import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

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

// External business eligibility and token cryptography have separate integration
// coverage. Here the real participant joins, outbox SQL, migrations and drainer run.
const participant = load("../src/lib/customer-quote-hub-server.ts", {
  "./trade-access-server": { verifiedTradeAccountPredicate: alias => `${alias}.eligible=1` },
  "./aea-trade-owner-server": { tradeOpportunityOwnerScopeSql: () => "1=1" },
  "./trade-certificate-leads": { certificateLeadEligibilitySql: () => "1=1" },
  "./public-plan-enquiry.mjs": { publicPlanContactReleaseAccessSql: alias => `${alias}.consented=1` },
  "./energy-service-catalogue.mjs": { ENERGY_SERVICE_LABELS: {} },
  "./customer-hub-links": {}, "./trade-quote-links": {}, "./trade-quote-decision-server": {},
  "./customer-hub-business-profile": {},
});
const cryptoBoundary = {
  encryptProtectedPayload: async value => JSON.stringify(value),
  decryptProtectedPayload: async value => JSON.parse(value),
};

async function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(`
    CREATE TABLE trade_crm_quote_versions(id TEXT,quote_id TEXT,firebase_uid TEXT,status TEXT);
    CREATE TABLE trade_crm_quotes(id TEXT,work_order_id TEXT,firebase_uid TEXT);
    CREATE TABLE trade_work_orders(id TEXT,firebase_uid TEXT,source_reference TEXT,source_type TEXT);
    CREATE TABLE trade_opportunities(id TEXT PRIMARY KEY,title TEXT,status TEXT,expires_at TEXT,source_reference TEXT,state TEXT);
    CREATE TABLE trade_opportunity_matches(id TEXT PRIMARY KEY,opportunity_id TEXT,firebase_uid TEXT,status TEXT,matched_categories TEXT);
    CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY,partner_type TEXT,eligible INTEGER);
    CREATE TABLE public_trade_lead_contact_releases(id TEXT PRIMARY KEY,opportunity_id TEXT,source_reference TEXT,status TEXT,withdrawn_at TEXT,consented INTEGER,granted_at TEXT,customer_email TEXT);
    CREATE TABLE public_plan_customer_email_suppressions(email_hash TEXT PRIMARY KEY);
    CREATE TABLE customer_accounts(firebase_uid TEXT PRIMARY KEY,email TEXT,account_status TEXT,account_updates INTEGER);
    CREATE TABLE customer_service_reminder_opt_outs(customer_uid TEXT,channel TEXT);
  `);
  for (const file of ["0245_customer_quote_hub.sql", "0247_customer_hub_conversations.sql"]) sqlite.exec(read("../drizzle/" + file));
  const now = new Date().toISOString();
  sqlite.exec(`
    INSERT INTO trade_opportunities VALUES ('project','Home energy upgrade','open','2099-01-01T00:00:00.000Z','source','VIC');
    INSERT INTO trade_opportunity_matches VALUES ('business','project','owner','interested','["solar"]');
    INSERT INTO trade_accounts VALUES ('owner','installer',1);
    INSERT INTO public_trade_lead_contact_releases VALUES ('release','project','source','active','',1,'2026-01-01T00:00:00.000Z','customer@example.test');
    INSERT INTO customer_accounts VALUES ('customer','customer@example.test','active',1);
    INSERT INTO customer_quote_hubs(id,opportunity_id,release_id,email_hash,recipient_email,token_hash,encrypted_token,expires_at,created_at)
      VALUES ('hub','project','release','email-hash','customer@example.test','token-hash','fixture','2099-01-01T00:00:00.000Z','${now}');
    INSERT INTO customer_hub_interests VALUES ('business','project',1,1,'${now}','${now}','owner');
  `);
  const hooks = { beforeQuery: null, afterQuery: null, afterLink: null, beforeAuthorise: null, provider: null };
  const sent = [];
  const statement = (sql, values = []) => ({
    sql, values, bind: (...next) => statement(sql, next),
    first: async () => { await hooks.beforeQuery?.(sql, "first"); return sqlite.prepare(sql).get(...values) || null; },
    all: async () => { await hooks.beforeQuery?.(sql, "all"); return { results: sqlite.prepare(sql).all(...values) }; },
    run: async () => {
      await hooks.beforeQuery?.(sql, "run");
      const result = { success: true, meta: sqlite.prepare(sql).run(...values) };
      await hooks.afterQuery?.(sql, "run");
      return result;
    },
  });
  const db = { prepare: statement, batch: async statements => {
    sqlite.exec("BEGIN");
    try { const results = []; for (const item of statements) results.push(await item.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const currentHub = () => sqlite.prepare("SELECT * FROM customer_quote_hubs WHERE id='hub'").get();
  const links = {
    customerHubEmailUrl: async () => {
      const url = `https://ausenergyassessments.com/customer-hub/hub.${currentHub().token_hash}`;
      await hooks.afterLink?.();
      return url;
    },
    authoriseCustomerHub: async (_db, token) => {
      await hooks.beforeAuthorise?.();
      const row = currentHub();
      if (row.revoked_at || token !== `hub.${row.token_hash}`) throw new Error("CUSTOMER_HUB_ACCESS_ENDED");
      return row;
    },
  };
  const delivery = {
    serviceReminderProviderConfiguration: () => ({ email: { configured: options.configured !== false } }),
    serviceReminderRetryAt: () => new Date(Date.now() + 300000).toISOString(),
    sendServiceReminderProviderMessage: async input => {
      sent.push(structuredClone(input));
      await hooks.provider?.(input);
      return { provider: "resend", providerMessageId: "provider-message", providerStatus: "sent" };
    },
  };
  const server = load("../src/lib/customer-hub-email-server.ts", {
    "./customer-quote-hub-server": participant, "./customer-hub-links": links,
    "./service-reminder-delivery": delivery, "./trade-integration-crypto": cryptoBoundary,
  });
  const queue = async (id = "event", type = "asked") => {
    await db.batch([
      db.prepare(`INSERT INTO customer_hub_questions(id,opportunity_id,match_id,service_categories_json,kind,prompt,created_at,updated_at)
        VALUES (?,'project','business','["solar"]','text','PRIVATE QUESTION CONTENT',?,?)`).bind(`question-${id}`, now, now),
      db.prepare(`INSERT INTO customer_hub_events(id,opportunity_id,question_id,event_type,author_match_id,created_at)
        VALUES (?,'project',?,?,'business',?)`).bind(id, `question-${id}`, type, now),
      server.hubEmailStatement(db, id, "project", now),
    ]);
  };
  const row = (id = "event") => sqlite.prepare("SELECT * FROM customer_hub_email_deliveries WHERE event_id=?").get(id);
  const drain = id => server.drainCustomerHubEmails(db, id);
  return { sqlite, db, hooks, sent, server, queue, row, drain };
}

test("customer Q&A and its outbox commit together, with one customer email per event", async t => {
  const f = await fixture(t);
  await f.queue();
  assert.equal(f.row().status, "pending");
  assert.equal(f.row().release_id, "release");
  assert.equal(f.row().email_hash, "email-hash");
  await f.drain("event");
  await f.drain("event");
  assert.equal(f.sent.length, 1);
  assert.equal(f.row().status, "accepted");
  assert.equal(f.row().provider_id, "provider-message");
  assert.equal(f.row().attempts, 1);
  assert.equal(f.sent[0].recipient, "customer@example.test");
  assert.equal(f.sent[0].idempotencyKey, "customer-hub-event");
  assert.match(f.sent[0].body, /customer-hub\/hub\.token-hash\?section=qa/);
  assert.doesNotMatch(JSON.stringify(f.sent), /PRIVATE QUESTION CONTENT|owner@example/);
});

test("a failing outbox insert rolls back the new question and event", async t => {
  const f = await fixture(t);
  f.sqlite.exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON customer_hub_email_deliveries BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END");
  await assert.rejects(f.queue(), /outbox unavailable/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_hub_questions").get().n, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_hub_events").get().n, 0);
  assert.equal(f.sent.length, 0);
});

test("unconfigured email stays pending without losing the saved conversation", async t => {
  const f = await fixture(t, { configured: false });
  await f.queue(); await f.drain();
  assert.equal(f.row().status, "pending");
  assert.equal(f.row().attempts, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_hub_questions").get().n, 1);
});

test("provider failure preserves the question and retries the identical event payload", async t => {
  const f = await fixture(t);
  await f.queue();
  f.hooks.provider = () => { throw new Error("provider outcome unknown"); };
  await f.drain();
  assert.equal(f.row().status, "failed");
  assert.equal(f.row().attempts, 1);
  assert.ok(f.row().first_attempt_at);
  assert.ok(f.row().next_attempt_at > new Date().toISOString());
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_hub_questions").get().n, 1);
  await f.drain();
  assert.equal(f.sent.length, 1, "no early retry");
  f.sqlite.exec("UPDATE customer_hub_email_deliveries SET next_attempt_at=''; UPDATE trade_opportunities SET title='Changed after the ambiguous send';");
  f.hooks.provider = null;
  await f.drain();
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent[1], f.sent[0], "provider idempotency requires unchanged message content");
  assert.equal(f.row().status, "accepted");
});

for (const [reason, sql] of [
  ["public email suppression", "INSERT INTO public_plan_customer_email_suppressions VALUES ('email-hash')"],
  ["account updates opt-out", "UPDATE customer_accounts SET account_updates=0"],
  ["inactive customer account", "UPDATE customer_accounts SET account_status='disabled'"],
  ["email reminder opt-out", "INSERT INTO customer_service_reminder_opt_outs VALUES ('customer','email')"],
  ["closed hub", "UPDATE customer_quote_hubs SET accepting=0"],
  ["revoked hub", "UPDATE customer_quote_hubs SET revoked_at='revoked'"],
  ["withdrawn business", "UPDATE trade_opportunity_matches SET status='withdrawn'"],
  ["withdrawn contact", "UPDATE public_trade_lead_contact_releases SET withdrawn_at='withdrawn'"],
  ["changed release", "UPDATE customer_quote_hubs SET release_id='new-release'"],
  ["changed recipient", "UPDATE customer_quote_hubs SET recipient_email='another@example.test',email_hash='new-hash'; UPDATE public_trade_lead_contact_releases SET customer_email='another@example.test'"],
]) {
  test(`queued email respects ${reason}`, async t => {
    const f = await fixture(t); await f.queue(); f.sqlite.exec(sql); await f.drain();
    assert.equal(f.sent.length, 0);
    assert.equal(f.row().status, "stopped");
  });
}

for (const [reason, sql] of [
  ["email suppression", "INSERT INTO public_plan_customer_email_suppressions VALUES ('email-hash')"],
  ["account opt-out", "UPDATE customer_accounts SET account_updates=0"],
  ["paused hub", "UPDATE customer_quote_hubs SET accepting=0"],
  ["revoked business", "UPDATE trade_opportunity_matches SET status='withdrawn'"],
]) {
  test(`email rechecks ${reason} after asynchronous link authorization`, async t => {
    const f = await fixture(t); await f.queue();
    f.hooks.beforeAuthorise = () => f.sqlite.exec(sql);
    await f.drain();
    assert.equal(f.sent.length, 0, "last recipient eligibility must be checked immediately before dispatch");
    assert.equal(f.row().status, "stopped");
  });
}

test("concurrent drainers claim an event only once", async t => {
  const f = await fixture(t); await f.queue();
  await Promise.all([f.drain(), f.drain()]);
  assert.equal(f.sent.length, 1);
  assert.equal(f.row().status, "accepted");
  assert.equal(f.row().attempts, 1);
});

test("a live sending claim cannot be stolen, while an expired claim retries within the idempotency window", async t => {
  const f = await fixture(t); await f.queue();
  const now = new Date().toISOString();
  f.sqlite.prepare("UPDATE customer_hub_email_deliveries SET status='sending',attempts=1,first_attempt_at=?,updated_at=?").run(now, now);
  await f.drain(); assert.equal(f.sent.length, 0);
  f.sqlite.prepare("UPDATE customer_hub_email_deliveries SET updated_at=?").run(new Date(Date.now() - 11 * 60000).toISOString());
  await f.drain(); assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].idempotencyKey, "customer-hub-event");
});

