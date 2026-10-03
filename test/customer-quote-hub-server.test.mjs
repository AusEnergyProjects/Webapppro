import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { migratedDataforceSqlite } from "./helpers/trade-dataforce-database.mjs";
import { certificateTestDependency } from "./helpers/creditex-training-fixture.mjs";
import * as consent from "../src/lib/public-plan-enquiry.mjs";
import * as catalogue from "../src/lib/energy-service-catalogue.mjs";
import * as collaboration from "../src/lib/trade-job-collaboration.ts";
import * as businessProfile from "../src/lib/customer-hub-business-profile.ts";
import * as privateImages from "../src/lib/private-image-evidence.ts";
import * as hubEmailContent from "../src/lib/customer-hub-email.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, dependencies) {
  const exports = {};
  const source = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  Function("require", "exports", source)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
// Only the environment-owned encryption boundary is substituted. Token generation,
// hashing, binding checks and all authorization SQL run their production code.
const protectedPayload = {
  encryptProtectedPayload: async value => JSON.stringify(value),
  decryptProtectedPayload: async value => JSON.parse(value),
};
const quoteLinks = load("../src/lib/trade-quote-links.ts", { "@/lib/trade-integration-crypto": protectedPayload });
const links = load("../src/lib/customer-hub-links.ts", {
  "./trade-integration-crypto": protectedPayload, "./trade-quote-links": quoteLinks,
  "./public-plan-enquiry.mjs": consent,
});
const receivedDecisions = new Map();
const hubServer = load("../src/lib/customer-quote-hub-server.ts", {
  "./customer-hub-business-profile": businessProfile,
  "./trade-access-server": certificateTestDependency("trade-access-server"),
  "./aea-trade-owner-server": certificateTestDependency("aea-trade-owner-server"),
  "./trade-certificate-leads": certificateTestDependency("trade-certificate-leads"),
  "./public-plan-enquiry.mjs": consent, "./energy-service-catalogue.mjs": catalogue,
  "./customer-hub-links": links, "./trade-quote-links": quoteLinks,
  "./trade-quote-decision-server": { storedQuoteDecision: async link => receivedDecisions.get(link.id) || null },
});
const tradeServer = load("../src/lib/trade-customer-hub-server.ts", {
  "./customer-quote-hub-server": hubServer, "./trade-job-collaboration": collaboration,
});
const quoteHubEmail = load("../src/lib/trade-quote-hub-email-server.ts", {
  "./customer-quote-hub-server": hubServer, "./customer-hub-links": links,
  "./trade-integration-crypto": protectedPayload, "./trade-quote-links": quoteLinks,
});
const now = new Date().toISOString();
const future = "2099-12-31T23:59:59.000Z";
const past = "2000-01-01T00:00:00.000Z";
const categories = JSON.stringify(["solar", "air-conditioning"]);
const customerEmail = "customer@example.invalid";
const ownerAccess = ownerUid => ({ ownerUid, actorUid: ownerUid, isOwner: true, memberId: `member-${ownerUid}`,
  canViewQuotes: true, canManageQuotes: true, canViewCustomers:true, canReceiveCustomerQaNotifications:true, jobScope: "team" });

