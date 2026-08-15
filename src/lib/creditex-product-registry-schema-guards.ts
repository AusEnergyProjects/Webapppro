// Product-registry guards are installed through D1 prepared statements.
// Sites migrations split SQL on semicolons, so trigger bodies cannot live in
// the migration files themselves.

export const CREDITEX_SRES_PRODUCT_REGISTRY_SCHEMA_GUARDS = [
  { name: "compliance_product_registry_snapshots_staging_insert", sql: "CREATE TRIGGER `compliance_product_registry_snapshots_staging_insert` BEFORE INSERT ON `compliance_product_registry_snapshots` WHEN NEW.`status` <> 'staging' BEGIN SELECT RAISE(ABORT, 'Product registry snapshots must be created in staging'); END;" },
  { name: "compliance_product_registry_snapshots_content_immutable", sql: "CREATE TRIGGER `compliance_product_registry_snapshots_content_immutable` BEFORE UPDATE ON `compliance_product_registry_snapshots` WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`registry_code` IS NOT OLD.`registry_code` OR NEW.`contract` IS NOT OLD.`contract` OR NEW.`source_manifest_json` IS NOT OLD.`source_manifest_json` OR NEW.`source_sha256` IS NOT OLD.`source_sha256` OR NEW.`record_count` IS NOT OLD.`record_count` OR NEW.`created_at` IS NOT OLD.`created_at` BEGIN SELECT RAISE(ABORT, 'Product registry snapshot content is immutable'); END;" },
  { name: "compliance_product_registry_snapshots_transition_guard", sql: "CREATE TRIGGER `compliance_product_registry_snapshots_transition_guard` BEFORE UPDATE ON `compliance_product_registry_snapshots` WHEN NOT ( ( OLD.`status` = 'staging' AND NEW.`status` = 'current' AND OLD.`activated_at` IS NULL AND OLD.`activated_on` IS NULL AND NEW.`activated_at` IS NOT NULL AND NEW.`activated_on` IS NOT NULL AND NEW.`superseded_at` IS NULL AND NEW.`superseded_on` IS NULL ) OR ( OLD.`status` = 'current' AND NEW.`status` = 'superseded' AND NEW.`activated_at` IS OLD.`activated_at` AND NEW.`activated_on` IS OLD.`activated_on` AND OLD.`superseded_at` IS NULL AND OLD.`superseded_on` IS NULL AND NEW.`superseded_at` IS NOT NULL AND NEW.`superseded_on` IS NOT NULL ) ) BEGIN SELECT RAISE(ABORT, 'Invalid product registry snapshot transition'); END;" },
  { name: "compliance_product_registry_snapshots_activation_guard", sql: "CREATE TRIGGER `compliance_product_registry_snapshots_activation_guard` BEFORE UPDATE OF `status` ON `compliance_product_registry_snapshots` WHEN NEW.`status` = 'current' AND ( (SELECT count(*) FROM `compliance_product_registry_products` WHERE `snapshot_id` = OLD.`id`) <> OLD.`record_count` OR (SELECT count(*) FROM `compliance_product_registry_source_artifacts` WHERE `snapshot_id` = OLD.`id`) <> 5 OR (SELECT coalesce(sum(`record_count`), 0) FROM `compliance_product_registry_source_artifacts` WHERE `snapshot_id` = OLD.`id`) <> OLD.`record_count` OR EXISTS ( SELECT 1 FROM `compliance_product_registry_source_artifacts` artifact WHERE artifact.`snapshot_id` = OLD.`id` AND artifact.`record_count` <> ( SELECT count(*) FROM `compliance_product_registry_products` product WHERE product.`snapshot_id` = OLD.`id` AND product.`source_record_key` GLOB artifact.`source_key` || ':*' ) ) ) BEGIN SELECT RAISE(ABORT, 'Product registry snapshot counts do not reconcile'); END;" },
  { name: "compliance_product_registry_snapshots_delete_guard", sql: "CREATE TRIGGER `compliance_product_registry_snapshots_delete_guard` BEFORE DELETE ON `compliance_product_registry_snapshots` WHEN OLD.`status` <> 'staging' BEGIN SELECT RAISE(ABORT, 'Activated product registry snapshots are immutable'); END;" },
  { name: "compliance_product_registry_products_staging_insert", sql: "CREATE TRIGGER `compliance_product_registry_products_staging_insert` BEFORE INSERT ON `compliance_product_registry_products` WHEN NOT EXISTS ( SELECT 1 FROM `compliance_product_registry_snapshots` WHERE `id` = NEW.`snapshot_id` AND `status` = 'staging' ) BEGIN SELECT RAISE(ABORT, 'Product rows may only be added to a staging snapshot'); END;" },
  { name: "compliance_product_registry_products_no_update", sql: "CREATE TRIGGER `compliance_product_registry_products_no_update` BEFORE UPDATE ON `compliance_product_registry_products` BEGIN SELECT RAISE(ABORT, 'Product registry rows are immutable'); END;" },
  { name: "compliance_product_registry_products_delete_guard", sql: "CREATE TRIGGER `compliance_product_registry_products_delete_guard` BEFORE DELETE ON `compliance_product_registry_products` WHEN EXISTS ( SELECT 1 FROM `compliance_product_registry_snapshots` WHERE `id` = OLD.`snapshot_id` AND `status` NOT IN ('staging', 'superseded') ) BEGIN SELECT RAISE(ABORT, 'Current product registry rows are immutable'); END;" },
  { name: "compliance_product_registry_source_artifacts_staging_insert", sql: "CREATE TRIGGER `compliance_product_registry_source_artifacts_staging_insert` BEFORE INSERT ON `compliance_product_registry_source_artifacts` WHEN NOT EXISTS ( SELECT 1 FROM `compliance_product_registry_snapshots` WHERE `id` = NEW.`snapshot_id` AND `status` = 'staging' ) BEGIN SELECT RAISE(ABORT, 'Source artifacts may only be added to a staging snapshot'); END;" },
  { name: "compliance_product_registry_source_artifacts_no_update", sql: "CREATE TRIGGER `compliance_product_registry_source_artifacts_no_update` BEFORE UPDATE ON `compliance_product_registry_source_artifacts` BEGIN SELECT RAISE(ABORT, 'Product registry source artifacts are immutable'); END;" },
  { name: "compliance_product_registry_source_artifacts_delete_guard", sql: "CREATE TRIGGER `compliance_product_registry_source_artifacts_delete_guard` BEFORE DELETE ON `compliance_product_registry_source_artifacts` WHEN EXISTS ( SELECT 1 FROM `compliance_product_registry_snapshots` WHERE `id` = OLD.`snapshot_id` AND `status` <> 'staging' ) BEGIN SELECT RAISE(ABORT, 'Activated product registry source artifacts are immutable'); END;" },
  { name: "compliance_product_registry_sync_runs_snapshot_guard", sql: "CREATE TRIGGER `compliance_product_registry_sync_runs_snapshot_guard` BEFORE INSERT ON `compliance_product_registry_sync_runs` WHEN NEW.`status` IN ('success', 'unchanged') AND NOT EXISTS ( SELECT 1 FROM `compliance_product_registry_snapshots` snapshot WHERE snapshot.`id` = NEW.`snapshot_id` AND snapshot.`registry_code` = NEW.`registry_code` AND snapshot.`source_manifest_json` = NEW.`source_manifest_json` AND snapshot.`source_sha256` = NEW.`source_sha256` AND snapshot.`record_count` = NEW.`record_count` AND snapshot.`status` = 'current' ) BEGIN SELECT RAISE(ABORT, 'Successful registry sync must identify the current snapshot'); END;" },
  { name: "compliance_product_registry_sync_runs_update_guard", sql: "CREATE TRIGGER `compliance_product_registry_sync_runs_update_guard` BEFORE UPDATE ON `compliance_product_registry_sync_runs` WHEN NOT ( OLD.`status` = 'failed' AND OLD.`snapshot_id` IS NOT NULL AND NEW.`snapshot_id` IS NULL AND NEW.`id` IS OLD.`id` AND NEW.`registry_code` IS OLD.`registry_code` AND NEW.`status` IS OLD.`status` AND NEW.`source_manifest_json` IS OLD.`source_manifest_json` AND NEW.`source_sha256` IS OLD.`source_sha256` AND NEW.`record_count` IS OLD.`record_count` AND NEW.`checked_at` IS OLD.`checked_at` AND NEW.`message` IS OLD.`message` ) BEGIN SELECT RAISE(ABORT, 'Product registry sync runs are append-only'); END;" },
  { name: "compliance_product_registry_sync_runs_no_delete", sql: "CREATE TRIGGER `compliance_product_registry_sync_runs_no_delete` BEFORE DELETE ON `compliance_product_registry_sync_runs` BEGIN SELECT RAISE(ABORT, 'Product registry sync runs are append-only'); END;" },
] as const;

