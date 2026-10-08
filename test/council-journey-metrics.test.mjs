import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { transformSync } from "esbuild";
import * as contract from "../src/lib/council-journey-metrics.ts";

function load(path, dependencies) {
  const record = { exports: {} };
  const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
  new Function("require", "module", "exports", code)(id => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency ${id}`);
    return dependencies[id];
  }, record, record.exports);
  return record.exports;
}
const server = load("../src/lib/council-journey-metrics-server.ts", { "./council-journey-metrics": contract });
const now = "2026-10-08T04:00:00.000Z";

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY, postcode TEXT, state TEXT, is_synthetic INTEGER, source_reference TEXT, created_by_uid TEXT);
    CREATE TABLE trade_opportunity_matches(id TEXT PRIMARY KEY, opportunity_id TEXT, firebase_uid TEXT);
    CREATE TABLE trade_work_orders(id TEXT PRIMARY KEY, firebase_uid TEXT, source_type TEXT, source_reference TEXT);
    CREATE TABLE trade_crm_job_details(id TEXT PRIMARY KEY, work_order_id TEXT, firebase_uid TEXT, crm_customer_id TEXT, service_site_id TEXT, customer_source TEXT,
      accepted_disclosure_snapshot TEXT, accepted_disclosure_sha256 TEXT, accepted_disclosure_at TEXT);`);
  for (const filename of ["0250_council_workspace.sql", "0258_council_public_branding.sql", "0050_versioned_trade_quotes.sql", "0067_secure_quote_sharing.sql"]) {
    sql.exec(readFileSync(new URL(`../drizzle/${filename}`, import.meta.url), "utf8"));
  }
  sql.exec("ALTER TABLE trade_crm_quote_deliveries ADD recipient_role TEXT NOT NULL DEFAULT 'acceptance'");
  for (const [id, actor, postcode] of [["c1", "actor-a", "3182"], ["c2", "actor-b", "3182"]]) {
    sql.prepare("INSERT INTO council_organisations(id,name,slug,state,created_at,updated_at) VALUES(?,?,?,'VIC',?,?)").run(id, `Council ${id}`, `council-${id}`, now, now);
    sql.prepare("INSERT INTO council_postcodes VALUES(?,'VIC',?,'admin',?)").run(id, postcode, now);
    sql.prepare("INSERT INTO council_memberships(id,council_id,firebase_uid,email,role,invited_by_uid,created_at,updated_at) VALUES(?,?,?,?,'viewer','admin',?,?)").run(`member-${id}`, id, actor, `${actor}@example.invalid`, now, now);
    for (const suffix of ["journey", "event", "replacement"]) sql.prepare("INSERT INTO council_campaigns(id,council_id,code,title,kind,audience,created_at,updated_at) VALUES(?,?,?,?,'campaign','everyone',?,?)").run(`${id}-${suffix}`, id, `${id}-${suffix}`, `Campaign ${suffix}`, now, now);
    sql.prepare("UPDATE council_organisations SET public_campaign_id=?,public_journey_enabled=1 WHERE id=?").run(`${id}-journey`, id);
  }
  let afterAggregate = null;
  const prepare = (query, args = []) => ({ query, args,
    bind: (...values) => prepare(query, values),
    first: async () => {
      const result = sql.prepare(query).get(...args) ?? null;
      if (query.startsWith("WITH submitted")) afterAggregate?.();
      return result;
    },
    all: async () => ({ success: true, results: sql.prepare(query).all(...args) }),
    run: async () => ({ success: true, results: [], meta: { changes: Number(sql.prepare(query).run(...args).changes) } }),
  });
  const db = { prepare, batch: async statements => {
    sql.exec("BEGIN");
    try {
      const rows = [];
      for (const statement of statements) rows.push(statement.query.trim().startsWith("SELECT") ? await statement.all() : await statement.run());
      sql.exec("COMMIT"); return rows;
    } catch (error) { sql.exec("ROLLBACK"); throw error; }
  } };
  function lead(id, options = {}) {
    const { postcode = "3182", state = "VIC", synthetic = 0, source = "lead-intake", reference = `intake-${id}`, council = "c1", campaign = `${council}-journey`, attributed = true } = options;
    sql.prepare("INSERT INTO trade_opportunities VALUES(?,?,?,?,?,?)").run(id, postcode, state, synthetic, reference, source);
    if (attributed) sql.prepare("INSERT INTO council_attributions VALUES(?,?,?,?,'explicit_referral')").run(id, campaign, council, now);
  }
  function quote(leadId, id, options = {}) {
    const { owner = "trade-a", versionStatus = "issued", issuedAt = now, status = "provider_accepted", providerId = `receipt-${id}`, role = "acceptance", channel = "email", delivered = true } = options;
    const workId = `work-${id}`, customer = `customer-${id}`, site = `site-${id}`, match = `match-${id}`;
    sql.prepare("INSERT INTO trade_opportunity_matches VALUES(?,?,?)").run(match, leadId, owner);
    sql.prepare("INSERT INTO trade_work_orders VALUES(?,?,'public_lead',?)").run(workId, owner, match);
    sql.prepare("INSERT INTO trade_crm_job_details VALUES(?,?,?,?,?,'public_lead_released',?,?,?)").run(`detail-${id}`, workId, owner, customer, site, JSON.stringify({ contract: "tlink-public-lead-accepted-disclosure-v1" }), "a".repeat(64), now);
    sql.prepare("INSERT INTO trade_crm_quotes(id,work_order_id,firebase_uid,crm_customer_id,service_site_id,quote_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(`quote-${id}`, workId, owner, customer, site, `number-${id}`, now, now);
    version(`version-${id}`, `quote-${id}`, owner, versionStatus, issuedAt);
    link(`link-${id}`, `version-${id}`, `quote-${id}`, workId, owner, customer);
    if (delivered) delivery(`delivery-${id}`, `link-${id}`, `version-${id}`, workId, owner, customer, { status, providerId, role, channel });
    return { workId, customer, site, owner, quoteId: `quote-${id}`, versionId: `version-${id}`, linkId: `link-${id}` };
  }
  function version(id, quoteId, owner, status = "issued", issuedAt = now, number = 1) {
    sql.prepare("INSERT INTO trade_crm_quote_versions(id,quote_id,firebase_uid,version_number,status,issued_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(id, quoteId, owner, number, status, issuedAt, now, now);
  }
  function link(id, versionId, quoteId, workId, owner, customer) {
    sql.prepare("INSERT INTO trade_crm_quote_links(id,quote_id,quote_version_id,work_order_id,firebase_uid,crm_customer_id,token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'2027-01-01',?,?)").run(id, quoteId, versionId, workId, owner, customer, `token-${id}`, now, now);
  }
  function delivery(id, linkId, versionId, workId, owner, customer, options = {}) {
    const { status = "provider_accepted", providerId = `receipt-${id}`, role = "acceptance", channel = "email", accepted = ["provider_accepted", "sent", "delivered"].includes(status) } = options;
    sql.prepare("INSERT INTO trade_crm_quote_deliveries(id,quote_link_id,quote_version_id,work_order_id,firebase_uid,crm_customer_id,channel,provider,status,idempotency_key,provider_message_id,recipient_role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'resend',?,?,?,?,?,?)").run(id, linkId, versionId, workId, owner, customer, channel, status, `key-${id}`, providerId, role, now, now);
    if (accepted) sql.prepare(`INSERT INTO trade_crm_quote_events
      (id,quote_link_id,quote_id,quote_version_id,work_order_id,firebase_uid,event_type,actor_type,evidence_key,occurred_at)
      SELECT ?,?,?,?,? ,?,'provider_accepted','system',?,? FROM trade_crm_quote_links WHERE id=?`)
      .run(`event-${id}`, linkId, sql.prepare("SELECT quote_id FROM trade_crm_quote_links WHERE id=?").get(linkId).quote_id, versionId, workId, owner, `provider_accepted:key-${id}`, now, linkId);
  }
  const actor = { uid: "actor-a", email: "actor-a@example.invalid", emailVerified: true };
  const access = load("../src/lib/council-access-server.ts", { "../../db": { getD1: () => db }, "./firebase-server": { requireFirebaseIdentity: async () => actor } });
  let accessCalls = 0;
  const route = load("../src/app/api/council/journey-metrics/route.ts", {
    "@/lib/council-access-server": { requireCouncilAccess: async (...args) => { accessCalls++; return access.requireCouncilAccess(...args); } },
    "@/lib/council-journey-metrics": contract,
    "@/lib/council-journey-metrics-server": server,
  });
  return { sql, db, actor, lead, quote, version, link, delivery,
    changeAfterAggregate: action => { afterAggregate = action; }, accessCalls: () => accessCalls,
    GET: (query = "councilId=c1", headers = {}) => route.GET(new Request(`https://example.test/api/council/journey-metrics?${query}`, { headers })),
    metrics: async () => server.loadCouncilJourneyMetrics(db, await server.readCouncilJourneyContext(db, "c1", "actor-a"), new Date(now)),
    close: () => sql.close() };
}

test("actual council attribution and current approved area isolate all-time submitted enquiries", async () => {
  const f = fixture();
  try {
    f.lead("eligible"); f.lead("eligible-2");
    f.lead("manual", { source: "trade-owner" }); f.lead("synthetic", { synthetic: 1 });
    f.lead("missing-reference", { reference: "" }); f.lead("unattributed", { attributed: false });
    f.lead("other-campaign", { campaign: "c1-event" }); f.lead("other-council", { council: "c2" });
    f.lead("outside", { postcode: "3000" }); f.lead("other-state", { state: "NSW" });
    assert.deepEqual(await f.metrics(), { submittedEnquiries: 2, enquiriesQuoted: 0, quotesSent: 0, checkedAt: now });
    f.sql.prepare("UPDATE council_campaigns SET status='paused' WHERE id='c1-journey'").run();
    f.sql.prepare("UPDATE council_organisations SET public_journey_enabled=0 WHERE id='c1'").run();
    assert.equal((await f.metrics()).submittedEnquiries, 2, "Pausing the journey must not erase its historical submissions");
  } finally { f.close(); }
});

test("successful customer receipts deduplicate resends while counting separate issued quote versions", async () => {
  const f = fixture();
  try {
    f.lead("one"); f.lead("two");
    const q = f.quote("one", "first");
    f.delivery("retry", q.linkId, q.versionId, q.workId, q.owner, q.customer, { status: "delivered" });
    f.delivery("another-send", q.linkId, q.versionId, q.workId, q.owner, q.customer, { status: "sent" });
    f.version("version-revised", q.quoteId, q.owner, "issued", now, 2);
    f.link("link-revised", "version-revised", q.quoteId, q.workId, q.owner, q.customer);
    f.delivery("delivery-revised", "link-revised", "version-revised", q.workId, q.owner, q.customer);
    f.quote("one", "another-trade", { owner: "trade-b" });
    f.quote("two", "second-enquiry", { status: "delivered" });
    assert.deepEqual(await f.metrics(), { submittedEnquiries: 2, enquiriesQuoted: 2, quotesSent: 4, checkedAt: now });
    f.sql.prepare("UPDATE trade_crm_quote_versions SET status='superseded' WHERE id=?").run(q.versionId);
    assert.equal((await f.metrics()).quotesSent, 4, "A revised or subsequently archived quote remains a genuine historical send");
  } finally { f.close(); }
});

test("drafts, issued-only, queued, failed, uncertain and non-customer sends never inflate quotes", async () => {
  const f = fixture();
  try {
    f.lead("one");
    for (const status of ["queued", "sending", "failed", "reconciliation_required", "waiting_for_channel", "bounced", "complained", "opted_out"]) f.quote("one", status, { status });
    f.quote("one", "draft", { versionStatus: "draft" }); f.quote("one", "unissued", { issuedAt: "" });
    f.quote("one", "issued-only", { delivered: false }); f.quote("one", "missing-receipt", { providerId: "" });
    f.quote("one", "business-copy", { role: "business" }); f.quote("one", "non-email", { channel: "sms" });
    assert.deepEqual(await f.metrics(), { submittedEnquiries: 1, enquiriesQuoted: 0, quotesSent: 0, checkedAt: now });
    f.quote("one", "accepted");
    assert.equal((await f.metrics()).quotesSent, 1, "Provider acceptance has no sent_at timestamp in the canonical outbox implementation");
  } finally { f.close(); }
});

test("cross-owner, cross-customer and corrupted public-lead provenance cannot join to counted deliveries", async () => {
  const f = fixture();
  try {
    f.lead("one");
    const mutations = [
      ["work-owner", "UPDATE trade_work_orders SET firebase_uid='other' WHERE id=?", "workId"],
      ["version-owner", "UPDATE trade_crm_quote_versions SET firebase_uid='other' WHERE id=?", "versionId"],
      ["quote-customer", "UPDATE trade_crm_quotes SET crm_customer_id='other' WHERE id=?", "quoteId"],
      ["link-work", "UPDATE trade_crm_quote_links SET work_order_id='other' WHERE id=?", "linkId"],
      ["receipt-owner", "UPDATE trade_crm_quote_deliveries SET firebase_uid='other' WHERE quote_version_id=?", "versionId"],
      ["bad-provenance", "UPDATE trade_crm_job_details SET accepted_disclosure_snapshot='invalid json' WHERE work_order_id=?", "workId"],
      ["manual-work", "UPDATE trade_work_orders SET source_type='manual' WHERE id=?", "workId"],
    ];
    for (const [id, mutation, field] of mutations) { const q = f.quote("one", id); f.sql.prepare(mutation).run(q[field]); }
    assert.equal((await f.metrics()).quotesSent, 0);
  } finally { f.close(); }
});

test("a later bounce or failed callback does not erase a historically confirmed send", async () => {
  const f = fixture();
  try {
    f.lead("one"); const q = f.quote("one", "original");
    for (const status of ["bounced", "complained", "opted_out", "failed"]) {
      f.sql.prepare("UPDATE trade_crm_quote_deliveries SET status=? WHERE quote_version_id=?").run(status, q.versionId);
      assert.equal((await f.metrics()).quotesSent, 1, status);
    }
    f.quote("one", "failed-never-accepted", { status: "failed" });
    assert.equal((await f.metrics()).quotesSent, 1);
  } finally { f.close(); }
});

test("missing or mismatched canonical acceptance events cannot establish a successful historical send", async () => {
  const f = fixture();
  try {
    f.lead("one");
    for (const [id, mutation] of [
      ["missing", "DELETE FROM trade_crm_quote_events WHERE quote_version_id=?"],
      ["forged-owner", "UPDATE trade_crm_quote_events SET firebase_uid='other' WHERE quote_version_id=?"],
      ["forged-actor", "UPDATE trade_crm_quote_events SET actor_type='trade' WHERE quote_version_id=?"],
      ["forged-type", "UPDATE trade_crm_quote_events SET event_type='issued' WHERE quote_version_id=?"],
      ["forged-key", "UPDATE trade_crm_quote_events SET evidence_key='provider_accepted:unrelated' WHERE quote_version_id=?"],
      ["forged-link", "UPDATE trade_crm_quote_events SET quote_link_id='unrelated' WHERE quote_version_id=?"],
      ["forged-time", "UPDATE trade_crm_quote_events SET occurred_at='invalid' WHERE quote_version_id=?"],
    ]) { const q = f.quote("one", id); f.sql.prepare(mutation).run(q.versionId); }
    assert.equal((await f.metrics()).quotesSent, 0);
  } finally { f.close(); }
});

test("separate enquiries by one customer count as separate enquiries with quotes", async () => {
  const f = fixture();
  try {
    f.lead("one"); f.lead("two"); const a = f.quote("one", "one"), b = f.quote("two", "two");
    for (const table of ["trade_crm_job_details", "trade_crm_quotes", "trade_crm_quote_links", "trade_crm_quote_deliveries"]) {
      f.sql.prepare(`UPDATE ${table} SET crm_customer_id=? WHERE work_order_id=?`).run(a.customer, b.workId);
    }
    assert.deepEqual(await f.metrics(), { submittedEnquiries: 2, enquiriesQuoted: 2, quotesSent: 2, checkedAt: now });
  } finally { f.close(); }
});

test("configured journey without submissions returns actual zeros and exposes only operational counters", async () => {
  const f = fixture();
  try {
    const response = await f.GET(); assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body.metrics).sort(), ["checkedAt", "enquiriesQuoted", "quotesSent", "submittedEnquiries"]);
    assert.equal(body.metrics.submittedEnquiries, 0); assert.equal(f.accessCalls(), 2);
    assert.match(response.headers.get("cache-control"), /private.*no-store/); assert.equal(response.headers.get("vary"), "Authorization");
    assert.doesNotMatch(JSON.stringify(body), /example.invalid|c1-journey|actor-a|postcode/);
    f.sql.prepare("UPDATE council_organisations SET public_campaign_id=NULL WHERE id='c1'").run();
    assert.equal((await (await f.GET()).json()).metrics.quotesSent, 0);
  } finally { f.close(); }
});