for (const status of ["sending", "failed"]) {
  test(`old ambiguous ${status} delivery becomes unknown without resending`, async t => {
    const f = await fixture(t); await f.queue();
    const old = new Date(Date.now() - 24 * 3600000).toISOString();
    f.sqlite.prepare("UPDATE customer_hub_email_deliveries SET status=?,attempts=1,first_attempt_at=?,updated_at=?").run(status, old, old);
    await f.drain();
    assert.equal(f.sent.length, 0);
    assert.equal(f.row().status, "unknown");
  });
}

test("accepted email followed by a database acknowledgement failure retains a safely retryable event", async t => {
  const f = await fixture(t); await f.queue();
  let failed = false;
  f.hooks.beforeQuery = sql => {
    if (!failed && sql.includes("status='accepted'")) { failed = true; throw new Error("D1 acknowledgement failed"); }
  };
  await f.drain();
  assert.equal(f.row().status, "failed");
  f.sqlite.exec("UPDATE customer_hub_email_deliveries SET next_attempt_at=''");
  await f.drain();
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent[1], f.sent[0]);
  assert.equal(f.row().status, "accepted");
});


test("a rotated private token is never replaced inside an already attempted email", async t => {
  const f = await fixture(t); await f.queue();
  f.hooks.provider = () => { throw new Error("ambiguous delivery"); };
  await f.drain();
  const saved = f.row().encrypted_payload;
  f.sqlite.exec("UPDATE customer_quote_hubs SET token_hash='rotated'; UPDATE customer_hub_email_deliveries SET next_attempt_at=''");
  f.hooks.provider = null;
  await f.drain();
  assert.equal(f.sent.length, 1, "do not resend a new capability with the original idempotency key");
  assert.equal(f.row().encrypted_payload, saved);
  assert.notEqual(f.row().status, "accepted");
});

