// Sites splits migration SQL on semicolons, so rental trigger bodies are installed
// through D1 prepared statements after migration 0142 has created the tables.
import { canonicalTlinkSchemaGuardSql } from "./tlink-schema-guards.ts";

type RentalSchemaGuardDefinition = {
  readonly name: string;
  readonly sql: string;
};

function abortTrigger(input: {
  name: string;
  event: string;
  table: string;
  when?: string;
  message: string;
}): RentalSchemaGuardDefinition {
  const when = input.when ? ` WHEN ${input.when}` : "";
  return {
    name: input.name,
    sql: `CREATE TRIGGER IF NOT EXISTS \`${input.name}\` BEFORE ${input.event} ON \`${input.table}\` FOR EACH ROW${when} BEGIN SELECT RAISE(ABORT, '${input.message}'); END;`,
  };
}

const inspectionWorkOrderMismatch = `NOT EXISTS (
  SELECT 1 FROM trade_work_orders work_order
  WHERE work_order.id = NEW.work_order_id AND work_order.firebase_uid = NEW.firebase_uid
) OR (NEW.service_site_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_crm_job_details detail
  WHERE detail.work_order_id = NEW.work_order_id AND detail.firebase_uid = NEW.firebase_uid
    AND detail.service_site_id = NEW.service_site_id
))`;

const moduleParentMismatch = `NOT EXISTS (
  SELECT 1 FROM trade_rental_inspections inspection
  WHERE inspection.id = NEW.inspection_id AND inspection.firebase_uid = NEW.firebase_uid
    AND EXISTS (SELECT 1 FROM json_each(inspection.module_selection_snapshot) selected WHERE selected.value = NEW.module_key)
)`;

const itemParentMismatch = `NOT EXISTS (
  SELECT 1 FROM trade_rental_inspection_modules module
  WHERE module.id = NEW.module_id AND module.inspection_id = NEW.inspection_id
    AND module.firebase_uid = NEW.firebase_uid
)`;

const findingParentMismatch = `${itemParentMismatch} OR (NEW.item_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_inspection_items item
  WHERE item.id = NEW.item_id AND item.module_id = NEW.module_id
    AND item.inspection_id = NEW.inspection_id AND item.firebase_uid = NEW.firebase_uid
))`;

const evidenceParentMismatch = `${findingParentMismatch} OR (NEW.finding_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_findings finding
  WHERE finding.id = NEW.finding_id AND finding.module_id = NEW.module_id
    AND finding.inspection_id = NEW.inspection_id AND finding.firebase_uid = NEW.firebase_uid
)) OR NOT EXISTS (
  SELECT 1 FROM trade_crm_job_media media
  JOIN trade_rental_inspections inspection ON inspection.id = NEW.inspection_id
  WHERE media.id = NEW.job_media_id AND media.work_order_id = inspection.work_order_id
    AND media.firebase_uid = NEW.firebase_uid AND inspection.firebase_uid = NEW.firebase_uid
)`;

const reportParentMismatch = `NOT EXISTS (
  SELECT 1 FROM trade_rental_inspections inspection
  WHERE inspection.id = NEW.inspection_id AND inspection.firebase_uid = NEW.firebase_uid
)`;

const reportLinkParentMismatch = `NEW.status <> 'active' OR NOT EXISTS (
  SELECT 1 FROM trade_rental_reports report
  JOIN trade_rental_inspections inspection ON inspection.id = report.inspection_id
    AND inspection.firebase_uid = report.firebase_uid
  WHERE report.id = NEW.report_id AND report.inspection_id = NEW.inspection_id
    AND report.firebase_uid = NEW.firebase_uid AND report.status = 'issued'
    AND inspection.status = 'issued' AND inspection.issued_report_id = report.id
)`;

const eventParentMismatch = `${reportParentMismatch} OR (NEW.report_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_reports report
  WHERE report.id = NEW.report_id AND report.inspection_id = NEW.inspection_id
    AND report.firebase_uid = NEW.firebase_uid
)) OR (NEW.report_link_id <> '' AND NOT EXISTS (
  SELECT 1 FROM trade_rental_report_links link
  WHERE link.id = NEW.report_link_id AND link.inspection_id = NEW.inspection_id
    AND link.firebase_uid = NEW.firebase_uid
    AND (NEW.report_id = '' OR link.report_id = NEW.report_id)
))`;

