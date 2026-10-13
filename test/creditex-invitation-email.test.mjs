import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import {
  creditexInvitationEmail,
  sendCreditexInvitationEmail,
  loadCreditexInvitationEmailDelivery,
  loadCreditexInvitationEmailDeliveries,
  CreditexInvitationEmailError,
} from "../src/lib/creditex-invitation-email-server.ts";
import * as operations from "../src/lib/creditex-operations-server.ts";

const time = "2026-10-13T00:00:00.000Z";
const actor = { membershipId: "admin", uid: "admin-uid", role: "admin", organisationId: "org", email: "admin@example.com", emailVerified: true };
const runtime = { RESEND_API_KEY: "test-only-resend-api-key", RESEND_FROM_EMAIL: "TLink <team@example.com>" };
const options = { origin: "https://example.com", runtime };
const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { success: true, results: this.database.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
  async run() { const result = this.database.prepare(this.sql).run(...this.values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
}

function fixture(t) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(time) });
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE compliance_organisations (id TEXT PRIMARY KEY, status TEXT, legal_name TEXT, trading_name TEXT);
    CREATE TABLE compliance_users (id TEXT PRIMARY KEY, organisation_id TEXT, firebase_uid TEXT, email TEXT, role TEXT, status TEXT, permissions_json TEXT,
      display_name TEXT DEFAULT '', phone TEXT DEFAULT '', job_title TEXT DEFAULT '', governance_identity_verified INTEGER DEFAULT 0,
      last_login_at TEXT DEFAULT '', created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '');
    CREATE TABLE compliance_invitations (id TEXT PRIMARY KEY, organisation_id TEXT, email TEXT, display_name TEXT, role TEXT, status TEXT, invited_by_uid TEXT,
      expires_at TEXT, claimed_by_uid TEXT, claimed_at TEXT, created_at TEXT, updated_at TEXT, permissions_json TEXT, phone TEXT, job_title TEXT);
    CREATE UNIQUE INDEX active_invitation ON compliance_invitations (organisation_id,email) WHERE status IN ('pending','claimed');
    CREATE TABLE compliance_audit_events (id TEXT PRIMARY KEY, organisation_id TEXT, actor_type TEXT, actor_uid TEXT, event_type TEXT, target_type TEXT,
      target_id TEXT, summary TEXT, metadata TEXT CHECK(json_valid(metadata)), created_at TEXT);
    CREATE TRIGGER audit_no_update BEFORE UPDATE ON compliance_audit_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
    CREATE TRIGGER audit_no_delete BEFORE DELETE ON compliance_audit_events BEGIN SELECT RAISE(ABORT,'IMMUTABLE'); END;
    CREATE TABLE compliance_write_guards (id TEXT PRIMARY KEY, organisation_id TEXT, operation_id TEXT, step_number INTEGER, verified INTEGER CHECK(verified=1), created_at TEXT);
    INSERT INTO compliance_organisations VALUES ('org','active','Creditex Pty Ltd','Creditex'), ('other','active','Other','Other');
    INSERT INTO compliance_users (id,organisation_id,firebase_uid,email,role,status,permissions_json) VALUES ('admin','org','admin-uid','admin@example.com','admin','active',NULL);
    INSERT INTO compliance_invitations VALUES ('invite','org','person@example.com','Alex Person','admin','pending','admin-uid','2026-10-20T00:00:00.000Z','','',
      '${time}','${time}',NULL,'','');`);
  const d1 = { prepare: sql => new Statement(db, sql), async batch(statements) {
    db.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  } };
  return { db, d1 };
}

function provider(calls, response = () => Response.json({ id: "provider-email-123" })) {
  return async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return response(); };
}

function loadRoute(d1, fetchImpl) {
  const output = ts.transpileModule(read("../src/app/api/creditex/access/route.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: "route.ts",
  }).outputText;
  class AccessError extends Error {}
  class NamedOwnerError extends Error {}
  const mocks = {
    "../../../../../db": { getD1: () => d1 },
    "@/lib/compliance-access-server": { ComplianceAccessError: AccessError, requireComplianceIdentity: async () => actor },
    "@/lib/firebase-server": { requireFirebaseIdentity: async () => actor },
    "@/lib/creditex-operations-server": operations,
    "@/lib/bounded-json-request": { BoundedJsonRequestError: AccessError, readBoundedJsonRequest: request => request.json() },
    "@/lib/creditex-named-owner-server": { CreditexNamedOwnerError: NamedOwnerError },
    "@/lib/creditex-invitation-email-server": { CreditexInvitationEmailError,
      sendCreditexInvitationEmail: (db, identity, id, routeOptions) => sendCreditexInvitationEmail(db, identity, id, { ...routeOptions, runtime, fetchImpl }) },
  };
  const record = { exports: {} };
  new Function("require", "module", "exports", output)(specifier => { assert.ok(mocks[specifier], `Unexpected dependency: ${specifier}`); return mocks[specifier]; }, record, record.exports);
  return record.exports;
}

const request = body => new Request("https://example.com/api/creditex/access", { method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify(body) });

test("invitation email presents first-use setup with the saved opaque reference and existing-account alternatives", () => {
  const id = "1fe1be51-6bc8-4b6d-8f5a-1812a12bbdab";
  const email = creditexInvitationEmail({ invitationId: id, displayName: '<img src=x onerror="attack">', email: "person@example.com", workspaceName: "Creditex & Team", expiresAt: "2026-10-20T00:00:00Z", origin: "https://example.com" });
  assert.match(email.subject, /You're invited to Creditex & Team on TLink/);
  assert.match(email.html, /role="presentation"/);
  assert.match(email.html, /background:#082d37/);
  assert.match(email.html, /Join Creditex &amp; Team on TLink/);
  assert.equal((email.html.match(/Accept your invitation/g) || []).length, 1);
  assert.match(email.html, /&lt;img src=x onerror=&quot;attack&quot;&gt;/);
  assert.doesNotMatch(email.html, /<img|token=|password=|Use your existing TLink password|access is ready when you sign in/);
  assert.match(email.body, /New to TLink\? Choose Create account and enter a password/);
  assert.match(email.body, /signed in automatically.*Confirm your email using the verification link/);
  assert.match(email.html, /<strong>Already use TLink\?<\/strong>/);
  assert.match(email.body, /Forgot password\? to email yourself a reset link/);
  assert.match(email.body, /Continue with Google/);
  assert.match(email.body, /person@example.com/);
  assert.match(email.body, /20 October 2026.*Sydney time/);
  assert.equal((email.html.match(new RegExp(`href="https://example\\.com/creditex/compliance\\?invite=${id}"`, "g")) || []).length, 2);
});

test("new creation submits provider email after invitation commit and reused creation does not dispatch again", async t => {
  const { db, d1 } = fixture(t); const calls = [];
  const route = loadRoute(d1, provider(calls, () => {
    assert.equal(db.prepare("SELECT COUNT(*) n FROM compliance_invitations WHERE email='new.person@example.com'").get().n, 1);
    return Response.json({ id: "new-provider-email" });
  }));
  const body = { action: "create_invitation", email: "new.person@example.com", displayName: "New Person", role: "reviewer" };
  const response = await route.POST(request(body)); assert.equal(response.status, 201);
  const result = (await response.json()).result; assert.equal(result.delivery.status, "submitted"); assert.equal(result.reused, false);
  assert.equal(calls.length, 1); assert.equal(calls[0].body.to[0], body.email);
  assert.match(calls[0].body.html, new RegExp(`\\?invite=${result.id}`));
  assert.match(calls[0].body.html, /Choose <strong>Create account<\/strong> and enter a password/);
  const again = (await (await route.POST(request(body))).json()).result;
  assert.equal(again.id, result.id); assert.equal(again.reused, true); assert.equal(again.delivery.status, "submitted"); assert.equal(calls.length, 1);
});

test("existing invitation endpoint dispatches stored recipient and exposes honest persisted status", async t => {
  const { db, d1 } = fixture(t); const calls = []; const route = loadRoute(d1, provider(calls));
  const response = await route.POST(request({ action: "send_invitation_email", invitationId: "invite", email: "attacker@example.com" }));
  assert.equal(response.status, 201); assert.equal((await response.json()).result.delivery.status, "submitted");
  assert.equal(calls[0].body.to[0], "person@example.com"); assert.match(calls[0].body.html, /Join Creditex on TLink/);
  assert.match(calls[0].body.html, /\?invite=invite/);
  const get = await route.GET(new Request("https://example.com/api/creditex/access"));
  const invitation = (await get.json()).access.invitations.find(row => row.id === "invite");
  assert.equal(invitation.emailDelivery.status, "submitted"); assert.equal(invitation.lastAttemptAt, time);
  const audit = db.prepare("SELECT * FROM compliance_audit_events WHERE event_type='membership.invitation_email_result'").get();
  assert.equal(audit.actor_uid, actor.uid); assert.equal(JSON.parse(audit.metadata).providerMessageId, "provider-email-123");
  assert.throws(() => db.prepare("UPDATE compliance_audit_events SET summary='edited'").run(), /IMMUTABLE/);
});

test("GET computes email availability from current pending, expiry and claim state on the server", async t => {
  const { db, d1 } = fixture(t);
  db.exec(`INSERT INTO compliance_invitations
    (id,organisation_id,email,display_name,role,status,expires_at,claimed_by_uid,claimed_at,created_at,updated_at)
    VALUES ('expired','org','expired@example.com','Expired Person','admin','pending','2026-10-12T00:00:00.000Z','','','${time}','${time}'),
      ('claimed','org','claimed@example.com','Claimed Person','admin','claimed','2026-10-20T00:00:00.000Z','claimed-uid','${time}','${time}','${time}'),
      ('revoked','org','revoked@example.com','Revoked Person','admin','revoked','2026-10-20T00:00:00.000Z','','','${time}','${time}');`);
  const route = loadRoute(d1, () => { throw new Error("GET must never send an email"); });
  const response = await route.GET(new Request("https://example.com/api/creditex/access"));
  assert.equal(response.status, 200);
  const rows = (await response.json()).access.invitations;
  assert.equal(rows.find(row => row.id === "invite").emailAvailable, true);
  for (const id of ["expired", "claimed", "revoked"]) assert.equal(rows.find(row => row.id === id).emailAvailable, false);
  assert.equal("claimedByUid" in rows[0], false, "availability does not disclose the claiming account identifier");
});

test("wrong organisation, inactive authority, missing grant and terminal invitation states never reach provider", async t => {
  const { db, d1 } = fixture(t); const calls = []; const settings = { ...options, fetchImpl: provider(calls) };
  await assert.rejects(sendCreditexInvitationEmail(d1, { ...actor, organisationId: "other" }, "invite", settings), /changed/);
  await assert.rejects(sendCreditexInvitationEmail(d1, { ...actor, permissions: [] }, "invite", settings), error => error.status === 403);
  for (const sql of ["UPDATE compliance_users SET status='suspended'", "UPDATE compliance_organisations SET status='suspended' WHERE id='org'", "UPDATE compliance_users SET permissions_json='[]'"]) {
    db.exec(sql); await assert.rejects(sendCreditexInvitationEmail(d1, actor, "invite", settings), /changed/);
    db.exec("UPDATE compliance_users SET status='active', permissions_json=NULL; UPDATE compliance_organisations SET status='active'");
  }
  for (const status of ["revoked", "claimed", "expired"]) {
    db.prepare("UPDATE compliance_invitations SET status=? WHERE id='invite'").run(status);
    await assert.rejects(sendCreditexInvitationEmail(d1, actor, "invite", settings), /changed/);
  }
  db.exec("UPDATE compliance_invitations SET status='pending',expires_at='2026-10-12T00:00:00.000Z'");
  await assert.rejects(sendCreditexInvitationEmail(d1, actor, "invite", settings), /changed/);
  assert.equal(calls.length, 0); assert.equal(db.prepare("SELECT COUNT(*) n FROM compliance_audit_events").get().n, 0);
});

test("simultaneous submissions reserve only one provider request and cooldown returns persisted state", async t => {
  const { db, d1 } = fixture(t); const calls = [];
  let release; const held = new Promise(resolve => { release = resolve; });
  const settings = { ...options, fetchImpl: provider(calls, async () => { await held; return Response.json({ id: "held-provider" }); }) };
  const first = sendCreditexInvitationEmail(d1, actor, "invite", settings);
  const simultaneous = sendCreditexInvitationEmail(d1, actor, "invite", settings);
  while (!calls.length) await Promise.resolve();
  const second = await simultaneous; assert.equal(second.status, "sending"); assert.equal(calls.length, 1);
  release(); assert.equal((await first).status, "submitted");
  assert.equal((await sendCreditexInvitationEmail(d1, actor, "invite", settings)).status, "submitted"); assert.equal(calls.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM compliance_audit_events WHERE event_type='membership.invitation_email_requested'").get().n, 1);
});

test("permission revocation between reservation and external dispatch is rechecked", async t => {
  const { db, d1 } = fixture(t); const calls = []; const prepare = d1.prepare;
  d1.prepare = sql => { const statement = prepare(sql); const bind = statement.bind; statement.bind = (...values) => {
    const bound = bind.call(statement, ...values); const run = bound.run;
    bound.run = async () => { const result = await run.call(bound); if (/SELECT.*'compliance'/s.test(sql) && sql.includes("INSERT INTO compliance_audit_events")) db.exec("UPDATE compliance_users SET status='suspended'"); return result; };
    return bound;
  }; return statement; };
  assert.equal((await sendCreditexInvitationEmail(d1, actor, "invite", { ...options, fetchImpl: provider(calls) })).status, "failed");
  assert.equal(calls.length, 0); assert.equal((await loadCreditexInvitationEmailDelivery(d1, "org", "invite")).status, "failed");
});

test("missing provider configuration and definite rejection persist failed state without losing invitation", async t => {
  const { db, d1 } = fixture(t); const calls = [];
  assert.equal((await sendCreditexInvitationEmail(d1, actor, "invite", { origin: options.origin, runtime: {}, fetchImpl: provider(calls) })).status, "failed");
  assert.equal(calls.length, 0); assert.equal(db.prepare("SELECT status FROM compliance_invitations WHERE id='invite'").get().status, "pending");
  t.mock.timers.tick(120_001);
  assert.equal((await sendCreditexInvitationEmail(d1, actor, "invite", { ...options, fetchImpl: provider(calls, () => Response.json({ error: "rejected" }, { status: 422 })) })).status, "failed");
  const deliveries = await loadCreditexInvitationEmailDeliveries(d1, "org", ["invite", "never-sent"]);
  assert.equal(deliveries.get("invite").status, "failed"); assert.equal(deliveries.get("never-sent").status, "not_sent");
});

test("uncertain provider response retries identical persisted payload and idempotency key", async t => {
  const { db, d1 } = fixture(t); const calls = [];
  assert.equal((await sendCreditexInvitationEmail(d1, actor, "invite", { ...options, fetchImpl: provider(calls, () => Response.json({}, { status: 503 })) })).status, "unknown");
  t.mock.timers.tick(120_001); db.exec("UPDATE compliance_organisations SET trading_name='New workspace name'");
  assert.equal((await sendCreditexInvitationEmail(d1, actor, "invite", { ...options, fetchImpl: provider(calls) })).status, "submitted");
  assert.equal(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"]);
  assert.deepEqual(calls[0].body, calls[1].body); assert.equal((await loadCreditexInvitationEmailDelivery(d1, "org", "invite")).status, "submitted");
});

test("accepted provider response followed by failed result persistence remains unconfirmed and retry-safe", async t => {
  const { db, d1 } = fixture(t); const calls = []; const prepare = d1.prepare;
  let loseResult = true;
  d1.prepare = sql => { const statement = prepare(sql); if (/VALUES \(/.test(sql) && /INSERT INTO compliance_audit_events/.test(sql)) {
    const bind = statement.bind; statement.bind = (...values) => { const bound = bind.call(statement, ...values); const run = bound.run; bound.run = async () => { if (loseResult) { loseResult = false; throw new Error("temporary database error"); } return run.call(bound); }; return bound; };
  } return statement; };
  assert.equal((await sendCreditexInvitationEmail(d1, actor, "invite", { ...options, fetchImpl: provider(calls) })).status, "unknown");
  assert.equal((await loadCreditexInvitationEmailDelivery(d1, "org", "invite")).status, "sending");
  t.mock.timers.tick(120_001); assert.equal((await loadCreditexInvitationEmailDelivery(d1, "org", "invite")).status, "unknown");
  assert.equal((await sendCreditexInvitationEmail(d1, actor, "invite", { ...options, fetchImpl: provider(calls) })).status, "submitted");
  assert.equal(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM compliance_audit_events WHERE event_type='membership.invitation_email_requested'").get().n, 2);
});

test("unconfirmed attempt past provider idempotency window never sends a duplicate email", async t => {
  const { d1 } = fixture(t); const calls = [];
  await sendCreditexInvitationEmail(d1, actor, "invite", { ...options, fetchImpl: provider(calls, () => { throw new Error("network lost"); }) });
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  const result = await sendCreditexInvitationEmail(d1, actor, "invite", { ...options, fetchImpl: provider(calls) });
  assert.equal(result.status, "unknown"); assert.match(result.message, /email administrator/); assert.equal(calls.length, 1);
});

test("an explicit resend after confirmed result and cooldown uses a fresh key", async t => {
  const { d1 } = fixture(t); const calls = []; const settings = { ...options, fetchImpl: provider(calls) };
  await sendCreditexInvitationEmail(d1, actor, "invite", settings); t.mock.timers.tick(120_001);
  await sendCreditexInvitationEmail(d1, actor, "invite", settings);
  assert.equal(calls.length, 2); assert.notEqual(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"]);
});

test("250 invitation histories load their latest states within D1's 100 binding limit", async t => {
  const { db, d1 } = fixture(t);
  const ids = Array.from({ length: 250 }, (_, index) => `bulk-invitation-${index}`);
  const states = ["submitted", "failed", "unknown"];
  const insert = db.prepare(`INSERT INTO compliance_audit_events
    (id,organisation_id,actor_type,actor_uid,event_type,target_type,target_id,summary,metadata,created_at)
    VALUES (?, 'org', 'compliance', 'admin-uid', ?, 'compliance_invitation', ?, 'Test email history', ?, ?)`);
  for (const [index, id] of ids.entries()) {
    insert.run(`${id}:old`, "membership.invitation_email_requested", id, "{}", "2026-10-12T00:00:00.000Z");
    insert.run(`${id}:old:result`, "membership.invitation_email_result", id, JSON.stringify({ status: "failed" }), "2026-10-12T00:00:01.000Z");
    insert.run(`${id}:latest`, "membership.invitation_email_requested", id, "{}", time);
    insert.run(`${id}:latest:result`, "membership.invitation_email_result", id, JSON.stringify({ status: states[index % states.length] }), time);
  }
  const counts = [];
  const prepare = d1.prepare;
  d1.prepare = sql => {
    const statement = prepare(sql); const bind = statement.bind;
    statement.bind = (...values) => { counts.push(values.length); assert.ok(values.length <= 100, "D1 bound parameter limit exceeded"); return bind.call(statement, ...values); };
    return statement;
  };
  const loaded = await loadCreditexInvitationEmailDeliveries(d1, "org", ids);
  assert.equal(loaded.size, 250);
  assert.deepEqual(counts, [100, 100, 59]);
  for (const [index, id] of ids.entries()) {
    assert.equal(loaded.get(id).status, states[index % states.length]);
    assert.equal(loaded.get(id).attemptedAt, time);
  }
});