async function fixture(t) {
  const { sqlite } = migratedDataforceSqlite();
  t.after(() => sqlite.close());
  const insert = (table, input) => {
    const values = {};
    for (const column of sqlite.prepare(`PRAGMA table_info(${table})`).all()) {
      if (column.notnull && column.dflt_value === null) values[column.name] = /INT/i.test(column.type) ? 0 : "";
    }
    Object.assign(values, input);
    return sqlite.prepare(`INSERT INTO ${table} (${Object.keys(values).join(",")}) VALUES (${Object.keys(values).map(() => "?").join(",")})`).run(...Object.values(values));
  };
  const update = (table, values, where, bindings = []) => sqlite.prepare(`UPDATE ${table} SET ${Object.keys(values).map(key => `${key}=?`).join(",")} WHERE ${where}`).run(...Object.values(values), ...bindings);
  let beforeQuery = null;
  let afterCommit = null;
  const statement = (sql, values = []) => ({
    sql, values, bind: (...next) => statement(sql, next),
    first: async () => { beforeQuery?.(sql, "first"); return sqlite.prepare(sql).get(...values) || null; },
    all: async () => { beforeQuery?.(sql, "all"); return { results: sqlite.prepare(sql).all(...values) }; },
    run: async () => { beforeQuery?.(sql, "run"); return { success: true, meta: sqlite.prepare(sql).run(...values) }; },
  });
  const db = { prepare: statement, batch: async statements => {
    beforeQuery?.("BATCH", "batch");
    sqlite.exec("BEGIN");
    const result = [];
    try { for (const item of statements) result.push(await item.run()); sqlite.exec("COMMIT"); }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    afterCommit?.();
    return result;
  } };
  for (const id of ["project-a", "project-b"]) {
    insert("trade_opportunities", { id, title: id, project_type: "residential", state: "VIC", postcode: "3000", status: "open",
      service_categories: categories, source_reference: `source-${id}`, expires_at: future, created_at: now, updated_at: now });
    insert("public_trade_lead_contact_releases", { id: `release-${id}`, opportunity_id: id, source_reference: `source-${id}`,
      customer_email: customerEmail, customer_name: "PRIVATE CUSTOMER", postcode: "3000", customer_street_address: "42 Private Street",
      notice_version: '2026-09-14-aea-services-and-upgrade-sharing-v9', consent_purpose: 'Email my private plan. Australian Energy Assessments handles safety and assessments. Other requests and selected quote details go to approved matching trades.',
      disclosed_fields: JSON.stringify(["customer_email", "postcode", "service_categories"]), granted_at: now, created_at: now, updated_at: now });
  }
  for (const owner of ["solar", "ac", "foreign"]) {
    const businessName = `Synthetic ${owner}`;
    const abn = { solar: "51824753556", ac: "53004085616", foreign: "73675233557" }[owner];
    insert("trade_accounts", { firebase_uid: owner, email: `${owner}@example.invalid`, business_name: businessName, partner_type: "installer",
      account_status: "active", abn, verified_abn: abn, verification_status: "approved", verification_review_id: `review-${owner}`,
      verification_reviewed_at: now, verification_reviewed_by_uid: "reviewer", capabilities: categories, service_states: '["VIC"]', created_at: now, updated_at: now });
    insert("trade_account_verification_reviews", { id: `review-${owner}`, firebase_uid: owner, abn, business_name: businessName,
      partner_type: "installer", decision: "approved", review_method: "official_abr_lookup", reviewed_by_uid: "reviewer", reviewed_at: now });
    insert("trade_team_members", { id: `member-${owner}`, owner_uid: owner, member_uid: owner, email: `${owner}@example.invalid`, role: "owner", status: "active", created_at: now, updated_at: now });
    insert("creditex_business_onboarding", { owner_uid: owner, status: "approved", application_json: "{}", business_abn: abn, business_name: businessName,
      insurance_expires_on: "2099-12-31", agreement_reference: "SYNTHETIC-AGREEMENT", reviewed_by_uid: "reviewer", reviewed_at: now, updated_at: now });
    const project = owner === "foreign" ? "project-b" : "project-a";
    const service = owner === "ac" ? "air-conditioning" : "solar";
    insert("trade_opportunity_matches", { id: `match-${owner}`, opportunity_id: project, firebase_uid: owner, status: "interested",
      matched_categories: JSON.stringify([service]), matched_at: now, updated_at: now });
    insert("customer_hub_interests", {match_id: `match-${owner}`,opportunity_id:project,interested:1,interested_since:past,updated_at:now,updated_by_uid:owner});
    insert("trade_crm_customers", { id: `customer-${owner}`,firebase_uid:owner,customer_number:`CUS-${owner}`,created_at:now,updated_at:now });
    insert("trade_work_orders", { id: `work-${owner}`, firebase_uid: owner, partner_type: "installer", work_number: `JOB-${owner}`, title: "PRIVATE STAFF TITLE",
      source_type: "public_lead", source_reference: `match-${owner}`, service_categories: JSON.stringify([service]), created_at: now, updated_at: now });
    insert("trade_crm_job_details", { id: `detail-${owner}`, work_order_id: `work-${owner}`, firebase_uid: owner,
      customer_source: "public_lead_released", crm_customer_id: `customer-${owner}`, service_site_id: `site-${owner}`, created_at: now, updated_at: now });
    insert("trade_crm_quotes", { id: `quote-${owner}`, firebase_uid: owner, work_order_id: `work-${owner}`, crm_customer_id: `customer-${owner}`,
      service_site_id: `site-${owner}`, quote_number: `Q-${owner}`, current_version_number: 1, status: "issued", created_at: now, updated_at: now });
    insert("trade_crm_quote_versions", { id: `version-${owner}`, quote_id: `quote-${owner}`, firebase_uid: owner,
      version_number: 1, status: "issued", total_cents: 120000, created_at: now, updated_at: now });
    const secret = quoteLinks.newQuoteLinkSecret();
    insert("trade_crm_quote_links", { id: `link-${owner}`, quote_id: `quote-${owner}`, quote_version_id: `version-${owner}`, work_order_id: `work-${owner}`,
      firebase_uid: owner, crm_customer_id: `customer-${owner}`, token_hash: await quoteLinks.hashQuoteLinkSecret(secret), token_issue: 1,
      encrypted_token: await quoteLinks.protectQuoteLinkSecret(`link-${owner}`, 1, secret), status: "active", expires_at: future, created_at: now, updated_at: now });
  }
  const token = decodeURIComponent(new URL(await links.customerHubEmailUrl(db, "project-a", customerEmail)).pathname.split("/").at(-1));
  const otherToken = decodeURIComponent(new URL(await links.customerHubEmailUrl(db, "project-b", customerEmail)).pathname.split("/").at(-1));
  const authority = await links.authoriseCustomerHub(db, token);
  let access = ownerAccess("solar");
  const objects = new Map();
  const deletedObjects = [];
  let duringDownload = null;
  const bucket = {
    get: async key => { duringDownload?.(); const body = objects.get(key); return body === undefined ? null : { body }; },
    put: async (key, bytes) => { objects.set(key, bytes); },
    delete: async key => { deletedObjects.push(key); objects.delete(key); },
  };
  const customerRoute = load("../src/app/api/customer-hub/[token]/route.ts", {
    "../../../../../db": { getD1: () => db }, "@/lib/admin-server": { sameOrigin: () => true },
    "@/lib/customer-hub-links": links, "@/lib/customer-quote-hub-server": hubServer,
  });
  const emails=load("../src/lib/customer-hub-email-server.ts",{
    "./trade-integration-crypto":protectedPayload,
    "./customer-hub-email.mjs":hubEmailContent,
    "./customer-quote-hub-server":hubServer,"./customer-hub-links":links,
    "./service-reminder-delivery":{serviceReminderProviderConfiguration:()=>({email:{configured:false}})},
  });
  let onHandoff=async()=>{throw new Error("Unexpected job creation");};
  const tradeRoute = load("../src/app/api/trade-customer-hub/route.ts", {
    "../../../../db": { getD1: () => db }, "@/lib/admin-server": { sameOrigin: () => true, mfaErrorResponse: () => null },
    "@/lib/customer-hub-email-server":emails,
    "@/lib/public-lead-quote-workflow-server":{startPublicLeadQuoteWorkflow:(...args)=>onHandoff(...args)},
    "@/lib/customer-hub-links":links,
    "@/lib/opportunity-server":{syncMarketplaceEnquiries:async()=>{}},
    "@/lib/trade-team-server": { requireInstallerTeamAccess: async () => access },
    "@/lib/trade-customer-hub-server": tradeServer, "@/lib/customer-quote-hub-server": hubServer,
    "@/lib/customer-project-evidence-bucket": { getCustomerProjectEvidenceBucket: () => bucket },
  });
  const fileRoute = load("../src/app/api/customer-hub/[token]/files/route.ts", {
    "../../../../../../db": { getD1: () => db }, "@/lib/admin-server": { sameOrigin: () => true },
    "@/lib/customer-hub-links": links, "@/lib/customer-quote-hub-server": hubServer,
    "@/lib/customer-project-evidence-bucket": { getCustomerProjectEvidenceBucket: () => bucket },
    "@/lib/private-image-evidence": privateImages,
  });
  const request = (method, body) => new Request("https://example.invalid/api/customer-hub/synthetic", { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const customer = (method, body, credential = token) => customerRoute[method](request(method, body), { params: Promise.resolve({ token: credential }) });
  const ask = body => tradeRoute.POST(request("POST", { workOrderId: "work-solar", kind: "text", prompt: "Please confirm the installation access", ...body }));
  const upload = (questionId, content = "%PDF-1.7\nSynthetic fixture\n%%EOF") => {
    const form = new FormData(); form.set("questionId", questionId);
    form.set("file", new File([content], "evidence.pdf", { type: "application/pdf" }));
    return fileRoute.POST(new Request("https://example.invalid/api/customer-hub/synthetic/files", { method: "POST", body: form }), { params: Promise.resolve({ token }) });
  };
  return { sqlite, db, insert, update, token, otherToken, authority, customer, ask, tradeRoute, upload, objects, deletedObjects,
    onHandoff: callback=>{onHandoff=callback;},
    access: () => access, setAccess: value => { access = value; }, hook: callback => { beforeQuery = callback; },
    onCommit: callback => { afterCommit = callback; }, onDownload: callback => { duringDownload = callback; },
    view: () => hubServer.loadCustomerQuoteHub(db, authority),
    hubRow: () => sqlite.prepare("SELECT * FROM customer_quote_hubs WHERE id=?").get(authority.id),
    question: (id, project = "project-a", owner = "solar") => insert("customer_hub_questions", { id, opportunity_id: project, match_id: `match-${owner}`,
      service_categories_json: categories, kind: "text", prompt: `Question ${id}`, created_at: now, updated_at: now }),
  };
}

test("customer capability covers only its enquiry, while business views never contain quote or hub credentials", async t => {
  const f = await fixture(t);
  const view = await f.view();
  assert.deepEqual(view.quotes.map(row => row.id).sort(), ["link-ac", "link-solar"]);
  assert.equal((await hubServer.hubQuoteView(f.db, f.token, "link-solar")).quoteToken.startsWith("link-solar."), true);
  await assert.rejects(hubServer.hubQuoteView(f.db, f.token, "link-foreign"), /ACCESS_ENDED/);
  await assert.rejects(links.authoriseCustomerHub(f.db, (await hubServer.hubQuoteView(f.db, f.token, "link-solar")).quoteToken), /ACCESS_ENDED/);
  const trade = await tradeServer.tradeHubView(f.db, f.access(), "work-solar");
  assert.equal(trade.available, true);
  assert.deepEqual(await tradeServer.tradeHubView(f.db, f.access(), "work-ac"), { ok: true, available: false });
  assert.doesNotMatch(JSON.stringify([view, trade]), /token|encrypted|email_hash|customer@example|42 Private|PRIVATE STAFF|firebase_uid|recipient_email/);
});

test("hub email delivery reuses the exact capability and rejects wrong recipients or corrupt encrypted binding", async t => {
  const f = await fixture(t);
  assert.equal(decodeURIComponent(new URL(await links.customerHubEmailUrl(f.db, "project-a", ` ${customerEmail.toUpperCase()} `)).pathname.split("/").at(-1)), f.token);
  await assert.rejects(links.customerHubEmailUrl(f.db, "project-a", "other@example.invalid"), /ACCESS_ENDED/);
  const stored = JSON.parse(f.hubRow().encrypted_token);
  for (const changed of [{ kind: "quote_link" }, { id: "foreign" }, { secret: quoteLinks.newQuoteLinkSecret() }]) {
    f.update("customer_quote_hubs", { encrypted_token: JSON.stringify({ ...stored, ...changed }) }, "id=?", [f.authority.id]);
    await assert.rejects(links.customerHubEmailUrl(f.db, "project-a", customerEmail), /ACCESS_ENDED/);
  }
});

test("quote child capabilities require exact business, customer, job, version and live link bindings", async t => {
  const f = await fixture(t);
  const cases = [
    ["trade_crm_quote_links", { firebase_uid: "ac" }, "id='link-solar'"],
    ["trade_crm_quote_links", { crm_customer_id: "customer-ac" }, "id='link-solar'"],
    ["trade_crm_quote_links", { work_order_id: "work-ac" }, "id='link-solar'"],
    ["trade_crm_quote_links", { revoked_at: now }, "id='link-solar'"],
    ["trade_crm_quote_links", { expires_at: past }, "id='link-solar'"],
    ["trade_crm_quote_links", { status: "superseded" }, "id='link-solar'"],
    ["trade_crm_quotes", { current_version_number: 2 }, "id='quote-solar'"],
    ["trade_crm_quote_versions", { status: "draft" }, "id='version-solar'"],
    ["trade_crm_quote_versions", { valid_until: "2000-01-01" }, "id='version-solar'"],
    ["trade_work_orders", { source_reference: "match-foreign" }, "id='work-solar'"],
    ["trade_work_orders", { source_type: "internal" }, "id='work-solar'"],
  ];
  for (const [table, values, where] of cases) {
    f.sqlite.exec("SAVEPOINT quote_scope");
    try {
      f.update(table, values, where);
      await assert.rejects(hubServer.hubQuoteView(f.db, f.token, "link-solar"), /ACCESS_ENDED/, `${table}: ${JSON.stringify(values)}`);
    } finally { f.sqlite.exec("ROLLBACK TO quote_scope; RELEASE quote_scope"); }
  }
  const encrypted = JSON.parse(f.sqlite.prepare("SELECT encrypted_token FROM trade_crm_quote_links WHERE id='link-solar'").get().encrypted_token);
  f.update("trade_crm_quote_links", { encrypted_token: JSON.stringify({ ...encrypted, linkId: "link-ac" }) }, "id='link-solar'");
  await assert.rejects(hubServer.hubQuoteView(f.db, f.token, "link-solar"), /QUOTE_LINK_STALE/);
});

test("customer authority fails closed after consent, project, recipient or token withdrawal", async t => {
  const cases = [
    ["customer_quote_hubs", { revoked_at: now }, "opportunity_id='project-a'"],
    ["customer_quote_hubs", { expires_at: past }, "opportunity_id='project-a'"],
    ["customer_quote_hubs", { token_hash: "replaced" }, "opportunity_id='project-a'"],
    ["customer_quote_hubs", { email_hash: "replaced" }, "opportunity_id='project-a'"],
    ["trade_opportunities", { status: "closed" }, "id='project-a'"],
    ["trade_opportunities", { postcode: "3001" }, "id='project-a'"],
    ["trade_opportunities", { source_reference: "replacement-source" }, "id='project-a'"],
    ["public_trade_lead_contact_releases", { status: "withdrawn", withdrawn_at: now }, "opportunity_id='project-a'"],
    ["public_trade_lead_contact_releases", { customer_email: "replacement@example.invalid" }, "opportunity_id='project-a'"],
    ["public_trade_lead_contact_releases", { disclosed_fields: '["postcode","service_categories"]' }, "opportunity_id='project-a'"],
    ["public_trade_lead_contact_releases", { consent_purpose: "not consented" }, "opportunity_id='project-a'"],
  ];
  for (const [table, values, where] of cases) await t.test(`${table} ${Object.keys(values).join(",")}`, async child => {
    const f = await fixture(child); f.update(table, values, where);
    await assert.rejects(links.authoriseCustomerHub(f.db, f.token), /ACCESS_ENDED/);
  });
});

test("both customer quotes and current trade reads enforce current invitation, verified owner and eligibility", async t => {
  const cases = [
    ["trade_opportunity_matches", { status: "declined" }, "id='match-solar'"],
    ["trade_opportunity_matches", { firebase_uid: "foreign" }, "id='match-solar'"],
    ["trade_accounts", { account_status: "suspended" }, "firebase_uid='solar'"],
    ["trade_accounts", { verification_review_id: "unbound-review" }, "firebase_uid='solar'"],
    ["trade_accounts", { capabilities: '["air-conditioning"]' }, "firebase_uid='solar'"],
    ["trade_accounts", { service_states: '["WA"]', address_state: "WA" }, "firebase_uid='solar'"],
    ["trade_opportunities", { service_categories: '["solar","nathers-existing"]' }, "id='project-a'"],
  ];
  for (const [table, values, where] of cases) await t.test(`${table} ${Object.keys(values).join(",")}`, async child => {
    const f = await fixture(child); f.update(table, values, where);
    assert.equal((await f.view()).quotes.some(row => row.id === "link-solar"), false);
    assert.equal(await tradeServer.tradeHubContext(f.db, f.access(), "work-solar"), null);
    await assert.rejects(hubServer.hubQuoteView(f.db, f.token, "link-solar"), /ACCESS_ENDED/);
  });
});

test("ordinary customer quotes and Q&A require verified services without Creditex onboarding or team setup", async t => {
  const f = await fixture(t);
  f.update("creditex_business_onboarding", { status: "rejected", insurance_expires_on: "2000-01-01" }, "owner_uid='solar'");
  f.update("trade_team_members", { status: "inactive" }, "owner_uid='solar'");
  assert.equal((await f.view()).quotes.some(row => row.id === "link-solar"), true);
  assert.equal((await tradeServer.tradeHubContext(f.db, f.access(), "work-solar")).customer_id, "customer-solar");
});

test("trade read permission, job assignment and archived jobs are checked against the current owner", async t => {
  const f = await fixture(t);
  await assert.rejects(tradeServer.tradeHubContext(f.db, { ...f.access(), canViewQuotes: false }, "work-solar"), /ACCESS_ENDED/);
  const member = { ...f.access(), isOwner: false, actorUid: "technician", memberId: "technician", jobScope: "own" };
  f.insert("trade_team_members", { id: "technician", owner_uid: "solar", member_uid: "technician", email: "technician@example.invalid", role: "member",
    status: "active", job_scope: "own", can_view_quotes: 1, can_manage_quotes: 1, created_at: now, updated_at: now });
  assert.equal(await tradeServer.tradeHubContext(f.db, member, "work-solar"), null);
  f.update("trade_work_orders", { assignee_member_id: "technician" }, "id='work-solar'");
  assert.ok(await tradeServer.tradeHubContext(f.db, member, "work-solar"));
  f.update("trade_team_members", { can_view_quotes: 0 }, "id='technician'");
  assert.equal(await tradeServer.tradeHubContext(f.db, member, "work-solar"), null, "A stale access object cannot preserve revoked quote permission");
  f.update("trade_team_members", { can_view_quotes: 1 }, "id='technician'");
  f.update("trade_work_orders", { record_status: "archived" }, "id='work-solar'");
  assert.equal(await tradeServer.tradeHubContext(f.db, member, "work-solar"), null);
});

test("customer close is revision guarded, leaves existing quote views readable and reopens explicitly", async t => {
  const f = await fixture(t);
  const closed = await f.customer("PATCH", { accepting: false, revision: 1 });
  assert.equal(closed.status, 200); assert.equal((await closed.json()).hub.accepting, false);
  assert.equal(f.hubRow().revision, 2);
  assert.ok((await hubServer.hubQuoteView(f.db, f.token, "link-solar")).quoteToken);
  assert.equal((await f.customer("PATCH", { accepting: true, revision: 1 })).status, 409);
  assert.equal(f.hubRow().accepting, 0); assert.equal(f.hubRow().revision, 2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_events").get().count, 1);
  assert.equal((await f.customer("PATCH", { accepting: true, revision: 2 })).status, 200);
  assert.equal(f.hubRow().accepting, 1); assert.equal(f.hubRow().revision, 3);
});

test("recording quote acceptance never closes the project or blocks an unrelated quote", async t => {
  const f = await fixture(t);
  f.update("trade_crm_quote_versions", { status: "accepted" }, "id='version-solar'");
  f.update("trade_crm_quote_links", { status: "accepted" }, "id='link-solar'");
  receivedDecisions.set("link-solar", { receipt: { decision: "accepted", quoteNumber: "Q-solar" } });
  t.after(() => receivedDecisions.delete("link-solar"));
  assert.deepEqual(await hubServer.hubQuoteView(f.db, f.token, "link-solar"), { ok: true, receipt: { decision: "accepted", quoteNumber: "Q-solar" } });
  assert.equal(f.hubRow().accepting, 1); assert.equal(f.hubRow().revision, 1);
  assert.ok((await hubServer.hubQuoteView(f.db, f.token, "link-ac")).quoteToken);
  assert.equal((await f.ask()).status, 200);
});

test("migration trigger prevents both starting and completing quote issuance after closure", async t => {
  const f = await fixture(t);
  f.insert("trade_crm_quote_versions", { id: "draft-solar", quote_id: "quote-solar", firebase_uid: "solar", version_number: 2, status: "draft", created_at: now, updated_at: now });
  assert.equal((await f.customer("PATCH", { accepting: false, revision: 1 })).status, 200);
  for (const status of ["issuing", "issued"]) assert.throws(() => f.update("trade_crm_quote_versions", { status }, "id='draft-solar'"), /CUSTOMER_HUB_CLOSED/);
  await f.customer("PATCH", { accepting: true, revision: 2 });
  f.update("trade_crm_quote_versions", { status: "issuing" }, "id='draft-solar'");
  await f.customer("PATCH", { accepting: false, revision: 3 });
  await assert.rejects(f.db.batch([
    f.db.prepare("UPDATE trade_crm_quotes SET current_version_number=2 WHERE id='quote-solar'"),
    f.db.prepare("UPDATE trade_crm_quote_versions SET status='issued' WHERE id='draft-solar'"),
  ]), /CUSTOMER_HUB_CLOSED/);
  assert.equal(f.sqlite.prepare("SELECT current_version_number FROM trade_crm_quotes WHERE id='quote-solar'").get().current_version_number, 1);
  assert.ok((await hubServer.hubQuoteView(f.db, f.token, "link-solar")).quoteToken);
  f.update("trade_crm_quote_versions", { status: "accepted" }, "id='version-solar'");
  f.update("trade_crm_quote_versions", { status: "issued" }, "id='version-foreign'");
});

test("shared questions and answers stay inside one project and are visible to its current invited trades", async t => {
  const f = await fixture(t); f.question("shared"); f.question("foreign", "project-b", "foreign");
  assert.deepEqual((await f.view()).questions.map(question => question.id), ["shared"]);
  assert.deepEqual((await tradeServer.tradeHubView(f.db, ownerAccess("ac"), "work-ac")).questions.map(question => question.id), ["shared"]);
  assert.equal((await f.customer("POST", { questionId: "foreign", answer: "Wrong project", revision: 0 })).status, 409);
  assert.equal(f.sqlite.prepare("SELECT answer FROM customer_hub_questions WHERE id='foreign'").get().answer, "");
  assert.equal((await f.customer("POST", { questionId: "shared", answer: "The switchboard is outside", revision: 0 })).status, 200);
  assert.equal((await f.customer("POST", { questionId: "shared", answer: "Stale overwrite", revision: 0 })).status, 409);
  assert.equal((await tradeServer.tradeHubView(f.db, ownerAccess("ac"), "work-ac")).questions[0].answer, "The switchboard is outside");
  const notifications = await tradeServer.hubTradeNotifications(f.db, ownerAccess("ac"));
  assert.equal(notifications.length, 1); assert.equal(notifications[0].targetId, "customer-ac");assert.equal(notifications[0].workOrderId,"work-ac");assert.equal(notifications[0].targetKind,"customer");
  assert.deepEqual(await tradeServer.hubTradeNotifications(f.db, ownerAccess("foreign")), []);
  f.update("trade_opportunity_matches", { status: "declined" }, "id='match-ac'");
  assert.deepEqual(await tradeServer.tradeHubView(f.db, ownerAccess("ac"), "work-ac"), { ok: true, available: false });
  assert.deepEqual(await tradeServer.hubTradeNotifications(f.db, ownerAccess("ac")), []);
});

test("closed hub rejects new trade questions and customer answers but retains shared history", async t => {
  const f = await fixture(t); f.question("shared");
  await f.customer("PATCH", { accepting: false, revision: 1 });
  assert.equal((await f.ask()).status, 409);
  assert.equal((await f.customer("POST", { questionId: "shared", answer: "No late write", revision: 0 })).status, 409);
  const view = await tradeServer.tradeHubView(f.db, f.access(), "work-solar");
  assert.equal(view.available, true); assert.equal(view.accepting, false); assert.equal(view.questions[0].closed, true);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_questions").get().count, 1);
  assert.equal(f.sqlite.prepare("SELECT answer FROM customer_hub_questions WHERE id='shared'").get().answer, "");
});

test("shared file reads require the current enquiry, matched service and an invitation still valid after storage access", async t => {
  const f = await fixture(t); f.question("shared"); f.question("foreign", "project-b", "foreign");
  for (const [id, project] of [["shared", "project-a"], ["foreign", "project-b"]]) {
    f.insert("customer_hub_files", { id: `file-${id}`, question_id: id, opportunity_id: project, file_name: "roof.png", content_type: "image/png",
      size_bytes: 123, object_key: `private/${id}`, sha256: `${id}-sha256`, created_at: now });
    f.objects.set(`private/${id}`, "SYNTHETIC FILE");
  }
  const file = id => f.tradeRoute.GET(new Request(`https://example.invalid/api/trade-customer-hub?workOrderId=work-solar&fileId=${id}`));
  const response = await file("file-shared");
  assert.equal(response.status, 200); assert.equal(await response.text(), "SYNTHETIC FILE");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Content-Security-Policy"), "default-src 'none'; sandbox");
  assert.equal((await file("file-foreign")).status, 404);
  f.update("customer_hub_questions", { service_categories_json: '["air-conditioning"]' }, "id='shared'");
  assert.equal((await file("file-shared")).status, 404);
  f.update("customer_hub_questions", { service_categories_json: categories }, "id='shared'");
  f.hook((sql, method) => { if (method === "first" && sql.includes("SELECT file.file_name")) { f.hook(null); f.update("trade_opportunity_matches", { status: "declined" }, "id='match-solar'"); } });
  assert.equal((await file("file-shared")).status, 404);
});

test("atomic write guards reject closure and consent withdrawal between preflight and mutation", async t => {
  const f = await fixture(t); f.question("shared");
  f.hook((sql, method) => { if (method === "batch") { f.hook(null); f.update("customer_quote_hubs", { accepting: 0 }, "id=?", [f.authority.id]); } });
  assert.equal((await f.customer("POST", { questionId: "shared", answer: "Race", revision: 0 })).status, 409);
  assert.equal(f.sqlite.prepare("SELECT answer_revision FROM customer_hub_questions WHERE id='shared'").get().answer_revision, 0);
  f.hook((sql, method) => { if (method === "batch") { f.hook(null); f.update("public_trade_lead_contact_releases", { status: "withdrawn", withdrawn_at: now }, "id='release-project-a'"); } });
  assert.equal((await f.customer("PATCH", { accepting: true, revision: 1 })).status, 409);
  assert.equal(f.hubRow().accepting, 0); assert.equal(f.hubRow().revision, 1);
});

test("trade question insert rechecks the customer gate and quote management permission", async t => {
  const f = await fixture(t);
  f.setAccess({ ...f.access(), canManageQuotes: false });
  assert.equal((await f.ask()).status, 403);
  f.setAccess(ownerAccess("solar"));
  f.hook((sql, method) => { if (method === "run" && sql.includes("INSERT INTO customer_hub_questions")) { f.hook(null); f.update("customer_quote_hubs", { accepting: 0 }, "id=?", [f.authority.id]); } });
  assert.equal((await f.ask()).status, 409);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_questions").get().count, 0);
});

test("trade data is withheld when invitation changes while reading shared questions", async t => {
  const f = await fixture(t); f.question("shared");
  f.hook((sql, method) => { if (method === "all" && sql.includes("SELECT question.*")) { f.hook(null); f.update("trade_opportunity_matches", { status: "declined" }, "id='match-solar'"); } });
  await assert.rejects(tradeServer.tradeHubView(f.db, f.access(), "work-solar"), /ACCESS_ENDED/);
});

test("expired or revoked customer links rotate without reopening the hub or dropping shared history", async t => {
  const f = await fixture(t); f.question("shared");
  await f.customer("PATCH", { accepting: false, revision: 1 });
  let oldToken = f.token;
  for (const values of [{ expires_at: past }, { revoked_at: now }]) {
    f.update("customer_quote_hubs", values, "id=?", [f.authority.id]);
    await assert.rejects(links.authoriseCustomerHub(f.db, oldToken), /ACCESS_ENDED/);
    const nextToken = decodeURIComponent(new URL(await links.customerHubEmailUrl(f.db, "project-a", customerEmail)).pathname.split("/").at(-1));
    assert.notEqual(nextToken, oldToken);
    await assert.rejects(links.authoriseCustomerHub(f.db, oldToken), /ACCESS_ENDED/);
    const nextAuthority = await links.authoriseCustomerHub(f.db, nextToken);
    assert.equal(nextAuthority.id, f.authority.id);
    const hub = await hubServer.loadCustomerQuoteHub(f.db, nextAuthority);
    assert.equal(hub.accepting, false); assert.equal(hub.revision, 2);
    assert.deepEqual(hub.questions.map(question => question.id), ["shared"]);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_quote_hubs WHERE opportunity_id='project-a'").get().count, 1);
    oldToken = nextToken;
  }
});

test("opportunity expiry denies customer links, new email capabilities and current trade reads", async t => {
  const f = await fixture(t);
  f.update("trade_opportunities", { expires_at: past }, "id='project-a'");
  await assert.rejects(links.authoriseCustomerHub(f.db, f.token), /ACCESS_ENDED/);
  await assert.rejects(links.customerHubEmailUrl(f.db, "project-a", customerEmail), /ACCESS_ENDED/);
  await assert.rejects(hubServer.hubQuoteView(f.db, f.token, "link-solar"), /ACCESS_ENDED/);
  assert.equal(await tradeServer.tradeHubContext(f.db, f.access(), "work-solar"), null);
  assert.equal((await f.ask()).status, 404);
});

test("member permissions revoked during question creation or file download stop the current request", async t => {
  const f = await fixture(t); f.question("shared");
  f.insert("trade_team_members", { id: "technician", owner_uid: "solar", member_uid: "technician", email: "technician@example.invalid", role: "member",
    status: "active", job_scope: "own", can_view_quotes: 1, can_manage_quotes: 1, created_at: now, updated_at: now });
  f.update("trade_work_orders", { assignee_member_id: "technician" }, "id='work-solar'");
  f.setAccess({ ...f.access(), isOwner: false, actorUid: "technician", memberId: "technician", jobScope: "own" });
  f.hook((sql, method) => { if (method === "run" && sql.includes("INSERT INTO customer_hub_questions")) {
    f.hook(null); f.update("trade_team_members", { can_manage_quotes: 0 }, "id='technician'");
  } });
  const denied = await f.ask();
  assert.ok(denied.status >= 400, "A rejected INSERT must not report success");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_questions").get().count, 1);
  f.insert("customer_hub_files", { id: "download", question_id: "shared", opportunity_id: "project-a", file_name: "evidence.pdf", content_type: "application/pdf",
    size_bytes: 123, object_key: "private/download", sha256: "download-hash", created_at: now });
  f.objects.set("private/download", "SYNTHETIC PRIVATE FILE");
  f.onDownload(() => f.update("trade_team_members", { can_view_quotes: 0 }, "id='technician'"));
  const download = await f.tradeRoute.GET(new Request("https://example.invalid/api/trade-customer-hub?workOrderId=work-solar&fileId=download"));
  assert.equal(download.status, 404);
  assert.doesNotMatch(await download.text(), /SYNTHETIC PRIVATE FILE/);
});

test("duplicate or over-limit trade questions report no-write conflicts instead of success", async t => {
  const f = await fixture(t);
  assert.equal((await f.ask({ prompt: "Is the roof access clear?" })).status, 200);
  const duplicate = await f.ask({ prompt: "  IS THE ROOF ACCESS CLEAR?  " });
  assert.equal(duplicate.status, 409);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_questions").get().count, 1);
  for (let index = 1; index < 60; index += 1) f.question(`question-${index}`);
  assert.equal((await f.ask({ prompt: "A new question beyond the limit" })).status, 409);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_questions").get().count, 60);
});

test("upload retains committed bytes after a lost database response and retry creates no duplicate file or event", async t => {
  const f = await fixture(t); f.question("document");
  f.update("customer_hub_questions", { kind: "document" }, "id='document'");
  f.onCommit(() => { f.onCommit(null); throw new Error("Synthetic response lost after COMMIT"); });
  assert.equal((await f.upload("document")).status, 201);
  const stored = f.sqlite.prepare("SELECT * FROM customer_hub_files WHERE question_id='document'").get();
  assert.ok(stored); assert.ok(f.objects.has(stored.object_key));
  assert.match(new TextDecoder().decode(f.objects.get(stored.object_key)), /^%PDF-1.7/);
  assert.deepEqual(f.deletedObjects, []);
  assert.equal((await f.upload("document")).status, 200);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_files").get().count, 1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_events WHERE event_type='file_added'").get().count, 1);
  assert.equal(f.objects.size, 1); assert.deepEqual(f.deletedObjects, []);
});

test("upload rolls back and removes staged bytes when the customer closes before the database write", async t => {
  const f = await fixture(t); f.question("document");
  f.update("customer_hub_questions", { kind: "document" }, "id='document'");
  f.hook((sql, method) => { if (method === "batch") {
    f.hook(null); f.update("customer_quote_hubs", { accepting: 0 }, "id=?", [f.authority.id]);
  } });
  assert.equal((await f.upload("document")).status, 409);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_files").get().count, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) count FROM customer_hub_events WHERE event_type='file_added'").get().count, 0);
  assert.equal(f.objects.size, 0); assert.equal(f.deletedObjects.length, 1);
});

