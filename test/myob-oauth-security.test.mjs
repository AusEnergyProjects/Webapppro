import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import * as mfa from "../src/lib/firebase-mfa.ts";
import * as audit from "../src/lib/myob-security-audit.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const compile = (path) => ts.transpileModule(read(path), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const integrationSource = compile("../src/app/api/trade-integrations/route.ts");
const callbackSource = compile("../src/app/api/trade-integrations/callback/[provider]/route.ts");
const adminSource = compile("../src/lib/admin-server.ts");
const hash = async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");

function fixture(t, options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const path of ["../drizzle/0020_lying_stick.sql", "../drizzle/0022_worried_sleepwalker.sql", "../drizzle/0181_accounting_export_defaults.sql", "../drizzle/0186_myob_security_events.sql"]) {
    read(path).split("--> statement-breakpoint").filter((part) => part.trim()).forEach((sql) => sqlite.exec(sql));
  }
  sqlite.exec(`CREATE TABLE trade_accounts(firebase_uid TEXT PRIMARY KEY, approved INTEGER NOT NULL);
    INSERT INTO trade_accounts VALUES ('owner-one',1),('owner-two',1);
    CREATE TABLE admin_users(id TEXT PRIMARY KEY,firebase_uid TEXT,email TEXT,display_name TEXT,role TEXT,status TEXT,last_login_at TEXT,updated_at TEXT);
    INSERT INTO admin_users VALUES ('admin-record','owner-one','synthetic@example.test','Test administrator','admin','active','','');`);
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
  });
  const db = { prepare: statement, async batch(items) {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const item of items) results.push(await item.run());
      sqlite.exec("COMMIT"); return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  const calls = { fetch: [], decrypt: 0, logs: [] };
  let identity = { uid: "owner-one", email: "synthetic@example.test", emailVerified: true, authTime: 1, signInProvider: "password",
    ...(options.mfa === false ? {} : { secondFactor: "totp" }) };
  const providers = ["xero", "myob", "quickbooks", "google_calendar", "microsoft_calendar"];
  const providerLayer = {
    INTEGRATION_PROVIDERS: providers,
    isIntegrationProvider: (provider) => providers.includes(provider),
    providerConfigured: () => true,
    providerSetting: (provider) => ({ provider, label: provider, purpose: "Test integration", clientId: "synthetic-client",
      clientSecret: "synthetic-client-secret", authorizeUrl: `https://provider.example/${provider}/authorize`,
      tokenUrl: `https://provider.example/${provider}/token`, scopes: ["sme-sales", "sme-contacts-customer", "sme-general-ledger"] }),
    requireInstallerOperations: async () => ({ uid: identity.uid, identity, businessName: "Synthetic trade business" }),
    integrationCallbackUri: (request, provider) => `${new URL(request.url).origin}/api/trade-integrations/callback/${provider}`,
  };
  const dependencies = (id) => {
    if (id.endsWith("/db")) return { getD1: () => db };
    if (id === "@/lib/firebase-server") return { requireFirebaseIdentity: async () => identity };
    if (id === "@/lib/firebase-mfa") return mfa;
    if (id === "@/lib/myob-security-audit") return audit;
    if (id === "@/lib/trade-integrations-server") return providerLayer;
    if (id === "@/lib/trade-integration-crypto") return {
      integrationStateHash: hash,
      newIntegrationState: () => crypto.randomUUID(),
      encryptIntegrationCredentials: async (credentials) => `encrypted:${JSON.stringify(credentials)}`,
      decryptIntegrationCredentials: async (value) => { calls.decrypt++; return JSON.parse(value.slice("encrypted:".length)); },
    };
    if (id === "@/lib/trade-access-server") return { verifiedTradeAccountPredicate: (alias) => `${alias}.approved = 1` };
    if (id === "@/lib/trade-integration-state") return { calendarIntegrationStateWeekStart: () => "" };
    if (id === "@/lib/trade-schedule") return { normaliseWeekStart: (value) => value };
    if (id === "@/lib/admin-server") return admin;
    throw new Error(`Unexpected dependency ${id}`);
  };
  const consoleStub = { error: (...args) => calls.logs.push(args) };
  const fakeFetch = async (...args) => {
    calls.fetch.push(args);
    if (options.fetch) return options.fetch(...args);
    return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600 });
  };
  const load = (compiled) => {
    const exports = {};
    Function("require", "exports", "fetch", "console", compiled)(dependencies, exports, fakeFetch, consoleStub);
    return exports;
  };
  const admin = load(adminSource);
  const integrations = load(integrationSource);
  const callbacks = load(callbackSource);
  const request = (method, body) => new Request("https://tlink.example/api/trade-integrations", {
    method, headers: { "Content-Type": "application/json", Origin: "https://tlink.example" }, body: JSON.stringify(body),
  });
  const connect = async (provider = "myob") => integrations.POST(request("POST", { provider }));
  const authorisation = async (provider = "myob") => {
    const response = await connect(provider);
    assert.equal(response.status, 200);
    return new URL((await response.json()).authorizationUrl).searchParams.get("state");
  };
  const callback = (state, parameters = {}) => {
    const url = new URL("https://tlink.example/api/trade-integrations/callback/myob");
    for (const [key, value] of Object.entries({ state, code: "synthetic-code", businessId: "synthetic-file", ...parameters })) url.searchParams.set(key, value);
    return callbacks.GET(new Request(url), { params: Promise.resolve({ provider: "myob" }) });
  };
  const seedConnection = (owner = "owner-one", provider = "myob") => sqlite.prepare(`INSERT INTO trade_crm_integrations
    (id,firebase_uid,provider,external_account_id,encrypted_credentials,created_at,updated_at)
    VALUES (?,?,?,?,?,'now','now')`).run(`${owner}-${provider}`, owner, provider, `${owner}-file`, 'encrypted:{"access_token":"synthetic-existing"}');
  const events = (action) => sqlite.prepare("SELECT action,outcome,actor_uid,owner_uid FROM myob_security_events WHERE action = ? ORDER BY rowid").all(action);
  return { sqlite, db, calls, admin, integrations, callback, authorisation, connect, seedConnection, events,
    identity: (next) => { identity = { ...identity, ...next }; },
    disconnect: (provider = "myob") => integrations.PATCH(request("PATCH", { provider })) };
}

