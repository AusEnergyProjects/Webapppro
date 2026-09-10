import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const apiSource = fs.readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');

class TestApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function responseBodyFunction() {
  const sourceFile = ts.createSourceFile('api.ts', apiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = sourceFile.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'responseBody');
  assert.ok(declaration, 'responseBody must remain executable');
  const javascript = ts.transpileModule(declaration.getText(sourceFile), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function('ApiError', `${javascript}; return responseBody;`)(TestApiError);
}

const responseBody = responseBodyFunction();

function requestHarness() {
  const sourceFile = ts.createSourceFile('api.ts', apiSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statements = sourceFile.statements.filter((statement) =>
    (ts.isFunctionDeclaration(statement) && statement.name?.text === 'fetchJson')
    || (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((entry) =>
      ['JSON_REQUEST_TIMEOUT_MS', 'REPORT_REQUEST_TIMEOUT_MS', 'MULTIPART_REQUEST_TIMEOUT_MS'].includes(entry.name.getText(sourceFile)))));
  const javascript = ts.transpileModule(statements.map((entry) => entry.getText(sourceFile)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const state = { deadline: 0, abort: null, resolve: null, cleared: false };
  const fetch = (_url, init) => new Promise((resolve, reject) => {
    state.resolve = resolve;
    if (init.signal.aborted) reject(new Error('aborted'));
    else init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const request = new Function('ApiError', 'fetch', 'expoFetch', 'setTimeout', 'clearTimeout', `${javascript}; return fetchJson;`)(
    TestApiError, fetch, fetch, (callback, delay) => { state.abort = callback; state.deadline = delay; return 1; },
    () => { state.cleared = true; },
  );
  return { request, state };
}

test('a report taking 58 seconds is not cancelled by the ordinary 20 second deadline', async () => {
  const { request, state } = requestHarness();
  const pending = request('https://tlink.test/report', { method: 'POST' }, { operation: 'report' });
  assert.equal(state.deadline, 120_000);
  assert.ok(state.deadline > 58_000);
  state.resolve(new Response('{"ok":true}'));
  assert.equal((await pending).status, 200);
  assert.equal(state.cleared, true);
});

test('ordinary API requests keep their short deadline and report timeouts do not blame reception', async () => {
  const normal = requestHarness();
  const normalPending = normal.request('https://tlink.test/job', {});
  assert.equal(normal.state.deadline, 20_000);
  normal.state.abort();
  await assert.rejects(normalPending, (error) => error.code === 'NETWORK_TIMEOUT');
  const report = requestHarness();
  const reportPending = report.request('https://tlink.test/report', {}, { operation: 'report' });
  report.state.abort();
  await assert.rejects(reportPending, (error) => error.code === 'NETWORK_TIMEOUT'
    && /finish request is saved/.test(error.message) && !/reception/.test(error.message));
});

test('explicit request cancellation still stops a report and clears its deadline', async () => {
  const { request, state } = requestHarness();
  const controller = new AbortController();
  const pending = request('https://tlink.test/report', { signal: controller.signal }, { operation: 'report' });
  controller.abort();
  await assert.rejects(pending, (error) => error.message === 'aborted' && !error.code);
  assert.equal(state.cleared, true);
});

test('a non-JSON 413 becomes an explicit upload-too-large failure', async () => {
  await assert.rejects(
    responseBody(new Response('Payload Too Large', { status: 413, headers: { 'content-type': 'text/plain' } })),
    (error) => error instanceof TestApiError
      && error.status === 413
      && error.code === 'UPLOAD_TOO_LARGE'
      && /original remains on this phone/i.test(error.message),
  );
});

test('a malformed 200 response is never accepted as a successful record', async () => {
  await assert.rejects(
    responseBody(new Response('<html>upstream outage</html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    (error) => error instanceof TestApiError
      && error.status === 200
      && error.code === 'INVALID_SERVER_RESPONSE'
      && /work is retained/i.test(error.message),
  );
  assert.equal([...apiSource.matchAll(/const body = await responseBody\(response\);/g)].length, 2,
    'authenticated and public JSON requests must share the rejecting parser');
});
