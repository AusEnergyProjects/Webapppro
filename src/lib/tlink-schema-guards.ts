// Sites splits migration SQL on semicolons, so trigger bodies are installed
// through D1 prepared statements after their tables and columns exist.
type TlinkSchemaGuardDefinition = {
  readonly name: string;
  readonly sql: string;
};

export const TLINK_SCHEMA_GUARD_DEFINITIONS: readonly TlinkSchemaGuardDefinition[] = [
  { name: "trade_team_members_permissions_insert_guard", sql: "CREATE TRIGGER IF NOT EXISTS `trade_team_members_permissions_insert_guard` BEFORE INSERT ON `trade_team_members` BEGIN SELECT CASE WHEN NEW.can_create_jobs NOT IN (0, 1) OR NEW.can_manage_jobs NOT IN (0, 1) OR NEW.can_assign_jobs NOT IN (0, 1) OR NEW.can_view_customers NOT IN (0, 1) OR NEW.can_manage_customers NOT IN (0, 1) OR NEW.can_view_quotes NOT IN (0, 1) OR NEW.can_manage_quotes NOT IN (0, 1) OR NEW.can_send_quotes NOT IN (0, 1) OR NEW.can_view_invoices NOT IN (0, 1) OR NEW.can_manage_invoices NOT IN (0, 1) OR NEW.can_view_price_book NOT IN (0, 1) OR NEW.can_manage_price_book NOT IN (0, 1) OR NEW.can_apply_discounts NOT IN (0, 1) OR NEW.can_reschedule_jobs NOT IN (0, 1) OR NEW.can_manage_team NOT IN (0, 1) OR NEW.can_edit_team_permissions NOT IN (0, 1) OR NEW.can_view_field_evidence NOT IN (0, 1) OR NEW.can_manage_field_evidence NOT IN (0, 1) OR NEW.can_run_reports NOT IN (0, 1) OR NEW.can_search_customers NOT IN (0, 1) OR (NEW.can_manage_customers = 1 AND NEW.can_view_customers = 0) OR (NEW.can_manage_quotes = 1 AND NEW.can_view_quotes = 0) OR (NEW.can_send_quotes = 1 AND NEW.can_manage_quotes = 0) OR (NEW.can_manage_invoices = 1 AND NEW.can_view_invoices = 0) OR (NEW.can_manage_price_book = 1 AND NEW.can_view_price_book = 0) OR (NEW.can_manage_field_evidence = 1 AND NEW.can_view_field_evidence = 0) OR (NEW.can_edit_team_permissions = 1 AND NEW.can_manage_team = 0) THEN RAISE(ABORT, 'invalid team permissions') END; END;" },
  { name: "trade_team_members_permissions_update_guard", sql: "CREATE TRIGGER IF NOT EXISTS `trade_team_members_permissions_update_guard` BEFORE UPDATE OF can_create_jobs, can_manage_jobs, can_assign_jobs, can_view_customers, can_manage_customers, can_view_quotes, can_manage_quotes, can_send_quotes, can_view_invoices, can_manage_invoices, can_view_price_book, can_manage_price_book, can_apply_discounts, can_reschedule_jobs, can_manage_team, can_edit_team_permissions, can_view_field_evidence, can_manage_field_evidence, can_run_reports, can_search_customers ON `trade_team_members` BEGIN SELECT CASE WHEN NEW.can_create_jobs NOT IN (0, 1) OR NEW.can_manage_jobs NOT IN (0, 1) OR NEW.can_assign_jobs NOT IN (0, 1) OR NEW.can_view_customers NOT IN (0, 1) OR NEW.can_manage_customers NOT IN (0, 1) OR NEW.can_view_quotes NOT IN (0, 1) OR NEW.can_manage_quotes NOT IN (0, 1) OR NEW.can_send_quotes NOT IN (0, 1) OR NEW.can_view_invoices NOT IN (0, 1) OR NEW.can_manage_invoices NOT IN (0, 1) OR NEW.can_view_price_book NOT IN (0, 1) OR NEW.can_manage_price_book NOT IN (0, 1) OR NEW.can_apply_discounts NOT IN (0, 1) OR NEW.can_reschedule_jobs NOT IN (0, 1) OR NEW.can_manage_team NOT IN (0, 1) OR NEW.can_edit_team_permissions NOT IN (0, 1) OR NEW.can_view_field_evidence NOT IN (0, 1) OR NEW.can_manage_field_evidence NOT IN (0, 1) OR NEW.can_run_reports NOT IN (0, 1) OR NEW.can_search_customers NOT IN (0, 1) OR (NEW.can_manage_customers = 1 AND NEW.can_view_customers = 0) OR (NEW.can_manage_quotes = 1 AND NEW.can_view_quotes = 0) OR (NEW.can_send_quotes = 1 AND NEW.can_manage_quotes = 0) OR (NEW.can_manage_invoices = 1 AND NEW.can_view_invoices = 0) OR (NEW.can_manage_price_book = 1 AND NEW.can_view_price_book = 0) OR (NEW.can_manage_field_evidence = 1 AND NEW.can_view_field_evidence = 0) OR (NEW.can_edit_team_permissions = 1 AND NEW.can_manage_team = 0) THEN RAISE(ABORT, 'invalid team permissions') END; END;" },
  { name: "trade_crm_job_details_accepted_disclosure_insert_guard", sql: "CREATE TRIGGER IF NOT EXISTS `trade_crm_job_details_accepted_disclosure_insert_guard` BEFORE INSERT ON `trade_crm_job_details` FOR EACH ROW WHEN NEW.customer_source = 'public_lead_released' BEGIN SELECT CASE WHEN json_extract(NEW.accepted_disclosure_snapshot, '$.contract') IS NOT 'tlink-public-lead-accepted-disclosure-v1' OR NEW.accepted_disclosure_sha256 = '' OR NEW.accepted_disclosure_at = '' OR datetime(NEW.accepted_disclosure_at) IS NULL THEN RAISE(ABORT, 'accepted public lead disclosure required') END; END;" },
  { name: "trade_crm_job_details_accepted_disclosure_update_guard", sql: "CREATE TRIGGER IF NOT EXISTS `trade_crm_job_details_accepted_disclosure_update_guard` BEFORE UPDATE OF customer_source, accepted_disclosure_snapshot, accepted_disclosure_sha256, accepted_disclosure_at ON `trade_crm_job_details` FOR EACH ROW WHEN OLD.customer_source = 'public_lead_released' AND (NEW.customer_source IS NOT OLD.customer_source OR NEW.accepted_disclosure_snapshot IS NOT OLD.accepted_disclosure_snapshot OR NEW.accepted_disclosure_sha256 IS NOT OLD.accepted_disclosure_sha256 OR NEW.accepted_disclosure_at IS NOT OLD.accepted_disclosure_at) BEGIN SELECT RAISE(ABORT, 'accepted public lead disclosure is immutable'); END;" },
  { name: "trade_crm_job_media_accepted_lead_insert_guard", sql: "CREATE TRIGGER IF NOT EXISTS `trade_crm_job_media_accepted_lead_insert_guard` BEFORE INSERT ON `trade_crm_job_media` FOR EACH ROW WHEN NEW.source = 'accepted_public_lead' BEGIN SELECT CASE WHEN NEW.category <> 'before' OR NEW.photo_request_id <> '' OR NEW.photo_requirement_id <> '' OR NEW.request_revision <> 0 OR NEW.checklist_version <> '' OR NEW.customer_acknowledged_at = '' OR datetime(NEW.customer_acknowledged_at) IS NULL OR json_extract(NEW.evidence_envelope, '$.contract') IS NOT 'tlink-accepted-public-lead-job-file-v1' OR NEW.original_sha256 = '' OR NEW.accepted_disclosure_sha256 = '' OR NEW.accepted_lead_source_photo_id = '' OR NEW.accepted_lead_source_opportunity_id = '' OR NEW.accepted_lead_source_preparation_id = '' OR NEW.accepted_lead_source_release_id = '' OR NEW.accepted_lead_prompt_id = '' OR json_type(NEW.accepted_lead_service_categories) IS NOT 'array' OR json_array_length(NEW.accepted_lead_service_categories) = 0 OR NOT EXISTS ( SELECT 1 FROM public_trade_lead_quote_photos source_photo JOIN public_trade_lead_quote_preparations preparation ON preparation.id = NEW.accepted_lead_source_preparation_id AND preparation.opportunity_id = source_photo.opportunity_id AND preparation.status = 'active' AND preparation.withdrawn_at = '' AND datetime(preparation.granted_at) IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(preparation.photo_prompt_ids) WHERE CAST(value AS text) = source_photo.prompt_id) JOIN trade_opportunities opportunity ON opportunity.id = source_photo.opportunity_id AND opportunity.source_reference = preparation.source_reference AND opportunity.status = 'open' AND datetime(opportunity.expires_at) > datetime(NEW.created_at) JOIN trade_opportunity_matches opportunity_match ON opportunity_match.opportunity_id = opportunity.id AND opportunity_match.firebase_uid = NEW.firebase_uid AND opportunity_match.id = replace(NEW.work_order_id, 'public-lead-work-', '') AND opportunity_match.status = 'interested' AND opportunity_match.updated_at = NEW.created_at AND EXISTS (SELECT 1 FROM json_each(source_photo.service_categories) source_category JOIN json_each(opportunity_match.matched_categories) matched_category ON CAST(matched_category.value AS text) = CAST(source_category.value AS text)) JOIN public_trade_lead_contact_releases contact ON contact.id = NEW.accepted_lead_source_release_id AND contact.opportunity_id = opportunity.id AND contact.source_reference = opportunity.source_reference AND contact.status = 'active' AND contact.withdrawn_at = '' AND datetime(contact.granted_at) IS NOT NULL WHERE source_photo.id = NEW.accepted_lead_source_photo_id AND source_photo.opportunity_id = NEW.accepted_lead_source_opportunity_id AND source_photo.status = 'active' AND source_photo.prompt_id = NEW.accepted_lead_prompt_id AND source_photo.prompt_label = NEW.caption AND source_photo.content_type = NEW.content_type AND source_photo.size_bytes = NEW.size_bytes AND source_photo.sha256 = NEW.original_sha256 AND source_photo.privacy_status = 'metadata-stripped' AND EXISTS (SELECT 1 FROM json_each(source_photo.service_categories) source_category JOIN json_each(NEW.accepted_lead_service_categories) accepted_category ON CAST(accepted_category.value AS text) = CAST(source_category.value AS text)) ) THEN RAISE(ABORT, 'accepted public lead job file source is invalid') END; END;" },
  { name: "trade_crm_job_media_accepted_lead_update_guard", sql: "CREATE TRIGGER IF NOT EXISTS `trade_crm_job_media_accepted_lead_update_guard` BEFORE UPDATE ON `trade_crm_job_media` FOR EACH ROW WHEN OLD.source = 'accepted_public_lead' BEGIN SELECT RAISE(ABORT, 'accepted public lead job file is immutable'); END;" },
  { name: "trade_crm_job_media_accepted_lead_delete_guard", sql: "CREATE TRIGGER IF NOT EXISTS `trade_crm_job_media_accepted_lead_delete_guard` BEFORE DELETE ON `trade_crm_job_media` FOR EACH ROW WHEN OLD.source = 'accepted_public_lead' BEGIN SELECT RAISE(ABORT, 'accepted public lead job file is retained with job history'); END;" },
  { name: "trade_crm_job_details_accepted_job_file_manifest_guard", sql: "CREATE TRIGGER IF NOT EXISTS `trade_crm_job_details_accepted_job_file_manifest_guard` BEFORE INSERT ON `trade_crm_job_details` FOR EACH ROW WHEN NEW.customer_source = 'public_lead_released' BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM trade_work_orders work JOIN trade_opportunity_matches accepted_match ON accepted_match.id = work.source_reference AND accepted_match.firebase_uid = work.firebase_uid AND accepted_match.status = 'interested' AND accepted_match.updated_at = NEW.created_at WHERE work.id = NEW.work_order_id AND work.firebase_uid = NEW.firebase_uid AND work.source_type = 'public_lead' AND work.record_status = 'active') OR json_type(NEW.accepted_disclosure_snapshot, '$.photos') IS NOT 'array' OR json_array_length(NEW.accepted_disclosure_snapshot, '$.photos') <> (SELECT COUNT(*) FROM trade_crm_job_media media WHERE media.firebase_uid = NEW.firebase_uid AND media.work_order_id = NEW.work_order_id AND media.source = 'accepted_public_lead' AND media.accepted_disclosure_sha256 = NEW.accepted_disclosure_sha256) OR (SELECT COUNT(DISTINCT json_extract(manifest.value, '$.id')) FROM json_each(NEW.accepted_disclosure_snapshot, '$.photos') manifest) <> json_array_length(NEW.accepted_disclosure_snapshot, '$.photos') OR EXISTS (SELECT 1 FROM json_each(NEW.accepted_disclosure_snapshot, '$.photos') manifest WHERE NOT EXISTS (SELECT 1 FROM trade_crm_job_media media WHERE media.id = json_extract(manifest.value, '$.id') AND media.firebase_uid = NEW.firebase_uid AND media.work_order_id = NEW.work_order_id AND media.source = 'accepted_public_lead' AND media.accepted_disclosure_sha256 = NEW.accepted_disclosure_sha256 AND media.accepted_lead_source_photo_id = json_extract(manifest.value, '$.sourcePhotoId') AND media.accepted_lead_prompt_id = json_extract(manifest.value, '$.promptId') AND media.caption = json_extract(manifest.value, '$.label') AND media.content_type = json_extract(manifest.value, '$.contentType') AND media.size_bytes = json_extract(manifest.value, '$.sizeBytes') AND media.original_sha256 = json_extract(manifest.value, '$.sha256') AND json_extract(media.evidence_envelope, '$.privacyStatus') = json_extract(manifest.value, '$.privacyStatus'))) THEN RAISE(ABORT, 'accepted public lead job file manifest is incomplete') END; END;" },
  { name: "trade_crm_job_media_events_insert_guard", sql: "CREATE TRIGGER IF NOT EXISTS `trade_crm_job_media_events_insert_guard` BEFORE INSERT ON `trade_crm_job_media_events` FOR EACH ROW BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM trade_crm_job_media media WHERE media.id = NEW.job_media_id AND media.firebase_uid = NEW.firebase_uid AND media.work_order_id = NEW.work_order_id) OR NOT EXISTS (SELECT 1 FROM trade_team_members member WHERE member.id = NEW.actor_member_id AND member.owner_uid = NEW.firebase_uid AND member.member_uid = NEW.actor_uid AND member.status = 'active') THEN RAISE(ABORT, 'job file event scope is invalid') END; END;" },
];