function status(response) { return new URL(response.headers.get("location")).searchParams.get("integration_status"); }
const count = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test("MYOB connect without MFA stops before creating OAuth state or contacting the provider", async (t) => {
  const h = fixture(t, { mfa: false });
  const response = await h.connect();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).setupUrl, "/direct-trade/security");
  assert.equal(count(h.sqlite, "trade_crm_oauth_states"), 0); assert.equal(h.calls.fetch.length, 0);
});

test("MYOB authorisation records a short-lived hashed state and verified MFA proof", async (t) => {
  const h = fixture(t); const state = await h.authorisation();
  const row = h.sqlite.prepare("SELECT * FROM trade_crm_oauth_states").get();
  assert.equal(row.state_hash, await hash(state)); assert.notEqual(row.state_hash, state);
  assert.equal(row.firebase_uid, "owner-one"); assert.equal(row.provider, "myob");
  assert.equal(row.mfa_verified_at, row.created_at);
  assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 600000);
  assert.equal(h.events("oauth.connect")[0].outcome, "success");
});

test("MYOB connect rolls back its new state when the security audit cannot be persisted", async (t) => {
  const h = fixture(t);
  h.sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON myob_security_events BEGIN SELECT RAISE(ABORT,'SYNTHETIC_AUDIT_FAILURE'); END");
  assert.equal((await h.connect()).status, 500);
  assert.equal(count(h.sqlite, "trade_crm_oauth_states"), 0); assert.equal(h.calls.fetch.length, 0);
});

test("a legacy MYOB callback without MFA proof fails before token exchange", async (t) => {
  const h = fixture(t); const state = await h.authorisation();
  h.sqlite.exec("UPDATE trade_crm_oauth_states SET mfa_verified_at = ''");
  assert.equal(status(await h.callback(state)), "failed");
  assert.equal(h.calls.fetch.length, 0); assert.equal(count(h.sqlite, "trade_crm_integrations"), 0);
});

