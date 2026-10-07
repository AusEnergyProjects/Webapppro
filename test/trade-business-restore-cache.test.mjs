import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import { BoundedJsonRequestError, readBoundedJsonRequest } from "../src/lib/bounded-json-request.ts";
import { FirebaseMfaRequiredError, MFA_REQUIRED_MESSAGE, MFA_SETUP_URL } from "../src/lib/firebase-mfa.ts";
import { isJobMember } from "../src/lib/trade-job-collaboration.ts";
import { installEmptyTradeCrews } from './helpers/trade-crews-fixture.mjs';

function functions(file, names, dependencies = {}) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const nodes = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(nodes.length, names.length);
  const compiled = ts.transpileModule(nodes.map(node => node.getText()).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("exports", ...Object.keys(dependencies), `${compiled}\nreturn {${names.join(",")}};`)({}, ...Object.values(dependencies));
}
const admin = functions("src/lib/admin-server.ts", ["adminJson", "sameOrigin", "mfaErrorResponse"],
  { FirebaseMfaRequiredError, MFA_REQUIRED_MESSAGE, MFA_SETUP_URL });
const source = readFileSync(new URL("../src/app/api/trade-businesses/restore-cache/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(t, overrides = {}) {
  const database = new DatabaseSync(":memory:"); t.after(() => database.close());
  installEmptyTradeCrews(database);
  database.exec('CREATE TABLE trade_team_members(id TEXT,owner_uid TEXT,status TEXT)');
  database.exec(`CREATE TABLE trade_work_orders (id TEXT PRIMARY KEY, firebase_uid TEXT, partner_type TEXT DEFAULT 'installer',
    source_type TEXT DEFAULT 'internal', source_reference TEXT DEFAULT '', assignee_member_id TEXT DEFAULT 'member-a',
    assignee_label TEXT DEFAULT 'Installer', stage TEXT DEFAULT 'scheduled', service_category TEXT DEFAULT 'solar', revision INTEGER DEFAULT 1,
    record_status TEXT DEFAULT 'active');
    CREATE TABLE trade_crm_job_details (work_order_id TEXT, firebase_uid TEXT, customer_source TEXT);
    CREATE TABLE trade_crm_appointments (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, firebase_uid TEXT NOT NULL,
      assignee_member_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'scheduled');
    CREATE TABLE compliance_manual_evidence_test_jobs (id TEXT PRIMARY KEY, organisation_id TEXT DEFAULT 'manual-org',
      field_tester_uid TEXT DEFAULT 'person', form_version_id TEXT DEFAULT 'form', record_mode TEXT DEFAULT 'synthetic_test', status TEXT DEFAULT 'field_testing');
    CREATE TABLE compliance_manual_evidence_form_versions (id TEXT PRIMARY KEY, organisation_id TEXT DEFAULT 'manual-org',
      status TEXT DEFAULT 'test_ready', title TEXT DEFAULT 'Synthetic form', version INTEGER DEFAULT 1);
    INSERT INTO compliance_manual_evidence_form_versions (id) VALUES ('form');`);
  const identity = { uid: "person", emailVerified: true, ...overrides.identity };
  const access = { ownerUid: "business-a", actorUid: "person", memberId: "member-a", isOwner: false,
    jobScope: "own", canViewFieldEvidence: true, ...overrides.access };
  const calls = { selected: [], jobs: [], authenticated: 0, manualSelected: [], manualJobs: [] };
  const db = { prepare: sql => ({ bind: (...values) => ({ first: async () => database.prepare(sql).get(...values) || null }) }) };
  const jobs = functions("src/lib/trade-team-server.ts", ["assignedJob", "assignedJobStatement", "requireAssignedJob"], { getD1: () => db, isJobMember });
  const manual = functions("src/lib/creditex-manual-field-server.ts", ["manualFieldJobRow"], {
    CreditexManualFieldError: class extends Error { constructor(code, status, message) { super(message); this.code = code; this.status = status; } },
  });
  const dependencies = {
    "../../../../../db": { getD1: () => db },
    "@/lib/admin-server": admin,
    "@/lib/bounded-json-request": { BoundedJsonRequestError, readBoundedJsonRequest },
    "@/lib/firebase-server": { requireFirebaseIdentity: async request => {
      calls.authenticated++;
      if (request.headers.get("Authorization") !== "Bearer fixture" || overrides.authError) throw new Error("AUTH_REQUIRED");
      return identity;
    } },
    "@/lib/creditex-manual-field-server": {
      requireManualFieldMember: async request => {
        calls.manualSelected.push(request);
        if (overrides.manualError) throw overrides.manualError;
        return { uid: identity.uid, organisationId: "manual-org", ...overrides.manualMember };
      },
      manualFieldJobRow: async (database, member, id) => {
        calls.manualJobs.push(id); return manual.manualFieldJobRow(database, member, id);
      },
    },
    "@/lib/trade-team-server": {
      requireInstallerTeamAccess: async request => {
        calls.selected.push(request);
        if (overrides.accessError) throw overrides.accessError;
        if (request.headers.get("X-TLink-Business") !== "business-a") throw Object.assign(new Error("BUSINESS_ACCESS_REQUIRED"), { code: "BUSINESS_ACCESS_REQUIRED" });
        return access;
      },
      assignedJob: async (selected, id) => {
        calls.jobs.push(id);
        if (overrides.jobError) throw overrides.jobError;
        return jobs.assignedJob(selected, id);
      },
    },
  };
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, exports);
  const add = (id, ownerUid = "business-a", memberId = "member-a") => database.prepare(
    "INSERT INTO trade_work_orders (id,firebase_uid,assignee_member_id) VALUES (?,?,?)").run(id, ownerUid, memberId);
  const request = (body = { ownerUid: "business-a", workOrderIds: [] }, headers = {}) => exports.POST(new Request("https://tlink.test/api/trade-businesses/restore-cache", {
    method: "POST", headers: { Authorization: "Bearer fixture", "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  return { database, access, calls, add, request };
}

test("manual-only legacy work is proven against the current organisation and assigned tester", async t => {
  const f = fixture(t);
  f.database.exec("INSERT INTO compliance_manual_evidence_test_jobs (id) VALUES ('manual-job')");
  const response = await f.request({ ownerUid: "compliance:person", workOrderIds: ["manual-job", "manual-job"] }, { "X-TLink-Business": "business-a" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ownerUid: "compliance:person", memberId: "person" });
  assert.deepEqual(f.calls.manualJobs, ["manual-job"]); assert.deepEqual(f.calls.jobs, []); assert.deepEqual(f.calls.selected, []);
  assert.equal(f.calls.manualSelected[0].headers.has("X-TLink-Business"), false);
});

for (const [name, setup] of [
  ["another organisation", "UPDATE compliance_manual_evidence_test_jobs SET organisation_id='another-org'"],
  ["another tester", "UPDATE compliance_manual_evidence_test_jobs SET field_tester_uid='another-person'"],
  ["archived job", "UPDATE compliance_manual_evidence_test_jobs SET status='archived'"],
  ["passed job", "UPDATE compliance_manual_evidence_test_jobs SET status='passed'"],
  ["non-synthetic job", "UPDATE compliance_manual_evidence_test_jobs SET record_mode='production'"],
  ["unavailable form", "UPDATE compliance_manual_evidence_form_versions SET status='draft'"],
]) {
  test(`manual cache proof refuses ${name}`, async t => {
    const f = fixture(t); f.database.exec("INSERT INTO compliance_manual_evidence_test_jobs (id) VALUES ('manual-job')"); f.database.exec(setup);
    const response = await f.request({ ownerUid: "compliance:person", workOrderIds: ["manual-job"] });
    assert.equal(response.status, 403); assert.equal((await response.json()).code, "CACHE_OWNERSHIP_UNCONFIRMED");
  });
}

test("manual proof rejects mixed lanes, another identity, inactive membership and MFA failures", async t => {
  const f = fixture(t); f.add("trade-job");
  f.database.exec("INSERT INTO compliance_manual_evidence_test_jobs (id) VALUES ('manual-job')");
  assert.equal((await f.request({ ownerUid: "compliance:person", workOrderIds: ["manual-job", "trade-job"] })).status, 403);
  assert.equal((await f.request({ ownerUid: "compliance:another-person", workOrderIds: ["manual-job"] })).status, 400);
  const wrongIdentity = fixture(t, { manualMember: { uid: "another-person" } });
  assert.equal((await wrongIdentity.request({ ownerUid: "compliance:person", workOrderIds: [] })).status, 403);
  for (const [error, code] of [
    [Object.assign(new Error("private membership"), { code: "COMPLIANCE_MEMBERSHIP_INACTIVE" }), "CACHE_OWNERSHIP_UNCONFIRMED"],
    [new FirebaseMfaRequiredError(), "MFA_REQUIRED"],
  ]) {
    const blocked = fixture(t, { manualError: error });
    const response = await blocked.request({ ownerUid: "compliance:person", workOrderIds: [] });
    assert.equal(response.status, 403); assert.equal((await response.json()).code, code);
    assert.deepEqual(blocked.calls.manualJobs, []);
  }
});

test("legacy cache ownership proves every unique job under an immutable explicit business selection", async t => {
  const f = fixture(t); f.add("job-a"); f.add("job-b");
  const before = f.database.prepare("SELECT * FROM trade_work_orders ORDER BY id").all();
  const response = await f.request({ ownerUid: "business-a", workOrderIds: ["job-a", "job-b", "job-a"] }, { "X-TLink-Business": "stale-business" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, ownerUid: "business-a", memberId: "member-a" });
  assert.deepEqual(f.calls.jobs, ["job-a", "job-b"]);
  assert.equal(f.calls.selected[0].headers.get("X-TLink-Business"), "business-a");
  assert.equal(f.calls.selected[0].headers.get("Authorization"), "Bearer fixture");
  assert.deepEqual(f.database.prepare("SELECT * FROM trade_work_orders ORDER BY id").all(), before);
});

test("an empty cache can establish current membership without manufacturing job evidence", async t => {
  const f = fixture(t); assert.equal((await f.request()).status, 200);
  assert.equal(f.calls.selected.length, 1); assert.deepEqual(f.calls.jobs, []);
});

test("a collaborator can restore only while a qualifying visit still grants job access", async t => {
  const f = fixture(t); f.add("shared-job", "business-a", "lead-member");
  f.database.exec("INSERT INTO trade_crm_appointments (id,work_order_id,firebase_uid,assignee_member_id) VALUES ('visit','shared-job','business-a','member-a')");
  for (const status of ["scheduled", "en_route", "arrived", "in_progress", "completed"]) {
    f.database.prepare("UPDATE trade_crm_appointments SET status=?").run(status);
    assert.equal((await f.request({ ownerUid: "business-a", workOrderIds: ["shared-job"] })).status, 200, status);
  }
  for (const status of ["cancelled", "no_show"]) {
    f.database.prepare("UPDATE trade_crm_appointments SET status=?").run(status);
    const result = await f.request({ ownerUid: "business-a", workOrderIds: ["shared-job"] });
    assert.equal(result.status, 403, status);
    assert.equal((await result.json()).code, "CACHE_OWNERSHIP_UNCONFIRMED");
  }
  f.database.exec("UPDATE trade_crm_appointments SET status='scheduled',firebase_uid='business-b'");
  assert.equal((await f.request({ ownerUid: "business-a", workOrderIds: ["shared-job"] })).status, 403, 'another business cannot grant access');
});

for (const failure of ["missing", "foreign", "unassigned", "deleted", "supplier", "manual-only"]) {
  test(`cache proof rejects the whole set when a job is ${failure}`, async t => {
    const f = fixture(t); f.add("job-good");
    if (!["missing", "manual-only"].includes(failure)) f.add("job-blocked", failure === "foreign" ? "business-b" : "business-a", failure === "unassigned" ? "other-member" : "member-a");
    if (failure === "deleted") f.database.exec("UPDATE trade_work_orders SET record_status='deleted' WHERE id='job-blocked'");
    if (failure === "supplier") f.database.exec("UPDATE trade_work_orders SET partner_type='supplier' WHERE id='job-blocked'");
    const response = await f.request({ ownerUid: "business-a", workOrderIds: ["job-good", "job-blocked"] });
    assert.equal(response.status, 403);
    const result = await response.json(); assert.equal(result.code, "CACHE_OWNERSHIP_UNCONFIRMED");
    assert.equal("ownerUid" in result, false); assert.equal("memberId" in result, false);
    assert.equal("jobs" in result, false); assert.match(result.error, /saved work has been kept/i);
  });
}

test("protected jobs already accessible through normal field policy are provable without returning customer data", async t => {
  const f = fixture(t); f.add("protected-job");
  f.database.exec("UPDATE trade_work_orders SET source_type='opportunity',source_reference='private-reference'; INSERT INTO trade_crm_job_details VALUES ('protected-job','business-a','platform_private')");
  const result = await (await f.request({ ownerUid: "business-a", workOrderIds: ["protected-job"] })).json();
  assert.deepEqual(result, { ok: true, ownerUid: "business-a", memberId: "member-a" });
  assert.doesNotMatch(JSON.stringify(result), /private-reference|protected-job/);
});

test("team-scope and owner access use the existing job assignment policy", async t => {
  for (const access of [{ jobScope: "team" }, { isOwner: true }]) {
    const f = fixture(t, { access }); f.add("job", "business-a", "other-member");
    assert.equal((await f.request({ ownerUid: "business-a", workOrderIds: ["job"] })).status, 200);
  }
});

test("authentication, verified email and field permissions are required before examining jobs", async t => {
  for (const [overrides, headers, status, code] of [
    [{}, { Authorization: "TLinkField old-session" }, 401, "AUTH_REQUIRED"],
    [{ authError: true }, {}, 401, "AUTH_REQUIRED"],
    [{ identity: { emailVerified: false } }, {}, 403, "EMAIL_VERIFICATION_REQUIRED"],
    [{ access: { canViewFieldEvidence: false } }, {}, 403, "FIELD_EVIDENCE_VIEW_REQUIRED"],
    [{ access: { ownerUid: "business-b" } }, {}, 403, "CACHE_OWNERSHIP_UNCONFIRMED"],
    [{ access: { actorUid: "other-person" } }, {}, 403, "CACHE_OWNERSHIP_UNCONFIRMED"],
  ]) {
    const f = fixture(t, overrides); f.add("job");
    const response = await f.request({ ownerUid: "business-a", workOrderIds: ["job"] }, headers);
    assert.equal(response.status, status); assert.equal((await response.json()).code, code);
    assert.deepEqual(f.calls.jobs, []);
  }
});

test("revoked membership and current MFA requirements remain actionable without leaking details", async t => {
  for (const [error, code] of [
    [Object.assign(new Error("private details"), { code: "BUSINESS_ACCESS_REQUIRED" }), "BUSINESS_ACCESS_REQUIRED"],
    [new FirebaseMfaRequiredError(), "MFA_REQUIRED"],
  ]) {
    const f = fixture(t, { accessError: error });
    const response = await f.request(); assert.equal(response.status, 403);
    const result = await response.json(); assert.equal(result.code, code); assert.doesNotMatch(result.error, /private details/);
    assert.deepEqual(f.calls.jobs, []);
  }
  const f = fixture(t); assert.equal((await f.request({ ownerUid: "unrelated-business", workOrderIds: [] })).status, 403);
});

test("malformed, oversize and foreign-origin requests never examine tenant jobs", async t => {
  const f = fixture(t);
  for (const body of [null, [], {}, { ownerUid: "", workOrderIds: [] }, { ownerUid: "business-a", workOrderIds: "job" },
    { ownerUid: "business-a", workOrderIds: [null] }, { ownerUid: "business-a", workOrderIds: [""] }, "{"]) {
    assert.equal((await f.request(body)).status, 400);
  }
  assert.equal((await f.request("x".repeat(80 * 1024 + 1))).status, 413);
  assert.equal((await f.request(undefined, { Origin: "https://untrusted.test" })).status, 403);
  assert.deepEqual(f.calls.selected, []); assert.deepEqual(f.calls.jobs, []);
});

test("500 references can be proven and a larger request is rejected explicitly without partial proof", async t => {
  const f = fixture(t); const ids = Array.from({ length: 500 }, (_, index) => `job-${index}`); ids.forEach(id => f.add(id));
  assert.equal((await f.request({ ownerUid: "business-a", workOrderIds: ids })).status, 200);
  assert.equal(f.calls.jobs.length, 500);
  const response = await f.request({ ownerUid: "business-a", workOrderIds: [...ids, "extra-job"] });
  assert.equal(response.status, 400); assert.equal((await response.json()).code, "CACHE_PROOF_LIMIT");
  assert.equal(f.calls.jobs.length, 500);
});

test("database failures keep local work pending and never masquerade as successful ownership proof", async t => {
  const f = fixture(t, { jobError: new Error("SQL private-work-order-owner") });
  const response = await f.request({ ownerUid: "business-a", workOrderIds: ["job"] });
  assert.equal(response.status, 503);
  const result = await response.json(); assert.equal(result.code, "CACHE_PROOF_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /SQL|private-work-order-owner/);
});
