import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as pure from "../src/lib/creditex-voice-connection.ts";

const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const output = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected voice dependency ${name}`);
  }, record, record.exports);
  return record.exports;
}
const protectedPayload = load("../src/lib/trade-integration-crypto.ts", { "cloudflare:workers": { env: { CRM_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 71).toString("base64url") } }, "@/lib/trade-integration-state": {} });
const server = load("../src/lib/creditex-voice-connection-server.ts", { "./trade-integration-crypto": protectedPayload, "./creditex-voice-connection": pure });
const credentials = { apiKey: "KEY-Creditex-private-test-key", publicKey: Buffer.alloc(32, 8).toString("base64") };
const owner = { organisationId: "org-1", membershipId: "admin-1", organisationLegalName: "Creditex Test" };
const number = { id: "number-1", phone_number: "+61280000001", country_iso_alpha2: "AU", phone_number_type: "local", status: "active" };
const number2 = { ...number, id: "number-2", phone_number: "+61400000002", phone_number_type: "mobile" };
const input = { ...credentials, ownsAccount: true, defaultNumberId: number.id, assignments: [] };
const json = value => Response.json(value);

function telnyx(overrides = {}) {
  const resources = { outbound_voice_profiles: [], credential_connections: [], call_control_applications: [] }, requests = [];
  const fetch = async (raw, options = {}) => {
    const url = new URL(raw); const path = url.pathname.slice(4); const body = options.body ? JSON.parse(options.body) : null;
    assert.equal(url.origin, "https://api.telnyx.com"); assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, `Bearer ${credentials.apiKey}`);
    requests.push({ path, body, url: String(url) });
    if (overrides.request) { const result = await overrides.request(path, body, resources); if (result) return result; }
    if (path === "balance") return json({ data: { balance: "10.00", currency: "USD" } });
    const numbers = overrides.numbers || [number, number2];
    if (path === "phone_numbers") return json({ data: numbers, meta: { page_number: 1, total_pages: 1 } });
    if (path.startsWith("phone_numbers/")) {
      const item = numbers.find(value => value.id === path.split("/")[1]);
      return json({ data: item });
    }
    const [kind, id] = path.split("/");
    if (resources[kind]) {
      if (body) { const created = { id: `${kind.replaceAll("_", "-")}-id`, ...body }; resources[kind].push(created); return json({ data: created }); }
      if (id) return json({ data: resources[kind].find(value => value.id === id) });
      return json({ data: resources[kind], meta: { page_number: 1, total_pages: 1 } });
    }
    throw new Error(`Unexpected Telnyx request ${path}`);
  };
  return { fetch, resources, requests };
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON; CREATE TABLE compliance_users(id TEXT PRIMARY KEY, organisation_id TEXT, display_name TEXT, role TEXT, status TEXT); INSERT INTO compliance_users VALUES ('admin-1','org-1','Administrator','admin','active'),('staff-1','org-1','Auditor','auditor','active'),('staff-2','org-2','Other organisation','auditor','active'),('staff-3','org-1','Inactive','auditor','inactive');");
  sqlite.exec(read("../drizzle/0183_creditex_audit_calls.sql").replaceAll("--> statement-breakpoint", ""));
  const statement = (sql, bindings = []) => ({ bind: (...values) => statement(sql, values), first: async () => sqlite.prepare(sql).get(...bindings) || null,
    all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }), run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }) });
  const db = { prepare: statement, batch: async statements => { sqlite.exec("BEGIN"); try { const values = []; for (const item of statements) values.push(await item.run()); sqlite.exec("COMMIT"); return values; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } } };
  return { db, sqlite, close: () => sqlite.close() };
}

async function connected() {
  const f = fixture(); const provider = telnyx();
  await server.connectVoiceAccount(f.db, owner, input, provider.fetch);
  return { ...f, provider, connection: f.sqlite.prepare("SELECT * FROM creditex_voice_connections").get() };
}

test("credentials and duplicate member assignments are validated before provider calls", () => {
  assert.throws(() => server.voiceCredentials("bad", credentials.publicKey), /VOICE_CREDENTIALS_INVALID/);
  assert.throws(() => server.voiceCredentials(credentials.apiKey, "not-ed25519"), /VOICE_CREDENTIALS_INVALID/);
  assert.throws(() => pure.creditexVoiceAssignments([{ memberId: "same", numberId: "a" }, { memberId: "same", numberId: "b" }]), /VOICE_ASSIGNMENTS_INVALID/);
});

test("inspection filters active owned Australian local/mobile numbers without returning credentials", async () => {
  const provider = telnyx({ numbers: [number, number2, { ...number, id: "foreign", country_iso_alpha2: "US" }, { ...number, id: "released", status: "deleted" }, { ...number, id: "tollfree", phone_number_type: "toll-free" }] });
  const result = await server.inspectVoiceAccount(credentials, provider.fetch);
  assert.deepEqual(result.numbers.map(item => item.id), [number.id, number2.id]);
  assert.doesNotMatch(JSON.stringify(result), /private-test-key|publicKey|apiKey/);
});

test("pagination constructs fixed-origin requests and rejects unsupported metadata", async () => {
  const provider = telnyx({ request: async path => path === "phone_numbers" ? json({ data: [], meta: { page_number: 1, total_pages: 999, next: "https://attacker.test/steal" } }) : null });
  await assert.rejects(server.inspectVoiceAccount(credentials, provider.fetch), /VOICE_PROVIDER_RESPONSE_INVALID/);
  assert.ok(provider.requests.every(item => item.url.startsWith("https://api.telnyx.com/v2/")));
});

test("connect requires explicit Creditex billing ownership and encrypts all account secrets", async () => {
  const f = fixture(); const provider = telnyx();
  try {
    await assert.rejects(server.connectVoiceAccount(f.db, owner, { ...input, ownsAccount: false }, provider.fetch), /VOICE_OWNERSHIP_REQUIRED/);
    assert.equal(provider.requests.length, 0);
    await server.connectVoiceAccount(f.db, owner, input, provider.fetch);
    const record = f.sqlite.prepare("SELECT * FROM creditex_voice_connections").get();
    assert.equal(record.status, "connected"); assert.equal(record.provision_stage, "ready");
    assert.doesNotMatch(record.encrypted_credentials, /private-test-key|sipPassword/);
    assert.equal((await protectedPayload.decryptProtectedPayload(record.encrypted_credentials)).apiKey, credentials.apiKey);
    const payload = await server.voiceWorkspace(f.db, owner.organisationId);
    assert.equal(payload.connection.defaultNumber, number.phone_number);
    assert.doesNotMatch(JSON.stringify(payload), /encrypted_credentials|private-test-key|publicKey|apiKey|sipPassword/);
    assert.equal(provider.resources.outbound_voice_profiles[0].call_recording.call_recording_type, "none");
    assert.deepEqual(provider.resources.outbound_voice_profiles[0].whitelisted_destinations, ["AU"]);
    assert.equal(provider.resources.credential_connections[0].outbound.call_parking_enabled, true);
    assert.equal(provider.resources.credential_connections[0].webhook_event_url, pure.CREDITEX_VOICE_WEBHOOK);
    assert.equal(provider.requests.filter(item => item.body).length, 3);
  } finally { f.close(); }
});

test("an uncertain resource creation is reconciled by exact name without duplicate POST", async () => {
  const f = fixture(); let failed = false;
  const provider = telnyx({ request: async (path, body, resources) => {
    if (path === "outbound_voice_profiles" && body && !failed) { failed = true; resources.outbound_voice_profiles.push({ id: "profile-recovered", ...body }); throw new Error("Transport lost after creation"); }
  } });
  try {
    await assert.rejects(server.connectVoiceAccount(f.db, owner, input, provider.fetch), /VOICE_PROVIDER_UNAVAILABLE/);
    assert.equal(f.sqlite.prepare("SELECT provision_stage FROM creditex_voice_connections").get().provision_stage, "profile_pending");
    await server.connectVoiceAccount(f.db, owner, { defaultNumberId: number.id, assignments: [] }, provider.fetch);
    assert.equal(f.sqlite.prepare("SELECT status FROM creditex_voice_connections").get().status, "connected");
    assert.equal(provider.requests.filter(item => item.path === "outbound_voice_profiles" && item.body).length, 1);
  } finally { f.close(); }
});

test("unknown creation with no matching resource remains pending and cannot silently disconnect or retry", async () => {
  const f = fixture(); const provider = telnyx({ request: async (path, body) => { if (path === "outbound_voice_profiles" && body) throw new Error("unknown"); } });
  try {
    await assert.rejects(server.connectVoiceAccount(f.db, owner, input, provider.fetch));
    await assert.rejects(server.connectVoiceAccount(f.db, owner, { defaultNumberId: number.id }, provider.fetch), /VOICE_SETUP_PENDING/);
    await assert.rejects(server.disconnectVoiceAccount(f.db, owner.organisationId), /VOICE_DISCONNECT_BUSY/);
    assert.equal(provider.requests.filter(item => item.body).length, 1);
  } finally { f.close(); }
});

test("cross-organisation or inactive staff cannot receive caller number assignments", async () => {
  const f = await connected();
  try {
    for (const memberId of ["staff-2", "staff-3"]) await assert.rejects(server.updateVoiceNumbers(f.db, owner.organisationId, { defaultNumberId: number.id, assignments: [{ memberId, numberId: number2.id }] }, f.provider.fetch), /VOICE_ASSIGNMENTS_INVALID/);
    await assert.rejects(server.updateVoiceNumbers(f.db, owner.organisationId, { defaultNumberId: "not-owned", assignments: [] }, f.provider.fetch), /VOICE_NUMBER_INVALID/);
    await server.updateVoiceNumbers(f.db, owner.organisationId, { defaultNumberId: number.id, assignments: [{ memberId: "staff-1", numberId: number2.id }] }, f.provider.fetch);
    assert.deepEqual((await server.voiceWorkspace(f.db, owner.organisationId)).assignments.map(item => ({ ...item })), [{ memberId: "staff-1", numberId: number2.id }]);
  } finally { f.close(); }
});

test("same Telnyx signing account cannot be connected to another organisation", async () => {
  const f = await connected();
  try { await assert.rejects(server.connectVoiceAccount(f.db, { ...owner, organisationId: "org-2" }, input, f.provider.fetch), /VOICE_ACCOUNT_ALREADY_CONNECTED/); }
  finally { f.close(); }
});

test("live configuration chooses assigned number and fails closed on provider recording or ownership changes", async () => {
  const f = await connected(); const original = globalThis.fetch; globalThis.fetch = f.provider.fetch;
  try {
    await server.updateVoiceNumbers(f.db, owner.organisationId, { defaultNumberId: number.id, assignments: [{ memberId: "staff-1", numberId: number2.id }] }, f.provider.fetch);
    assert.equal((await server.resolveAuditCallConfiguration(f.db, "org-1", "staff-1")).configuration.callerId, number2.phone_number);
    assert.equal((await server.resolveAuditCallConfiguration(f.db, "org-1", "admin-1")).configuration.callerId, number.phone_number);
    const before = f.provider.requests.length;
    assert.equal((await server.resolveAuditCallConfiguration(f.db, "org-1", "staff-1", { verifyProvider: false })).configured, true);
    assert.equal(f.provider.requests.length, before, "history readiness makes no provider requests");
    assert.equal((await server.resolveAuditCallConfiguration(f.db, "org-1", "staff-2")).configured, false);
    f.provider.resources.outbound_voice_profiles[0].call_recording.call_recording_type = "all";
    assert.equal((await server.resolveAuditCallConfiguration(f.db, "org-1", "staff-1")).configured, false);
  } finally { globalThis.fetch = original; f.close(); }
});

test("disconnect protects active calls and unsaved recordings, then preserves historical account binding", async () => {
  const f = await connected();
  try {
    const c = f.connection;
    f.sqlite.prepare("INSERT INTO creditex_audit_calls (id,organisation_id,connection_id,case_id,started_by_uid,started_by_member_id,started_by_name,request_id,customer_phone,caller_id,credential_connection_id,call_control_application_id,intent_secret_hash,expires_at,active_until,created_at,updated_at) VALUES ('call-1','org-1',?,'case-1','uid','staff-1','Staff','request','+61400000009',?,?,?,'hash','later','later','now','now')").run(c.id, number.phone_number, c.credential_connection_id, c.call_control_application_id);
    await assert.rejects(server.disconnectVoiceAccount(f.db, "org-1"), /VOICE_DISCONNECT_BUSY/);
    f.sqlite.exec("UPDATE creditex_audit_calls SET status='completed', recording_status='unknown'");
    await assert.rejects(server.disconnectVoiceAccount(f.db, "org-1"), /VOICE_DISCONNECT_BUSY/);
    f.sqlite.exec("UPDATE creditex_audit_calls SET recording_status='none', end_requested=1");
    await assert.rejects(server.disconnectVoiceAccount(f.db, "org-1"), /VOICE_DISCONNECT_BUSY/);
    f.sqlite.exec("UPDATE creditex_audit_calls SET end_requested=0");
    await server.disconnectVoiceAccount(f.db, "org-1");
    assert.equal((await server.voiceWorkspace(f.db, "org-1")).connection, null);
    const binding = { organisationId: "org-1", connectionId: c.id, credentialConnectionId: c.credential_connection_id, callControlApplicationId: c.call_control_application_id, callerId: number.phone_number };
    assert.equal((await server.resolveStoredAuditCallConfiguration(f.db, binding)).apiKey, credentials.apiKey);
    assert.equal(await server.resolveStoredAuditCallConfiguration(f.db, { ...binding, organisationId: "org-2" }), null);
    assert.equal(await server.resolveStoredAuditCallConfiguration(f.db, { ...binding, callerId: "+61400000009" }), null);
  } finally { f.close(); }
});

test("connection API requires same origin and Creditex admin before inspecting secrets", async () => {
  class AccessError extends Error { constructor() { super("Admin required"); this.status = 403; } }
  let checks = 0; let accessChecks = 0; let otherOrganisation = false;
  const route = load("../src/app/api/creditex/voice-connection/route.ts", {
    "../../../../../db": { getD1: () => ({}) },
    "@/lib/admin-server": { adminJson: (body, status = 200) => Response.json(body, { status }), sameOrigin: request => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin },
    "@/lib/compliance-access-server": { ComplianceAccessError: AccessError, requireComplianceAccess: async (_request, options) => { accessChecks++; assert.deepEqual(options.allowedRoles, ["admin"]); if(otherOrganisation)return {organisationCode:"OTHER",organisationId:"other"};throw new AccessError(); } },
    "@/lib/trade-compliance-intent": { CREDITEX_PARTNER_ORGANISATION_CODE:"CREDITEX" },
    "@/lib/creditex-voice-connection-server": { ...server, inspectVoiceAccount: () => { checks++; } },
  });
  const request = origin => new Request("https://ausenergyassessments.com/api/creditex/voice-connection", { method: "POST", headers: { origin }, body: JSON.stringify({ action: "inspect", ...credentials }) });
  assert.equal((await route.POST(request("https://attacker.test"))).status, 403); assert.equal(accessChecks, 0);
  assert.equal((await route.POST(request("https://ausenergyassessments.com"))).status, 403); assert.equal(accessChecks, 1); assert.equal(checks, 0);
  otherOrganisation = true;
  assert.equal((await route.POST(request("https://ausenergyassessments.com"))).status,403);assert.equal(checks,0);
  assert.equal((await route.GET(new Request("https://ausenergyassessments.com/api/creditex/voice-connection"))).status,403);assert.equal(checks,0);
});