test("expired MYOB state cannot be exchanged even when it has MFA proof", async (t) => {
  const h = fixture(t); const state = await h.authorisation();
  h.sqlite.exec("UPDATE trade_crm_oauth_states SET expires_at = '2020-01-01T00:00:00.000Z'");
  assert.equal(status(await h.callback(state)), "failed");
  assert.equal(h.calls.fetch.length, 0); assert.equal(count(h.sqlite, "trade_crm_integrations"), 0);
});

test("MYOB callback rejection logs contain no provider payloads, credentials or customer data", async (t) => {
  const h = fixture(t, { fetch: async () => Response.json({
    error: "synthetic_secret_identifier", error_description: "private-customer-info",
    access_token: "synthetic-provider-secret",
  }, { status: 400 }) });
  const state = await h.authorisation();
  assert.equal(status(await h.callback(state)), "failed");
  assert.doesNotMatch(JSON.stringify(h.calls.logs), /synthetic_secret_identifier|private-customer-info|synthetic-provider-secret|synthetic-code/);
  assert.equal(count(h.sqlite, "trade_crm_integrations"), 0);
  assert.equal(h.events("oauth.callback").filter((event) => event.outcome === "success").length, 0);
});

test("one-time MYOB callback state allows only one concurrent token exchange and one connection", async (t) => {
  const h = fixture(t); const state = await h.authorisation();
  const responses = await Promise.all([h.callback(state), h.callback(state)]);
  assert.deepEqual(responses.map(status).sort(), ["connected", "failed"]);
  assert.equal(h.calls.fetch.length, 1); assert.equal(count(h.sqlite, "trade_crm_integrations"), 1);
  const row = h.sqlite.prepare("SELECT * FROM trade_crm_integrations").get();
  assert.equal(row.firebase_uid, "owner-one"); assert.equal(row.external_account_id, "synthetic-file");
  assert.match(row.encrypted_credentials, /^encrypted:/);
  assert.equal(h.events("oauth.callback").filter((event) => event.outcome === "success").length, 1);
});

test("callback refuses connections revoked or superseded while token exchange is in flight", async (t) => {
  for (const mutation of ["DELETE FROM trade_crm_oauth_states", "UPDATE trade_accounts SET approved=0 WHERE firebase_uid='owner-one'"]) {
    await t.test(mutation, async (t) => {
      const h = fixture(t, { fetch: async () => {
        h.sqlite.exec(mutation);
        return Response.json({ access_token: "synthetic-access" });
      } });
      const state = await h.authorisation();
      assert.equal(status(await h.callback(state)), "failed");
      assert.equal(count(h.sqlite, "trade_crm_integrations"), 0);
      assert.equal(h.events("oauth.callback").filter((event) => event.outcome === "success").length, 0);
    });
  }
});

test("another customer connecting does not invalidate an in-flight MYOB callback", async (t) => {
  const h = fixture(t, { fetch: async () => {
    h.identity({ uid: "owner-two" });
    await h.authorisation("google_calendar");
    return Response.json({ access_token: "synthetic-access" });
  } });
  const state = await h.authorisation();
  assert.equal(status(await h.callback(state)), "connected");
  assert.equal(h.sqlite.prepare("SELECT firebase_uid FROM trade_crm_integrations").get().firebase_uid, "owner-one");
});

test("starting a newer authorisation for the same customer invalidates the old callback", async (t) => {
  const h = fixture(t, { fetch: async () => {
    await h.authorisation();
    return Response.json({ access_token: "synthetic-access" });
  } });
  const state = await h.authorisation();
  assert.equal(status(await h.callback(state)), "failed");
  assert.equal(count(h.sqlite, "trade_crm_integrations"), 0);
  assert.equal(h.events("oauth.callback").filter((event) => event.outcome === "success").length, 0);
});

test("callback audit failure prevents token access and success audit failure rolls back attachment", async (t) => {
  for (const outcome of ["attempt", "success"]) {
    await t.test(outcome, async (t) => {
      const h = fixture(t); const state = await h.authorisation();
      h.sqlite.exec(`CREATE TRIGGER reject_callback_audit BEFORE INSERT ON myob_security_events
        WHEN NEW.action='oauth.callback' AND NEW.outcome='${outcome}' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_AUDIT_FAILURE'); END`);
      assert.equal(status(await h.callback(state)), "failed");
      assert.equal(h.calls.fetch.length, outcome === "attempt" ? 0 : 1);
      assert.equal(count(h.sqlite, "trade_crm_integrations"), 0);
      assert.equal(h.events("oauth.callback").filter((event) => event.outcome === "success").length, 0);
    });
  }
});

