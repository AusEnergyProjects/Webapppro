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
