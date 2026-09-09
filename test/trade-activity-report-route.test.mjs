import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const routeSource = readFileSync(new URL("../src/app/api/trade-activity-forms/route.ts", import.meta.url), "utf8");

class BoundedJsonRequestError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function loadRoute({ originAccepted, readPdf = async () => reportBytes() }) {
  const calls = { origin: 0, auth: 0, shared: [], loaded: [] };
  const record = {
    id: "record-a",
    ownerUid: "owner-a",
    workOrderId: "job-a",
    recordNumber: "TAF-REPORT-A",
    submittedAt: "2026-09-09T01:02:03.000Z",
    status: "submitted_for_creditex_review",
    form: { title: "Completed activity", activityTemplateId: "activity-a", fields: [], declarations: [] },
    evidence: [],
  };
  const output = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "src/app/api/trade-activity-forms/route.ts",
  }).outputText;
  const moduleRecord = { exports: {} };
  const mocks = {
    "../../../../db": { getD1: () => ({}) },
    "@/lib/admin-server": {
      adminJson: (value, status = 200) => Response.json(value, { status }),
      requireAdminIdentity: async () => { throw new Error("unexpected admin access"); },
      sameOrigin: () => { calls.origin += 1; return originAccepted; },
    },
    "@/lib/trade-team-server": {
      requireInstallerTeamAccess: async () => { calls.auth += 1; return { ownerUid: "owner-a", actorUid: "worker-a" }; },
    },
    "@/lib/compliance-access-server": { requireComplianceAccess: async () => { throw new Error("unexpected compliance access"); } },
    "@/lib/creditex-field-master-access": { canEditCreditexFieldMasters: () => false },
    "@/lib/creditex-official-source-custody-server": { resolveActiveCreditexOfficialSourceOrganisation: async () => "creditex" },
    "@/lib/bounded-json-request": { BoundedJsonRequestError, readBoundedJsonRequest: async () => ({}) },
    "@/lib/trade-activity-forms-library": {
      activityFieldCatalogue: () => [], applyDefaultActivityFormPolicy: (value) => value,
      defaultActivityFieldForm: () => ({}),
    },
    "@/lib/trade-activity-forms": {
      activityCanonical: JSON.stringify, activityHash: () => "a".repeat(64), normaliseActivityAnswers: (value) => value,
    },
    "@/lib/trade-activity-forms-server": {
      activityPresentation: (value) => value,
      activitySigningProfileSetup: async () => undefined,
      saveActivitySigningProfile: async () => record,
      changeActivityVariant: async () => record,
      listActivityRecords: async () => [],
      loadActivityRecord: async (access, id) => { calls.loaded.push({ access, id }); return record; },
      openActivityRecord: async () => record,
      readActivityConsumerDocument: async () => reportBytes(),
      readActivityEvidence: async () => reportBytes(),
      readActivityPdf: readPdf,
      saveActivityAnswers: async () => record,
      shareActivityReport: async () => "",
      sharedActivityRecord: async (token) => { calls.shared.push(token); return record; },
      signActivityDeclaration: async () => record,
      submitActivityRecord: async () => record,
      uploadActivityEvidence: async () => record,
    },
  };
  new Function("require", "module", "exports", output)((specifier) => {
    assert.ok(Object.hasOwn(mocks, specifier), `Unexpected module dependency: ${specifier}`);
    return mocks[specifier];
  }, moduleRecord, moduleRecord.exports);
  return { route: moduleRecord.exports, calls };
}

function reportBytes() {
  return {
    bytes: new TextEncoder().encode("%PDF-completed-activity"),
    contentType: "application/pdf",
    fileName: "TAF-REPORT-A.pdf",
  };
}

test("a valid share token can deliver the immutable PDF from an external browser context", async () => {
  const token = "a".repeat(64);
  const { route, calls } = loadRoute({ originAccepted: false });
  const response = await route.GET(new Request(
    `https://tlink.example/api/trade-activity-forms?reportToken=${token}&view=pdf`,
    { headers: { Origin: "https://mail.example" } },
  ));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(await response.text(), "%PDF-completed-activity");
  assert.deepEqual(calls.shared, [token]);
  assert.equal(calls.origin, 0);
  assert.equal(calls.auth, 0);
});

test("portal report delivery authenticates and resolves the owner-scoped activity record", async () => {
  const { route, calls } = loadRoute({ originAccepted: true });
  const response = await route.GET(new Request(
    "https://tlink.example/api/trade-activity-forms?recordId=record-a&view=pdf",
    { headers: { Authorization: "Bearer installer-token", Origin: "https://tlink.example" } },
  ));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "%PDF-completed-activity");
  assert.equal(calls.origin, 1);
  assert.equal(calls.auth, 1);
  assert.deepEqual(calls.loaded, [{ access: { ownerUid: "owner-a", actorUid: "worker-a" }, id: "record-a" }]);
});

test("missing retained report bytes return a specific response instead of ACTIVITY_REQUEST_FAILED", async () => {
  const { route } = loadRoute({
    originAccepted: true,
    readPdf: async () => { throw new Error("ACTIVITY_REPORT_UNAVAILABLE"); },
  });
  const response = await route.GET(new Request(
    "https://tlink.example/api/trade-activity-forms?recordId=record-a&view=pdf",
    { headers: { Authorization: "Bearer installer-token" } },
  ));

  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "ACTIVITY_REPORT_UNAVAILABLE");
});
