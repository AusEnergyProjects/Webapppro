import { readFileSync } from 'node:fs';
import ts from 'typescript';

export class TurnAccessError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const turnAuthorityContract = {};
Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../src/lib/wattzun-turn-authority-server.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(name => {
  if (name === '../../db' || name === './trade-team-server') return {};
  if (name === './wattzun-portal-access-server') return { WattzunAccessError: TurnAccessError };
  throw new Error(name);
}, turnAuthorityContract);