test("invalid or duplicate selectors and cross-origin requests are rejected before authentication", async () => {
  const f = fixture();
  try {
    for (const query of ["", "councilId=", "councilId=c1&councilId=c1", "councilId=c1&postcode=3182", "councilId=c1&period=year", "demonstration=seccca", "councilId=%20c1"]) {
      const response = await f.GET(query); assert.equal(response.status, 400, query); assert.match(response.headers.get("cache-control"), /private.*no-store/);
    }
    assert.equal((await f.GET("councilId=c1", { origin: "https://other.test" })).status, 403);
    assert.equal(f.accessCalls(), 0);
  } finally { f.close(); }
});

test("membership revocation or suspension during aggregate loading blocks release", async () => {
  for (const mutation of ["UPDATE council_memberships SET status='suspended' WHERE firebase_uid='actor-a'", "UPDATE council_organisations SET status='suspended' WHERE id='c1'"]) {
    const f = fixture();
    try {
      f.lead("one"); f.changeAfterAggregate(() => f.sql.exec(mutation));
      const response = await f.GET(); assert.equal(response.status, 403); assert.ok(!(await response.text()).includes("submittedEnquiries"));
      assert.match(response.headers.get("cache-control"), /private.*no-store/);
    } finally { f.close(); }
  }
});

