import fs from 'node:fs';
import ts from 'typescript';
import * as guards from '../../src/lib/trade-rental-correction-schema-guards.ts';
import * as actors from '../../src/lib/trade-message-media-access.ts';
import * as predicates from '../../src/lib/trade-account-predicates.ts';
import * as visibility from '../../src/lib/trade-rental-report-visibility.ts';

const dependencies = { './trade-rental-correction-schema-guards': guards, './trade-message-media-access': actors, './trade-account-predicates': predicates };
const compiled = ts.transpileModule(fs.readFileSync(new URL('../../src/lib/trade-rental-correction-drafts.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const drafts = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => {
  if (!(name in dependencies)) throw new Error(`Unmapped rental correction fixture dependency ${name}`);
  return dependencies[name];
}, drafts, drafts.exports);

export const RENTAL_REPORT_TEST_DEPENDENCIES = {
  '@/lib/trade-rental-correction-schema-guards': guards,
  '@/lib/trade-rental-correction-drafts': drafts.exports,
  '@/lib/trade-rental-report-visibility': visibility,
  './trade-rental-report-visibility': visibility,
};