test("business interest defaults off, uses CAS, stops updates immediately and does not reopen customer enquiries", async t => {
  const f=await fixture(t);
  f.sqlite.prepare("DELETE FROM customer_hub_interests").run();
  const req=body=>new Request('https://example.invalid/api/trade-customer-hub',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({workOrderId:'work-solar',...body})});
  let view=await tradeServer.tradeHubView(f.db,f.access(),'work-solar');
  assert.equal(view.interested,false);assert.equal(view.interestRevision,0);
  assert.equal((await f.ask()).status,409);
  assert.equal((await f.tradeRoute.PATCH(req({interested:true,revision:0}))).status,200);
  assert.equal((await f.tradeRoute.PATCH(req({interested:false,revision:0}))).status,409);
  assert.equal((await f.ask()).status,200);
  let notes=await tradeServer.hubTradeNotifications(f.db,f.access());
  assert.equal(notes.length,1);assert.equal(notes[0].targetKind,'customer');assert.equal(notes[0].targetId,'customer-solar');
  await f.customer('PATCH',{accepting:false,revision:1});
  assert.equal((await f.tradeRoute.PATCH(req({interested:false,revision:1}))).status,200);
  assert.deepEqual(await tradeServer.hubTradeNotifications(f.db,f.access()),[]);
  assert.equal((await f.tradeRoute.PATCH(req({interested:true,revision:2}))).status,200);
  assert.equal((await f.view()).accepting,false);
  assert.deepEqual(await tradeServer.hubTradeNotifications(f.db,f.access()),[],'resubscribing does not flood old updates');
});