export const CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS = [
  { name: "compliance_official_product_snapshots_staging_insert", sql: "CREATE TRIGGER `compliance_official_product_snapshots_staging_insert` BEFORE INSERT ON `compliance_official_product_snapshots` WHEN NEW.`status` <> 'staging' BEGIN SELECT RAISE(ABORT, 'Official product snapshots must be created in staging'); END;" },
  { name: "compliance_official_product_snapshots_content_immutable", sql: "CREATE TRIGGER `compliance_official_product_snapshots_content_immutable` BEFORE UPDATE ON `compliance_official_product_snapshots` WHEN NEW.`id` IS NOT OLD.`id` OR NEW.`registry_code` IS NOT OLD.`registry_code` OR NEW.`contract` IS NOT OLD.`contract` OR NEW.`source_manifest_json` IS NOT OLD.`source_manifest_json` OR NEW.`source_sha256` IS NOT OLD.`source_sha256` OR NEW.`source_count` IS NOT OLD.`source_count` OR NEW.`record_count` IS NOT OLD.`record_count` OR NEW.`created_at` IS NOT OLD.`created_at` BEGIN SELECT RAISE(ABORT, 'Official product snapshot content is immutable'); END;" },
  { name: "compliance_official_product_snapshots_transition_guard", sql: "CREATE TRIGGER `compliance_official_product_snapshots_transition_guard` BEFORE UPDATE ON `compliance_official_product_snapshots` WHEN NOT ( (OLD.`status` = 'staging' AND NEW.`status` = 'current' AND OLD.`activated_at` IS NULL AND OLD.`activated_on` IS NULL AND NEW.`activated_at` IS NOT NULL AND NEW.`activated_on` IS NOT NULL AND NEW.`superseded_at` IS NULL AND NEW.`superseded_on` IS NULL) OR (OLD.`status` = 'current' AND NEW.`status` = 'superseded' AND NEW.`activated_at` IS OLD.`activated_at` AND NEW.`activated_on` IS OLD.`activated_on` AND OLD.`superseded_at` IS NULL AND OLD.`superseded_on` IS NULL AND NEW.`superseded_at` IS NOT NULL AND NEW.`superseded_on` IS NOT NULL) ) BEGIN SELECT RAISE(ABORT, 'Invalid official product snapshot transition'); END;" },
  { name: "compliance_official_product_snapshots_activation_guard", sql: "CREATE TRIGGER `compliance_official_product_snapshots_activation_guard` BEFORE UPDATE OF `status` ON `compliance_official_product_snapshots` WHEN NEW.`status` = 'current' AND ( (SELECT count(*) FROM `compliance_official_products` WHERE `snapshot_id` = OLD.`id`) <> OLD.`record_count` OR (SELECT count(*) FROM `compliance_official_product_artifacts` WHERE `snapshot_id` = OLD.`id`) <> OLD.`source_count` OR (SELECT coalesce(sum(`record_count`), 0) FROM `compliance_official_product_artifacts` WHERE `snapshot_id` = OLD.`id`) <> OLD.`record_count` OR EXISTS ( SELECT 1 FROM `compliance_official_product_artifacts` artifact WHERE artifact.`snapshot_id` = OLD.`id` AND artifact.`record_count` <> ( SELECT count(*) FROM `compliance_official_products` product WHERE product.`snapshot_id` = OLD.`id` AND product.`source_key` = artifact.`source_key` ) ) ) BEGIN SELECT RAISE(ABORT, 'Official product snapshot counts do not reconcile'); END;" },
  { name: "compliance_official_product_snapshots_delete_guard", sql: "CREATE TRIGGER `compliance_official_product_snapshots_delete_guard` BEFORE DELETE ON `compliance_official_product_snapshots` WHEN OLD.`status` <> 'staging' BEGIN SELECT RAISE(ABORT, 'Activated official product snapshots are immutable'); END;" },
  { name: "compliance_official_products_staging_insert", sql: "CREATE TRIGGER `compliance_official_products_staging_insert` BEFORE INSERT ON `compliance_official_products` WHEN NOT EXISTS ( SELECT 1 FROM `compliance_official_product_snapshots` WHERE `id` = NEW.`snapshot_id` AND `status` = 'staging' ) BEGIN SELECT RAISE(ABORT, 'Official products may only be added to staging'); END;" },
  { name: "compliance_official_products_no_update", sql: "CREATE TRIGGER `compliance_official_products_no_update` BEFORE UPDATE ON `compliance_official_products` BEGIN SELECT RAISE(ABORT, 'Official product rows are immutable'); END;" },
  { name: "compliance_official_products_delete_guard", sql: "CREATE TRIGGER `compliance_official_products_delete_guard` BEFORE DELETE ON `compliance_official_products` WHEN EXISTS ( SELECT 1 FROM `compliance_official_product_snapshots` WHERE `id` = OLD.`snapshot_id` AND `status` NOT IN ('staging', 'superseded') ) BEGIN SELECT RAISE(ABORT, 'Current official product rows are immutable'); END;" },
  { name: "compliance_official_product_artifacts_staging_insert", sql: "CREATE TRIGGER `compliance_official_product_artifacts_staging_insert` BEFORE INSERT ON `compliance_official_product_artifacts` WHEN NOT EXISTS ( SELECT 1 FROM `compliance_official_product_snapshots` WHERE `id` = NEW.`snapshot_id` AND `status` = 'staging' ) BEGIN SELECT RAISE(ABORT, 'Official source artifacts may only be added to staging'); END;" },
  { name: "compliance_official_product_artifacts_no_update", sql: "CREATE TRIGGER `compliance_official_product_artifacts_no_update` BEFORE UPDATE ON `compliance_official_product_artifacts` BEGIN SELECT RAISE(ABORT, 'Official source artifacts are immutable'); END;" },
  { name: "compliance_official_product_artifacts_delete_guard", sql: "CREATE TRIGGER `compliance_official_product_artifacts_delete_guard` BEFORE DELETE ON `compliance_official_product_artifacts` WHEN EXISTS ( SELECT 1 FROM `compliance_official_product_snapshots` WHERE `id` = OLD.`snapshot_id` AND `status` <> 'staging' ) BEGIN SELECT RAISE(ABORT, 'Activated official source artifacts are immutable'); END;" },
  { name: "compliance_official_product_refresh_progress_insert_guard", sql: "CREATE TRIGGER `compliance_official_product_refresh_progress_insert_guard` BEFORE INSERT ON `compliance_official_product_refresh_progress` WHEN NEW.`revision` <> 1 OR NOT EXISTS ( SELECT 1 FROM `compliance_official_product_snapshots` snapshot JOIN `compliance_official_product_artifacts` artifact ON artifact.`snapshot_id` = snapshot.`id` AND artifact.`source_key` = NEW.`source_key` WHERE snapshot.`id` = NEW.`snapshot_id` AND snapshot.`registry_code` = NEW.`registry_code` AND snapshot.`status` = 'staging' AND NEW.`source_index` < snapshot.`source_count` AND NEW.`supplement_value_count` <= artifact.`record_count` AND NEW.`product_record_count` <= artifact.`record_count` ) OR NEW.`supplement_value_count` <> ( SELECT count(*) FROM `compliance_official_product_stream_values` WHERE `snapshot_id` = NEW.`snapshot_id` AND `source_key` = NEW.`source_key` ) OR NEW.`product_record_count` <> ( SELECT count(*) FROM `compliance_official_products` WHERE `snapshot_id` = NEW.`snapshot_id` AND `source_key` = NEW.`source_key` ) OR ( NEW.`product_record_count` > 0 AND NOT EXISTS ( SELECT 1 FROM `compliance_official_products` WHERE `snapshot_id` = NEW.`snapshot_id` AND `source_key` = NEW.`source_key` AND `source_record_key` = NEW.`last_product_record_key` ) ) OR ( NEW.`phase` = 'supplements' AND NEW.`product_record_count` <> 0 ) OR ( NEW.`phase` IN ('activate', 'cleanup') AND ( NEW.`source_index` + 1 <> ( SELECT `source_count` FROM `compliance_official_product_snapshots` WHERE `id` = NEW.`snapshot_id` ) OR NEW.`product_record_count` <> ( SELECT `record_count` FROM `compliance_official_product_artifacts` WHERE `snapshot_id` = NEW.`snapshot_id` AND `source_key` = NEW.`source_key` ) ) ) BEGIN SELECT RAISE(ABORT, 'Official product refresh progress must match staged source rows'); END;" },
  { name: "compliance_official_product_refresh_progress_parent_guard", sql: "CREATE TRIGGER `compliance_official_product_refresh_progress_parent_guard` BEFORE UPDATE ON `compliance_official_product_refresh_progress` WHEN NEW.`registry_code` IS NOT OLD.`registry_code` OR NEW.`snapshot_id` IS NOT OLD.`snapshot_id` OR NEW.`replay_contract` IS NOT OLD.`replay_contract` OR NEW.`created_at` IS NOT OLD.`created_at` OR NOT EXISTS ( SELECT 1 FROM `compliance_official_product_snapshots` snapshot JOIN `compliance_official_product_artifacts` artifact ON artifact.`snapshot_id` = snapshot.`id` AND artifact.`source_key` = NEW.`source_key` WHERE snapshot.`id` = NEW.`snapshot_id` AND snapshot.`registry_code` = NEW.`registry_code` AND snapshot.`status` = 'staging' AND NEW.`source_index` < snapshot.`source_count` AND NEW.`supplement_value_count` <= artifact.`record_count` AND NEW.`product_record_count` <= artifact.`record_count` ) OR NEW.`supplement_value_count` <> ( SELECT count(*) FROM `compliance_official_product_stream_values` WHERE `snapshot_id` = NEW.`snapshot_id` AND `source_key` = NEW.`source_key` ) OR NEW.`product_record_count` <> ( SELECT count(*) FROM `compliance_official_products` WHERE `snapshot_id` = NEW.`snapshot_id` AND `source_key` = NEW.`source_key` ) OR ( NEW.`product_record_count` > 0 AND NOT EXISTS ( SELECT 1 FROM `compliance_official_products` WHERE `snapshot_id` = NEW.`snapshot_id` AND `source_key` = NEW.`source_key` AND `source_record_key` = NEW.`last_product_record_key` ) ) OR ( NEW.`phase` = 'supplements' AND NEW.`product_record_count` <> 0 ) OR ( NEW.`phase` IN ('activate', 'cleanup') AND ( NEW.`source_index` + 1 <> ( SELECT `source_count` FROM `compliance_official_product_snapshots` WHERE `id` = NEW.`snapshot_id` ) OR NEW.`product_record_count` <> ( SELECT `record_count` FROM `compliance_official_product_artifacts` WHERE `snapshot_id` = NEW.`snapshot_id` AND `source_key` = NEW.`source_key` ) ) ) BEGIN SELECT RAISE(ABORT, 'Official product refresh progress lost its staged source'); END;" },
  { name: "compliance_official_product_refresh_progress_transition_guard", sql: "CREATE TRIGGER `compliance_official_product_refresh_progress_transition_guard` BEFORE UPDATE ON `compliance_official_product_refresh_progress` WHEN NEW.`revision` <> OLD.`revision` + 1 OR datetime(NEW.`updated_at`) < datetime(OLD.`updated_at`) OR OLD.`phase` = 'cleanup' OR NEW.`source_index` < OLD.`source_index` OR NEW.`source_index` > OLD.`source_index` + 1 OR ( NEW.`source_index` = OLD.`source_index` AND ( NEW.`source_key` IS NOT OLD.`source_key` OR NOT ( NEW.`phase` = OLD.`phase` OR (OLD.`phase` = 'supplements' AND NEW.`phase` = 'products') OR (OLD.`phase` = 'products' AND NEW.`phase` = 'activate') OR (OLD.`phase` = 'activate' AND NEW.`phase` = 'cleanup') ) OR NEW.`supplement_batch_count` < OLD.`supplement_batch_count` OR NEW.`supplement_value_count` < OLD.`supplement_value_count` OR NEW.`product_batch_count` < OLD.`product_batch_count` OR NEW.`product_record_count` < OLD.`product_record_count` OR ( OLD.`phase` <> 'supplements' AND ( NEW.`supplement_batch_count` <> OLD.`supplement_batch_count` OR NEW.`supplement_value_count` <> OLD.`supplement_value_count` ) ) OR ( OLD.`phase` <> 'products' AND ( NEW.`product_batch_count` <> OLD.`product_batch_count` OR NEW.`product_record_count` <> OLD.`product_record_count` OR NEW.`last_product_record_key` IS NOT OLD.`last_product_record_key` ) ) OR ( NEW.`product_record_count` = OLD.`product_record_count` AND NEW.`last_product_record_key` IS NOT OLD.`last_product_record_key` ) OR ( NEW.`product_record_count` > OLD.`product_record_count` AND NEW.`last_product_record_key` IS OLD.`last_product_record_key` ) ) ) OR ( NEW.`source_index` = OLD.`source_index` + 1 AND NOT ( OLD.`phase` = 'products' AND OLD.`product_record_count` = ( SELECT `record_count` FROM `compliance_official_product_artifacts` WHERE `snapshot_id` = OLD.`snapshot_id` AND `source_key` = OLD.`source_key` ) AND NEW.`phase` = 'supplements' AND NEW.`source_key` <> OLD.`source_key` AND NEW.`supplement_batch_count` = 0 AND NEW.`supplement_value_count` = 0 AND NEW.`product_batch_count` = 0 AND NEW.`product_record_count` = 0 AND NEW.`last_product_record_key` = '' ) ) BEGIN SELECT RAISE(ABORT, 'Official product refresh progress must advance monotonically'); END;" },
  { name: "compliance_official_product_source_acquisitions_transition_guard", sql: "CREATE TRIGGER `compliance_official_product_source_acquisitions_transition_guard` BEFORE UPDATE ON `compliance_official_product_source_acquisitions` WHEN NEW.`registry_code` IS NOT OLD.`registry_code` OR NEW.`acquisition_id` IS NOT OLD.`acquisition_id` OR NEW.`contract` IS NOT OLD.`contract` OR NEW.`definition_sha256` IS NOT OLD.`definition_sha256` OR NEW.`source_key` IS NOT OLD.`source_key` OR NEW.`source_refreshed_at` IS NOT OLD.`source_refreshed_at` OR NEW.`total_record_count` IS NOT OLD.`total_record_count` OR NEW.`status_control_json` IS NOT OLD.`status_control_json` OR NEW.`category_control_json` IS NOT OLD.`category_control_json` OR NEW.`supplemental_control_json` IS NOT OLD.`supplemental_control_json` OR NEW.`created_at` IS NOT OLD.`created_at` OR NEW.`revision` <> OLD.`revision` + 1 OR NEW.`response_count` < OLD.`response_count` OR NEW.`response_byte_length` < OLD.`response_byte_length` OR NEW.`assembly_record_count` < OLD.`assembly_record_count` OR NEW.`assembly_chunk_count` < OLD.`assembly_chunk_count` OR NEW.`assembly_byte_length` < OLD.`assembly_byte_length` OR datetime(NEW.`updated_at`) < datetime(OLD.`updated_at`) OR NOT (NEW.`phase` = OLD.`phase` OR (OLD.`phase` = 'pages' AND NEW.`phase` IN ('assemble', 'cleanup')) OR (OLD.`phase` = 'assemble' AND NEW.`phase` IN ('ready', 'cleanup')) OR (OLD.`phase` = 'ready' AND NEW.`phase` = 'cleanup')) OR NOT (NEW.`cleanup_disposition` = OLD.`cleanup_disposition` OR (OLD.`phase` = 'ready' AND NEW.`phase` = 'cleanup' AND OLD.`cleanup_disposition` = 'restart' AND NEW.`cleanup_disposition` = 'finish')) OR (OLD.`phase` <> 'pages' AND (NEW.`response_count` <> OLD.`response_count` OR NEW.`response_byte_length` <> OLD.`response_byte_length`)) OR (OLD.`phase` <> 'assemble' AND (NEW.`assembly_record_count` <> OLD.`assembly_record_count` OR NEW.`assembly_chunk_count` <> OLD.`assembly_chunk_count` OR NEW.`assembly_byte_length` <> OLD.`assembly_byte_length`)) BEGIN SELECT RAISE(ABORT, 'Official source acquisition must advance monotonically'); END;" },
  { name: "compliance_official_product_source_acquisition_streams_transition_guard", sql: "CREATE TRIGGER `compliance_official_product_source_acquisition_streams_transition_guard` BEFORE UPDATE ON `compliance_official_product_source_acquisition_streams` WHEN NEW.`acquisition_id` IS NOT OLD.`acquisition_id` OR NEW.`stream_index` IS NOT OLD.`stream_index` OR NEW.`stream_key` IS NOT OLD.`stream_key` OR NEW.`expected_record_count` IS NOT OLD.`expected_record_count` OR NEW.`revision` <> OLD.`revision` + 1 OR NEW.`page_count` <> OLD.`page_count` + 1 OR NEW.`record_count` <= OLD.`record_count` OR NEW.`last_record_id` IS OLD.`last_record_id` OR NEW.`terminal` < OLD.`terminal` OR datetime(NEW.`updated_at`) < datetime(OLD.`updated_at`) BEGIN SELECT RAISE(ABORT, 'Official source acquisition stream must advance monotonically'); END;" },
  { name: "compliance_official_product_source_acquisition_fragments_no_update", sql: "CREATE TRIGGER `compliance_official_product_source_acquisition_fragments_no_update` BEFORE UPDATE ON `compliance_official_product_source_acquisition_fragments` BEGIN SELECT RAISE(ABORT, 'Official source acquisition fragments are immutable'); END;" },
  { name: "compliance_official_product_sync_runs_snapshot_guard", sql: "CREATE TRIGGER `compliance_official_product_sync_runs_snapshot_guard` BEFORE INSERT ON `compliance_official_product_sync_runs` WHEN NEW.`status` IN ('success', 'unchanged') AND NOT EXISTS ( SELECT 1 FROM `compliance_official_product_snapshots` snapshot WHERE snapshot.`id` = NEW.`snapshot_id` AND snapshot.`registry_code` = NEW.`registry_code` AND snapshot.`source_manifest_json` = NEW.`source_manifest_json` AND snapshot.`source_sha256` = NEW.`source_sha256` AND snapshot.`record_count` = NEW.`record_count` AND snapshot.`status` = 'current' ) BEGIN SELECT RAISE(ABORT, 'Successful official product sync must identify current snapshot'); END;" },
  { name: "compliance_official_product_sync_runs_update_guard", sql: "CREATE TRIGGER `compliance_official_product_sync_runs_update_guard` BEFORE UPDATE ON `compliance_official_product_sync_runs` WHEN NOT ( OLD.`status` = 'failed' AND OLD.`snapshot_id` IS NOT NULL AND NEW.`snapshot_id` IS NULL AND NEW.`id` IS OLD.`id` AND NEW.`registry_code` IS OLD.`registry_code` AND NEW.`status` IS OLD.`status` AND NEW.`source_manifest_json` IS OLD.`source_manifest_json` AND NEW.`source_sha256` IS OLD.`source_sha256` AND NEW.`record_count` IS OLD.`record_count` AND NEW.`checked_at` IS OLD.`checked_at` AND NEW.`message` IS OLD.`message` ) BEGIN SELECT RAISE(ABORT, 'Official product sync runs are append-only'); END;" },
  { name: "compliance_official_product_sync_runs_no_delete", sql: "CREATE TRIGGER `compliance_official_product_sync_runs_no_delete` BEFORE DELETE ON `compliance_official_product_sync_runs` BEGIN SELECT RAISE(ABORT, 'Official product sync runs are append-only'); END;" },
] as const;