const reportIdentityChanged = `NEW.id IS NOT OLD.id OR NEW.inspection_id IS NOT OLD.inspection_id
  OR NEW.firebase_uid IS NOT OLD.firebase_uid OR NEW.report_number IS NOT OLD.report_number
  OR NEW.revision IS NOT OLD.revision OR NEW.report_schema_version IS NOT OLD.report_schema_version
  OR NEW.report_snapshot IS NOT OLD.report_snapshot OR NEW.source_snapshot_sha256 IS NOT OLD.source_snapshot_sha256
  OR NEW.staged_at IS NOT OLD.staged_at OR NEW.created_at IS NOT OLD.created_at`;

const terminalReportChanged = `OLD.status IN ('issued', 'superseded', 'withdrawn') AND (
  NEW.id IS NOT OLD.id OR NEW.inspection_id IS NOT OLD.inspection_id
  OR NEW.firebase_uid IS NOT OLD.firebase_uid OR NEW.report_number IS NOT OLD.report_number
  OR NEW.revision IS NOT OLD.revision OR NEW.report_schema_version IS NOT OLD.report_schema_version
  OR NEW.report_snapshot IS NOT OLD.report_snapshot OR NEW.source_snapshot_sha256 IS NOT OLD.source_snapshot_sha256
  OR NEW.pdf_object_key IS NOT OLD.pdf_object_key OR NEW.pdf_sha256 IS NOT OLD.pdf_sha256
  OR NEW.pdf_size_bytes IS NOT OLD.pdf_size_bytes OR NEW.issued_by_uid IS NOT OLD.issued_by_uid
  OR NEW.issued_by_member_id IS NOT OLD.issued_by_member_id OR NEW.issuer_snapshot IS NOT OLD.issuer_snapshot
  OR NEW.staged_at IS NOT OLD.staged_at OR NEW.issued_at IS NOT OLD.issued_at
  OR NEW.created_at IS NOT OLD.created_at
)`;

const reportTransitionInvalid = `NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'staged' AND NEW.status = 'issued' AND EXISTS (
    SELECT 1 FROM trade_rental_inspections inspection
    WHERE inspection.id = OLD.inspection_id AND inspection.firebase_uid = OLD.firebase_uid
      AND inspection.status = 'issuing'
  ))
  OR (OLD.status = 'staged' AND NEW.status = 'failed'
    AND NEW.pdf_object_key = OLD.pdf_object_key AND NEW.pdf_sha256 = OLD.pdf_sha256
    AND NEW.pdf_size_bytes = OLD.pdf_size_bytes AND NEW.issued_by_uid = OLD.issued_by_uid
    AND NEW.issued_by_member_id = OLD.issued_by_member_id AND NEW.issuer_snapshot = OLD.issuer_snapshot
    AND NEW.issued_at = OLD.issued_at)
  OR (OLD.status = 'issued' AND NEW.status IN ('superseded', 'withdrawn')
    AND datetime(NEW.superseded_at) IS NOT NULL)
)`;

const inspectionIssueInvalid = `NEW.status = 'issued' AND NOT (
  OLD.status = 'issuing' AND NEW.issued_report_id <> '' AND datetime(NEW.issued_at) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM trade_rental_reports report
    WHERE report.id = NEW.issued_report_id AND report.inspection_id = OLD.id
      AND report.firebase_uid = OLD.firebase_uid AND report.status = 'issued'
      AND report.issued_at = NEW.issued_at
  )
)`;

const terminalInspectionChanged = `OLD.status IN ('issued', 'superseded', 'withdrawn') AND (
  NEW.id IS NOT OLD.id OR NEW.work_order_id IS NOT OLD.work_order_id
  OR NEW.firebase_uid IS NOT OLD.firebase_uid OR NEW.service_site_id IS NOT OLD.service_site_id
  OR NEW.inspection_number IS NOT OLD.inspection_number OR NEW.jurisdiction IS NOT OLD.jurisdiction
  OR NEW.template_key IS NOT OLD.template_key OR NEW.template_version IS NOT OLD.template_version
  OR NEW.rules_effective_from IS NOT OLD.rules_effective_from
  OR NEW.module_selection_snapshot IS NOT OLD.module_selection_snapshot
  OR NEW.property_snapshot IS NOT OLD.property_snapshot OR NEW.assessor_uid IS NOT OLD.assessor_uid
  OR NEW.assessor_member_id IS NOT OLD.assessor_member_id OR NEW.assessor_snapshot IS NOT OLD.assessor_snapshot
  OR NEW.creation_request_id IS NOT OLD.creation_request_id OR NEW.issued_report_id IS NOT OLD.issued_report_id
  OR NEW.submitted_at IS NOT OLD.submitted_at OR NEW.issued_at IS NOT OLD.issued_at
  OR NEW.created_by_uid IS NOT OLD.created_by_uid OR NEW.created_at IS NOT OLD.created_at
)`;

