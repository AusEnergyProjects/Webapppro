import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as journey from "../src/lib/customer-job-journey.ts";
import * as photos from "../src/lib/trade-photo-requests.ts";
import * as calendar from "../src/lib/customer-appointment-calendar.ts";
import * as accountPredicates from "../src/lib/trade-account-predicates.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const result = {};
  const source = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function("require", "exports", source)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, result);
  return result;
}
const access = load("../src/lib/trade-access-server.ts", {
  "../../db": {}, "./firebase-server": {}, "./creditex-schema-guards": {},
  "./trade-abn": {}, "./trade-mfa-server": {}, "./trade-account-predicates": accountPredicates,
});
const questions = load("../src/lib/trade-quote-questions-server.ts", { "@/lib/trade-access-server": access });
const now = "2026-10-04T00:30:00.000Z";
const expiry = "2026-10-30T00:00:00.000Z";
const requestId = "12345678-1234-4234-8234-123456789abc";
const secret = "synthetic-photo-secret-with-at-least-forty-characters";
const requirement = { id: "roof", label: "Roof", guidance: "From ground level", usefulExample: "Wide view", avoidExample: "Climbing", required: true };
const baseJourney = { decision: "accepted", workNumber: "JOB-1", title: "Install", businessName: "Synthetic Trade", expiresAt: expiry,
  current: { stage: "preparing", appointment: null, photos: null } };

