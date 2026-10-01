import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeTradeFormAnswers } from "../src/lib/trade-form-library.mjs";

const source = fs.readFileSync(new URL("../src/app/api/trade-job-forms/route.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
const patch = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PATCH");
const compiled = ts.transpileModule(patch.getText(ast).replace("export ", ""), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(overrides = {}) {
  const row = { id: "form", template_key: "test", template_snapshot: JSON.stringify({ fields: [{ key: "result", type: "text", required: true }] }),
    status: "complete", revision: 3, answers: '{"result":"Passed"}', completed_by_uid: "worker",
    job_stage: "in_progress", job_revision: 7, ...overrides };
  const calls = [];
  const dependencies = {
    sameOrigin: () => true,
    cleanAdminText: value => String(value || ""),
    accessAndJob: async () => ({ access: { ownerUid: "owner", actorUid: "worker", canManageFieldEvidence: true }, job: { revision: 7 } }),
    getD1: () => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }), batch: () => assert.fail("A completed replay must never rewrite its form") }),
    parseJson: (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } },
    normalizeTradeFormAnswers,
    reconcileTradeFormJobProgress: async (access, workOrderId, options) => {
      calls.push({ access, workOrderId, options });
      return { changed: false, stage: "", pending: true, blockers: [{ key: "job_progress_pending" }] };
    },
    formPayload: async () => ({ forms: [{ id: row.id, revision: row.revision, status: row.status }] }),
    adminJson: (value, status = 200) => Response.json(value, { status }),
    formError: error => Response.json({ ok: false, error: error.message }, { status: 409 }),
  };
  const handler = new Function(...Object.keys(dependencies), compiled + "; return PATCH;")(...Object.values(dependencies));
  return { calls, handler };
}

const request = (changes = {}) => new Request("https://example.test/api/trade-job-forms", {
  method: "PATCH", headers: { "content-type": "application/json" },
  body: JSON.stringify({ workOrderId: "job", formId: "form", baseRevision: 2, answers: { result: "Passed" }, complete: true, ...changes }),
});

test("exact same-actor completion replay recovers progress without rewriting immutable form data", async () => {
  const { handler, calls } = fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true); assert.equal(payload.duplicate, true); assert.equal(payload.jobProgress.pending, true);
  assert.deepEqual(payload.forms, [{ id: "form", revision: 3, status: "complete" }]);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].options, { afterSave: true });
});

test("completed replay rejects other actors, changed answers, wrong revisions, cancelled and imported jobs", async () => {
  for (const [row, body] of [
    [{ completed_by_uid: "another-worker" }, {}], [{}, { answers: { result: "Changed" } }],
    [{}, { baseRevision: 1 }], [{}, { complete: false }], [{ job_stage: "cancelled" }, {}], [{ job_stage: "imported" }, {}],
  ]) {
    const { handler, calls } = fixture(row);
    assert.equal((await handler(request(body))).status, 409);
    assert.equal(calls.length, 0);
  }
});

test("an exact retry remains acknowledged after the job already completed", async () => {
  const { handler, calls } = fixture({ job_stage: "completed" });
  assert.equal((await handler(request())).status, 200); assert.equal(calls.length, 1);
});