const readinessByDatabase = new WeakMap<object, Promise<void>>();

const REQUIRED_COLUMNS = {
  trade_team_members: [
    "id", "owner_uid", "member_uid", "status", "can_create_jobs", "can_manage_jobs",
    "can_assign_jobs", "can_view_customers", "can_manage_customers", "can_view_quotes",
    "can_manage_quotes", "can_send_quotes", "can_view_invoices", "can_manage_invoices",
    "can_view_price_book", "can_manage_price_book", "can_apply_discounts",
    "can_reschedule_jobs", "can_manage_team", "can_edit_team_permissions",
    "can_view_field_evidence", "can_manage_field_evidence", "can_run_reports",
    "can_search_customers",
  ],
  trade_crm_job_details: [
    "work_order_id", "firebase_uid", "customer_source", "accepted_disclosure_snapshot",
    "accepted_disclosure_sha256", "accepted_disclosure_at", "created_at",
  ],
  trade_crm_job_media: [
    "id", "work_order_id", "firebase_uid", "category", "content_type", "size_bytes",
    "caption", "source", "photo_request_id", "photo_requirement_id", "request_revision",
    "checklist_version", "customer_acknowledged_at", "evidence_envelope", "original_sha256",
    "accepted_lead_source_photo_id", "accepted_lead_source_opportunity_id",
    "accepted_lead_source_preparation_id", "accepted_lead_source_release_id",
    "accepted_lead_prompt_id", "accepted_lead_service_categories",
    "accepted_disclosure_sha256", "created_at",
  ],
  trade_crm_job_media_events: [
    "job_media_id", "firebase_uid", "work_order_id", "actor_uid", "actor_member_id",
  ],
  trade_work_orders: ["id", "firebase_uid", "source_reference", "source_type", "record_status"],
  trade_opportunity_matches: [
    "id", "opportunity_id", "firebase_uid", "status", "matched_categories", "updated_at",
  ],
  trade_opportunities: ["id", "source_reference", "status", "expires_at"],
  public_trade_lead_quote_photos: [
    "id", "opportunity_id", "prompt_id", "prompt_label", "service_categories",
    "content_type", "size_bytes", "sha256", "privacy_status", "status",
  ],
  public_trade_lead_quote_preparations: [
    "id", "opportunity_id", "source_reference", "status", "withdrawn_at", "granted_at",
    "photo_prompt_ids",
  ],
  public_trade_lead_contact_releases: [
    "id", "opportunity_id", "source_reference", "status", "withdrawn_at", "granted_at",
  ],
} as const;