for (const changed of [{ eventId: "other-event" }, { recipient: "other@example.test" }, { link: "https://other.example/customer-hub/private" }]) {
  test("stored payload must remain bound to this event and recipient: " + Object.keys(changed)[0], async t => {
    const f = await fixture(t); await f.queue();
    const payload = { eventId: "event", recipient: "customer@example.test", link: "https://ausenergyassessments.com/customer-hub/hub.token-hash", subject: "Fixture", body: "Fixture", ...changed };
    f.sqlite.prepare("UPDATE customer_hub_email_deliveries SET encrypted_payload=?").run(JSON.stringify(payload));
    await f.drain();
    assert.equal(f.sent.length, 0);
    assert.notEqual(f.row().status, "accepted");
  });
}

test("failed retries remain bounded and retain the conversation plus failure state", async t => {
  const f = await fixture(t); await f.queue();
  f.hooks.provider = () => { throw new Error("provider unavailable"); };
  for (let attempt = 0; attempt < 6; attempt++) {
    f.sqlite.exec("UPDATE customer_hub_email_deliveries SET next_attempt_at=''");
    await f.drain();
  }
  assert.equal(f.sent.length, 4);
  assert.equal(f.row().attempts, 4);
  assert.equal(f.row().status, "failed");
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM customer_hub_questions").get().n, 1);
  for (const message of f.sent) assert.deepEqual(message, f.sent[0]);
});

