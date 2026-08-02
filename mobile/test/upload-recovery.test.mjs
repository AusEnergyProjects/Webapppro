import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function sourceFunction(source, name) {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(declaration, `missing ${name}`);
  return declaration.getText(sourceFile);
}

function executableFunction(source, name) {
  const output = ts.transpileModule(sourceFunction(source, name), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return Function(`${output}; return ${name};`)();
}

const uploads = read('../src/lib/uploads.ts');
const api = read('../src/lib/api.ts');
const provider = read('../src/providers/app-provider.tsx');

test('completed sessions are locally completed before encrypted parts are inspected or uploaded', () => {
  const sessionAction = executableFunction(uploads, 'sessionAction');
  assert.equal(sessionAction('completed'), 'complete');
  assert.equal(sessionAction('uploading'), 'continue');
  assert.equal(sessionAction('completing'), 'continue');

  const attempt = sourceFunction(uploads, 'processUploadAttempt');
  const completed = attempt.indexOf("action === 'complete'");
  const localComplete = attempt.indexOf('await completeUpload(row.id)', completed);
  const bundleCheck = attempt.indexOf('encryptedBundleExists');
  assert.ok(completed >= 0 && localComplete > completed);
  assert.ok(localComplete < bundleCheck);
});

test('expired and aborted sessions restart while rejected and unknown terminal states stop', () => {
  const sessionAction = executableFunction(uploads, 'sessionAction');
  assert.equal(sessionAction('expired'), 'restart');
  assert.equal(sessionAction('aborted'), 'restart');
  assert.equal(sessionAction('rejected'), 'reject');
  assert.equal(sessionAction('unexpected'), 'reject');
});

test('not-found, expired and invalid upload-session failures are recoverable but access errors are not', () => {
  const recoverable = executableFunction(uploads, 'isRecoverableSessionFailure');
  assert.equal(recoverable(404, '', 'Upload session not found.'), true);
  assert.equal(recoverable(410, 'UPLOAD_EXPIRED', 'Expired.'), true);
  assert.equal(recoverable(409, 'MANUAL_FIELD_UPLOAD_STATE_INVALID', 'Invalid.'), true);
  assert.equal(recoverable(409, '', 'This upload is no longer accepting parts.'), true);
  assert.equal(recoverable(403, 'TEAM_ACCESS_REQUIRED', 'Access denied.'), false);
  assert.equal(recoverable(409, 'EVIDENCE_HASH_MISMATCH', 'Hash mismatch.'), false);
});

test('restart rotates and persists one client upload ID while clearing only that row session', () => {
  const restart = sourceFunction(uploads, 'restartUpload');
  assert.match(restart, /clientUploadId = `upload-\$\{Crypto\.randomUUID\(\)\}`/);
  assert.match(restart, /updateUpload\(row\.id/);
  assert.match(restart, /client_upload_id:\s*clientUploadId/);
  assert.match(restart, /session_id:\s*''/);
  assert.match(restart, /uploaded_parts:\s*'\[\]'/);
  assert.doesNotMatch(restart, /purgeLocalData|completeUpload/);
  assert.match(uploads, /clientUploadId:\s*row\.client_upload_id \|\| row\.id/);
});

test('upload routing is explicit and queue processing remains lane-bound', () => {
  assert.match(uploads, /function mediaPath\(mode:\s*FieldAccessMode\)/);
  assert.match(uploads, /processUploadQueue\(mode:\s*FieldAccessMode\)/);
  assert.match(uploads, /queuedUploads\(mode\)/);
  assert.doesNotMatch(uploads, /getSetting\('field_access_mode'\)/);
});

test('route-level API errors never purge local work without confirmed field-access loss', () => {
  assert.doesNotMatch(api, /purgeLocalData|forgetPushToken/);
  assert.match(provider, /error\.status === 401 && error\.code === 'AUTH_REQUIRED'/);
  assert.match(provider, /error\.status === 403 && error\.code === 'FIELD_ACCESS_REQUIRED'/);

  const handler = provider.match(
    /const handleAccessError = useCallback[\s\S]*?(?=\n\s*const syncNow)/,
  )?.[0];
  assert.ok(handler);
  const revalidation = handler.indexOf("await apiRequest('/api/field/access')");
  const confirmedCheck = handler.indexOf('if (!isConfirmedFieldAccessLoss(accessError)) return false');
  const purge = handler.indexOf('await purgeLocalData()');
  assert.ok(revalidation >= 0);
  assert.ok(confirmedCheck > revalidation);
  assert.ok(purge > confirmedCheck);
});
