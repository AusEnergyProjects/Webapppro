import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { readBoundedJsonRequest, BoundedJsonRequestError } from "../src/lib/bounded-json-request.ts";
import { GOVERNMENT_ACTIVITY_TEMPLATES } from "../src/lib/australian-government-program-catalogue.ts";
import { registrySchemeForProgram } from "../src/lib/creditex-registry.ts";

class KnownError extends Error { constructor(code, status, message) { super(message); this.code = code; this.status = status; } }
class CreditexRegistryError extends KnownError {}
class CreditexOutputActionError extends KnownError {}
class CreditexActivityWorkPackServerError extends KnownError {}
class ComplianceAccessError extends KnownError {}
const db = { id: "test-database" };
const actor = { actorUid: "operator", organisationId: "trusted-org", actorKind: "compliance" };
function compile(file, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}
function fixture() {
  const state = { calls: [], sameOrigin: true, accessError: null };
  const call = (name, result) => async (...args) => { state.calls.push({ name, args }); return result; };
  const operations = { CreditexRegistryError,
    loadRegistryWorkspace: call("workspace", { accounts: [], claims: [], invoices: [], payments: [], results: [], capabilities: { canOperate: true } }),
    listRegistryUnresolvedMatches: call("unresolved_matches", []),
    saveRegistryAccount: call("save_account"), disableRegistryAccount: call("disable_account"), attachRegistryAccount: call("attach_account"),
    storeRegistryEvidence: call("store_evidence", "private-evidence"), downloadRegistryEvidence: call("download_evidence", new Response("private evidence")),
    registryOnboardingRequest: call("onboarding", "Approved account connection request"), recordRegistryInvoice: call("record_invoice"),
    recordRegistryPayment: call("record_payment"), recordRegistryResult: call("record_result"), reviewRegistryResult: call("review_result"),
  };
  const shared = compile("../src/app/api/creditex/registry/_shared.ts", {
    "@/lib/bounded-json-request": { readBoundedJsonRequest, BoundedJsonRequestError },
    "@/lib/compliance-access-server": { ComplianceAccessError },
    "@/lib/creditex-activity-work-pack-server": { CreditexActivityWorkPackServerError },
    "@/lib/creditex-output-action-server": { CreditexOutputActionError },
    "@/lib/creditex-registry-server": operations,
    "@/lib/creditex-registry-exports": { registryExportTemplate: call("template", "Reference\r\npacket-one\r\n"), prepareRegistryExport: call("prepare_export"), reviewRegistryExport: call("review_export"),
      downloadRegistryExport: call("download_export", new Response("approved export")), previewRegistryExport: call("preview_export", { csv: "Reference" }), listRegistryExports: call("exports", []) },
    "@/lib/creditex-registry-formats": { listRegistryFormats: () => [{ key: "rec_sgu", label: "REC solar", scheme: "stc", headers: ["Reference"], maximumRecords: 1000, referenceField: "Reference", version: "test", source: "not copied to browser" }] },
    "@/lib/creditex-registry-rec": { syncRecRegistry: call("sync_rec", { updatedClaims: 0, matches: [] }) },
    "@/lib/australian-government-program-catalogue": { GOVERNMENT_ACTIVITY_TEMPLATES },
    "@/lib/creditex-registry": { registrySchemeForProgram },
    "@/lib/creditex-registry-batches": {
      loadRegistryBatchWorkspace: call("batch_workspace", { readyGroups: [], blockedClaims: [], batches: [], capabilities: { canOperate: true } }),
      exportReadyRegistryBatch: call("export_ready_batch", { id: "retained-batch" }),
      downloadRegistryBatch: call("download_batch", new Response("private zip", { headers: { "Content-Type": "application/zip" } })),
      recordRegistryBatchLodgement: call("record_batch_lodgement", { submittedCount: 2, failedCount: 0, results: [] }),
    },
  });
  const compliance = compile("../src/app/api/creditex/registry/route.ts", {
    "../../../../../db": { getD1: () => db },
    "@/lib/admin-server": { sameOrigin: () => state.sameOrigin },
    "@/lib/compliance-access-server": { async requireComplianceAccess(request, options, database) {
      state.calls.push({ name: "compliance_auth", args: [request, options, database] });
      if (state.accessError) throw state.accessError;
      return { uid: actor.actorUid, organisationId: actor.organisationId };
    } },
    "./_shared": shared,
  });
  const admin = compile("../src/app/api/admin/compliance-registry/route.ts", {
    "../../../../../db": { getD1: () => db },
    "@/lib/admin-server": { sameOrigin: () => state.sameOrigin, async requireAdminIdentity(request, roles) {
      state.calls.push({ name: "admin_auth", args: [request, roles] });
      if (state.accessError) throw state.accessError;
      return { uid: "admin-operator" };
    }, adminError: () => new Response("Admin access unavailable", { status: 403 }) },
    "@/lib/creditex-official-source-custody-server": { resolveActiveCreditexOfficialSourceOrganisation: call("active_org", "active-creditex-org") },
    "@/app/api/creditex/registry/_shared": shared,
  });
  return { state, shared, compliance, admin };
}
function jsonRequest(value, query = "") { return new Request(`https://example.test/api/creditex/registry${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); }

test("batch readiness and private downloads use the authenticated organisation", async () => {
  const f = fixture();
  const plan = await f.compliance.GET(new Request("https://example.test/api/creditex/registry?view=batches&organisationId=untrusted"));
  assert.equal(plan.status, 200); assert.deepEqual((await plan.json()).readyGroups, []);
  assert.deepEqual(f.state.calls.find(call => call.name === "batch_workspace").args, [db, actor]);
  const download = await f.compliance.GET(new Request("https://example.test/api/creditex/registry?download=batch&batchId=batch-one&organisationId=untrusted"));
  assert.equal(await download.text(), "private zip");
  assert.deepEqual(f.state.calls.find(call => call.name === "download_batch").args, [db, actor, "batch-one"]);
});

test("batch export and actual lodgement have distinct authenticated operations and return refreshed state", async () => {
  for (const action of ["export_ready_batch", "record_batch_lodgement"]) {
    const f = fixture(), input = { action, organisationId: "untrusted", actorUid: "spoofed", batchId: "batch-one", requestId: "request-one", expectedPacketIds: ["p1"], providerReference: "ACTUAL-1" };
    const response = await f.compliance.POST(jsonRequest(input));
    assert.equal(response.status, 200);
    const result = await response.json(); assert.ok(action === "export_ready_batch" ? result.batch : result.outcome);
    const operation = f.state.calls.find(call => call.name === action);
    assert.deepEqual(operation.args.slice(0, 2), [db, actor]); assert.deepEqual(operation.args[2], input);
    assert.ok(f.state.calls.find(call => call.name === "batch_workspace"));
    assert.equal(f.state.calls.filter(call => call.name === (action === "export_ready_batch" ? "record_batch_lodgement" : "export_ready_batch")).length, 0);
  }
});

test("compliance mutations use server-resolved organisation and actor despite supplied identity fields", async () => {
  const f = fixture();
  const response = await f.compliance.POST(jsonRequest({ action: "save_account", organisationId: "attacker-org", actorUid: "attacker" }));
  assert.equal(response.status, 200);
  const save = f.state.calls.find(call => call.name === "save_account");
  assert.equal(save.args[0], db);
  assert.deepEqual(save.args[1], actor);
  assert.deepEqual(f.state.calls[0].args[1].allowedRoles, ["admin", "case_manager", "reviewer", "auditor"]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("admin mutations resolve the active Creditex organisation and keep admin identity", async () => {
  const f = fixture();
  assert.equal((await f.admin.POST(jsonRequest({ action: "record_payment", organisationId: "untrusted" }))).status, 200);
  assert.deepEqual(f.state.calls.find(call => call.name === "record_payment").args[1], { actorUid: "admin-operator", organisationId: "active-creditex-org", actorKind: "admin" });
  assert.deepEqual(f.state.calls.find(call => call.name === "admin_auth").args[1], ["owner", "admin", "reviewer"]);
});

test("same-origin denial happens before authentication or data access for both wrappers", async () => {
  for (const name of ["compliance", "admin"]) {
    const f = fixture(); f.state.sameOrigin = false;
    assert.equal((await f[name].POST(jsonRequest({ action: "save_account" }))).status, 403);
    assert.equal(f.state.calls.length, 0);
  }
});

test("known permission errors retain safe error codes and deny operations", async () => {
  const f = fixture(); f.state.accessError = new ComplianceAccessError("ACCESS_DENIED", 403, "Access is unavailable.");
  const response = await f.compliance.GET(new Request("https://example.test/api/creditex/registry"));
  assert.deepEqual(await response.json(), { ok: false, code: "ACCESS_DENIED", error: "Access is unavailable." });
  assert.equal(f.state.calls.filter(call => call.name !== "compliance_auth").length, 0);
  f.state.accessError = new Error("secret database connection failure");
  const unknown = await f.compliance.GET(new Request("https://example.test/api/creditex/registry"));
  assert.equal(unknown.status, 500);
  assert.equal((await unknown.text()).includes("secret"), false);
});

test("REC sync accepts only account/date parameters and never accepts a caller's source URL or result", async () => {
  const f = fixture();
  const response = await f.compliance.POST(jsonRequest({ action: "sync_rec", accountId: "account-one", date: "2026-09-22", source: "rec_public_register", sourceUrl: "https://attacker.test", registryStatus: "registered" }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.state.calls.find(call => call.name === "sync_rec").args.slice(1), [actor, { accountId: "account-one", date: "2026-09-22" }]);
  assert.equal(f.state.calls.some(call => call.name === "record_result"), false);
});

test("unknown actions, arrays and malformed JSON cannot mutate registry data", async () => {
  for (const body of ["{invalid", "[]", "null", JSON.stringify({ action: "insertRegistryResult", source: "rec_public_register" })]) {
    const f = fixture();
    const response = await f.compliance.POST(new Request("https://example.test/api/creditex/registry", { method: "POST", body }));
    assert.equal(response.status, 400);
    assert.deepEqual(f.state.calls.map(call => call.name), ["compliance_auth"]);
  }
});

test("streamed JSON is bounded without trusting content length", async () => {
  const f = fixture(); let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  const response = await f.compliance.POST(new Request("https://example.test/api/creditex/registry", { method: "POST", body: stream, duplex: "half" }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "The registry request is too large.");
  assert.equal(cancelled, true);
  assert.equal(f.state.calls.length, 1);
});

test("one multipart evidence file reaches custody with trusted actor; text and multiple parts fail", async () => {
  const f = fixture(), data = new FormData();
  data.append("file", new File(["evidence"], "evidence.txt", { type: "text/plain" }));
  const response = await f.compliance.POST(new Request("https://example.test/api/creditex/registry?upload=evidence", { method: "POST", body: data }));
  assert.deepEqual(await response.json(), { ok: true, evidenceId: "private-evidence" });
  const upload = f.state.calls.find(call => call.name === "store_evidence");
  assert.deepEqual(upload.args[1], actor);
  assert.equal(upload.args[2].name, "evidence.txt");
  for (const makeData of [() => { const d = new FormData(); d.append("file", "plain text"); return d; }, () => { const d = new FormData(); d.append("file", new File(["a"], "a.txt")); d.append("extra", "no"); return d; }]) {
    const invalid = fixture();
    assert.equal((await invalid.compliance.POST(new Request("https://example.test/api/creditex/registry?upload=evidence", { method: "POST", body: makeData() }))).status, 400);
    assert.equal(invalid.state.calls.length, 1);
  }
});

test("oversized streamed uploads are cancelled before multipart parsing or evidence storage", async () => {
  const f = fixture(); let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 65537)); }, cancel() { cancelled = true; } });
  const response = await f.compliance.POST(new Request("https://example.test/api/creditex/registry?upload=evidence", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test" }, body: stream, duplex: "half" }));
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(f.state.calls.length, 1);
});

test("onboarding downloads remain private attachments, authenticated evidence download preserves actor scope", async () => {
  const f = fixture();
  const response = await f.compliance.GET(new Request("https://example.test/api/creditex/registry?download=onboarding&accountId=account-one"));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("Content-Disposition"), /^attachment;/);
  assert.deepEqual(f.state.calls.find(call => call.name === "onboarding").args.slice(1), [actor, "account-one"]);
  await f.compliance.GET(new Request("https://example.test/api/creditex/registry?download=evidence&evidenceId=evidence-one&organisationId=untrusted"));
  assert.deepEqual(f.state.calls.find(call => call.name === "download_evidence").args.slice(1), [actor, "evidence-one"]);
});