test("shared customer questions and trade replies notify interested businesses without sharing business identities",async t=>{
  const f=await fixture(t);
  assert.equal((await f.customer('POST',{action:'ask',prompt:'Can we keep the existing switchboard?'})).status,200);
  const question=(await f.view()).questions[0];assert.equal(question.authorType,'customer');
  assert.equal((await f.ask({action:'reply',questionId:question.id,body:'Please share a clear photo so this can be assessed.'})).status,200);
  const trade=await tradeServer.tradeHubView(f.db,ownerAccess('ac'),'work-ac');
  assert.equal(trade.questions[0].replies[0].authorType,'trade');
  assert.equal(trade.questions[0].replies[0].body,'Please share a clear photo so this can be assessed.');
  assert.doesNotMatch(JSON.stringify(trade),/Synthetic solar|businessProfile|business_name|websiteUrl|match-solar|firebase_uid|quote_number/);
  const customer=await f.view();assert.equal(customer.questions[0].replies[0].business,'Synthetic solar');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM customer_hub_email_deliveries').get().count,1,'customer own question does not email itself');
  assert.equal((await tradeServer.hubTradeNotifications(f.db,ownerAccess('ac'))).length,2);
  assert.equal((await f.ask({action:'reply',questionId:question.id,body:'Please share a clear photo so this can be assessed.'})).status,409);
  assert.equal((await f.ask({action:'reply',questionId:'foreign-question',body:'Wrong project'})).status,409);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) count FROM customer_hub_replies').get().count,1);
  assert.equal((await f.customer('POST',{action:'reply',questionId:question.id,body:'I will upload that now.'})).status,200);
  assert.equal((await f.view()).questions[0].replies.length,2);
});