async function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const schema = read("../db/schema.ts");
  for (const table of ["trade_accounts", "trade_account_verification_reviews", "trade_work_orders", "trade_crm_job_details",
    "trade_crm_customers", "trade_crm_service_sites", "trade_crm_quotes", "trade_crm_quote_versions", "trade_crm_quote_links",
    "trade_crm_quote_acceptances", "trade_crm_appointments", "trade_crm_photo_requests"]) {
    const start = schema.indexOf(`sqliteTable("${table}", {`);
    assert.ok(start >= 0, table);
    const block = schema.slice(start, schema.indexOf("}, (table)", start));
    const columns = [...block.matchAll(/(?:text|integer|real)\("([a-z0-9_]+)"/g)].map(match => match[1]);
    sqlite.exec(`CREATE TABLE ${table} (${columns.map(name => `${name} ${/^(token_issue|revision|version_number|current_version_number)$/.test(name) ? "INTEGER DEFAULT 0" : "TEXT DEFAULT ''"}`).join(",")})`);
  }
  const insert = (table, values) => sqlite.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
  const update = (table, values) => sqlite.prepare(`UPDATE ${table} SET ${Object.keys(values).map(name => `${name}=?`).join(",")}`).run(...Object.values(values));
  insert("trade_accounts", { firebase_uid: "owner", business_name: "Synthetic Trade", partner_type: "installer", account_status: "active",
    abn: "51824753556", verified_abn: "51824753556", verification_status: "approved", verification_review_id: "review",
    verification_reviewed_at: "2026-09-01", verification_reviewed_by_uid: "reviewer", address_state: "WA" });
  insert("trade_account_verification_reviews", { id: "review", firebase_uid: "owner", business_name: "Synthetic Trade", partner_type: "installer",
    abn: "51824753556", decision: "approved", review_method: "official_abr_lookup", reviewed_at: "2026-09-01", reviewed_by_uid: "reviewer" });
  insert("trade_work_orders", { id: "job", firebase_uid: "owner", work_number: "JOB-1", title: "PRIVATE STAFF JOB TITLE", stage: "backlog",
    record_status: "active", source_type: "internal", partner_type: "installer" });
  insert("trade_crm_job_details", { work_order_id: "job", firebase_uid: "owner", crm_customer_id: "customer", service_site_id: "site",
    customer_source: "trade_owned", pipeline_stage: "planning" });
  insert("trade_crm_customers", { id: "customer", firebase_uid: "owner", record_status: "active", email: "private@example.invalid", phone: "0411111111" });
  insert("trade_crm_service_sites", { id: "site", customer_id: "customer", firebase_uid: "owner", record_status: "active",
    address_state: options.state || "NSW", address_line_1: "42 Private Street" });
  const status = options.status || "accepted";
  const link = { id: "link", quote_id: "quote", quote_version_id: "version", work_order_id: "job", firebase_uid: "owner",
    crm_customer_id: "customer", token_issue: 2, token_hash: "secret-quote-hash", status, expires_at: expiry };
  insert("trade_crm_quotes", { id: "quote", firebase_uid: "owner", work_order_id: "job", crm_customer_id: "customer", current_version_number: 1 });
  insert("trade_crm_quote_versions", { id: "version", quote_id: "quote", firebase_uid: "owner", version_number: 1,
    status: status === "active" ? "issued" : status, valid_until: "2026-10-20" });
  insert("trade_crm_quote_links", { ...link, revoked_at: "" });
  if (status === "accepted") insert("trade_crm_quote_acceptances", { id: "acceptance", quote_link_id: "link", quote_id: "quote", quote_version_id: "version",
    work_order_id: "job", firebase_uid: "owner", crm_customer_id: "customer", token_issue: 2, decision: "accepted" });
  let proof = { proofReady: false, completion: null, outstandingRequirementIds: ["roof"] };
  let protectedToken = { requestId, tokenIssue: 3, secret };
  let onProof = null;
  const calls = { proof: [], decrypt: [] };
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...values) || null,
  });
  const db = { prepare: statement };
  const server = load("../src/lib/customer-job-journey-server.ts", {
    "./trade-quote-questions-server": questions,
    "./trade-integration-crypto": { decryptProtectedPayload: async value => { calls.decrypt.push(value); if (protectedToken instanceof Error) throw protectedToken; return protectedToken; } },
    "./trade-photo-requests": photos,
    "./photo-request-review-server": { photoRequestProofOverview: async input => { calls.proof.push(input); onProof?.(); return proof; } },
    "./customer-appointment-calendar": calendar,
    "./customer-job-journey": journey,
  });
  const photo = async (values = {}) => insert("trade_crm_photo_requests", { id: requestId, firebase_uid: "owner", work_order_id: "job", crm_customer_id: "customer",
    status: "active", expires_at: expiry, encrypted_token: "protected-synthetic-photo-token", token_hash: await photos.hashPhotoRequestSecret(secret),
    token_issue: 3, revision: 4, requirements: JSON.stringify([requirement]), updated_at: now, ...values });
  const visit = (id, startsAt, endsAt, values = {}) => insert("trade_crm_appointments", {
    id, firebase_uid: "owner", work_order_id: "job", starts_at: startsAt, ends_at: endsAt, status: "scheduled", ...values });
  return { sqlite, insert, update, link, db, calls, photo, visit, server,
    current: () => server.loadCustomerJobCurrent(db, link, now), token: () => server.customerJobPhotoToken(db, link, now),
    setProof: value => { proof = value; }, setProtectedToken: value => { protectedToken = value; }, duringProof: callback => { onProof = callback; } };
}

test("next steps prioritise a quote decision, cancellation, requested photos and current job progress", () => {
  const cases = [
    [{ decision: "declined" }, "Quote declined", "document"],
    [{ decision: "active" }, "Your quote is ready", "document"],
    [{ current: { stage: "cancelled", photos: { status: "needed" } } }, "Job cancelled", "document"],
    [{ current: { stage: "scheduled", photos: { status: "needed" }, appointment: {} } }, "A few photos are needed", "photos"],
    [{ current: { stage: "completed", photos: null } }, "Work completed", "document"],
    [{ current: { stage: "in_progress", photos: null } }, "Work is under way", null],
    [{ current: { stage: "scheduled", photos: { status: "submitted" }, appointment: {} } }, "Your appointment is booked", null],
    [{ current: null }, "Your acceptance is saved", "document"],
    [{}, "Your quote is accepted", null],
  ];
  for (const [input, title, action] of cases) {
    const step = journey.customerJobNextStep({ ...baseJourney, ...input });
    assert.equal(step.title, title); assert.equal(step.action, action); assert.ok(step.detail);
  }
});

