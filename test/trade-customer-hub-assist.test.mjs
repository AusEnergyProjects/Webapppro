import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";
import { certificateTestDependency } from "./helpers/creditex-training-fixture.mjs";
import * as consent from "../src/lib/public-plan-enquiry.mjs";
import * as catalogue from "../src/lib/energy-service-catalogue.mjs";
import * as collaboration from "../src/lib/trade-job-collaboration.ts";
import * as profiles from "../src/lib/customer-hub-business-profile.ts";
import * as contract from "../src/lib/trade-customer-hub-assist.ts";
import * as bounded from "../src/lib/bounded-json-request.ts";

function load(path, dependencies) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  Function("require", "exports", source)(name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, exports);
  return exports;
}
const hub = load("../src/lib/customer-quote-hub-server.ts", {
  "./trade-access-server": certificateTestDependency("trade-access-server"), "./aea-trade-owner-server": certificateTestDependency("aea-trade-owner-server"),
  "./trade-certificate-leads": certificateTestDependency("trade-certificate-leads"), "./public-plan-enquiry.mjs": consent,
  "./energy-service-catalogue.mjs": catalogue, "./customer-hub-business-profile": profiles,
  "./customer-hub-links": {}, "./trade-quote-links": {}, "./trade-quote-decision-server": {},
});
const trade = load("../src/lib/trade-customer-hub-server.ts", { "./customer-quote-hub-server": hub, "./trade-job-collaboration": collaboration });
const validDraft = () => ({ brief: [{ text: "Customer asks for rooftop solar.", sourceIds: ["q-solar"] }], draftScope: [{ text: "Confirm the requested rooftop solar scope with the customer.", sourceIds: ["job", "q-solar"] }] });
const now = new Date().toISOString(), future = "2099-12-31T23:59:59.000Z";