test("campaign, postcode, state or journey status changes fence obsolete totals", async () => {
  for (const mutation of [
    "UPDATE council_organisations SET public_campaign_id='c1-replacement' WHERE id='c1'",
    "UPDATE council_postcodes SET postcode='3205' WHERE council_id='c1'",
    "DELETE FROM council_postcodes WHERE council_id='c1'; UPDATE council_organisations SET state='NSW' WHERE id='c1'; INSERT INTO council_postcodes VALUES('c1','NSW','2000','admin','2026-10-08')",
    "UPDATE council_organisations SET public_journey_enabled=0 WHERE id='c1'",
    "UPDATE council_campaigns SET status='paused' WHERE id='c1-journey'",
  ]) {
    const f = fixture();
    try {
      f.lead("one"); f.changeAfterAggregate(() => f.sql.exec(mutation));
      const response = await f.GET(); assert.equal(response.status, 409, mutation); assert.ok(!(await response.text()).includes("submittedEnquiries"));
    } finally { f.close(); }
  }
});

test("other council memberships and unverified identities cannot obtain own-journey totals", async () => {
  const f = fixture();
  try {
    assert.equal((await f.GET("councilId=c2")).status, 403);
    f.actor.emailVerified = false; assert.equal((await f.GET()).status, 403);
  } finally { f.close(); }
});