const terminalInspectionTransitionInvalid = `OLD.status IN ('issued', 'superseded', 'withdrawn') AND NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'issued' AND NEW.status IN ('superseded', 'withdrawn')
    AND datetime(NEW.superseded_at) IS NOT NULL)
)`;

const reportLinkIdentityChanged = `NEW.id IS NOT OLD.id OR NEW.report_id IS NOT OLD.report_id
  OR NEW.inspection_id IS NOT OLD.inspection_id OR NEW.firebase_uid IS NOT OLD.firebase_uid
  OR NEW.token_hash IS NOT OLD.token_hash OR NEW.encrypted_token IS NOT OLD.encrypted_token
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_by_uid IS NOT OLD.created_by_uid
  OR NEW.created_at IS NOT OLD.created_at`;

const reportLinkTransitionInvalid = `NOT (
  (OLD.status = 'active' AND NEW.status = 'active' AND NEW.token_issue = OLD.token_issue
    AND NEW.view_count >= OLD.view_count AND NEW.download_count >= OLD.download_count)
  OR (OLD.status = 'active' AND NEW.status = 'revoked'
    AND NEW.token_issue = OLD.token_issue + 1 AND datetime(NEW.revoked_at) IS NOT NULL)
  OR (OLD.status = 'active' AND NEW.status = 'expired'
    AND NEW.token_issue = OLD.token_issue AND datetime(OLD.expires_at) <= datetime(NEW.updated_at))
  OR (OLD.status = 'active' AND NEW.status = 'superseded' AND NEW.token_issue >= OLD.token_issue)
)`;

const lockedAssessment = (alias: "NEW" | "OLD") => `EXISTS (
  SELECT 1 FROM trade_rental_inspections inspection
  WHERE inspection.id = ${alias}.inspection_id AND inspection.status IN ('issuing', 'issued', 'superseded', 'withdrawn')
)`;