test("appointment labels preserve wall time and local now follows state daylight saving", () => {
  assert.equal(journey.customerJobLocalNow(now, "Australia/Sydney"), "2026-10-04T11:30");
  assert.equal(journey.customerJobLocalNow(now, "Australia/Perth"), "2026-10-04T08:30");
  assert.equal(journey.customerJobLocalNow("2026-10-03T00:30:00.000Z", "Australia/Sydney"), "2026-10-03T10:30");
  assert.match(journey.customerJobAppointmentLabel("2026-10-04T11:00", "2026-10-04T12:00"), /11:00 am to 12:00 pm/);
  assert.match(journey.customerJobAppointmentLabel("2026-10-04T23:30", "2026-10-05T00:30"), /Mon, 5 Oct, 12:30 am/);
  for (const [start, end] of [["invalid", "2026-10-04T12:00"], ["2026-10-04T12:00", "2026-10-04T11:00"], ["2026-10-04T12:00", "2026-10-04T12:00"]]) {
    assert.equal(journey.customerJobAppointmentLabel(start, end), "");
  }
});

test("current appointment excludes stale, cancelled, completed and foreign visits while retaining an ongoing visit", async t => {
  const f = await fixture(t);
  f.visit("ended", "2026-10-04T09:00", "2026-10-04T11:30");
  f.visit("cancelled", "2026-10-04T10:00", "2026-10-04T13:00", { status: "cancelled" });
  f.visit("done", "2026-10-04T10:00", "2026-10-04T13:00", { status: "completed" });
  f.visit("foreign", "2026-10-04T10:00", "2026-10-04T13:00", { firebase_uid: "other" });
  f.visit("other-job", "2026-10-04T10:00", "2026-10-04T13:00", { work_order_id: "other" });
  f.visit("ongoing", "2026-10-04T11:00", "2026-10-04T12:00", { status: "arrived" });
  f.visit("future", "2026-10-04T13:00", "2026-10-04T14:00");
  const result = await f.current();
  assert.equal(result.stage, "scheduled"); assert.equal(result.appointment.startsAt, "2026-10-04T11:00");
  assert.equal(new URL(result.appointment.googleCalendarUrl).searchParams.get("ctz"), "Australia/Sydney");
  f.sqlite.exec("DELETE FROM trade_crm_appointments WHERE id='ongoing'");
  assert.equal((await f.current()).appointment.startsAt, "2026-10-04T13:00");
});

test("site timezone overrides the business and completed or cancelled jobs do not show visits", async t => {
  const f = await fixture(t, { state: "WA" });
  f.visit("wa", "2026-10-04T09:00", "2026-10-04T10:00");
  const current = await f.current();
  assert.equal(new URL(current.appointment.googleCalendarUrl).searchParams.get("ctz"), "Australia/Perth");
  f.update("trade_work_orders", { stage: "completed" });
  assert.deepEqual(await f.current(), { stage: "completed", appointment: null, photos: null });
  f.update("trade_work_orders", { stage: "cancelled" });
  await f.photo();
  assert.deepEqual(await f.current(), { stage: "cancelled", appointment: null, photos: null });
  await assert.rejects(f.token(), /QUOTE_LINK_STOPPED/);
});

test("historical acceptance never grants current access after scope, custody, review or token changes", async t => {
  const denied = [
    ["trade_work_orders", { record_status: "archived" }], ["trade_work_orders", { firebase_uid: "other" }], ["trade_work_orders", { source_type: "opportunity" }],
    ["trade_crm_job_details", { crm_customer_id: "other" }], ["trade_crm_job_details", { customer_source: "public_lead_released" }], ["trade_crm_job_details", { pipeline_stage: "lost" }],
    ["trade_crm_customers", { record_status: "archived" }], ["trade_crm_customers", { firebase_uid: "other" }],
    ["trade_crm_service_sites", { customer_id: "other" }], ["trade_crm_service_sites", { firebase_uid: "other" }], ["trade_crm_service_sites", { record_status: "archived" }],
    ["trade_accounts", { account_status: "suspended" }], ["trade_accounts", { verification_status: "rejected" }], ["trade_account_verification_reviews", { decision: "rejected" }],
    ["trade_crm_quote_links", { revoked_at: now }], ["trade_crm_quote_links", { token_issue: 3 }], ["trade_crm_quote_links", { token_hash: "replacement" }], ["trade_crm_quote_links", { expires_at: now }],
    ["trade_crm_quote_acceptances", { decision: "declined" }], ["trade_crm_quote_acceptances", { token_issue: 1 }],
  ];
  for (const [table, values] of denied) await t.test(`${table}: ${JSON.stringify(values)}`, async child => {
    const f = await fixture(child); await f.photo(); assert.ok(await f.current());
    f.update(table, values);
    assert.equal(await f.current(), null);
    await assert.rejects(f.token(), /QUOTE_LINK_STOPPED/);
    assert.equal(f.calls.decrypt.length, 0);
  });
});

