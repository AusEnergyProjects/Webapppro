import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as contract from "../../src/lib/wattzun-work-context.ts";

export { contract as workContextContract };

export function syntheticWorkContext(overrides = {}) {
  return {
    reference: { kind: "trade_job", recordId: "synthetic-job" }, title: "Synthetic electrical inspection",
    sourceSha256: "a".repeat(64),
    sources: [{ id: "trade_job_overview", label: "Job overview",
      href: "/direct-trade/dashboard?workspace=work&jobId=synthetic-job&jobTab=summary", description: "Recorded job scope only." }],
    facts: { job: { workNumber: "JOB-TEST-1", scope: "Review the recorded switchboard condition", operationalStage: "ready" } },
    limitations: ["Read-only selected job. No uploaded file contents, private notes, schedule or financial records were loaded."],
    ...overrides,
  };
}

/** Run the production context gateway with explicitly mocked authorised projections. */
export function workContextGateway(projectors = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../../src/lib/wattzun-work-context-server.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const unavailable = async () => { throw new Error("Unexpected context projector"); };
  const dependencies = {
    "./wattzun-work-context": contract,
    "./wattzun-work-context.ts": contract,
    "./wattzun-trade-context-server": { loadWattzunTradeContext: projectors.trade || unavailable },
    "./wattzun-creditex-context-server": { loadWattzunCreditexContext: projectors.creditex || unavailable },
    "./wattzun-council-context-server": { loadWattzunCouncilContext: projectors.council || unavailable },
    "./wattzun-form-server": { loadWattzunFormContext: projectors.form || unavailable },
    "./wattzun-council-demographics-server": { loadWattzunCouncilDemographics: projectors.demographics || unavailable },
  };
  Function("require", "exports", code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected work-context dependency: ${id}`);
    return dependencies[id];
  }, exports);
  return exports;
}