test("MYOB disconnect requires MFA and removes only this customer's local credentials and pending states", async (t) => {
  const h = fixture(t); h.seedConnection(); h.seedConnection("owner-two"); h.seedConnection("owner-one", "xero");
  const state = await h.authorisation();
  h.identity({ secondFactor: undefined });
  assert.equal((await h.disconnect()).status, 403);
  assert.equal(count(h.sqlite, "trade_crm_integrations"), 3);
  assert.equal(count(h.sqlite, "trade_crm_oauth_states"), 1); assert.equal(h.calls.decrypt, 0);
  h.identity({ secondFactor: "totp" });
  const response = await h.disconnect();
  assert.equal(response.status, 200);
  assert.doesNotMatch(JSON.stringify(await response.json()), /revok/i);
  assert.equal(count(h.sqlite, "trade_crm_integrations"), 2); assert.equal(count(h.sqlite, "trade_crm_oauth_states"), 0);
  assert.equal(h.calls.fetch.length, 0);
  assert.deepEqual(h.events("oauth.disconnect").map((event) => event.outcome), ["attempt", "success"]);
  assert.equal(status(await h.callback(state)), "failed"); assert.equal(h.calls.fetch.length, 0);
});

test("MYOB disconnect audit failure preserves local credentials and pending states", async (t) => {
  const h = fixture(t); h.seedConnection(); await h.authorisation();
  h.sqlite.exec(`CREATE TRIGGER reject_disconnect_success BEFORE INSERT ON myob_security_events
    WHEN NEW.action='oauth.disconnect' AND NEW.outcome='success' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_AUDIT_FAILURE'); END`);
  assert.equal((await h.disconnect()).status, 500);
  assert.equal(count(h.sqlite, "trade_crm_integrations"), 1); assert.equal(count(h.sqlite, "trade_crm_oauth_states"), 1);
  assert.equal(h.events("oauth.disconnect").filter((event) => event.outcome === "success").length, 0);
});

test("administrative MYOB access requires MFA and a durable audit before returning identity", async (t) => {
  const h = fixture(t, { mfa: false }); h.seedConnection();
  const request = new Request("https://tlink.example/api/admin/jobs");
  await assert.rejects(h.admin.requireAdminIdentity(request), mfa.FirebaseMfaRequiredError);
  assert.deepEqual(h.events("access.denied").map((event) => event.outcome), ["denied"]);
  assert.equal(h.sqlite.prepare("SELECT last_login_at FROM admin_users").get().last_login_at, "");
  h.identity({ secondFactor: "totp" });
  assert.equal((await h.admin.requireAdminIdentity(request)).uid, "owner-one");
  assert.equal(h.events("admin.access").filter((event) => event.outcome === "success").length, 1);
  h.sqlite.exec(`CREATE TRIGGER reject_admin_audit BEFORE INSERT ON myob_security_events
    WHEN NEW.action='admin.access' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_AUDIT_FAILURE'); END`);
  await assert.rejects(h.admin.requireAdminIdentity(request), /SYNTHETIC_AUDIT_FAILURE/);
});

test("an email match for a different established admin identity never records successful access", async (t) => {
  const h = fixture(t); h.seedConnection(); h.identity({ uid: "owner-two" });
  await assert.rejects(h.admin.requireAdminIdentity(new Request("https://tlink.example/api/admin/jobs")), /ADMIN_REQUIRED/);
  assert.equal(h.events("admin.access").filter((event) => event.outcome === "success").length, 0);
});

test("administrative failures never log arbitrary provider data or production secrets", (t) => {
  const h = fixture(t);
  assert.equal(h.admin.adminError(new Error("private-customer-invoice production-secret-value")).status, 500);
  assert.doesNotMatch(JSON.stringify(h.calls.logs), /private-customer|production-secret/);
});