function fixture(t) {
  const { sqlite } = migratedDataforceSqlite(); t.after(() => sqlite.close());
  function insert(table, values) {
    const input = {};
    for (const column of sqlite.prepare(`PRAGMA table_info(${table})`).all()) if (column.notnull && column.dflt_value === null) input[column.name] = /INT/i.test(column.type) ? 0 : "";
    Object.assign(input, values);
    sqlite.prepare(`INSERT INTO ${table} (${Object.keys(input).join(",")}) VALUES (${Object.keys(input).map(() => "?").join(",")})`).run(...Object.values(input));
  }
  const writes = [], calls = [];
  let beforeRead = () => {};
  function statement(sql, values = []) { return { bind: (...next) => statement(sql, next), first: async () => { beforeRead(sql); return sqlite.prepare(sql).get(...values) || null; },
    all: async () => { beforeRead(sql); return { results: sqlite.prepare(sql).all(...values) }; }, run: async () => { writes.push(sql); return { meta: sqlite.prepare(sql).run(...values) }; } }; }
  const db = { prepare: statement };
  insert("trade_opportunities", { id: "project", title: "Shared project", project_type: "residential", state: "VIC", postcode: "3000", status: "open", service_categories: '["solar","hot-water"]', source_reference: "public-project", expires_at: future, created_at: now, updated_at: now });
  insert("public_trade_lead_contact_releases", { id: "release", opportunity_id: "project", source_reference: "public-project", customer_email: "PRIVATE_RECIPIENT@example.invalid", customer_name: "PRIVATE_CUSTOMER", postcode: "3000", customer_street_address: "PRIVATE_ADDRESS", notice_version: consent.PUBLIC_PLAN_CONSENT_NOTICE_VERSION, consent_purpose: consent.PUBLIC_PLAN_CONSENT_PURPOSE, disclosed_fields: '["customer_email","postcode","service_categories"]', granted_at: now, created_at: now, updated_at: now });
  insert("customer_quote_hubs", { id: "hub", opportunity_id: "project", release_id: "release", recipient_email: "private_recipient@example.invalid", email_hash: "PRIVATE_HASH", token_hash: "PRIVATE_TOKEN_HASH", encrypted_token: "PRIVATE_CAPABILITY", expires_at: future, created_at: now });
  for (const [owner, abn] of [["solar", "51824753556"], ["other", "53004085616"]]) {
    insert("trade_accounts", { firebase_uid: owner, email: `${owner}@example.invalid`, business_name: `PRIVATE_BUSINESS_${owner}`, partner_type: "installer", account_status: "active", abn, verified_abn: abn, verification_status: "approved", verification_review_id: `review-${owner}`, verification_reviewed_at: now, verification_reviewed_by_uid: "reviewer", capabilities: '["solar","hot-water"]', service_states: '["VIC"]', created_at: now, updated_at: now });
    insert("trade_account_verification_reviews", { id: `review-${owner}`, firebase_uid: owner, abn, business_name: `PRIVATE_BUSINESS_${owner}`, partner_type: "installer", decision: "approved", review_method: "official_abr_lookup", reviewed_by_uid: "reviewer", reviewed_at: now });
    insert("trade_team_members", { id: `member-${owner}`, owner_uid: owner, member_uid: `staff-${owner}`, email: `staff-${owner}@example.invalid`, role: "manager", status: "active", can_view_quotes: 1, can_manage_quotes: 1, job_scope: "team", created_at: now, updated_at: now });
    insert("trade_opportunity_matches", { id: `match-${owner}`, opportunity_id: "project", firebase_uid: owner, status: "interested", matched_categories: owner === "solar" ? '["solar"]' : '["hot-water"]', matched_at: now, updated_at: now });
    insert("customer_hub_interests", { match_id: `match-${owner}`, opportunity_id: "project", interested: 1, interested_since: now, updated_at: now, updated_by_uid: owner });
    insert("trade_crm_customers", { id: `customer-${owner}`, firebase_uid: owner, customer_number: `CUS-${owner}`, created_at: now, updated_at: now });
    insert("trade_work_orders", { id: `work-${owner}`, firebase_uid: owner, partner_type: "installer", work_number: `JOB-${owner}`, title: owner === "solar" ? "Rooftop solar" : "PRIVATE_OTHER_JOB", source_type: "public_lead", source_reference: `match-${owner}`, created_at: now, updated_at: now });
    insert("trade_crm_job_details", { id: `detail-${owner}`, work_order_id: `work-${owner}`, firebase_uid: owner, crm_customer_id: `customer-${owner}`, customer_source: "public_lead_released", description: owner === "solar" ? "Review rooftop solar scope" : "PRIVATE_OTHER_SCOPE", created_at: now, updated_at: now });
    insert("customer_hub_questions", { id: `q-${owner}`, opportunity_id: "project", match_id: `match-${owner}`, service_categories_json: owner === "solar" ? '["solar"]' : '["hot-water"]', kind: "text", prompt: owner === "solar" ? "What solar work is requested?" : "PRIVATE_OTHER_QUESTION", answer: owner === "solar" ? "Rooftop solar please" : "PRIVATE_OTHER_ANSWER", created_at: now, updated_at: now });
  }
  insert("customer_hub_files", { id: "file-solar", question_id: "q-solar", opportunity_id: "project", file_name: "PRIVATE_FILE_NAME.pdf", content_type: "application/pdf", size_bytes: 200, object_key: "PRIVATE_OBJECT_KEY", sha256: "PRIVATE_FILE_HASH", created_at: now });
  const access = { ownerUid: "solar", actorUid: "staff-solar", memberId: "member-solar", isOwner: false, canViewQuotes: true, canManageQuotes: true, jobScope: "team" };
  let provider = async () => validDraft(), auth = async () => access, sameOrigin = true;
  const server = load("../src/lib/trade-customer-hub-assist-server.ts", { "./trade-customer-hub-server": trade, "./trade-customer-hub-assist": contract,
    "./workflow-ai-server": { workflowAiSourceHash: async value => createHash("sha256").update(JSON.stringify(value)).digest("hex"), requestWorkflowAi: async options => { calls.push(options); return provider(options); } } });
  const route = load("../src/app/api/trade-customer-hub/assist/route.ts", { "../../../../../db": { getD1: () => db }, "@/lib/admin-server": { sameOrigin: () => sameOrigin, mfaErrorResponse: () => null }, "@/lib/trade-team-server": { requireInstallerTeamAccess: () => auth() }, "@/lib/customer-quote-hub-server": hub, "@/lib/trade-customer-hub-assist-server": server, "@/lib/bounded-json-request": bounded });
  return { sqlite, db, calls, writes, access, server, insert, beforeRead: fn => { beforeRead = fn; }, setProvider: fn => { provider = fn; }, setAuth: fn => { auth = fn; }, setOrigin: value => { sameOrigin = value; },
    async post(body = { workOrderId: "work-solar", requestId: "synthetic-request-0001" }) { const response = await route.POST(new Request("https://example.test/api/trade-customer-hub/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); return { status: response.status, headers: response.headers, body: await response.json() }; } };
}

test("AI receives only the current business job and authorised shared Q&A projection, with no writes", async t => {
  const f = fixture(t), result = await f.post();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.match(result.body.sourceHash, /^[a-f0-9]{64}$/); assert.equal(result.headers.get("cache-control"), "private, no-store");
  const call = f.calls[0]; assert.equal(call.actorUid, "staff-solar"); assert.equal(call.scopeUid, "solar");
  assert.equal(call.input.job.title, "Rooftop solar"); assert.deepEqual(call.input.questions.map(question => question.id), ["q-solar"]);
  assert.equal(call.input.attachmentContentsReviewed, false); assert.deepEqual(call.input.questions[0].attachments, [{ id: "file-solar", type: "application/pdf" }]);
  assert.doesNotMatch(JSON.stringify(call.input), /PRIVATE_|recipient|token_hash|object_key|businessProfile|totalCents/);
  assert.deepEqual(f.writes, []);
});

test("wrong business, revoked consent, archived job, absent interest and current member permissions block before provider", async t => {
  for (const [label, sql, body] of [
    ["wrong business", "", { workOrderId: "work-other", requestId: "synthetic-request-0001" }],
    ["view revoked", "UPDATE trade_team_members SET can_view_quotes=0 WHERE id='member-solar'"],
    ["manage revoked", "UPDATE trade_team_members SET can_manage_quotes=0 WHERE id='member-solar'"],
    ["member revoked", "UPDATE trade_team_members SET status='removed' WHERE id='member-solar'"],
    ["interest off", "UPDATE customer_hub_interests SET interested=0 WHERE match_id='match-solar'"],
    ["job archived", "UPDATE trade_work_orders SET record_status='archived' WHERE id='work-solar'"],
    ["consent withdrawn", "UPDATE public_trade_lead_contact_releases SET withdrawn_at='2026-10-04' WHERE id='release'"],
  ]) await t.test(label, async child => { const f = fixture(child); if (sql) f.sqlite.exec(sql); const result = await f.post(body); assert.equal(result.status, 403, JSON.stringify(result.body)); assert.equal(f.calls.length, 0); });
});

test("question, reply, file and job changes while AI runs invalidate its entire result", async t => {
  for (const [label, mutate] of [
    ["answer", f => f.sqlite.exec("UPDATE customer_hub_questions SET answer='Changed',answer_revision=answer_revision+1 WHERE id='q-solar'")],
    ["job", f => f.sqlite.exec("UPDATE trade_crm_job_details SET description='Changed scope' WHERE work_order_id='work-solar'")],
    ["reply", f => f.insert("customer_hub_replies", { id: "new-reply", opportunity_id: "project", question_id: "q-solar", author_type: "customer", body: "Changed requirement", created_at: now })],
    ["file removed", f => f.sqlite.exec("UPDATE customer_hub_files SET removed_at='2026-10-05T00:00:00.000Z' WHERE id='file-solar'")],
  ]) await t.test(label, async child => { const f = fixture(child); f.setProvider(async () => { mutate(f); return validDraft(); }); const result = await f.post(); assert.equal(result.status, 409); assert.equal(result.body.brief, undefined); });
});

test("file removal during the final source read invalidates the generated draft", async t => {
  const f = fixture(t);
  f.setProvider(async () => {
    f.beforeRead(sql => {
      if (sql.startsWith('SELECT work.title,detail.description')) {
        f.sqlite.exec("UPDATE customer_hub_files SET removed_at='2026-10-05T00:00:00.000Z' WHERE id='file-solar'");
        f.beforeRead(() => {});
      }
    });
    return validDraft();
  });
  const result = await f.post();
  assert.equal(result.status, 409); assert.equal(result.body.brief, undefined); assert.equal(f.calls.length, 1);
});

test("interest or permission revoked during generation prevents returning the private draft", async t => {
  for (const sql of ["UPDATE customer_hub_interests SET interested=0 WHERE match_id='match-solar'", "UPDATE trade_team_members SET can_manage_quotes=0 WHERE id='member-solar'"]) await t.test(sql, async child => {
    const f = fixture(child); f.setProvider(async () => { f.sqlite.exec(sql); return validDraft(); }); const result = await f.post(); assert.equal(result.status, 403); assert.equal(result.body.brief, undefined);
  });
});

test("unknown citations, partial output, prices and compliance conclusions never become a draft", async t => {
  const cases = [null, { brief: [] }, { ...validDraft(), extra: "unrequested" }, { ...validDraft(), draftScope: [{ text: "Other business scope", sourceIds: ["q-other"] }] },
    { ...validDraft(), brief: [{ text: "Price is $12,000", sourceIds: ["job"] }] }, { ...validDraft(), brief: [{ text: "Fully compliant installation", sourceIds: ["q-solar"] }] }];
  const f = fixture(t);
  for (const output of cases) { f.setProvider(async () => output); const result = await f.post(); assert.equal(result.status, 503); assert.equal(result.body.brief, undefined); }
});

test("origin, request shape, reauthentication and provider errors fail without false success", async t => {
  const f = fixture(t); f.setOrigin(false); assert.equal((await f.post()).status, 403); assert.equal(f.calls.length, 0); f.setOrigin(true);
  assert.equal((await f.post({ workOrderId: "work-solar", requestId: "short" })).status, 400); assert.equal(f.calls.length, 0);
  for (const [code, status] of [["WORKFLOW_AI_LIMIT", 429], ["WORKFLOW_AI_INPUT_LIMIT", 413], ["WORKFLOW_AI_UNAVAILABLE", 503]]) {
    f.setProvider(async () => { throw new Error(code); }); const result = await f.post(); assert.equal(result.status, status); assert.equal(result.body.brief, undefined);
  }
  let authCount = 0; f.setProvider(async () => validDraft()); f.setAuth(async () => ++authCount === 1 ? f.access : { ...f.access, canManageQuotes: false });
  assert.equal((await f.post()).status, 403);
});