export function canonicalTlinkSchemaGuardSql(sql: string) {
  const normalised = sql.trim()
    .replace(/^CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, "CREATE TRIGGER ")
    .replace(/;\s*$/, "");
  let canonical = "";
  let quote = "";
  let pendingWhitespace = false;
  const punctuation = new Set(["(", ")", ","]);
  for (let index = 0; index < normalised.length; index += 1) {
    const character = normalised[index];
    if (quote) {
      canonical += character;
      if (character !== quote) continue;
      if (quote === "'" && normalised[index + 1] === "'") {
        canonical += normalised[index + 1];
        index += 1;
      } else {
        quote = "";
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      if (pendingWhitespace && canonical) canonical += " ";
      pendingWhitespace = false;
      quote = character;
      canonical += character;
      continue;
    }
    if (/\s/.test(character)) {
      pendingWhitespace = true;
      continue;
    }
    if (punctuation.has(character)) {
      canonical = canonical.trimEnd();
      pendingWhitespace = false;
      canonical += character;
      continue;
    }
    if (pendingWhitespace && canonical && !punctuation.has(canonical.at(-1) || "")) canonical += " ";
    pendingWhitespace = false;
    canonical += character;
  }
  return canonical.trim();
}

async function requireTlinkSchemaMigrations(database: D1Database) {
  const missing: string[] = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const columns = await database.prepare(`PRAGMA table_xinfo(\`${table}\`)`)
      .all<{ name: string }>();
    const installed = new Set(columns.results.map((row) => String(row.name)));
    if (!installed.size) {
      missing.push(`table:${table}`);
      continue;
    }
    for (const column of required) {
      if (!installed.has(column)) missing.push(`column:${table}.${column}`);
    }
  }
  if (missing.length) throw new Error(`TLINK_SCHEMA_MIGRATIONS_REQUIRED:${missing.join(",")}`);
}

