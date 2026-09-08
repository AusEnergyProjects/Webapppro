import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
function apply(db, sql) {
  for (const statement of sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean)) db.exec(statement);
}

test("SRES credential migration preserves existing credentials and accepts only governed credential uses", async () => {
  const [base, roster, permissions, titles, rental, sres, schema] = await Promise.all([
    read("../drizzle/0025_dizzy_spot.sql"),
    read("../drizzle/0070_frictionless_team_roster.sql"),
    read("../drizzle/0131_trade_team_permissions_and_member_files.sql"),
    read("../drizzle/0134_team_member_documents_and_colours.sql"),
    read("../drizzle/0160_trade_rental_inspections.sql"),
    read("../drizzle/0172_trade_team_sres_credentials.sql"),
    read("../db/schema.ts"),
  ]);
  assert.match(schema, /credentialType\} IN \('licence', 'registration', 'training', 'accreditation'/);
  assert.match(schema, /'sres_installer_accreditation', 'sres_designer_accreditation'/);
  assert.match(schema, /sres_national_check/);
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE trade_work_orders (id text PRIMARY KEY NOT NULL)");
  apply(db, base); apply(db, roster); apply(db, permissions); apply(db, titles); apply(db, rental);
  const now = "2026-09-08T00:00:00.000Z";
  db.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, email, display_name, role, status, invited_at, created_at, updated_at)
    VALUES ('worker', 'owner', 'worker@example.com', 'Worker', 'technician', 'active', ?, ?, ?)`)
    .run(now, now, now);
  db.prepare(`INSERT INTO trade_team_member_credentials
    (id, owner_uid, team_member_id, credential_type, name, credential_number, issuer, jurisdiction,
      expires_at, status, file_id, created_at, updated_at, rental_gate)
    VALUES ('existing', 'owner', 'worker', 'licence', 'Electrical licence', 'A123', 'Energy Safe Victoria',
      'VIC', '2099-01-01', 'active', 'file-existing', ?, ?, 'licensed_electrician')`)
    .run(now, now);

  apply(db, sres);
  assert.deepEqual({ ...db.prepare(`SELECT credential_type, credential_number, rental_gate
    FROM trade_team_member_credentials WHERE id='existing'`).get() }, {
    credential_type: "licence", credential_number: "A123", rental_gate: "licensed_electrician",
  });
  const insert = db.prepare(`INSERT INTO trade_team_member_credentials
    (id, owner_uid, team_member_id, credential_type, name, credential_number, issuer, jurisdiction,
      expires_at, status, file_id, created_at, updated_at, rental_gate)
    VALUES (?, 'owner', 'worker', 'accreditation', ?, ?, 'Solar Accreditation Australia', 'NATIONAL',
      '2099-01-01', 'active', ?, ?, ?, ?)`);
  insert.run("installer", "Grid-connected installer", "SAA-I-1", "file-installer", now, now, "sres_installer_accreditation");
  insert.run("designer", "Grid-connected designer", "SAA-D-1", "file-designer", now, now, "sres_designer_accreditation");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM trade_team_member_credentials WHERE credential_type='accreditation'").get().count, 2);
  for (const [id, credentialType, jurisdiction] of [
    ["state-sres", "accreditation", "VIC"],
    ["wrong-type-sres", "licence", "NATIONAL"],
  ]) assert.throws(() => db.prepare(`INSERT INTO trade_team_member_credentials
    (id, owner_uid, team_member_id, credential_type, name, jurisdiction, created_at, updated_at, rental_gate)
    VALUES (?, 'owner', 'worker', ?, 'Invalid SRES credential', ?, ?, ?, 'sres_installer_accreditation')`)
    .run(id, credentialType, jurisdiction, now, now), /CHECK constraint failed/);
  assert.throws(() => insert.run("unknown", "Unknown", "X", "file-unknown", now, now, "sres_unknown_accreditation"), /CHECK constraint failed/);
  assert.throws(() => db.prepare(`INSERT INTO trade_team_member_credentials
    (id, owner_uid, team_member_id, credential_type, name, created_at, updated_at)
    VALUES ('bad-type', 'owner', 'worker', 'certificate', 'Unknown', ?, ?)`)
    .run(now, now), /CHECK constraint failed/);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  db.close();
});