const definitions: RentalSchemaGuardDefinition[] = [
  abortTrigger({ name: "trade_rental_inspections_work_order_guard_insert", event: "INSERT", table: "trade_rental_inspections", when: inspectionWorkOrderMismatch, message: "rental inspection work order mismatch" }),
  abortTrigger({ name: "trade_rental_inspections_work_order_guard_update", event: "UPDATE OF work_order_id, firebase_uid, service_site_id", table: "trade_rental_inspections", when: inspectionWorkOrderMismatch, message: "rental inspection work order mismatch" }),
  abortTrigger({ name: "trade_rental_inspections_issue_transition_guard", event: "UPDATE", table: "trade_rental_inspections", when: inspectionIssueInvalid, message: "rental inspection issue transition is invalid" }),
  abortTrigger({ name: "trade_rental_inspections_terminal_immutable", event: "UPDATE", table: "trade_rental_inspections", when: terminalInspectionChanged, message: "issued rental inspection is immutable" }),
  abortTrigger({ name: "trade_rental_inspections_terminal_transition_guard", event: "UPDATE", table: "trade_rental_inspections", when: terminalInspectionTransitionInvalid, message: "rental inspection transition is invalid" }),
  abortTrigger({ name: "trade_rental_inspections_terminal_delete_guard", event: "DELETE", table: "trade_rental_inspections", when: "OLD.status IN ('issued', 'superseded', 'withdrawn')", message: "issued rental inspection is retained" }),
  abortTrigger({ name: "trade_rental_modules_parent_guard_insert", event: "INSERT", table: "trade_rental_inspection_modules", when: moduleParentMismatch, message: "rental module parent mismatch" }),
  abortTrigger({ name: "trade_rental_modules_parent_guard_update", event: "UPDATE OF inspection_id, firebase_uid, module_key", table: "trade_rental_inspection_modules", when: moduleParentMismatch, message: "rental module parent mismatch" }),
  abortTrigger({ name: "trade_rental_items_parent_guard_insert", event: "INSERT", table: "trade_rental_inspection_items", when: itemParentMismatch, message: "rental item parent mismatch" }),
  abortTrigger({ name: "trade_rental_items_parent_guard_update", event: "UPDATE OF inspection_id, module_id, firebase_uid", table: "trade_rental_inspection_items", when: itemParentMismatch, message: "rental item parent mismatch" }),
  abortTrigger({ name: "trade_rental_findings_parent_guard_insert", event: "INSERT", table: "trade_rental_findings", when: findingParentMismatch, message: "rental finding parent mismatch" }),
  abortTrigger({ name: "trade_rental_findings_parent_guard_update", event: "UPDATE OF inspection_id, module_id, item_id, firebase_uid", table: "trade_rental_findings", when: findingParentMismatch, message: "rental finding parent mismatch" }),
  abortTrigger({ name: "trade_rental_evidence_parent_guard_insert", event: "INSERT", table: "trade_rental_evidence_links", when: evidenceParentMismatch, message: "rental evidence parent mismatch" }),
  abortTrigger({ name: "trade_rental_evidence_parent_guard_update", event: "UPDATE OF inspection_id, module_id, item_id, finding_id, job_media_id, firebase_uid", table: "trade_rental_evidence_links", when: evidenceParentMismatch, message: "rental evidence parent mismatch" }),
  abortTrigger({ name: "trade_rental_reports_parent_guard_insert", event: "INSERT", table: "trade_rental_reports", when: reportParentMismatch, message: "rental report parent mismatch" }),
  abortTrigger({ name: "trade_rental_reports_parent_guard_update", event: "UPDATE OF inspection_id, firebase_uid", table: "trade_rental_reports", when: reportParentMismatch, message: "rental report parent mismatch" }),
  abortTrigger({ name: "trade_rental_report_links_parent_guard_insert", event: "INSERT", table: "trade_rental_report_links", when: reportLinkParentMismatch, message: "rental report link parent mismatch" }),
  abortTrigger({ name: "trade_rental_report_links_parent_guard_update", event: "UPDATE OF report_id, inspection_id, firebase_uid", table: "trade_rental_report_links", when: reportLinkParentMismatch, message: "rental report link parent mismatch" }),
  abortTrigger({ name: "trade_rental_events_parent_guard_insert", event: "INSERT", table: "trade_rental_inspection_events", when: eventParentMismatch, message: "rental event parent mismatch" }),
  abortTrigger({ name: "trade_rental_events_append_only_update", event: "UPDATE", table: "trade_rental_inspection_events", message: "rental inspection events are append only" }),
  abortTrigger({ name: "trade_rental_events_append_only_delete", event: "DELETE", table: "trade_rental_inspection_events", message: "rental inspection events are append only" }),
  abortTrigger({ name: "trade_rental_reports_identity_immutable", event: "UPDATE", table: "trade_rental_reports", when: reportIdentityChanged, message: "rental report identity is immutable" }),
  abortTrigger({ name: "trade_rental_reports_terminal_immutable", event: "UPDATE", table: "trade_rental_reports", when: terminalReportChanged, message: "issued rental report is immutable" }),
  abortTrigger({ name: "trade_rental_reports_transition_guard", event: "UPDATE", table: "trade_rental_reports", when: reportTransitionInvalid, message: "rental report transition is invalid" }),
  abortTrigger({ name: "trade_rental_reports_issued_delete_guard", event: "DELETE", table: "trade_rental_reports", when: "OLD.status IN ('issued', 'superseded', 'withdrawn')", message: "issued rental report is retained" }),
  abortTrigger({ name: "trade_rental_report_links_identity_guard", event: "UPDATE", table: "trade_rental_report_links", when: reportLinkIdentityChanged, message: "rental report link identity is immutable" }),
  abortTrigger({ name: "trade_rental_report_links_transition_guard", event: "UPDATE", table: "trade_rental_report_links", when: reportLinkTransitionInvalid, message: "rental report link transition is invalid" }),
  abortTrigger({ name: "trade_rental_report_links_delete_guard", event: "DELETE", table: "trade_rental_report_links", message: "rental report link history is retained" }),
];

for (const table of [
  "trade_rental_inspection_modules",
  "trade_rental_inspection_items",
  "trade_rental_findings",
  "trade_rental_evidence_links",
]) {
  const prefix = table.replace(/^trade_rental_/, "trade_rental_").replace(/_inspection_/, "_");
  definitions.push(
    abortTrigger({ name: `${prefix}_issued_lock_insert`, event: "INSERT", table, when: lockedAssessment("NEW"), message: "issued rental assessment is immutable" }),
    abortTrigger({ name: `${prefix}_issued_lock_update`, event: "UPDATE", table, when: lockedAssessment("OLD"), message: "issued rental assessment is immutable" }),
    abortTrigger({ name: `${prefix}_issued_lock_delete`, event: "DELETE", table, when: lockedAssessment("OLD"), message: "issued rental assessment is immutable" }),
  );
}

export const TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS: readonly RentalSchemaGuardDefinition[] = definitions;

