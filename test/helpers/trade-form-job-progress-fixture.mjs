import fs from "node:fs";
import ts from "typescript";
import * as actorGuard from "../../src/lib/trade-message-media-access.ts";

/** Executes the production progress SQL with the route fixture's D1 and external proof dependencies. */
export function loadFormJobProgress(db, requireDependency) {
  const source = fs.readFileSync(new URL("../../src/lib/trade-form-job-progress.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(specifier => {
    if (specifier === "../../db") return { getD1: () => db };
    if (specifier === "./trade-message-media-access") return actorGuard;
    return requireDependency(specifier.replace(/^\.\//, "@/lib/"));
  }, loaded, loaded.exports);
  return loaded.exports;
}
