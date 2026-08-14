import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  drainTradeTeamDocumentExpiryEmails,
  enqueueTradeTeamDocumentExpiryWarnings,
  listTradeTeamDocumentExpiryWarnings,
} from "../src/lib/trade-team-document-expiry-server.ts";

const migration = fs.readFileSync(
  new URL("../drizzle/0135_team_document_expiry_warnings.sql", import.meta.url),
  "utf8",
);
const schema = fs.readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
const notificationsRoute = fs.readFileSync(
  new URL("../src/app/api/trade-job-notifications/route.ts", import.meta.url),
  "utf8",
);
const notificationsDrawer = fs.readFileSync(
  new URL("../src/components/TradeJobNotifications.tsx", import.meta.url),
  "utf8",
);
const dashboard = fs.readFileSync(
  new URL("../src/components/DirectTradeDashboard.tsx", import.meta.url),
  "utf8",
);
const teamSettings = fs.readFileSync(
  new URL("../src/components/TradeTeamSettings.tsx", import.meta.url),
  "utf8",
);

function apply(database, sql) {
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    database.exec(statement);
  }
}

function d1(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      let bindings = [];
      const prepared = {
        bind(...values) {
          bindings = values;
          return prepared;
        },
        async first(columnName) {
          const row = statement.get(...bindings);
          return columnName ? row?.[columnName] ?? null : row ?? null;
        },
        async all() {
          return { results: statement.all(...bindings), success: true, meta: {} };
        },
        async run() {
          const result = statement.run(...bindings);
          return { results: [], success: true, meta: { changes: result.changes } };
        },
      };
      return prepared;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`CREATE TABLE trade_accounts (
    firebase_uid text PRIMARY KEY,
    email text NOT NULL,
    business_name text NOT NULL,
    account_status text NOT NULL
  )`);
  database.exec(`CREATE TABLE trade_team_members (
    id text PRIMARY KEY,
    owner_uid text NOT NULL,
    display_name text NOT NULL,
    first_name text NOT NULL DEFAULT '',
    last_name text NOT NULL DEFAULT '',
    status text NOT NULL
  )`);
  database.exec(`CREATE TABLE trade_team_member_files (
    id text PRIMARY KEY,
    owner_uid text NOT NULL,
    team_member_id text NOT NULL,
    file_name text NOT NULL,
    title text NOT NULL DEFAULT '',
    expires_at text NOT NULL DEFAULT '',
    status text NOT NULL,
    FOREIGN KEY (team_member_id) REFERENCES trade_team_members(id) ON DELETE RESTRICT
  )`);
  apply(database, migration);
  const insertAccount = database.prepare(`INSERT INTO trade_accounts
    (firebase_uid, email, business_name, account_status) VALUES (?, ?, ?, 'active')`);
  insertAccount.run("owner-a", "owner-a@example.com", "Alpha Electrical");
  insertAccount.run("owner-b", "owner-b@example.com", "Beta Solar");
  const insertMember = database.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, display_name, first_name, last_name, status) VALUES (?, ?, ?, ?, ?, ?)`);
  insertMember.run("member-a", "owner-a", "Alex Field", "Alex", "Field", "active");
  insertMember.run("member-b", "owner-b", "Bailey Tech", "Bailey", "Tech", "active");
  return { database, db: d1(database) };
}

function insertFile(database, {
  id,
  ownerUid,
  memberId,
  title,
  expiresAt,
  status = "active",
}) {
  database.prepare(`INSERT INTO trade_team_member_files
    (id, owner_uid, team_member_id, file_name, title, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, ownerUid, memberId, `${id}.pdf`, title, expiresAt, status);
}