test("notification permission defaults off for staff and is rechecked after reading events",async t=>{
  const f=await fixture(t);assert.equal((await f.ask()).status,200);
  f.insert('trade_team_members',{id:'staff',owner_uid:'solar',member_uid:'staff',email:'staff@example.invalid',role:'member',status:'active',job_scope:'team',can_view_quotes:1,can_manage_quotes:1,can_view_customers:1,created_at:now,updated_at:now});
  const access={...f.access(),isOwner:false,actorUid:'staff',memberId:'staff',canReceiveCustomerQaNotifications:false};
  assert.deepEqual(await tradeServer.hubTradeNotifications(f.db,access),[]);
  access.canReceiveCustomerQaNotifications=true;
  assert.deepEqual(await tradeServer.hubTradeNotifications(f.db,access),[],'stale request permission cannot grant receipt');
  f.update('trade_team_members',{can_receive_customer_qa_notifications:1},"id='staff'");
  assert.equal((await tradeServer.hubTradeNotifications(f.db,access)).length,1);
  f.hook((sql,method)=>{if(method==='first'&&sql.includes('match.id match_id')){f.hook(null);f.update('trade_team_members',{can_receive_customer_qa_notifications:0},"id='staff'");}});
  assert.deepEqual(await tradeServer.hubTradeNotifications(f.db,access),[]);
});