const ALL_PRODUCT_REGISTRY_SCHEMA_GUARDS = [
  ...CREDITEX_SRES_PRODUCT_REGISTRY_SCHEMA_GUARDS,
  ...CREDITEX_OFFICIAL_PRODUCT_REGISTRY_SCHEMA_GUARDS,
] as const;

const REQUIRED_PRODUCT_REGISTRY_TABLES = [
  "compliance_product_registry_snapshots",
  "compliance_product_registry_products",
  "compliance_product_registry_source_artifacts",
  "compliance_product_registry_sync_runs",
  "compliance_product_registry_sync_leases",
  "compliance_official_product_snapshots",
  "compliance_official_products",
  "compliance_official_product_artifacts",
  "compliance_official_product_sync_runs",
  "compliance_official_product_sync_leases",
  "compliance_official_product_refresh_requests",
  "compliance_official_product_stream_values",
  "compliance_official_product_refresh_progress",
  "compliance_official_product_source_acquisitions",
  "compliance_official_product_source_acquisition_streams",
  "compliance_official_product_source_acquisition_fragments",
] as const;

const readinessByDatabase = new WeakMap<object, Promise<void>>();

function canonicalTriggerSql(sql: string) {
  return sql
    .trim()
    .replace(
      /^CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?/i,
      "CREATE TRIGGER ",
    )
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ");
}