test("expiry storage is Sites-safe, revision-unique and represented in the schema", () => {
  assert.match(migration, /CREATE TABLE `trade_team_document_expiry_warnings`/);
  assert.match(migration, /trade_team_document_expiry_warnings_revision_idx/);
  assert.match(migration, /trade_team_document_expiry_warnings_email_queue_idx/);
  assert.doesNotMatch(migration, /CREATE TRIGGER/);
  assert.match(schema, /sqliteTable\("trade_team_document_expiry_warnings"/);
  const { database } = fixture();
  const indexes = database.prepare("PRAGMA index_list(trade_team_document_expiry_warnings)")
    .all().map((row) => row.name);
  assert.ok(indexes.includes("trade_team_document_expiry_warnings_revision_idx"));
  assert.ok(indexes.includes("trade_team_document_expiry_warnings_email_queue_idx"));
  database.close();
});

test("only active documents for active staff inside the 30-day window enqueue once", async () => {
  const { database, db } = fixture();
  const now = new Date("2026-08-13T00:00:00.000Z");
  insertFile(database, { id: "due", ownerUid: "owner-a", memberId: "member-a", title: "Driver licence", expiresAt: "2026-09-12" });
  insertFile(database, { id: "no-expiry", ownerUid: "owner-a", memberId: "member-a", title: "Induction", expiresAt: "" });
  insertFile(database, { id: "later", ownerUid: "owner-a", memberId: "member-a", title: "Insurance", expiresAt: "2026-09-13" });
  insertFile(database, { id: "deleted", ownerUid: "owner-a", memberId: "member-a", title: "Old card", expiresAt: "2026-08-20", status: "deleted" });
  database.prepare("UPDATE trade_team_members SET status = 'suspended' WHERE id = 'member-b'").run();
  insertFile(database, { id: "suspended", ownerUid: "owner-b", memberId: "member-b", title: "White card", expiresAt: "2026-08-20" });

  assert.deepEqual(await enqueueTradeTeamDocumentExpiryWarnings({ db, now }), { scanned: 1, enqueued: 1 });
  assert.deepEqual(await enqueueTradeTeamDocumentExpiryWarnings({ db, now }), { scanned: 0, enqueued: 0 });
  const stored = database.prepare(`SELECT owner_uid, file_id, document_title, member_name, expires_at
    FROM trade_team_document_expiry_warnings`).all().map((row) => ({ ...row }));
  assert.deepEqual(stored, [{
    owner_uid: "owner-a",
    file_id: "due",
    document_title: "Driver licence",
    member_name: "Alex Field",
    expires_at: "2026-09-12",
  }]);
  database.close();
});

test("warning list is tenant-scoped and visible only while the member document revision is active", async () => {
  const { database, db } = fixture();
  const now = new Date("2026-08-13T00:00:00.000Z");
  insertFile(database, { id: "file-a", ownerUid: "owner-a", memberId: "member-a", title: "A grade licence", expiresAt: "2026-08-20" });
  insertFile(database, { id: "file-b", ownerUid: "owner-b", memberId: "member-b", title: "Insurance", expiresAt: "2026-08-21" });
  await enqueueTradeTeamDocumentExpiryWarnings({ db, now });
  assert.deepEqual((await listTradeTeamDocumentExpiryWarnings(db, "owner-a")).map((row) => row.file_id), ["file-a"]);
  assert.deepEqual((await listTradeTeamDocumentExpiryWarnings(db, "owner-b")).map((row) => row.file_id), ["file-b"]);

  database.prepare("UPDATE trade_team_members SET status = 'suspended' WHERE id = 'member-a'").run();
  assert.deepEqual(await listTradeTeamDocumentExpiryWarnings(db, "owner-a"), []);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_document_expiry_warnings WHERE owner_uid = 'owner-a'").get().count, 1,
    "history remains retained when access is suspended");
  database.close();
});

test("reactivating staff with an upcoming expiry can enqueue the retained document", async () => {
  const { database, db } = fixture();
  const now = new Date("2026-08-13T00:00:00.000Z");
  database.prepare("UPDATE trade_team_members SET status = 'suspended' WHERE id = 'member-a'").run();
  insertFile(database, { id: "retained-file", ownerUid: "owner-a", memberId: "member-a", title: "Working at heights", expiresAt: "2026-08-20" });
  assert.equal((await enqueueTradeTeamDocumentExpiryWarnings({ db, now })).enqueued, 0);
  database.prepare("UPDATE trade_team_members SET status = 'active' WHERE id = 'member-a'").run();
  assert.equal((await enqueueTradeTeamDocumentExpiryWarnings({ db, now })).enqueued, 1);
  database.close();
});

test("email goes to the owning account once and retries with one provider idempotency key", async () => {
  const { database, db } = fixture();
  const start = new Date("2026-08-13T00:00:00.000Z");
  insertFile(database, { id: "email-file", ownerUid: "owner-a", memberId: "member-a", title: "Public liability insurance", expiresAt: "2026-08-20" });
  await enqueueTradeTeamDocumentExpiryWarnings({ db, now: start });
  const attempts = [];
  const failed = await drainTradeTeamDocumentExpiryEmails({
    db,
    emailConfigured: true,
    now: start,
    sendEmail: async (message) => {
      attempts.push(message);
      throw new Error("temporary provider failure");
    },
  });
  assert.equal(failed.failed, 1);
  assert.equal(attempts[0].recipient, "owner-a@example.com");
  assert.equal(attempts[0].messageType, "team_document_expiry");
  assert.match(attempts[0].subject, /Alex Field: Public liability insurance expires soon/);
  assert.match(attempts[0].body, /20 August 2026/);
  assert.equal(attempts[0].callbackUrl,
    "https://compare.ausenergyassessments.com/direct-trade/dashboard?workspace=team&teamMemberId=member-a");
  assert.match(attempts[0].body, /workspace=team&teamMemberId=member-a/);

  const beforeRetry = await drainTradeTeamDocumentExpiryEmails({
    db,
    emailConfigured: true,
    now: new Date("2026-08-13T00:04:59.000Z"),
    sendEmail: async () => assert.fail("retry must respect next_attempt_at"),
  });
  assert.equal(beforeRetry.attempted, 0);
  const sent = await drainTradeTeamDocumentExpiryEmails({
    db,
    emailConfigured: true,
    now: new Date("2026-08-13T00:05:00.000Z"),
    sendEmail: async (message) => {
      attempts.push(message);
      return { provider: "resend", providerMessageId: "message-1", providerStatus: "sent" };
    },
  });
  assert.equal(sent.sent, 1);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].idempotencyKey, attempts[1].idempotencyKey);
  const replay = await drainTradeTeamDocumentExpiryEmails({
    db,
    emailConfigured: true,
    now: new Date("2026-08-14T00:00:00.000Z"),
    sendEmail: async () => assert.fail("sent warning must not send again"),
  });
  assert.equal(replay.attempted, 0);
  assert.equal(database.prepare("SELECT email_status FROM trade_team_document_expiry_warnings").get().email_status, "sent");
  database.close();
});

