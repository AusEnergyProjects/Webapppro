import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as firebaseMfa from '../../src/lib/firebase-mfa.ts';
import * as myobSecurityAudit from '../../src/lib/myob-security-audit.ts';

// Load production response translation without providing a permissive auth or
// database stub. These API fixtures supply their own scoped access separately.
const unavailableRuntime = () => { throw new Error('Authentication and database access are unavailable in the response fixture.'); };
const dependencies = {
  '../../db': { getD1: unavailableRuntime },
  '@/lib/firebase-server': { requireFirebaseIdentity: unavailableRuntime },
  '@/lib/firebase-mfa': firebaseMfa,
  '@/lib/myob-security-audit': myobSecurityAudit,
};
const source = fs.readFileSync(new URL('../../src/lib/admin-server.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(specifier => {
  assert.ok(dependencies[specifier], `Unexpected admin response dependency: ${specifier}`);
  return dependencies[specifier];
}, loaded, loaded.exports);

export const { mfaErrorResponse } = loaded.exports;
