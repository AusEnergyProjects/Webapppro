import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function sourceFunction(source, name) {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(declaration, `missing ${name}`);
  return declaration.getText(sourceFile);
}

function firstMatchIndex(source, pattern, label) {
  const match = pattern.exec(source);
  assert.ok(match, `missing ${label}`);
  return match.index;
}

function loadFunctions(source, names, dependencies = {}) {
  const sourceFile = ts.createSourceFile('subject.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = sourceFile.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name && names.includes(statement.name.text));
  assert.deepEqual(declarations.map((statement) => statement.name.text), names);
  const output = ts.transpileModule(declarations.map((statement) => statement.getFullText(sourceFile)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const dependencyNames = Object.keys(dependencies);
  return new Function('exports', ...dependencyNames, `${output}\nreturn { ${names.join(', ')} };`)(
    {}, ...Object.values(dependencies),
  );
}

const completion = read('../src/lib/activity-form-completion.ts');
const database = read('../src/lib/database.ts');
const sync = read('../src/lib/sync.ts');
const background = read('../src/lib/background.ts');

test('the durable activity completion queue has the required public entry point and settings scan', () => {
  const sourceFile = ts.createSourceFile('activity-form-completion.ts', completion,
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const worker = sourceFile.statements.find((statement) =>
    ts.isFunctionDeclaration(statement)
      && statement.name?.text === 'processActivityFormCompletionQueue');

  assert.ok(worker, 'processActivityFormCompletionQueue must be a top-level function');
  assert.ok(worker.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    'processActivityFormCompletionQueue must be exported');
  assert.ok(worker.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword),
    'processActivityFormCompletionQueue must be async');
  assert.equal(worker.parameters.length, 1, 'the queue worker accepts only an optional cache key');
  assert.ok(worker.parameters[0].questionToken, 'the cache key must remain optional for all-cache sync');
  assert.equal(worker.parameters[0].type?.getText(sourceFile), 'string');

  const settingsStorage = `${database}\n${completion}`;
  assert.match(settingsStorage, /SELECT\s+key\s*,\s*value\s+FROM\s+settings\s+WHERE\s+key\s+LIKE/i,
    'queued form completion must be discoverable after a process restart');
  assert.match(settingsStorage, /activity-form:%/,
    'the settings scan must stay restricted to activity form cache rows');
});

test('ordinary sync drains activity completions before fetching authoritative job changes', () => {
  assert.match(sync, /import\s*\{[^}]*processActivityFormCompletionQueue[^}]*\}\s*from\s*['"]@\/lib\/activity-form-completion['"]/s);
  const performSync = sourceFunction(sync, 'performSync');
  const completionIndex = firstMatchIndex(performSync, /await\s+processActivityFormCompletionQueue\s*\(/,
    'activity completion queue processing');
  const fetchIndex = firstMatchIndex(performSync, /await\s+fetchChanges\s*\(/, 'authoritative change fetch');
  assert.ok(completionIndex < fetchIndex,
    'submitted activity state must reach the server before the refreshed job lifecycle is fetched');
});

test('activity image retries retain stable upload identity and a durable bounded JPEG', () => {
  assert.match(completion, /(?:append|set)\(\s*['"]clientUploadId['"]\s*,\s*pending\.id\s*\)/,
    'the retained pending ID must remain the server idempotency key');
  assert.match(completion, /preparedUploadUri:\s*prepared\.uri/,
    'the prepared file URI must be retained for identical retries');
  assert.match(completion, /preparedUploadVersion:\s*ACTIVITY_IMAGE_UPLOAD_VERSION/);
  assert.match(completion, /\[2560,\s*0\.8\]/);
  assert.match(completion, /file\.size\s*<=\s*MAX_ACTIVITY_IMAGE_UPLOAD_BYTES/);
});

test('generic Android images upload the compact canonical JPEG without a preview part', () => {
  assert.match(completion, /pending\.contentType\.toLowerCase\(\) !== 'application\/octet-stream'/);
  assert.match(completion, /\\\.\(\?:jpe\?g\|png\)\\b\/i/);
  const upload = sourceFunction(completion, 'uploadPendingFile');
  assert.match(upload, /prepareActivityImageUpload\(cacheKey,\s*latest,\s*pending\)/);
  assert.match(upload, /append\(\s*['"]file['"]\s*,\s*uploadFile\s*\)/);
  assert.doesNotMatch(upload, /append\(\s*['"]preview['"]/,
    'the canonical image is already small enough for the report');
  assert.match(upload, /captureMetadata['"]\s*,\s*JSON\.stringify\(pending\.metadata\)/,
    'capture and GPS metadata must remain unchanged');
});

test('image resizing bounds the longest side and never enlarges a smaller photo', () => {
  const { boundedActivityImageResize } = loadFunctions(completion, ['boundedActivityImageResize']);
  assert.deepEqual(boundedActivityImageResize(8000, 6000), { width: 2560 });
  assert.deepEqual(boundedActivityImageResize(3000, 4000), { height: 2560 });
  assert.equal(boundedActivityImageResize(1600, 1200), null);
});

test('one legacy failed image completion is retried once after the upload repair', () => {
  const retry = sourceFunction(completion, 'shouldRetryLegacyFailedImageUpload');
  assert.match(retry, /Boolean\(cache\.finishError\)/);
  assert.match(retry, /cache\.pending\.some\(pendingFileIsImage\)/);
  assert.match(retry, /imageUploadRepairVersion[\s\S]*ACTIVITY_IMAGE_UPLOAD_VERSION/);
  const worker = sourceFunction(completion, 'completeCache');
  assert.match(worker, /imageUploadRepairVersion:\s*ACTIVITY_IMAGE_UPLOAD_VERSION/);
  assert.match(worker, /finishRequested:\s*true/);
  const queue = sourceFunction(completion, 'processActivityFormCompletionQueue');
  assert.match(queue, /cache\.finishRequested\s*\|\|\s*shouldRetryLegacyFailedImageUpload\(cache\)/);
});

test('server receipt is persisted before the retained original is deleted', () => {
  const receipt = sourceFunction(completion, 'removeReceivedPendingFile');
  const removePendingIndex = firstMatchIndex(receipt,
    /await\s+acceptResponse\s*\([\s\S]{0,260}pending\s*:\s*[\s\S]{0,180}\.filter\s*\(/,
    'durable pending-item removal');
  const originalDeleteIndex = firstMatchIndex(receipt.slice(removePendingIndex),
    /new\s+File\(\s*pending\.uri\s*\)[\s\S]{0,120}\.delete\s*\(/,
    'retained original deletion') + removePendingIndex;
  assert.ok(removePendingIndex < originalDeleteIndex,
    'a crash after upload must not lose the only durable receipt or original');
});

test('a lost submit response recovers from the authoritative submitted record', () => {
  const worker = sourceFunction(completion, 'completeCache');
  const refreshIndex = firstMatchIndex(worker,
    /await\s+refresh\s*\(/,
    'authoritative record refresh');
  const submittedIndex = firstMatchIndex(worker,
    /status\s*===\s*['"]submitted_for_creditex_review['"]/,
    'already-submitted recovery check');
  const submitIndex = firstMatchIndex(worker,
    /await\s+submit\s*\(/,
    'submit request');
  assert.ok(refreshIndex < submittedIndex && submittedIndex < submitIndex,
    'the worker must accept an already submitted record before attempting another submit');
});

test('signature retries refuse to apply a stale declaration scope', () => {
  assert.match(completion, /ACTIVITY_SIGNING_SCOPE_CHANGED/);
  assert.match(completion, /signingUserContentChanged\s*\(/);
  assert.match(completion,
    /boundActivityDeclaration\s*\([\s\S]{0,220}(?:queued|pendingSignature)\.declarationText/,
    'scope retry must compare the current bound declaration with the retained signed text');
});

test('completion intent retries transport failures, stops invalid-state loops, and clears after confirmed success', () => {
  const worker = sourceFunction(completion, 'completeCache');
  const catchIndex = firstMatchIndex(worker, /\bcatch\s*\(/, 'completion failure handler');
  const classificationIndex = firstMatchIndex(worker.slice(catchIndex), /completionFailureNeedsAttention\s*\(/,
    'completion failure classification') + catchIndex;
  const retainedIndex = firstMatchIndex(worker.slice(catchIndex), /finishRequested\s*:\s*!needsAttention/,
    'retryable-only completion intent') + catchIndex;
  const submittedIndex = firstMatchIndex(worker, /status\s*===\s*['"]submitted_for_creditex_review['"]/,
    'confirmed submitted state');
  const clearedIndex = firstMatchIndex(worker.slice(submittedIndex), /finishRequested\s*:\s*false/,
    'cleared completion intent') + submittedIndex;

  assert.ok(classificationIndex > catchIndex && retainedIndex > classificationIndex);
  assert.ok(clearedIndex > submittedIndex,
    'finishRequested must clear only after the server confirms completion');
});

test('fresh-form reconciliation removes only answers the current form cannot save', () => {
  const flowSource = read('../../src/lib/trade-activity-form-flow.ts');
  const flowOutput = ts.transpileModule(flowSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const flow = {};
  new Function('exports', flowOutput)(flow);
  const { sanitiseActivityAnswers } = loadFunctions(completion, ['sanitiseActivityAnswers'], {
    activityBaseFieldKey: flow.activityBaseFieldKey,
    activityRepeatCount: flow.activityRepeatCount,
  });
  const form = { fields: [
    { key: 'scenario', type: 'select', options: ['current'], required: true },
    { key: 'capacity', type: 'number', options: [], required: true },
    { key: 'installedOn', type: 'date', options: [], required: true },
    { key: 'model', type: 'text', options: [], required: true, repeatGroup: 'products[]' },
    { key: 'photo', type: 'photo', options: [], required: true },
  ] };

  assert.deepEqual(sanitiseActivityAnswers(form, {
    '$repeat.products[]': 1,
    scenario: 'retired-option',
    capacity: '3.5',
    installedOn: '2026-09-09',
    model: '  Emerald 270  ',
    'model[1]': 'removed repeat',
    photo: 'must-not-be-an-answer',
    'retired.question': 'stale cache value',
  }), {
    '$repeat.products[]': 1,
    installedOn: '2026-09-09',
    model: 'Emerald 270',
  });
});

test('mobile signature acceptance matches the server path-length boundary', () => {
  const { activitySignatureStrokesAreValid } = loadFunctions(completion, ['activitySignatureStrokesAreValid']);
  assert.equal(activitySignatureStrokesAreValid([{ points: [{ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }] }]), false);
  assert.equal(activitySignatureStrokesAreValid([{ points: [
    { x: 0.2, y: 0.2 }, { x: 0.26, y: 0.25 }, { x: 0.4, y: 0.4 },
  ] }]), true);
});

test('pending and failed form completions remain visible in the ordinary sync counts', () => {
  assert.match(database, /key LIKE 'activity-form:%'/);
  assert.match(database, /json_extract\(value, '\$\.finishRequested'\) = 1/);
  assert.match(database, /json_extract\(value, '\$\.finishError'\)/);
  assert.match(database, /actions: \(actions\?\.count \|\| 0\) \+ \(activityCompletions\?\.count \|\| 0\)/);
  assert.match(database, /conflicts: \(conflicts\?\.count \|\| 0\) \+ \(activityCompletions\?\.errors \|\| 0\)/);
});

test('job activity rows can read the exact locally finished intent without completing sibling forms', () => {
  const getter = sourceFunction(database, 'listLocallyFinishedActivityIntentIds');
  assert.match(getter, /activity-form:\$\{workOrderId\}:%/,
    'the cache lookup must be restricted to the open job');
  assert.match(getter, /cache\.record\?\.workOrderId\s*!==\s*workOrderId/,
    'parsed cache content must also belong to the open job');
  assert.match(getter, /cache\.finishRequested\s*===\s*true/);
  assert.match(getter, /cache\.finishError/);
  assert.match(getter, /cache\.record\.intentId/);
});

test('background sync remains available to an active PIN field session', () => {
  assert.match(background, /TaskManager\.defineTask[\s\S]{0,500}await\s+runSync\s*\(/);
  assert.doesNotMatch(background, /if\s*\(\s*!firebaseAuth\.currentUser\s*\)\s*return/,
    'runSync already authorizes either Firebase or the retained field principal');
});