test("a consented released contact does not require a customer login to receive the notification", async t => {
  const f = await fixture(t); await f.queue();
  f.sqlite.exec("DELETE FROM customer_accounts");
  await f.drain();
  assert.equal(f.sent.length, 1);
  assert.equal(f.row().status, "accepted");
});

test("an expired worker does not dispatch its different payload after a newer worker accepted the same event", async t => {
  const f = await fixture(t); await f.queue();
  let superseded = false;
  f.hooks.beforeQuery = async sql => {
    if (superseded || !sql.includes("SET encrypted_payload=")) return;
    superseded = true;
    f.sqlite.prepare("UPDATE customer_hub_email_deliveries SET updated_at=?").run(new Date(Date.now() - 11 * 60000).toISOString());
    f.sqlite.exec("UPDATE trade_opportunities SET title='New title before another worker claimed it'");
    await f.drain();
  };
  await f.drain();
  assert.equal(f.row().status, "accepted");
  assert.equal(f.sent.length, 1, "losing the snapshot compare-and-set must end the stale worker");
});


test("an accepted status that commits before D1 transport failure is not downgraded or resent", async t => {
  const f = await fixture(t); await f.queue();
  let interrupted = false;
  f.hooks.afterQuery = sql => {
    if (!interrupted && sql.includes("status='accepted'")) { interrupted = true; throw new Error("D1 response lost after commit"); }
  };
  await f.drain();
  assert.equal(f.row().status, "accepted");
  assert.equal(f.row().provider_id, "provider-message");
  await f.drain();
  assert.equal(f.sent.length, 1);
});


test("an expired worker cannot overwrite a newer accepted delivery with stopped", async t => {
  const f = await fixture(t); await f.queue();
  f.hooks.beforeAuthorise = async () => {
    f.hooks.beforeAuthorise = null;
    f.sqlite.prepare("UPDATE customer_hub_email_deliveries SET updated_at=?").run(new Date(Date.now() - 11 * 60000).toISOString());
    await f.drain();
    assert.equal(f.row().status, "accepted");
    f.sqlite.exec("UPDATE customer_quote_hubs SET accepting=0");
  };
  await f.drain();
  assert.equal(f.sent.length, 1);
  assert.equal(f.row().status, "accepted", "late scope checks must not overwrite the newer attempt's outcome");
});