const REQUIRED_COLUMNS = {
  trade_work_orders: ["id", "firebase_uid"],
  trade_crm_job_details: ["work_order_id", "firebase_uid", "service_site_id"],
  trade_crm_job_media: ["id", "work_order_id", "firebase_uid"],
  trade_rental_inspections: [
    "id", "work_order_id", "firebase_uid", "service_site_id", "inspection_number", "jurisdiction",
    "status", "template_key", "template_version", "rules_effective_from", "module_selection_snapshot",
    "property_snapshot", "assessor_uid", "assessor_member_id", "assessor_snapshot", "creation_request_id",
    "issued_report_id", "submitted_at", "issued_at", "superseded_at", "created_by_uid", "created_at",
  ],
  trade_rental_inspection_modules: ["id", "inspection_id", "firebase_uid", "module_key"],
  trade_rental_inspection_items: ["id", "inspection_id", "module_id", "firebase_uid"],
  trade_rental_findings: ["id", "inspection_id", "module_id", "item_id", "firebase_uid"],
  trade_rental_evidence_links: ["id", "inspection_id", "module_id", "item_id", "finding_id", "job_media_id", "firebase_uid"],
  trade_rental_reports: [
    "id", "inspection_id", "firebase_uid", "report_number", "revision", "status",
    "report_schema_version", "report_snapshot", "source_snapshot_sha256", "pdf_object_key",
    "pdf_sha256", "pdf_size_bytes", "issued_by_uid", "issued_by_member_id",
    "issuer_snapshot", "staged_at", "issued_at", "superseded_at", "created_at",
  ],
  trade_rental_report_links: [
    "id", "report_id", "inspection_id", "firebase_uid", "token_hash", "encrypted_token",
    "token_issue", "status", "expires_at", "revoked_at", "created_by_uid", "last_viewed_at",
    "last_downloaded_at", "view_count", "download_count", "created_at", "updated_at",
  ],
  trade_rental_inspection_events: ["id", "inspection_id", "report_id", "report_link_id", "firebase_uid"],
} as const;

const readinessByDatabase = new WeakMap<object, Promise<void>>();

async function requireRentalSchemaMigration(database: D1Database) {
  const missing: string[] = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const columns = await database.prepare(`PRAGMA table_xinfo(\`${table}\`)`).all<{ name: string }>();
    const installed = new Set(columns.results.map((row) => String(row.name)));
    if (!installed.size) {
      missing.push(`table:${table}`);
      continue;
    }
    for (const column of required) if (!installed.has(column)) missing.push(`column:${table}.${column}`);
  }
  if (missing.length) throw new Error(`TRADE_RENTAL_SCHEMA_MIGRATION_REQUIRED:${missing.join(",")}`);
}

async function installRentalSchemaGuards(database: D1Database) {
  await requireRentalSchemaMigration(database);
  const rows = await database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'")
    .all<{ name: string; sql: string | null }>();
  const installed = new Map(rows.results.map((row) => [String(row.name), String(row.sql || "")]));
  for (const definition of TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS) {
    const current = installed.get(definition.name);
    if (current && canonicalTlinkSchemaGuardSql(current) !== canonicalTlinkSchemaGuardSql(definition.sql)) {
      throw new Error(`TRADE_RENTAL_SCHEMA_GUARD_MISMATCH:${definition.name}`);
    }
  }
  const missing = TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.filter((definition) => !installed.has(definition.name));
  if (missing.length) await database.batch(missing.map((definition) => database.prepare(definition.sql)));
  const verified = await database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'")
    .all<{ name: string; sql: string | null }>();
  const verifiedMap = new Map(verified.results.map((row) => [String(row.name), String(row.sql || "")]));
  const unavailable = TRADE_RENTAL_SCHEMA_GUARD_DEFINITIONS.filter((definition) =>
    canonicalTlinkSchemaGuardSql(verifiedMap.get(definition.name) || "") !== canonicalTlinkSchemaGuardSql(definition.sql));
  if (unavailable.length) {
    throw new Error(`TRADE_RENTAL_SCHEMA_GUARDS_UNAVAILABLE:${unavailable.map((definition) => definition.name).join(",")}`);
  }
}

export async function ensureTradeRentalSchemaGuards(database: D1Database) {
  const key = database as object;
  let readiness = readinessByDatabase.get(key);
  if (!readiness) {
    readiness = installRentalSchemaGuards(database);
    readinessByDatabase.set(key, readiness);
  }
  try {
    await readiness;
  } catch (error) {
    readinessByDatabase.delete(key);
    throw error;
  }
}