test("unknown counts, inconsistent totals and invalid check timestamps are rejected", () => {
  for (const value of [null, {}, { submittedEnquiries: null, enquiriesQuoted: 0, quotesSent: 0, checkedAt: now },
    { submittedEnquiries: 1, enquiriesQuoted: 2, quotesSent: 2, checkedAt: now },
    { submittedEnquiries: 1, enquiriesQuoted: 1, quotesSent: 0, checkedAt: now },
    { submittedEnquiries: 0, enquiriesQuoted: 0, quotesSent: 0, checkedAt: "invalid" }]) assert.equal(contract.isCouncilJourneyMetrics(value), false);
});

test("a reporting area changed between polls returns its new fingerprint rather than masquerading as the saved area", async () => {
  const f = fixture();
  try {
    f.lead("old-area"); f.lead("new-area-a", { postcode: "3205" }); f.lead("new-area-b", { postcode: "3205" });
    const first = await (await f.GET()).json(); assert.equal(first.metrics.submittedEnquiries, 1);
    assert.equal(first.scopeKey, await contract.councilJourneyScopeKey({ councilId: "c1", state: "VIC", postcodes: ["3182"] }));
    f.sql.prepare("UPDATE council_postcodes SET postcode='3205' WHERE council_id='c1'").run();
    const second = await (await f.GET()).json(); assert.equal(second.metrics.submittedEnquiries, 2);
    assert.notEqual(second.scopeKey, first.scopeKey);
    assert.doesNotMatch(second.scopeKey, /3182|3205|VIC/);
  } finally { f.close(); }
});

test("scope fingerprints ignore ordering but bind council, state and exact approved area", async () => {
  const scope = { councilId: "c1", state: "VIC", postcodes: ["3182", "3205"] };
  const key = await contract.councilJourneyScopeKey(scope);
  assert.equal(key, await contract.councilJourneyScopeKey({ ...scope, postcodes: ["3205", "3182"] }));
  for (const change of [{ councilId: "c2" }, { state: "NSW" }, { postcodes: ["3182"] }]) assert.notEqual(key, await contract.councilJourneyScopeKey({ ...scope, ...change }));
});
