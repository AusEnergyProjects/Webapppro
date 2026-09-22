import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { myobSecurityEventStatement, writeMyobSecurityEvent } from "../src/lib/myob-security-audit.ts";

const migration = readFileSync(new URL("../drizzle/0186_myob_security_events.sql", import.meta.url), "utf8");
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE trade_crm_oauth_states(id TEXT)");
  const parts = migration.split("--> statement-breakpoint");
  sqlite.exec(parts.shift());
  // Existing retained data precedes deployment of the guard, as on a migration.
  sqlite.exec(`INSERT INTO myob_security_events(id,actor_uid,owner_uid,action,outcome,created_at)
    VALUES ('old','actor','owner','accounting.read','success',strftime('%Y-%m-%dT%H:%M:%fZ','now','-366 days'))`);
  for (const part of parts) sqlite.exec(part);
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  });
  return { sqlite, db: { prepare: statement } };
}
const event = { actorUid: "actor", ownerUid: "owner", action: "invoice.export", resourceId: "invoice-1", outcome: "attempt" };

test("MYOB events contain fixed identifiers and outcomes, with a database timestamp", async () => {
  const { sqlite, db } = fixture();
  await writeMyobSecurityEvent(db, { ...event, token: "DO_NOT_STORE", customerEmail: "private@example.test" });
  const row = sqlite.prepare("SELECT * FROM myob_security_events WHERE id <> 'old'").get();
  assert.deepEqual(Object.keys(row), ["id", "actor_uid", "owner_uid", "action", "resource_id", "outcome", "created_at"]);
  assert.equal(row.owner_uid, "owner");
  assert.equal(row.action, "invoice.export");
  assert.ok(Math.abs(Date.now() - Date.parse(row.created_at)) < 5000);
  assert.doesNotMatch(JSON.stringify(row), /DO_NOT_STORE|private@example/);
  sqlite.close();
});

test("MYOB event updates and deletion within a year are blocked by SQLite", async () => {
  const { sqlite, db } = fixture();
  await writeMyobSecurityEvent(db, event);
  assert.throws(() => sqlite.exec("UPDATE myob_security_events SET outcome='success'"), /IMMUTABLE/);
  assert.throws(() => sqlite.exec("DELETE FROM myob_security_events WHERE id <> 'old'"), /RETENTION/);
  assert.equal(sqlite.prepare("DELETE FROM myob_security_events WHERE id='old'").run().changes, 1);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM myob_security_events").get().n, 1);
  sqlite.close();
});

test("backdating cannot bypass the retention guard", () => {
  const { sqlite } = fixture();
  assert.throws(() => sqlite.exec(`INSERT INTO myob_security_events(id,actor_uid,owner_uid,action,outcome,created_at)
    VALUES ('backdated','actor','owner','invoice.export','success','2020-01-01T00:00:00.000Z')`), /TIMESTAMP/);
  sqlite.close();
});

test("unstructured actions and private data disguised as identifiers are rejected", () => {
  const { sqlite, db } = fixture();
  assert.throws(() => myobSecurityEventStatement(db, { ...event, action: "Customer owes $100" }), /INVALID_SECURITY_EVENT/);
  assert.throws(() => myobSecurityEventStatement(db, { ...event, resourceId: "private@example.test" }), /IDENTIFIER/);
  assert.throws(() => myobSecurityEventStatement(db, { ...event, outcome: "unrecognised" }), /INVALID_SECURITY_EVENT/);
  sqlite.close();
});

test("an audit storage failure rejects the caller", async () => {
  const broken = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("unavailable"); } }) }) };
  await assert.rejects(writeMyobSecurityEvent(broken, event), /unavailable/);
});

test("conditional success records require the preceding mutation to change exactly one row", async () => {
  const { sqlite, db } = fixture();
  sqlite.exec("CREATE TABLE mutation(id TEXT PRIMARY KEY); INSERT INTO mutation VALUES ('record')");
  sqlite.exec("DELETE FROM mutation WHERE id='missing'");
  await myobSecurityEventStatement(db, { ...event, outcome: "success" }, true).run();
  assert.equal(sqlite.prepare("SELECT count(*) n FROM myob_security_events WHERE id <> 'old'").get().n, 0);
  sqlite.exec("DELETE FROM mutation WHERE id='record'");
  await myobSecurityEventStatement(db, { ...event, outcome: "success" }, true).run();
  assert.equal(sqlite.prepare("SELECT count(*) n FROM myob_security_events WHERE id <> 'old'").get().n, 1);
  sqlite.close();
});
