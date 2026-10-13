import { canonicalTlinkSchemaGuardSql } from "./tlink-schema-guards";

// Sites installs trigger bodies with complete prepared statements, not migrations.
export const SAFETY_CHECK_SCHEMA_GUARDS = [
  { name: "safety_check_owner_job", sql: "CREATE TRIGGER IF NOT EXISTS safety_check_owner_job BEFORE INSERT ON trade_safety_checks WHEN NOT EXISTS(SELECT 1 FROM trade_work_orders WHERE id=NEW.work_order_id AND firebase_uid=NEW.owner_uid AND partner_type='installer' AND record_status='active') BEGIN SELECT RAISE(ABORT,'SAFETY_CHECK_JOB_SCOPE'); END;" },
  { name: "safety_check_record_immutable", sql: "CREATE TRIGGER IF NOT EXISTS safety_check_record_immutable BEFORE UPDATE ON trade_safety_checks WHEN OLD.status='complete' OR NEW.id<>OLD.id OR NEW.owner_uid<>OLD.owner_uid OR NEW.work_order_id<>OLD.work_order_id OR NEW.kind<>OLD.kind OR NEW.revision<>OLD.revision+1 OR NEW.created_at<>OLD.created_at BEGIN SELECT RAISE(ABORT,'SAFETY_CHECK_IMMUTABLE'); END;" },
  { name: "safety_check_record_retained", sql: "CREATE TRIGGER IF NOT EXISTS safety_check_record_retained BEFORE DELETE ON trade_safety_checks BEGIN SELECT RAISE(ABORT,'SAFETY_CHECK_RETAINED'); END;" },
  { name: "safety_check_version_created", sql: "CREATE TRIGGER IF NOT EXISTS safety_check_version_created AFTER INSERT ON trade_safety_checks BEGIN INSERT INTO trade_safety_check_versions VALUES(NEW.id,NEW.revision,NEW.payload,NEW.payload_sha256,NEW.actor_uid,NEW.updated_at); END;" },
  { name: "safety_check_version_changed", sql: "CREATE TRIGGER IF NOT EXISTS safety_check_version_changed AFTER UPDATE ON trade_safety_checks BEGIN INSERT INTO trade_safety_check_versions VALUES(NEW.id,NEW.revision,NEW.payload,NEW.payload_sha256,NEW.actor_uid,NEW.updated_at); END;" },
  { name: "safety_check_version_immutable", sql: "CREATE TRIGGER IF NOT EXISTS safety_check_version_immutable BEFORE UPDATE ON trade_safety_check_versions BEGIN SELECT RAISE(ABORT,'SAFETY_CHECK_RETAINED'); END;" },
  { name: "safety_check_version_retained", sql: "CREATE TRIGGER IF NOT EXISTS safety_check_version_retained BEFORE DELETE ON trade_safety_check_versions BEGIN SELECT RAISE(ABORT,'SAFETY_CHECK_RETAINED'); END;" },
  { name: "safety_check_mutation_immutable", sql: "CREATE TRIGGER IF NOT EXISTS safety_check_mutation_immutable BEFORE UPDATE ON trade_safety_check_mutations BEGIN SELECT RAISE(ABORT,'SAFETY_CHECK_RETAINED'); END;" },
  { name: "safety_check_mutation_retained", sql: "CREATE TRIGGER IF NOT EXISTS safety_check_mutation_retained BEFORE DELETE ON trade_safety_check_mutations BEGIN SELECT RAISE(ABORT,'SAFETY_CHECK_RETAINED'); END;" },
] as const;

const readiness = new WeakSet<object>();
export async function ensureSafetyCheckSchemaGuards(db: D1Database) {
  if (!readiness.has(db)) {
      const existing = await db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'safety_check_*'").all<{name:string;sql:string}>();
      const installed = new Map(existing.results.map(row => [row.name, row.sql]));
      for (const guard of SAFETY_CHECK_SCHEMA_GUARDS) if (installed.has(guard.name)
        && canonicalTlinkSchemaGuardSql(installed.get(guard.name) || "") !== canonicalTlinkSchemaGuardSql(guard.sql)) throw new Error("SAFETY_CHECK_SCHEMA_GUARD_MISMATCH");
      const missing = SAFETY_CHECK_SCHEMA_GUARDS.filter(guard => !installed.has(guard.name));
      if (missing.length) await db.batch(missing.map(guard => db.prepare(guard.sql)));
      const confirmed=await db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'safety_check_*'").all<{name:string;sql:string}>();
      const verified=new Map(confirmed.results.map(row=>[row.name,row.sql]));
      for(const guard of SAFETY_CHECK_SCHEMA_GUARDS) if(canonicalTlinkSchemaGuardSql(verified.get(guard.name)||"")!==canonicalTlinkSchemaGuardSql(guard.sql)) throw new Error("SAFETY_CHECK_SCHEMA_GUARD_MISMATCH");
    readiness.add(db);
  }
}
