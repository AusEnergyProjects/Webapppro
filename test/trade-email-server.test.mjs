import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";
import * as emailProvider from "../src/lib/trade-email-provider.ts";
import { ReminderProviderDeliveryError } from "../src/lib/service-reminder-delivery.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const compiled = new Map();
function load(path, dependencies) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText);
  const record = { exports: {} };
  new Function("require", "module", "exports", compiled.get(path))((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected email dependency ${name}`);
  }, record, record.exports);
  return record.exports;
}

const origin = "https://portal.example.test";
const message = { channel: "email", recipient: "customer@example.test", subject: "Your quote", body: "Your quote is ready.", idempotencyKey: "quote-123", callbackUrl: "" };
const freshCredentials = () => ({ accessToken: "private-access-token", refreshToken: "private-refresh-token", expiresAt: new Date(Date.now() + 3600000).toISOString() });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const uncertain = (error) => error instanceof ReminderProviderDeliveryError && error.outcome === "indeterminate";

function fixture(overrides = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE trade_accounts (firebase_uid TEXT PRIMARY KEY, business_name TEXT, partner_type TEXT, verified INTEGER);");
  sqlite.exec(read("../drizzle/0196_trade_outgoing_email.sql").replaceAll("--> statement-breakpoint", ""));
  sqlite.prepare("INSERT INTO trade_accounts VALUES (?, ?, 'installer', 1)").run("owner", "John's Electrical");
  sqlite.prepare("INSERT INTO trade_accounts VALUES (?, ?, 'installer', 1)").run("other", "Other Business");
  const env = {
    CRM_INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 91).toString("base64url"),
    GOOGLE_EMAIL_CLIENT_ID: "google-client", GOOGLE_EMAIL_CLIENT_SECRET: "google-secret", GOOGLE_EMAIL_ENABLED: "true",
    MICROSOFT_EMAIL_CLIENT_ID: "microsoft-client", MICROSOFT_EMAIL_CLIENT_SECRET: "microsoft-secret", MICROSOFT_EMAIL_ENABLED: "true",
  };
  const protectedPayload = load("../src/lib/trade-integration-crypto.ts", {
    "cloudflare:workers": { env }, "@/lib/trade-integration-state": { calendarIntegrationState: (nonce) => nonce },
  });
  const calls = { send: [], refresh: [], exchange: [], identity: [], legacy: [] };
  const hooks = { ...overrides };
  const statement = (sql, bindings = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => { await hooks.beforeFirst?.(sql, bindings); return sqlite.prepare(sql).get(...bindings) || null; },
    all: async () => ({ results: sqlite.prepare(sql).all(...bindings) }),
    run: async () => {
      await hooks.beforeRun?.(sql, bindings);
      const result = { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } };
      await hooks.afterRun?.(sql, bindings, result);
      return result;
    },
  });
  const db = { prepare: statement, batch: async (statements) => {
    sqlite.exec("BEGIN");
    try { const results = []; for (const item of statements) results.push(await item.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const provider = {
    ...emailProvider,
    exchangeEmailCode: async (...args) => { calls.exchange.push(args); return hooks.exchange ? hooks.exchange(...args) : freshCredentials(); },
    getEmailIdentity: async (...args) => { calls.identity.push(args); return hooks.identity ? hooks.identity(...args) : { id: "external-account", email: "john@jelec.com", name: "John Smith" }; },
    refreshEmailCredentials: async (...args) => { calls.refresh.push(args); return hooks.refresh ? hooks.refresh(...args) : { ...freshCredentials(), accessToken: "rotated-access", refreshToken: "rotated-refresh" }; },
    sendMailboxEmail: async (...args) => { calls.send.push(args); return hooks.send ? hooks.send(...args) : { providerMessageId: "mailbox-message-id", providerStatus: "accepted" }; },
  };
  const server = load("../src/lib/trade-email-server.ts", {
    "cloudflare:workers": { env }, "../../db": { getD1: () => db }, "./trade-integration-crypto": protectedPayload,
    "./trade-access-server": { verifiedTradeAccountPredicate: (alias) => `${alias}.verified = 1` },
    "./trade-email-provider": provider,
    "./service-reminder-delivery": {
      ReminderProviderDeliveryError,
      serviceReminderProviderConfiguration: () => ({ email: { configured: true, from: "AEA <info@ausenergyassessments.com>", provider: "resend" } }),
      sendServiceReminderProviderMessage: async (...args) => { calls.legacy.push(args); return hooks.legacy ? hooks.legacy(...args) : { provider: "resend", providerMessageId: "legacy-id", providerStatus: "accepted" }; },
    },
  });
  const f = { sqlite, db, server, calls, hooks, env, crypto: protectedPayload, close: () => sqlite.close() };
  f.begin = async (owner = "owner", provider = "google") => {
    const result = await server.beginTradeEmailConnection(owner, provider, origin, db);
    const url = new URL(result.authorizationUrl);
    return { provider, state: url.searchParams.get("state"), browser: result.browser, redirectUri: url.searchParams.get("redirect_uri"), url };
  };
  f.complete = async (pending) => server.completeTradeEmailConnection(pending.provider, pending.state, pending.browser, "oauth-code", pending.redirectUri, db);
  f.connect = async (owner = "owner", provider = "google") => { const pending = await f.begin(owner, provider); await f.complete(pending); return pending; };
  f.send = (changes = {}, owner = "owner", actor = "staff-1") => server.sendTradeCustomerEmail(owner, actor, { ...message, ...changes }, { db });
  f.row = (owner = "owner") => sqlite.prepare("SELECT * FROM trade_email_connections WHERE owner_uid = ?").get(owner);
  f.submission = () => sqlite.prepare("SELECT * FROM trade_email_submissions WHERE owner_uid = 'owner'").get();
  return f;
}

test("Connection selects verified provider identity, uses business display name and protects tokens from settings", async () => {
  const f = fixture();
  try {
    const pending = await f.connect();
    const row = f.row();
    assert.equal(row.sender_email, "john@jelec.com");
    assert.equal(row.display_name, "John's Electrical");
    assert.equal(row.external_id, "external-account");
    assert.match(row.encrypted_credentials, /^v1\./);
    assert.equal(row.encrypted_credentials.includes("private"), false);
    assert.equal((await f.crypto.decryptProtectedPayload(row.encrypted_credentials)).refreshToken, "private-refresh-token");
    assert.equal(f.calls.exchange[0][2].redirectUri, pending.redirectUri);
    assert.equal(await f.crypto.integrationStateHash(f.calls.exchange[0][2].verifier), pending.url.searchParams.get("code_challenge"));
    const settings = await f.server.tradeEmailSettings("owner", f.db);
    assert.equal(settings.connection.email, row.sender_email);
    assert.equal(settings.connection.status, "connected");
    for (const secret of ["private-access", "private-refresh", "encrypted_credentials", "clientSecret", "google-secret"]) assert.equal(JSON.stringify(settings).includes(secret), false);
    assert.equal((await f.server.tradeEmailSettings("other", f.db)).connection, null);
    const state = f.sqlite.prepare("SELECT * FROM trade_email_oauth_states").get();
    assert.notEqual(state.state_hash, pending.state);
    assert.notEqual(state.browser_hash, pending.browser);
    assert.equal(state.encrypted_verifier.includes(f.calls.exchange[0][2].verifier), false);
  } finally { f.close(); }
});

test("Provider availability requires encryption, credentials and explicit enabled flag", async () => {
  const f = fixture();
  try {
    f.env.GOOGLE_EMAIL_ENABLED = "false";
    assert.equal((await f.server.tradeEmailSettings("owner", f.db)).providers.find((p) => p.id === "google").available, false);
    await assert.rejects(f.begin(), /EMAIL_SETUP_UNAVAILABLE/);
    f.env.GOOGLE_EMAIL_ENABLED = "true";
    delete f.env.CRM_INTEGRATION_ENCRYPTION_KEY;
    assert.equal((await f.server.tradeEmailSettings("owner", f.db)).providers.some((p) => p.available), false);
    await assert.rejects(f.begin(), /EMAIL_SETUP_UNAVAILABLE/);
    assert.equal(f.calls.exchange.length, 0);
  } finally { f.close(); }
});

test("Google test access requires an exact nonempty owner UID while public enablement remains unchanged", async () => {
  const f = fixture();
  try {
    f.env.GOOGLE_EMAIL_ENABLED = "false";
    f.env.GOOGLE_EMAIL_TEST_OWNER_UIDS = " , owner , reviewer-owner, ,";
    const available = async (uid) => (await f.server.tradeEmailSettings(uid, f.db)).providers.find((provider) => provider.id === "google").available;
    assert.equal(await available("owner"), true);
    for (const uid of ["", "other", "unknown", "OWNER", "own", "owner-suffix", " owner "]) assert.equal(await available(uid), false, uid);
    for (const uid of ["", "other", "unknown"]) await assert.rejects(f.begin(uid), /EMAIL_SETUP_UNAVAILABLE/);
    for (const allowlist of ["", " , , ", "*", "owner-suffix,OWNER"]) {
      f.env.GOOGLE_EMAIL_TEST_OWNER_UIDS = allowlist;
      assert.equal(await available("owner"), false);
    }
    f.env.GOOGLE_EMAIL_ENABLED = "true";
    assert.equal(await available("owner"), true);
    assert.equal(await available("other"), true);
    assert.equal(await available(""), false);
  } finally { f.close(); }
});

test("Google allowlisting gates business settings, connection, readiness and send by owner rather than team actor", async () => {
  const f = fixture();
  try {
    await f.connect("other");
    f.env.GOOGLE_EMAIL_ENABLED = "false";
    f.env.GOOGLE_EMAIL_TEST_OWNER_UIDS = "owner";
    await f.connect("owner");
    assert.equal((await f.server.tradeCustomerEmailReadiness("owner", f.db)).configured, true);
    assert.equal((await f.server.tradeCustomerEmailReadiness("other", f.db)).configured, false);
    await f.send({}, "owner", "staff-not-on-test-list");
    await assert.rejects(f.send({}, "other", "owner"), /EMAIL_RECONNECT_REQUIRED/);
    assert.equal(f.calls.send.length, 1);
    assert.equal(f.calls.legacy.length, 0);
    f.env.GOOGLE_EMAIL_TEST_OWNER_UIDS = "";
    assert.equal((await f.server.tradeCustomerEmailReadiness("owner", f.db)).configured, false);
    await assert.rejects(f.send({ idempotencyKey: "after-test-access-removed" }), /EMAIL_RECONNECT_REQUIRED/);
    assert.equal(f.calls.send.length, 1);
  } finally { f.close(); }
});

test("Google callback rechecks the server-stored owner allowlist before exchanging OAuth credentials", async () => {
  const f = fixture();
  try {
    const otherPending = await f.begin("other");
    f.env.GOOGLE_EMAIL_ENABLED = "false";
    f.env.GOOGLE_EMAIL_TEST_OWNER_UIDS = "owner";
    await assert.rejects(f.complete(otherPending), /EMAIL_CONNECTION_INVALID/);
    assert.equal(f.calls.exchange.length, 0);
    assert.equal(f.row("other"), undefined);
    const ownerPending = await f.begin("owner");
    f.env.GOOGLE_EMAIL_TEST_OWNER_UIDS = "other";
    await assert.rejects(f.complete(ownerPending), /EMAIL_CONNECTION_INVALID/);
    assert.equal(f.calls.exchange.length, 0);
    assert.equal(f.row(), undefined);
  } finally { f.close(); }
});

test("Google test allowlisting cannot replace provider credentials, encryption or verified installer eligibility", async () => {
  for (const missing of ["GOOGLE_EMAIL_CLIENT_ID", "GOOGLE_EMAIL_CLIENT_SECRET", "CRM_INTEGRATION_ENCRYPTION_KEY"]) {
    const f = fixture();
    try {
      f.env.GOOGLE_EMAIL_ENABLED = "false"; f.env.GOOGLE_EMAIL_TEST_OWNER_UIDS = "owner";
      delete f.env[missing];
      assert.equal((await f.server.tradeEmailSettings("owner", f.db)).providers.find((p) => p.id === "google").available, false);
      await assert.rejects(f.begin(), /EMAIL_SETUP_UNAVAILABLE/);
    } finally { f.close(); }
  }
  const f = fixture();
  try {
    f.env.GOOGLE_EMAIL_ENABLED = "false"; f.env.GOOGLE_EMAIL_TEST_OWNER_UIDS = "owner";
    const pending = await f.begin();
    f.sqlite.exec("UPDATE trade_accounts SET verified = 0 WHERE firebase_uid = 'owner'");
    await assert.rejects(f.complete(pending), /EMAIL_CONNECTION_INVALID/);
    assert.equal(f.calls.exchange.length, 0);
    f.sqlite.exec("UPDATE trade_accounts SET verified = 1 WHERE firebase_uid = 'owner'");
    await f.connect();
    f.sqlite.exec("UPDATE trade_accounts SET verified = 0 WHERE firebase_uid = 'owner'");
    await assert.rejects(f.send(), /EMAIL_ACCESS_REQUIRED/);
    assert.equal(f.calls.send.length, 0);
  } finally { f.close(); }
});

test("Google test owners do not enable Microsoft or restrict its existing public availability", async () => {
  const f = fixture();
  try {
    f.env.GOOGLE_EMAIL_ENABLED = "false"; f.env.GOOGLE_EMAIL_TEST_OWNER_UIDS = "owner";
    f.env.MICROSOFT_EMAIL_ENABLED = "false";
    assert.equal((await f.server.tradeEmailSettings("owner", f.db)).providers.find((p) => p.id === "microsoft").available, false);
    await assert.rejects(f.begin("owner", "microsoft"), /EMAIL_SETUP_UNAVAILABLE/);
    f.env.MICROSOFT_EMAIL_ENABLED = "true";
    assert.equal((await f.server.tradeEmailSettings("other", f.db)).providers.find((p) => p.id === "microsoft").available, true);
    await f.connect("other", "microsoft");
    await f.send({}, "other", "other-staff");
    assert.equal(f.calls.send[0][0], "microsoft");
  } finally { f.close(); }
});

test("Callback rejects wrong browser, wrong provider, changed redirect, expiry, replay and unverified owner", async () => {
  const f = fixture();
  try {
    let pending = await f.begin();
    await assert.rejects(f.complete({ ...pending, browser: "wrong-browser" }), /EMAIL_CONNECTION_INVALID/);
    await assert.rejects(f.complete({ ...pending, provider: "microsoft" }), /EMAIL_CONNECTION_INVALID/);
    await assert.rejects(f.complete({ ...pending, redirectUri: "https://attacker.example.test/callback" }), /EMAIL_CONNECTION_INVALID/);
    assert.equal(f.calls.exchange.length, 0);
    await f.complete(pending);
    await assert.rejects(f.complete(pending), /EMAIL_CONNECTION_INVALID/);
    assert.equal(f.calls.exchange.length, 1);
    pending = await f.begin();
    f.sqlite.exec("UPDATE trade_email_oauth_states SET expires_at = '2000-01-01T00:00:00.000Z'");
    await assert.rejects(f.complete(pending), /EMAIL_CONNECTION_INVALID/);
    pending = await f.begin();
    f.sqlite.exec("UPDATE trade_accounts SET verified = 0 WHERE firebase_uid = 'owner'");
    await assert.rejects(f.complete(pending), /EMAIL_CONNECTION_INVALID/);
    assert.equal(f.calls.exchange.length, 1);
  } finally { f.close(); }
});

test("Disconnect and a newer connection attempt invalidate an in-flight OAuth callback", async () => {
  for (const change of ["disconnect", "new-connect"]) {
    const exchanging = deferred();
    const release = deferred();
    const f = fixture({ exchange: async () => { exchanging.resolve(); await release.promise; return freshCredentials(); } });
    try {
      const pending = await f.begin();
      const callback = f.complete(pending);
      await exchanging.promise;
      if (change === "disconnect") await f.server.disconnectTradeEmail("owner", f.db);
      else await f.begin();
      release.resolve();
      await assert.rejects(callback, /EMAIL_CONNECTION_INVALID/);
      assert.equal(f.row(), undefined);
    } finally { release.resolve(); f.close(); }
  }
});

test("Owner deactivation during OAuth token exchange cannot establish a business connection", async () => {
  const exchanging = deferred();
  const release = deferred();
  const f = fixture({ exchange: async () => { exchanging.resolve(); await release.promise; return freshCredentials(); } });
  try {
    const pending = await f.begin();
    const callback = f.complete(pending);
    await exchanging.promise;
    f.sqlite.exec("UPDATE trade_accounts SET verified = 0 WHERE firebase_uid = 'owner'");
    release.resolve();
    await assert.rejects(callback, /EMAIL_CONNECTION_INVALID/);
    assert.equal(f.row(), undefined);
  } finally { release.resolve(); f.close(); }
});

test("An approved owner changed to a supplier during OAuth cannot establish an installer mailbox", async () => {
  const exchanging = deferred();
  const release = deferred();
  const f = fixture({ exchange: async () => { exchanging.resolve(); await release.promise; return freshCredentials(); } });
  try {
    const pending = await f.begin();
    const callback = f.complete(pending);
    await exchanging.promise;
    f.sqlite.exec("UPDATE trade_accounts SET partner_type = 'supplier' WHERE firebase_uid = 'owner'");
    release.resolve();
    await assert.rejects(callback, /EMAIL_CONNECTION_INVALID/);
    assert.equal(f.row(), undefined);
  } finally { release.resolve(); f.close(); }
});

test("All team actors use the business mailbox and accepted duplicate requests do not resend", async () => {
  const f = fixture();
  try {
    await f.connect();
    const first = await f.send();
    const repeated = await f.send({}, "owner", "staff-2");
    assert.deepEqual(repeated, first);
    assert.equal(first.provider, "google");
    assert.equal(first.providerStatus, "accepted");
    assert.equal(f.calls.send.length, 1);
    assert.equal(f.calls.legacy.length, 0);
    assert.equal(f.calls.send[0][2].senderEmail, "john@jelec.com");
    assert.equal(f.calls.send[0][2].senderName, "John's Electrical");
    assert.equal(f.submission().actor_uid, "staff-1");
    assert.equal(f.submission().status, "accepted");
    assert.match(f.calls.send[0][2].messageId, /^<[A-Za-z0-9-]+@tlink\.ausenergyassessments\.com>$/);
    await assert.rejects(f.send({ body: "Different content" }), /EMAIL_REQUEST_CONFLICT/);
    assert.equal(f.calls.send.length, 1);
  } finally { f.close(); }
});

test("SQLite claim admits only one concurrent send for the same business request", async () => {
  const sending = deferred();
  const release = deferred();
  const f = fixture({ send: async () => { sending.resolve(); await release.promise; return { providerMessageId: "id", providerStatus: "accepted" }; } });
  try {
    await f.connect();
    const first = f.send();
    await sending.promise;
    await assert.rejects(f.send({}, "owner", "staff-2"), uncertain);
    release.resolve();
    await first;
    assert.equal(f.calls.send.length, 1);
    assert.equal(f.submission().status, "accepted");
  } finally { release.resolve(); f.close(); }
});

test("Simultaneous new requests share one atomic submission even before either has claimed it", async () => {
  const f = fixture();
  try {
    await f.connect();
    const results = await Promise.allSettled([f.send(), f.send({}, "owner", "staff-2")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length >= 1, true);
    for (const result of results) if (result.status === "rejected") assert.equal(uncertain(result.reason), true);
    assert.equal(f.calls.send.length, 1);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS count FROM trade_email_submissions").get().count, 1);
  } finally { f.close(); }
});

test("The same request key remains isolated between two business owners", async () => {
  const f = fixture();
  try {
    await f.connect();
    f.hooks.identity = async () => ({ id: "other-account", email: "office@other.example.test", name: "Other" });
    await f.connect("other", "microsoft");
    await Promise.all([f.send(), f.send({}, "other", "other-staff")]);
    assert.equal(f.calls.send.length, 2);
    assert.deepEqual(f.calls.send.map((call) => call[2].senderEmail).sort(), ["john@jelec.com", "office@other.example.test"]);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS count FROM trade_email_submissions").get().count, 2);
    const ids = f.calls.send.map((call) => call[2].messageId);
    assert.notEqual(ids[0], ids[1]);
  } finally { f.close(); }
});

test("Uncertain provider sends and unknown exceptions never retry or fall back to AEA", async () => {
  for (const failure of [new emailProvider.TradeEmailProviderError("email_provider_unavailable", "uncertain"), new Error("unexpected")]) {
    const f = fixture({ send: async () => { throw failure; } });
    try {
      await f.connect();
      await assert.rejects(f.send(), uncertain);
      assert.equal(f.submission().status, "uncertain");
      await assert.rejects(f.send(), uncertain);
      assert.equal(f.calls.send.length, 1);
      assert.equal(f.calls.legacy.length, 0);
    } finally { f.close(); }
  }
});

test("Definite rejection requires cooldown and revoked access marks the connection for reconnect", async () => {
  const f = fixture({ send: async () => { throw new emailProvider.TradeEmailProviderError("email_provider_rejected", "rejected"); } });
  try {
    await f.connect();
    await assert.rejects(f.send(), (error) => error.outcome === "definite_failure");
    assert.equal(f.submission().status, "failed");
    await assert.rejects(f.send(), /EMAIL_RETRY_LATER/);
    assert.equal(f.calls.send.length, 1);
    f.sqlite.exec("UPDATE trade_email_submissions SET retry_after = '2000-01-01T00:00:00.000Z'");
    delete f.hooks.send;
    await f.send();
    assert.equal(f.calls.send.length, 2);
    assert.equal(f.submission().status, "accepted");
    f.hooks.send = async () => { throw new emailProvider.TradeEmailProviderError("email_provider_reconnect", "reconnect"); };
    await assert.rejects(f.send({ idempotencyKey: "revoked-request" }), (error) => error.outcome === "definite_failure");
    assert.equal(f.row().status, "reconnect_required");
    await assert.rejects(f.send({ idempotencyKey: "later-request" }), /EMAIL_RECONNECT_REQUIRED/);
    assert.equal(f.calls.legacy.length, 0);
  } finally { f.close(); }
});

test("Disconnected or unavailable connections block sending with no platform fallback", async () => {
  const f = fixture();
  try {
    await f.connect();
    f.env.GOOGLE_EMAIL_ENABLED = "false";
    assert.equal((await f.server.tradeCustomerEmailReadiness("owner", f.db)).configured, false);
    await assert.rejects(f.send(), /EMAIL_RECONNECT_REQUIRED/);
    f.env.GOOGLE_EMAIL_ENABLED = "true";
    await f.server.disconnectTradeEmail("owner", f.db);
    assert.equal(f.row().encrypted_credentials, "");
    assert.equal(f.row().status, "disconnected");
    await assert.rejects(f.send(), /EMAIL_RECONNECT_REQUIRED/);
    assert.equal(f.calls.send.length, 0);
    assert.equal(f.calls.legacy.length, 0);
    assert.equal((await f.server.tradeCustomerEmailReadiness("owner", f.db)).configured, false);
  } finally { f.close(); }
});

test("A deactivated business cannot send through retained mailbox credentials or AEA", async () => {
  const f = fixture();
  try {
    await f.connect();
    f.sqlite.exec("UPDATE trade_accounts SET verified = 0 WHERE firebase_uid = 'owner'");
    await assert.rejects(f.send(), /EMAIL_ACCESS_REQUIRED|ABN_REVIEW_REQUIRED|EMAIL_CONNECTION_INVALID/);
    assert.equal(f.calls.send.length, 0);
    assert.equal(f.calls.legacy.length, 0);
  } finally { f.close(); }
});

test("Deactivation during mailbox refresh blocks a new submission at its atomic claim", async () => {
  const refreshing = deferred();
  const release = deferred();
  const f = fixture({ exchange: async () => ({ ...freshCredentials(), expiresAt: new Date(0).toISOString() }), refresh: async () => {
    refreshing.resolve(); await release.promise; return freshCredentials();
  } });
  try {
    await f.connect();
    const send = f.send();
    await refreshing.promise;
    f.sqlite.exec("UPDATE trade_accounts SET verified = 0 WHERE firebase_uid = 'owner'");
    release.resolve();
    await assert.rejects(send, uncertain);
    assert.equal(f.calls.send.length, 0);
    assert.equal(f.calls.legacy.length, 0);
    assert.equal(f.submission().status, "failed");
    assert.equal(f.submission().error_code, "email_preflight_not_sent");
  } finally { release.resolve(); f.close(); }
});

test("A failed mailbox retry must still have an active installer at its atomic claim", async () => {
  for (const change of ["verified = 0", "partner_type = 'supplier'"]) {
    const f = fixture({ send: async () => { throw new emailProvider.TradeEmailProviderError("email_provider_rejected", "rejected"); } });
    try {
      await f.connect();
      await assert.rejects(f.send(), (error) => error.outcome === "definite_failure");
      f.sqlite.exec("UPDATE trade_email_submissions SET retry_after = '2000-01-01T00:00:00.000Z'");
      delete f.hooks.send;
      f.hooks.beforeRun = (sql) => {
        if (sql.includes("UPDATE trade_email_submissions SET status = 'sending'")) f.sqlite.exec(`UPDATE trade_accounts SET ${change} WHERE firebase_uid = 'owner'`);
      };
      await assert.rejects(f.send(), uncertain);
      assert.equal(f.calls.send.length, 1);
      assert.equal(f.calls.legacy.length, 0);
      assert.equal(f.submission().status, "failed");
    } finally { f.close(); }
  }
});

test("Both new and failed legacy submissions require active installer eligibility at reservation", async () => {
  for (const retry of [false, true]) {
    const f = fixture({ legacy: async () => { throw new ReminderProviderDeliveryError("definite_failure", "rejected"); } });
    try {
      if (retry) {
        await assert.rejects(f.send(), (error) => error.outcome === "definite_failure");
        f.sqlite.exec("UPDATE trade_email_submissions SET retry_after = '2000-01-01T00:00:00.000Z'");
      }
      delete f.hooks.legacy;
      f.hooks.beforeRun = (sql) => {
        if (sql.includes("INSERT OR IGNORE INTO trade_email_submissions") || sql.includes("UPDATE trade_email_submissions SET status = 'sending'")) f.sqlite.exec("UPDATE trade_accounts SET verified = 0 WHERE firebase_uid = 'owner'");
      };
      await assert.rejects(f.send(), uncertain);
      assert.equal(f.calls.send.length, 0);
      assert.equal(f.calls.legacy.length, retry ? 1 : 0);
      assert.equal(f.submission().status, "failed");
      if (!retry) assert.equal(f.submission().error_code, "email_preflight_not_sent");
    } finally { f.close(); }
  }
});

test("Only a business which has never connected may retain legacy service email behavior", async () => {
  const f = fixture();
  try {
    const result = await f.send();
    assert.equal(result.provider, "resend");
    assert.equal(f.calls.legacy.length, 1);
    assert.equal(f.submission().provider, "resend");
    assert.equal(f.submission().status, "accepted");
    await assert.rejects(f.server.sendTradeCustomerEmail("owner", "staff", { ...message, idempotencyKey: "new-request" }, { db: f.db, requireConnection: true }), /EMAIL_CONNECTION_REQUIRED/);
    assert.equal(f.calls.legacy.length, 1);
  } finally { f.close(); }
});

test("A successful Resend submission stays idempotent after connecting a Google mailbox", async () => {
  const f = fixture();
  try {
    const accepted = await f.send();
    const original = f.submission();
    await f.connect();
    const replayed = await f.send();
    assert.deepEqual(replayed, accepted);
    assert.equal(replayed.provider, "resend");
    assert.equal(replayed.providerMessageId, "legacy-id");
    assert.equal(f.calls.legacy.length, 1);
    assert.equal(f.calls.send.length, 0);
    assert.equal(f.submission().provider, "resend");
    assert.equal(f.submission().sender_email, original.sender_email);
    assert.equal(f.submission().connection_id, "platform");
    await assert.rejects(f.send({ subject: "Changed quote" }), /EMAIL_REQUEST_CONFLICT/);
  } finally { f.close(); }
});

test("An uncertain Resend submission cannot be retried through a newly connected mailbox", async () => {
  const f = fixture({ legacy: async () => { throw new ReminderProviderDeliveryError("indeterminate", "provider timeout"); } });
  try {
    await assert.rejects(f.send(), uncertain);
    assert.equal(f.submission().status, "uncertain");
    await f.connect();
    await assert.rejects(f.send(), uncertain);
    assert.equal(f.calls.legacy.length, 1);
    assert.equal(f.calls.send.length, 0);
    assert.equal(f.submission().provider, "resend");
  } finally { f.close(); }
});

test("Mailbox cannot retry a pre-migration send with no authoritative journal entry", async () => {
  const f = fixture();
  try {
    await f.connect();
    await assert.rejects(f.server.sendTradeCustomerEmail("owner", "staff", message, { db: f.db, previouslyAttempted: true }), uncertain);
    assert.equal(f.calls.send.length, 0);
    assert.equal(f.calls.legacy.length, 0);
    assert.equal(f.submission(), undefined);
  } finally { f.close(); }
});

test("Durable preflight evidence permits retry after refresh failure even when the caller incremented attempts", async () => {
  const f = fixture({ exchange: async () => ({ ...freshCredentials(), expiresAt: new Date(0).toISOString() }), refresh: async () => {
    throw new emailProvider.TradeEmailProviderError("email_provider_unavailable", "uncertain");
  } });
  try {
    await f.connect();
    await assert.rejects(f.send(), /EMAIL_PREFLIGHT_FAILED/);
    const prepared = f.submission();
    assert.equal(prepared.status, "failed");
    assert.equal(prepared.error_code, "email_preflight_not_sent");
    assert.equal(f.calls.send.length, 0);
    delete f.hooks.refresh;
    const result = await f.server.sendTradeCustomerEmail("owner", "staff-1", message, { db: f.db, previouslyAttempted: true });
    assert.equal(result.providerStatus, "accepted");
    assert.equal(f.calls.send.length, 1);
    assert.equal(f.submission().id, prepared.id);
    assert.equal(f.submission().sender_email, prepared.sender_email);
    assert.equal(f.submission().content_hash, prepared.content_hash);
    assert.equal(f.submission().error_code, "");
  } finally { f.close(); }
});

test("Recipient preflight failure is safely retryable while a changed payload remains a conflict", async () => {
  const f = fixture();
  try {
    await f.connect();
    await assert.rejects(f.server.sendTradeCustomerEmail("owner", "staff-1", message, { db: f.db, beforeSend: async () => { throw new Error("EMAIL_RECIPIENT_UNAVAILABLE"); } }), /EMAIL_RECIPIENT_UNAVAILABLE/);
    assert.equal(f.submission().error_code, "email_preflight_not_sent");
    await assert.rejects(f.send({ subject: "Different message" }), /EMAIL_REQUEST_CONFLICT/);
    await f.server.sendTradeCustomerEmail("owner", "staff-1", message, { db: f.db, previouslyAttempted: true });
    assert.equal(f.calls.send.length, 1);
  } finally { f.close(); }
});

test("Temporarily disabled mailbox configuration records unsent evidence and resumes with the same sender", async () => {
  const f = fixture();
  try {
    await f.connect();
    f.env.GOOGLE_EMAIL_ENABLED = "false";
    await assert.rejects(f.send(), /EMAIL_RECONNECT_REQUIRED/);
    assert.equal(f.submission().error_code, "email_preflight_not_sent");
    f.env.GOOGLE_EMAIL_ENABLED = "true";
    await f.server.sendTradeCustomerEmail("owner", "staff-1", message, { db: f.db, previouslyAttempted: true });
    assert.equal(f.calls.send.length, 1);
  } finally { f.close(); }
});

test("An unjournalled historical platform attempt cannot gain safe-preflight evidence before switching mailboxes", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.server.sendTradeCustomerEmail("owner", "staff-1", message, { db: f.db, previouslyAttempted: true,
      beforeSend: async () => { throw new Error("EMAIL_RECIPIENT_UNAVAILABLE"); } }), /EMAIL_RECIPIENT_UNAVAILABLE/);
    assert.equal(f.submission(), undefined);
    await f.connect();
    await assert.rejects(f.server.sendTradeCustomerEmail("owner", "staff-1", message, { db: f.db, previouslyAttempted: true }), uncertain);
    assert.equal(f.calls.send.length, 0);
    assert.equal(f.calls.legacy.length, 0);
    assert.equal(f.submission(), undefined);
  } finally { f.close(); }
});

test("A definitively rejected Resend request cannot switch its provider or sender on retry", async () => {
  const f = fixture({ legacy: async () => { throw new ReminderProviderDeliveryError("definite_failure", "rejected"); } });
  try {
    await assert.rejects(f.send(), (error) => error.outcome === "definite_failure");
    assert.equal(f.submission().status, "failed");
    f.sqlite.exec("UPDATE trade_email_submissions SET retry_after = '2000-01-01T00:00:00.000Z'");
    await f.connect();
    await assert.rejects(f.send(), /EMAIL_CONNECTION_CHANGED/);
    assert.equal(f.calls.legacy.length, 1);
    assert.equal(f.calls.send.length, 0);
    assert.equal(f.submission().provider, "resend");
    assert.equal(f.submission().connection_id, "platform");
  } finally { f.close(); }
});

test("Resend also uses the SQL claim for simultaneous duplicates and acceptance persistence failures", async () => {
  const f = fixture();
  try {
    const results = await Promise.allSettled([f.send(), f.send({}, "owner", "staff-2")]);
    assert.equal(results.some((result) => result.status === "fulfilled"), true);
    assert.equal(f.calls.legacy.length, 1);
    assert.equal(f.calls.send.length, 0);
    f.hooks.beforeRun = (sql) => { if (sql.includes("SET status = 'accepted'")) throw new Error("database unavailable"); };
    await assert.rejects(f.send({ idempotencyKey: "second-legacy" }), uncertain);
    delete f.hooks.beforeRun;
    await f.connect();
    await assert.rejects(f.send({ idempotencyKey: "second-legacy" }), uncertain);
    assert.equal(f.calls.legacy.length, 2);
    assert.equal(f.calls.send.length, 0);
  } finally { f.close(); }
});

test("Refresh rotates encrypted credentials exactly once while a lease blocks concurrent refresh", async () => {
  const refreshing = deferred();
  const release = deferred();
  const f = fixture({ exchange: async () => ({ ...freshCredentials(), expiresAt: new Date(0).toISOString() }), refresh: async () => {
    refreshing.resolve(); await release.promise;
    return { ...freshCredentials(), accessToken: "rotated-access", refreshToken: "rotated-refresh" };
  } });
  try {
    await f.connect();
    const first = f.send();
    await refreshing.promise;
    await assert.rejects(f.send({ idempotencyKey: "second" }), /EMAIL_REFRESH_BUSY/);
    release.resolve();
    await first;
    assert.equal(f.calls.refresh.length, 1);
    assert.equal(f.calls.send[0][1], "rotated-access");
    assert.equal((await f.crypto.decryptProtectedPayload(f.row().encrypted_credentials)).refreshToken, "rotated-refresh");
    assert.equal(f.row().refresh_lock, "");
  } finally { release.resolve(); f.close(); }
});

test("Disconnect during refresh prevents token persistence, queued sending and AEA fallback", async () => {
  const refreshing = deferred();
  const release = deferred();
  const f = fixture({ exchange: async () => ({ ...freshCredentials(), expiresAt: new Date(0).toISOString() }), refresh: async () => {
    refreshing.resolve(); await release.promise; return freshCredentials();
  } });
  try {
    await f.connect();
    const send = f.send();
    await refreshing.promise;
    await f.server.disconnectTradeEmail("owner", f.db);
    release.resolve();
    await assert.rejects(send, /EMAIL_CONNECTION_CHANGED/);
    assert.equal(f.row().status, "disconnected");
    assert.equal(f.row().encrypted_credentials, "");
    assert.equal(f.calls.send.length, 0);
    assert.equal(f.calls.legacy.length, 0);
  } finally { release.resolve(); f.close(); }
});

test("A delayed refresh lease cannot rotate credentials read before another request refreshed them", async () => {
  const claiming = deferred();
  const release = deferred();
  let firstLease = true;
  const f = fixture({ exchange: async () => ({ ...freshCredentials(), expiresAt: new Date(0).toISOString() }) });
  try {
    await f.connect();
    f.hooks.beforeRun = async (sql) => {
      if (firstLease && sql.includes("SET refresh_lock = ?")) { firstLease = false; claiming.resolve(); await release.promise; }
    };
    const first = f.send();
    await claiming.promise;
    await f.send({ idempotencyKey: "second" });
    release.resolve();
    const [result] = await Promise.allSettled([first]);
    if (result.status === "rejected") assert.match(result.reason.message, /EMAIL_REFRESH_BUSY|EMAIL_CONNECTION_CHANGED/);
    assert.equal(f.calls.refresh.length, 1);
    assert.equal((await f.crypto.decryptProtectedPayload(f.row().encrypted_credentials)).refreshToken, "rotated-refresh");
  } finally { release.resolve(); f.close(); }
});

test("Refresh revocation blocks sending and keeps secrets out of reconnect explanation", async () => {
  const f = fixture({ exchange: async () => ({ ...freshCredentials(), expiresAt: new Date(0).toISOString() }), refresh: async () => {
    throw new emailProvider.TradeEmailProviderError("email_provider_reconnect", "reconnect");
  } });
  try {
    await f.connect();
    await assert.rejects(f.send(), /EMAIL_RECONNECT_REQUIRED/);
    assert.equal(f.row().status, "reconnect_required");
    assert.equal(f.row().refresh_lock, "");
    assert.equal(f.calls.send.length, 0);
    assert.equal((await f.server.tradeEmailSettings("owner", f.db)).connection.lastError, "Reconnect your email account to resume sending.");
  } finally { f.close(); }
});

test("Database failure after provider acceptance remains indeterminate and never retries", async () => {
  const f = fixture();
  try {
    await f.connect();
    f.hooks.beforeRun = (sql) => { if (sql.includes("SET status = 'accepted'")) throw new Error("database unavailable after acceptance"); };
    await assert.rejects(f.send(), uncertain);
    assert.equal(f.submission().status, "sending");
    delete f.hooks.beforeRun;
    await assert.rejects(f.send(), uncertain);
    assert.equal(f.calls.send.length, 1);
    assert.equal(f.calls.legacy.length, 0);
  } finally { f.close(); }
});

test("Database failure while saving uncertain provider outcome cannot become a definite failure", async () => {
  const f = fixture({ send: async () => { throw new emailProvider.TradeEmailProviderError("email_provider_unavailable", "uncertain"); } });
  try {
    await f.connect();
    f.hooks.beforeRun = (sql) => { if (sql.includes("SET status = ?, error_code = ?")) throw new Error("database unavailable while saving uncertainty"); };
    await assert.rejects(f.send(), uncertain);
    assert.equal(f.submission().status, "sending");
    delete f.hooks.beforeRun;
    await assert.rejects(f.send(), uncertain);
    assert.equal(f.calls.send.length, 1);
    assert.equal(f.calls.legacy.length, 0);
  } finally { f.close(); }
});

test("Test email is sent to the connected address and records acceptance without claiming delivery", async () => {
  const f = fixture();
  try {
    await f.connect("owner", "microsoft");
    f.hooks.send = async () => ({ providerMessageId: "", providerStatus: "accepted" });
    const result = await f.server.testTradeEmail("owner", "staff", "test-request", f.db);
    assert.equal(result.provider, "microsoft");
    assert.equal(result.providerStatus, "accepted");
    assert.equal(f.calls.send[0][2].recipient, "john@jelec.com");
    assert.ok(f.row().last_test_at);
    await f.server.testTradeEmail("owner", "staff", "test-request", f.db);
    assert.equal(f.calls.send.length, 1);
  } finally { f.close(); }
});