async function installTlinkSchemaGuards(database: D1Database) {
  await requireTlinkSchemaMigrations(database);
  const rows = await database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'")
    .all<{ name: string; sql: string | null }>();
  const installed = new Map(rows.results.map((row) => [String(row.name), String(row.sql || "")]));
  for (const definition of TLINK_SCHEMA_GUARD_DEFINITIONS) {
    const current = installed.get(definition.name);
    if (current && canonicalTlinkSchemaGuardSql(current) !== canonicalTlinkSchemaGuardSql(definition.sql)) {
      throw new Error(`TLINK_SCHEMA_GUARD_MISMATCH:${definition.name}`);
    }
  }
  const missing = TLINK_SCHEMA_GUARD_DEFINITIONS.filter((definition) => !installed.has(definition.name));
  if (missing.length) await database.batch(missing.map((definition) => database.prepare(definition.sql)));
  const verified = await database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'")
    .all<{ name: string; sql: string | null }>();
  const verifiedMap = new Map(verified.results.map((row) => [String(row.name), String(row.sql || "")]));
  const unavailable = TLINK_SCHEMA_GUARD_DEFINITIONS.filter((definition) =>
    canonicalTlinkSchemaGuardSql(verifiedMap.get(definition.name) || "") !== canonicalTlinkSchemaGuardSql(definition.sql));
  if (unavailable.length) throw new Error(`TLINK_SCHEMA_GUARDS_UNAVAILABLE:${unavailable.map((item) => item.name).join(",")}`);
}

export async function ensureTlinkSchemaGuards(database: D1Database) {
  const key = database as object;
  let readiness = readinessByDatabase.get(key);
  if (!readiness) {
    readiness = installTlinkSchemaGuards(database);
    readinessByDatabase.set(key, readiness);
  }
  try {
    await readiness;
  } catch (error) {
    readinessByDatabase.delete(key);
    throw error;
  }
}