test("interest revocation during question write rolls back question, event and customer email",async t=>{
  const f=await fixture(t);
  f.hook((sql,method)=>{if(method==='run'&&sql.includes('INSERT INTO customer_hub_questions')){f.hook(null);f.update('customer_hub_interests',{interested:0},"match_id='match-solar'");}});
  assert.equal((await f.ask()).status,409);
  for(const table of ['customer_hub_questions','customer_hub_events','customer_hub_email_deliveries'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,0);
});

test("lead interest works before a quote job exists and provisions only the current owner's exact match",async t=>{
  const f=await fixture(t);const saved=f.sqlite.prepare("SELECT * FROM trade_work_orders WHERE id='work-solar'").get();
  f.sqlite.prepare("DELETE FROM customer_hub_interests WHERE match_id='match-solar'").run();
  f.sqlite.prepare("DELETE FROM trade_work_orders WHERE id='work-solar'").run();
  const view=await tradeServer.tradeHubView(f.db,f.access(),'','match-solar');
  assert.equal(view.available,true);assert.equal(view.workOrderId,'');assert.equal(view.interested,false);
  let handoffs=0;f.onHandoff(async(db,owner,match)=>{assert.equal(db,f.db);assert.equal(owner,'solar');assert.equal(match,'match-solar');handoffs++;f.insert('trade_work_orders',saved);});
  const patch=(matchId,interested,revision)=>f.tradeRoute.PATCH(new Request('https://example.invalid/api/trade-customer-hub',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId,interested,revision})}));
  assert.equal((await patch('match-ac',true,0)).status,404);
  assert.equal((await patch('match-solar',false,0)).status,200);assert.equal(handoffs,0);
  const result=await patch('match-solar',true,0);assert.equal(result.status,200);assert.equal(handoffs,1);
  const body=await result.json();assert.equal(body.workOrderId,'work-solar');assert.equal(body.customerId,'customer-solar');assert.equal(body.interested,true);
  const replay=await patch('match-solar',true,0);assert.equal(replay.status,200);assert.equal(handoffs,1);assert.equal((await replay.json()).interestRevision,1);
});


