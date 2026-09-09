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

test('activity evidence retries retain stable upload identity and clean every generated preview', () => {
  assert.match(completion, /(?:append|set)\(\s*['"]clientUploadId['"]\s*,\s*pending\.id\s*\)/,
    'the retained pending ID must remain the server idempotency key');

  const uploadRequest = firstMatchIndex(completion, /apiRequest[\s\S]{0,180}(?:method:\s*['"]POST['"]|body:\s*form)/,
    'activity evidence upload request');
  const finallyIndex = firstMatchIndex(completion.slice(uploadRequest), /\bfinally\b/,
    'preview cleanup finally block') + uploadRequest;
  const previewDeleteIndex = firstMatchIndex(completion.slice(finallyIndex),
    /(?:new\s+File\(previewUri\)|preview(?:File)?)[\s\S]{0,180}\.delete\s*\(/,
    'generated preview deletion') + finallyIndex;
  assert.ok(previewDeleteIndex > finallyIndex,
    'generated previews must be deleted after both successful and failed upload attempts');
});

test('generic Android image files still receive a compact report preview', () => {
  assert.match(completion, /pending\.contentType\.toLowerCase\(\) !== 'application\/octet-stream'/);
  assert.match(completion, /\\\.\(\?:jpe\?g\|png\)\\b\/i/);
  assert.match(completion, /if \(pendingFileIsImage\(pending\)\) previewUri = await generatedPreview\(pending\.uri\)/);
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

test('completion intent survives failure and clears only after confirmed success', () => {
  const worker = sourceFunction(completion, 'completeCache');
  const catchIndex = firstMatchIndex(worker, /\bcatch\s*\(/, 'completion failure handler');
  const retainedIndex = firstMatchIndex(worker.slice(catchIndex), /finishRequested\s*:\s*true/,
    'retained completion intent') + catchIndex;
  const submittedIndex = firstMatchIndex(worker, /status\s*===\s*['"]submitted_for_creditex_review['"]/,
    'confirmed submitted state');
  const clearedIndex = firstMatchIndex(worker.slice(submittedIndex), /finishRequested\s*:\s*false/,
    'cleared completion intent') + submittedIndex;

  assert.ok(retainedIndex > catchIndex);
  assert.ok(clearedIndex > submittedIndex,
    'finishRequested must clear only after the server confirms completion');
});

test('pending and failed form completions remain visible in the ordinary sync counts', () => {
  assert.match(database, /key LIKE 'activity-form:%'/);
  assert.match(database, /json_extract\(value, '\$\.finishRequested'\) = 1/);
  assert.match(database, /json_extract\(value, '\$\.finishError'\)/);
  assert.match(database, /actions: \(actions\?\.count \|\| 0\) \+ \(activityCompletions\?\.count \|\| 0\)/);
  assert.match(database, /conflicts: \(conflicts\?\.count \|\| 0\) \+ \(activityCompletions\?\.errors \|\| 0\)/);
});

test('background sync remains available to an active PIN field session', () => {
  assert.match(background, /TaskManager\.defineTask[\s\S]{0,500}await\s+runSync\s*\(/);
  assert.doesNotMatch(background, /if\s*\(\s*!firebaseAuth\.currentUser\s*\)\s*return/,
    'runSync already authorizes either Firebase or the retained field principal');
});