test("suspending staff after enqueue retains and defers the warning until reactivation", async () => {
  const { database, db } = fixture();
  const now = new Date("2026-08-13T00:00:00.000Z");
  insertFile(database, { id: "former-worker-file", ownerUid: "owner-a", memberId: "member-a", title: "Registration", expiresAt: "2026-08-20" });
  await enqueueTradeTeamDocumentExpiryWarnings({ db, now });
  database.prepare("UPDATE trade_team_members SET status = 'suspended' WHERE id = 'member-a'").run();
  let sent = 0;
  const outcome = await drainTradeTeamDocumentExpiryEmails({
    db,
    emailConfigured: true,
    now,
    sendEmail: async () => assert.fail("former staff must not trigger email"),
  });
  assert.equal(outcome.deferred, 1);
  assert.equal(database.prepare("SELECT email_status FROM trade_team_document_expiry_warnings").get().email_status, "failed");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM trade_team_document_expiry_warnings").get().count, 1);
  database.prepare("UPDATE trade_team_members SET status = 'active' WHERE id = 'member-a'").run();
  const resumed = await drainTradeTeamDocumentExpiryEmails({
    db,
    emailConfigured: true,
    now: new Date("2026-08-13T12:00:00.000Z"),
    sendEmail: async () => {
      sent += 1;
      return { provider: "resend", providerMessageId: "message-reactivated", providerStatus: "sent" };
    },
  });
  assert.equal(resumed.sent, 1);
  assert.equal(sent, 1);
  database.close();
});

test("changing expiry creates a new revision while the old revision cannot deliver", async () => {
  const { database, db } = fixture();
  const now = new Date("2026-08-13T00:00:00.000Z");
  insertFile(database, { id: "renewed-file", ownerUid: "owner-a", memberId: "member-a", title: "Insurance", expiresAt: "2026-08-20" });
  await enqueueTradeTeamDocumentExpiryWarnings({ db, now });
  database.prepare("UPDATE trade_team_member_files SET expires_at = '2026-09-01' WHERE id = 'renewed-file'").run();
  await enqueueTradeTeamDocumentExpiryWarnings({ db, now });
  const sent = [];
  const outcome = await drainTradeTeamDocumentExpiryEmails({
    db,
    emailConfigured: true,
    now,
    sendEmail: async (message) => {
      sent.push(message);
      return { provider: "resend", providerMessageId: "message-new", providerStatus: "sent" };
    },
  });
  assert.equal(outcome.sent, 1);
  assert.equal(outcome.skipped, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /1 September 2026/);
  assert.deepEqual(database.prepare(`SELECT expires_at, email_status FROM trade_team_document_expiry_warnings
    ORDER BY expires_at`).all().map((row) => ({ ...row })), [
    { expires_at: "2026-08-20", email_status: "skipped" },
    { expires_at: "2026-09-01", email_status: "sent" },
  ]);
  database.close();
});

test("the minute worker drains durable warnings and the owner or team manager drawer projects them once", () => {
  assert.match(worker, /enqueueTradeTeamDocumentExpiryWarnings\(\{ db: getD1\(\) \}\)/);
  assert.match(worker, /drainTradeTeamDocumentExpiryEmails/);
  assert.match(worker, /serviceReminderProviderConfiguration\(\)\.email/);
  assert.match(worker, /sendServiceReminderProviderMessage/);
  assert.match(notificationsRoute, /access\.isOwner \|\| access\.canManageTeam/);
  assert.match(notificationsRoute, /listTradeTeamDocumentExpiryWarnings\(db, access\.ownerUid\)/);
  assert.match(notificationsRoute, /team-document-expiry:/);
  assert.match(notificationsRoute, /readKeys\.has\(item\.id\)/);
  assert.match(notificationsRoute, /INSERT OR IGNORE INTO trade_job_notification_reads/);
  assert.match(notificationsRoute, /current\.items\.some\(\(item\) => item\.id === notificationKey\)/);
  assert.match(notificationsDrawer, /item\.targetKind === "team"/);
  assert.match(notificationsDrawer, /workspace: "team"/);
  assert.match(notificationsDrawer, /item\.source === "team" \? "Team"/);
  assert.match(dashboard, /parameters\.get\("teamMemberId"\)/);
  assert.match(dashboard, /<TradeTeamSettings user=\{user\} navigationTarget=\{commandTarget\}/);
  assert.match(teamSettings, /navigationTarget\.id/);
  assert.match(worker, /Team document expiry notification failed/);
});