function leadInterestRequest(matchId, interested, revision) {
  return new Request('https://example.invalid/api/trade-customer-hub', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchId,interested,revision})});
}

test("eligible legacy lead GET is read-only and Interested creates a missing hub without exposing its customer capability",async t=>{
  const f=await fixture(t);
  f.sqlite.exec("DELETE FROM customer_quote_hubs WHERE opportunity_id='project-a'; DELETE FROM customer_hub_interests WHERE match_id='match-solar'");
  const available=await tradeServer.tradeHubView(f.db,f.access(),'','match-solar');
  assert.equal(available.available,true);assert.equal(available.interested,false);assert.equal(available.interestRevision,0);
  assert.equal(available.customerId,'customer-solar');assert.equal(available.workOrderId,'work-solar');assert.deepEqual(available.questions,[]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_quote_hubs WHERE opportunity_id='project-a'").get().n,0);
  assert.deepEqual(await tradeServer.tradeHubView(f.db,ownerAccess('ac'),'','match-solar'),{ok:true,available:false});
  const result=await f.tradeRoute.PATCH(leadInterestRequest('match-solar',true,0));
  assert.equal(result.status,200);
  const body=await result.json();assert.equal(body.interested,true);assert.equal(body.customerId,'customer-solar');assert.equal(body.workOrderId,'work-solar');
  assert.doesNotMatch(JSON.stringify(body),/recipient_email|customer@example|token|secret|encrypted|email_hash/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_quote_hubs WHERE opportunity_id='project-a'").get().n,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_hub_email_deliveries").get().n,0,'interest itself does not send the customer an email');
  assert.equal((await f.tradeRoute.PATCH(leadInterestRequest('match-solar',false,1))).status,200);
  assert.equal((await f.tradeRoute.PATCH(leadInterestRequest('match-solar',true,2))).status,200);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_work_orders WHERE source_reference='match-solar'").get().n,1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM trade_crm_customers WHERE id='customer-solar'").get().n,1);
});

test("an existing revoked or expired hub cannot be revived by a trade's Interested action",async t=>{
  const f=await fixture(t);
  for(const values of [{revoked_at:now},{revoked_at:'',expires_at:past}]){
    f.update('customer_quote_hubs',values,"opportunity_id='project-a'");
    assert.deepEqual(await tradeServer.tradeHubView(f.db,f.access(),'','match-solar'),{ok:true,available:false});
    assert.equal((await f.tradeRoute.PATCH(leadInterestRequest('match-solar',true,1))).status,404);
  }
});

test("returned Customer Q&A IDs are the exact active customer and job belonging to this owner",async t=>{
  const f=await fixture(t);
  f.update('trade_crm_job_details',{crm_customer_id:'customer-ac'},"work_order_id='work-solar'");
  let view=await tradeServer.tradeHubView(f.db,f.access(),'','match-solar');
  assert.equal(view.customerId,'');assert.equal(view.workOrderId,'');
  f.update('trade_crm_job_details',{crm_customer_id:'customer-solar'},"work_order_id='work-solar'");
  f.update('trade_crm_customers',{record_status:'archived'},"id='customer-solar'");
  view=await tradeServer.tradeHubView(f.db,f.access(),'','match-solar');
  assert.equal(view.customerId,'');assert.equal(view.workOrderId,'');
  f.update('trade_crm_customers',{record_status:'active'},"id='customer-solar'");
  view=await tradeServer.tradeHubView(f.db,f.access(),'work-solar');
  assert.equal(view.customerId,'customer-solar');assert.equal(view.workOrderId,'work-solar');
});

test("missing-hub provision uses the exact consent release and fails if it changes during creation",async t=>{
  const f=await fixture(t);
  f.sqlite.exec("DELETE FROM customer_quote_hubs WHERE opportunity_id='project-a'; DELETE FROM customer_hub_interests WHERE match_id='match-solar'");
  f.hook((sql,method)=>{if(method==='run'&&sql.includes('INSERT INTO customer_quote_hubs')){f.hook(null);f.update('public_trade_lead_contact_releases',{withdrawn_at:now},"id='release-project-a'");}});
  assert.equal((await f.tradeRoute.PATCH(leadInterestRequest('match-solar',true,0))).status,404);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_quote_hubs WHERE opportunity_id='project-a'").get().n,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_hub_interests WHERE match_id='match-solar'").get().n,0);
});