async function installProductRegistrySchemaGuards(database: D1Database) {
  const tableNames = REQUIRED_PRODUCT_REGISTRY_TABLES
    .map((name) => `'${name}'`)
    .join(", ");
  const tables = await database.prepare(
    `SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name IN (${tableNames})`,
  ).all<{ name: string }>();
  const installedTables = new Set(
    tables.results.map((row) => String(row.name)),
  );
  const missingTables = REQUIRED_PRODUCT_REGISTRY_TABLES.filter(
    (name) => !installedTables.has(name),
  );
  if (missingTables.length) {
    throw new Error(
      `CREDITEX_PRODUCT_REGISTRY_MIGRATIONS_REQUIRED:${missingTables.join(",")}`,
    );
  }

  const triggerRows = await database.prepare(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'",
  ).all<{ name: string; sql: string | null }>();
  const installed = new Map(
    triggerRows.results.map((row) => [
      String(row.name),
      String(row.sql || ""),
    ]),
  );
  const mismatched = ALL_PRODUCT_REGISTRY_SCHEMA_GUARDS.filter(
    (definition) => installed.has(definition.name)
      && canonicalTriggerSql(installed.get(definition.name) || "")
        !== canonicalTriggerSql(definition.sql),
  );
  if (mismatched.length) {
    throw new Error(
      `CREDITEX_PRODUCT_REGISTRY_SCHEMA_GUARD_MISMATCH:${mismatched
        .map((definition) => definition.name)
        .join(",")}`,
    );
  }

  const missing = ALL_PRODUCT_REGISTRY_SCHEMA_GUARDS.filter(
    (definition) => !installed.has(definition.name),
  );
  if (missing.length) {
    await database.batch(
      missing.map((definition) => database.prepare(
        definition.sql.replace(
          /^CREATE TRIGGER /,
          "CREATE TRIGGER IF NOT EXISTS ",
        ),
      )),
    );
  }

  const verifiedRows = await database.prepare(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'",
  ).all<{ name: string; sql: string | null }>();
  const verified = new Map(
    verifiedRows.results.map((row) => [
      String(row.name),
      String(row.sql || ""),
    ]),
  );
  const unavailable = ALL_PRODUCT_REGISTRY_SCHEMA_GUARDS.filter(
    (definition) => canonicalTriggerSql(verified.get(definition.name) || "")
      !== canonicalTriggerSql(definition.sql),
  );
  if (unavailable.length) {
    throw new Error(
      `CREDITEX_PRODUCT_REGISTRY_SCHEMA_GUARDS_UNAVAILABLE:${unavailable
        .map((definition) => definition.name)
        .join(",")}`,
    );
  }
}

export async function ensureCreditexProductRegistrySchemaGuards(
  database: D1Database,
) {
  const databaseKey = database as object;
  let readiness = readinessByDatabase.get(databaseKey);
  if (!readiness) {
    readiness = installProductRegistrySchemaGuards(database);
    readinessByDatabase.set(databaseKey, readiness);
  }
  try {
    await readiness;
  } catch (error) {
    readinessByDatabase.delete(databaseKey);
    throw error;
  }
}
