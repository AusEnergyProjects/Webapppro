import fs from "node:fs";

export function installFieldCorrectionFixture(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS creditex_job_lifecycle_events (
    id TEXT PRIMARY KEY, organisation_id TEXT, owner_uid TEXT, work_order_id TEXT, intent_id TEXT,
    action TEXT, source_snapshot TEXT, note TEXT, created_at TEXT);`);
  database.exec("BEGIN");
  try {
    database.exec(fs.readFileSync(new URL("../../drizzle/0194_trade_activity_field_corrections.sql", import.meta.url), "utf8"));
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