test("legacy AEA-only consent retains private Q&A for its verified AEA owner before and after hub provisioning",async t=>{
  const f=await fixture(t);
  f.sqlite.exec("DELETE FROM customer_quote_hubs WHERE opportunity_id='project-a'; DELETE FROM customer_hub_interests WHERE match_id='match-solar'");
  // This legacy policy intentionally stays unchanged when new all-qualified consent is introduced.
  f.update('public_trade_lead_contact_releases',{notice_version:'2026-09-14-aea-services-and-upgrade-sharing-v9',consent_purpose:'Email my private plan. Australian Energy Assessments handles safety and assessments. Other requests and selected quote details go to approved matching trades.'},"id='release-project-a'");
  f.update('trade_opportunities',{service_categories:'["assessment","solar"]'},"id='project-a'");
  f.update('trade_opportunity_matches',{matched_categories:'["assessment","solar"]'},"id='match-solar'");
  f.update('trade_accounts',{capabilities:'["assessment","solar"]'},"firebase_uid='solar'");
  assert.deepEqual(await tradeServer.tradeHubView(f.db,f.access(),'','match-solar'),{ok:true,available:false});
  f.update('trade_accounts',{verified_abn:''},"firebase_uid='foreign'");
  const aeaReview=f.sqlite.prepare("SELECT * FROM trade_account_verification_reviews WHERE id='review-solar'").get();
  f.insert('trade_account_verification_reviews',{...aeaReview,id:'review-aea',abn:'73675233557'});
  f.update('trade_accounts',{abn:'73675233557',verified_abn:'73675233557',verification_review_id:'review-aea'},"firebase_uid='solar'");
  f.insert('admin_users',{firebase_uid:'solar',email:'solar@example.invalid',role:'admin',status:'active',created_at:now,updated_at:now});
  const view=await tradeServer.tradeHubView(f.db,f.access(),'','match-solar');assert.equal(view.available,true);
  assert.equal((await f.tradeRoute.PATCH(leadInterestRequest('match-solar',true,0))).status,200);
  assert.deepEqual(await tradeServer.tradeHubView(f.db,ownerAccess('ac'),'','match-ac'),{ok:true,available:false});
});

function prepareQuoteHubRecipient(f, owner='solar') {
  const project=owner==='foreign'?'project-b':'project-a';
  f.update('trade_crm_customers',{email:customerEmail},"id=?",[`customer-${owner}`]);
  f.update('trade_crm_job_details',{accepted_disclosure_sha256:'a'.repeat(64),accepted_disclosure_snapshot:JSON.stringify({
    contract:'tlink-public-lead-accepted-disclosure-v1',source:{opportunityMatchId:`match-${owner}`,sourceReference:`source-${project}`,releaseId:`release-${project}`},customer:{email:customerEmail}})},'id=?',[`detail-${owner}`]);
  return {ownerUid:owner,workOrderId:`work-${owner}`,customerId:`customer-${owner}`,recipientEmail:customerEmail};
}

test('quote email hub capability is exact to owner, job, accepted release and recipient, never aggregated by email',async t=>{
  const f=await fixture(t), input=prepareQuoteHubRecipient(f), other=prepareQuoteHubRecipient(f,'foreign');
  const url=await quoteHubEmail.tradeQuoteCustomerHubEmailUrl(f.db,input);
  assert.equal(decodeURIComponent(new URL(url).pathname.split('/').at(-1)),f.token);
  assert.notEqual(await quoteHubEmail.tradeQuoteCustomerHubEmailUrl(f.db,other),url,'same recipient on a different enquiry has a different hub');
  for(const change of [{ownerUid:'ac'},{workOrderId:'work-ac'},{customerId:'customer-ac'},{recipientEmail:'other@example.invalid'}])
    assert.equal(await quoteHubEmail.tradeQuoteCustomerHubEmailUrl(f.db,{...input,...change}),undefined);
  const cases=[
    ['public_trade_lead_contact_releases',{postcode:'3001'},"id='release-project-a'"],
    ['public_trade_lead_contact_releases',{source_reference:'replaced'},"id='release-project-a'"],
    ['public_trade_lead_contact_releases',{withdrawn_at:now},"id='release-project-a'"],
    ['customer_quote_hubs',{revoked_at:now},"opportunity_id='project-a'"],
    ['customer_quote_hubs',{expires_at:past},"opportunity_id='project-a'"],
    ['customer_quote_hubs',{email_hash:'replacement'},"opportunity_id='project-a'"],
    ['customer_quote_hubs',{token_hash:'replacement'},"opportunity_id='project-a'"],
    ['trade_crm_customers',{email:'replaced@example.invalid'},"id='customer-solar'"],
    ['trade_crm_job_details',{accepted_disclosure_snapshot:'{}'},"id='detail-solar'"],
    ['trade_crm_job_details',{crm_customer_id:'customer-foreign'},"id='detail-solar'"],
    ['trade_work_orders',{source_reference:'match-foreign'},"id='work-solar'"],
    ['trade_opportunity_matches',{status:'declined'},"id='match-solar'"],
    ['trade_accounts',{verification_review_id:'foreign'},"firebase_uid='solar'"],
  ];
  for(const [table,change,where] of cases){
    f.sqlite.exec('SAVEPOINT quote_email_scope');
    try{f.update(table,change,where);assert.equal(await quoteHubEmail.tradeQuoteCustomerHubEmailUrl(f.db,input),undefined,table);}
    finally{f.sqlite.exec('ROLLBACK TO quote_email_scope; RELEASE quote_email_scope');}
  }
});

test('quote delivery retry never creates or revives a missing or withdrawn customer hub',async t=>{
  const f=await fixture(t),input=prepareQuoteHubRecipient(f);
  f.sqlite.exec("DELETE FROM customer_quote_hubs WHERE opportunity_id='project-a'");
  assert.equal(await quoteHubEmail.tradeQuoteCustomerHubEmailUrl(f.db,input),undefined);
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM customer_quote_hubs WHERE opportunity_id='project-a'").get().n,0);
  const url=await quoteHubEmail.tradeQuoteCustomerHubEmailUrl(f.db,input,true);
  assert.ok(url.startsWith('https://ausenergyassessments.com/customer-hub/'));
  const before=f.sqlite.prepare("SELECT * FROM customer_quote_hubs WHERE opportunity_id='project-a'").get();
  f.update('customer_quote_hubs',{revoked_at:now},"opportunity_id='project-a'");
  assert.equal(await quoteHubEmail.tradeQuoteCustomerHubEmailUrl(f.db,input,true),undefined);
  const after=f.sqlite.prepare("SELECT * FROM customer_quote_hubs WHERE opportunity_id='project-a'").get();
  assert.equal(after.token_hash,before.token_hash);assert.equal(after.revoked_at,now);
});

test('quote hub email rechecks release authority after decrypting a stored capability',async t=>{
  const f=await fixture(t),input=prepareQuoteHubRecipient(f);let reads=0;
  f.hook((sql,operation)=>{if(operation==='first'&&sql.includes('hub.id hub_id')&&++reads===2)
    f.update('public_trade_lead_contact_releases',{withdrawn_at:now},"id='release-project-a'");});
  assert.equal(await quoteHubEmail.tradeQuoteCustomerHubEmailUrl(f.db,input),undefined);
});
