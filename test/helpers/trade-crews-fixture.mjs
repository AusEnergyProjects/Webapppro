/** Empty crew dependencies for pre-existing, explicitly non-crew SQL fixtures.
 * Crew migration/constraint behaviour is exercised with the real migration in trade-crews.test.mjs.
 */
export function installEmptyTradeCrews(database) {
  database.exec(`CREATE TABLE trade_crews(id TEXT PRIMARY KEY,owner_uid TEXT,name TEXT,company_name TEXT,lead_member_id TEXT,revision INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE trade_crew_members(owner_uid TEXT,crew_id TEXT,member_id TEXT,created_at TEXT);`);
}
