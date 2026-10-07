import { canonicalTlinkSchemaGuardSql } from "./tlink-schema-guards";

// Sites installs trigger bodies with complete prepared statements, not migrations.
export const PIESA_SCHEMA_GUARDS = [
  { name: "piesa_owner_job", sql: "CREATE TRIGGER IF NOT EXISTS piesa_owner_job BEFORE INSERT ON trade_veu_electrical_assessments WHEN NOT EXISTS(SELECT 1 FROM trade_work_orders WHERE id=NEW.work_order_id AND firebase_uid=NEW.owner_uid AND partner_type='installer' AND record_status='active') BEGIN SELECT RAISE(ABORT,'PIESA_JOB_SCOPE'); END;" },
  { name: "piesa_record_immutable", sql: "CREATE TRIGGER IF NOT EXISTS piesa_record_immutable BEFORE UPDATE ON trade_veu_electrical_assessments WHEN OLD.status='complete' OR NEW.id<>OLD.id OR NEW.owner_uid<>OLD.owner_uid OR NEW.work_order_id<>OLD.work_order_id OR NEW.revision<>OLD.revision+1 OR NEW.created_at<>OLD.created_at BEGIN SELECT RAISE(ABORT,'PIESA_IMMUTABLE'); END;" },
  { name: "piesa_record_retained", sql: "CREATE TRIGGER IF NOT EXISTS piesa_record_retained BEFORE DELETE ON trade_veu_electrical_assessments BEGIN SELECT RAISE(ABORT,'PIESA_RETAINED'); END;" },
  { name: "piesa_version_created", sql: "CREATE TRIGGER IF NOT EXISTS piesa_version_created AFTER INSERT ON trade_veu_electrical_assessments BEGIN INSERT INTO trade_veu_electrical_versions VALUES(NEW.id,NEW.revision,NEW.payload,NEW.payload_sha256,NEW.actor_uid,NEW.updated_at); END;" },
  { name: "piesa_version_changed", sql: "CREATE TRIGGER IF NOT EXISTS piesa_version_changed AFTER UPDATE ON trade_veu_electrical_assessments BEGIN INSERT INTO trade_veu_electrical_versions VALUES(NEW.id,NEW.revision,NEW.payload,NEW.payload_sha256,NEW.actor_uid,NEW.updated_at); END;" },
  { name: "piesa_version_immutable", sql: "CREATE TRIGGER IF NOT EXISTS piesa_version_immutable BEFORE UPDATE ON trade_veu_electrical_versions BEGIN SELECT RAISE(ABORT,'PIESA_RETAINED'); END;" },
  { name: "piesa_version_retained", sql: "CREATE TRIGGER IF NOT EXISTS piesa_version_retained BEFORE DELETE ON trade_veu_electrical_versions BEGIN SELECT RAISE(ABORT,'PIESA_RETAINED'); END;" },
  { name: "piesa_mutation_immutable", sql: "CREATE TRIGGER IF NOT EXISTS piesa_mutation_immutable BEFORE UPDATE ON trade_veu_electrical_mutations BEGIN SELECT RAISE(ABORT,'PIESA_RETAINED'); END;" },
  { name: "piesa_mutation_retained", sql: "CREATE TRIGGER IF NOT EXISTS piesa_mutation_retained BEFORE DELETE ON trade_veu_electrical_mutations BEGIN SELECT RAISE(ABORT,'PIESA_RETAINED'); END;" },
] as const;

const readiness = new WeakSet<object>();
export async function ensurePiesaSchemaGuards(db: D1Database) {
  if (!readiness.has(db)) {
      const existing = await db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'piesa_*'").all<{name:string;sql:string}>();
      const installed = new Map(existing.results.map(row => [row.name, row.sql]));
      for (const guard of PIESA_SCHEMA_GUARDS) if (installed.has(guard.name)
        && canonicalTlinkSchemaGuardSql(installed.get(guard.name) || "") !== canonicalTlinkSchemaGuardSql(guard.sql)) throw new Error("PIESA_SCHEMA_GUARD_MISMATCH");
      const missing = PIESA_SCHEMA_GUARDS.filter(guard => !installed.has(guard.name));
      if (missing.length) await db.batch(missing.map(guard => db.prepare(guard.sql)));
      const confirmed=await db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'piesa_*'").all<{name:string;sql:string}>();
      const verified=new Map(confirmed.results.map(row=>[row.name,row.sql]));
      for(const guard of PIESA_SCHEMA_GUARDS) if(canonicalTlinkSchemaGuardSql(verified.get(guard.name)||"")!==canonicalTlinkSchemaGuardSql(guard.sql)) throw new Error("PIESA_SCHEMA_GUARD_MISMATCH");
    readiness.add(db);
  }
}