test("active quote version and validity gates apply while declined decisions return no live information", async t => {
  const f = await fixture(t, { status: "active" }); assert.ok(await f.current());
  f.update("trade_crm_quotes", { current_version_number: 2 }); assert.equal(await f.current(), null);
  f.update("trade_crm_quotes", { current_version_number: 1 });
  f.update("trade_crm_quote_versions", { valid_until: "2026-10-03" }); assert.equal(await f.current(), null);
  const declined = await fixture(t, { status: "declined" }); assert.equal(await declined.current(), null);
});

test("photo summaries expose only readiness and count, not bearer tokens, addresses or private records", async t => {
  const f = await fixture(t); await f.photo(); f.visit("visit", "2026-10-04T12:00", "2026-10-04T13:00");
  for (const [proof, status, outstanding] of [
    [{ proofReady: false, completion: null, outstandingRequirementIds: ["roof"] }, "needed", 1],
    [{ proofReady: false, completion: { current: true }, outstandingRequirementIds: [] }, "submitted", 0],
    [{ proofReady: true, completion: { current: true }, outstandingRequirementIds: [] }, "reviewed", 0],
  ]) {
    f.setProof(proof); const current = await f.current();
    assert.deepEqual(current.photos, { status, outstanding });
    assert.deepEqual(Object.keys(current).sort(), ["appointment", "photos", "stage"]);
    assert.doesNotMatch(JSON.stringify(current), /secret|token|42 Private|private@example|0411111111|PRIVATE STAFF|customer_id|firebase_uid|requestId/);
  }
  assert.equal(f.calls.decrypt.length, 0, "Rendering a summary never decrypts the child capability");
  assert.deepEqual(f.calls.proof[0], { ownerUid: "owner", workOrderId: "job", requestId, requestRevision: 4, requirements: [requirement] });
});

test("photo scope rejects foreign, revoked, expired or incomplete child capabilities", async t => {
  for (const values of [{ firebase_uid: "other" }, { work_order_id: "other" }, { crm_customer_id: "other" }, { status: "revoked" }, { expires_at: now }, { token_hash: "" }, { encrypted_token: "" }]) {
    await t.test(JSON.stringify(values), async child => {
      const f = await fixture(child); await f.photo(values);
      assert.equal((await f.current()).photos, null);
      await assert.rejects(f.token(), /QUOTE_LINK_STOPPED/);
      assert.equal(f.calls.decrypt.length, 0);
    });
  }
});

test("the server-only photo capability validates decrypted request, issue, token syntax and hash", async t => {
  const f = await fixture(t); await f.photo();
  assert.equal(await f.token(), `${requestId}.${secret}`);
  for (const changes of [{ requestId: "different" }, { tokenIssue: 2 }, { secret: "short" }, { secret: "another-synthetic-secret-that-is-long-enough-but-wrong" }, { secret: 123 }]) {
    f.setProtectedToken({ requestId, tokenIssue: 3, secret, ...changes });
    await assert.rejects(f.token(), /CUSTOMER_JOB_PHOTO_LINK_INVALID/);
  }
  f.setProtectedToken(new Error("CORRUPT_ENCRYPTED_PAYLOAD"));
  await assert.rejects(f.token(), /CORRUPT_ENCRYPTED_PAYLOAD/);
});

test("scope is rechecked after asynchronous photo loading so revocation cannot return live data", async t => {
  const f = await fixture(t); await f.photo();
  f.duringProof(() => f.update("trade_crm_quote_links", { revoked_at: now }));
  assert.equal(await f.current(), null);
});
