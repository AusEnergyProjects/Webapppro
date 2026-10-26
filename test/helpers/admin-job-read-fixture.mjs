import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as errors from '../../src/lib/admin-job-read-error.ts';

// Existing trade fixtures have no administrator session. Load the real support
// boundary so ordinary requests remain unchanged and support headers fail closed.
const unavailable = () => { throw new Error('AUTH_REQUIRED'); };
const dependencies = {
  '../../db': { getD1: unavailable },
  './admin-job-read-error': errors,
  './admin-server': {
    adminJson: (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
    adminError: () => Response.json({ ok: false, error: 'No admin session in this trade fixture.' }, { status: 401 }),
    requireAdminIdentity: unavailable,
    writeAdminAudit: unavailable,
    sameOrigin: request => !request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin,
  },
};
const source = fs.readFileSync(new URL('../../src/lib/admin-job-read-access.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(specifier => {
  assert.ok(dependencies[specifier], `Unexpected job support fixture dependency: ${specifier}`);
  return dependencies[specifier];
}, loaded, loaded.exports);
export const { requireAdminJobReadAccess, rejectAdminJobAccess, rejectAdminJobMutation, ADMIN_JOB_HEADER } = loaded.exports;
export const { AdminJobReadError, adminJobReadError } = errors;
