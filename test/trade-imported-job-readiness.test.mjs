import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/app/api/trade-job-readiness/route.ts", import.meta.url), "utf8");

test("imported history cannot create plans, stock usage, readiness or completion outcomes", async () => {
  const queries = [];
  const forbidden = () => { throw new Error("Imported work reached an operational write"); };
  const dependencies = {
    "@/lib/trade-form-job-progress": { reconcileTradeFormJobProgress: async () => ({changed:false,stage:"imported",blockers:[]}) },
    "@/lib/trade-team-server": {},
    "../../../../db": { getD1: () => ({ prepare(sql) {
      queries.push(sql);
      assert.match(sql, /SELECT w.id, w.assignee_member_id, w.stage/);
      return { bind(jobId, owner) {
        assert.equal(jobId, "imported-job"); assert.equal(owner, "business-owner");
        return { first: async () => ({ id: jobId, stage: "imported", customer_source: "trade_owned" }) };
      } };
    }, batch: forbidden }) },
    "@/lib/admin-server": { sameOrigin: () => true, cleanAdminText: value => String(value || ""),
      adminJson: (value, status = 200) => Response.json(value, { status }) },
    "@/lib/trade-integrations-server": { requireInstallerOperations: async () => ({ uid: "business-owner" }) },
    "@/lib/trade-job-plan-server": { buildJobPlanStatements: forbidden },
    "@/lib/trade-stock-server": { jobStock: forbidden, stockActualStatements: forbidden },
    "@/lib/photo-request-review-server": { photoRequestProofOverview: forbidden },
  };
  const loadedModule = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unbound dependency ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  for (const action of ["prepare", "requirement", "deposit", "ready", "actual", "complete"]) {
    const response = await loadedModule.exports.POST(new Request("https://tlink.test/api/trade-job-readiness", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workOrderId: "imported-job", action }),
    }));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "IMPORTED_JOB_INACTIVE");
  }
  assert.equal(queries.length, 6);
});
