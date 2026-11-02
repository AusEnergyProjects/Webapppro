import type { TeamAccess } from "./trade-team-server";
import { ensureRentalCorrectionSchemaGuards } from "./trade-rental-correction-schema-guards";
import { messageActorGuard } from "./trade-message-media-access";
import { verifiedTradeAccountPredicate } from "./trade-account-predicates";

type Row = Record<string, unknown>;
export type RentalCorrectionContext = {
  access: TeamAccess;
  inspection: Row;
  job: Row;
  workOrderId: string;
  correction?: boolean;
};

const originalTables = Object.freeze({ inspections: "trade_rental_inspections", modules: "trade_rental_inspection_modules",
  items: "trade_rental_inspection_items", findings: "trade_rental_findings", evidence: "trade_rental_evidence_links", events: "trade_rental_inspection_events" });
const correctionTables = Object.freeze({ inspections: "trade_rental_corrections", modules: "trade_rental_correction_modules",
  items: "trade_rental_correction_items", findings: "trade_rental_correction_findings", evidence: "trade_rental_correction_evidence_links", events: "trade_rental_correction_events" });

/** Closed table families share the same assessment validation and mutation contracts. */
export function rentalAssessmentTables(correction = false) { return correction ? correctionTables : originalTables; }

export function rentalCorrectionActorGuard(access: TeamAccess) {
  if (access.fieldSessionId && access.actorUid !== `field-member:${access.memberId}`) return { sql: "0=1", values: [] as unknown[] };
  const actor = messageActorGuard(access);
  return { sql: `${actor.sql} AND EXISTS(SELECT 1 FROM trade_team_members corrector JOIN trade_accounts account
    ON account.firebase_uid=corrector.owner_uid WHERE corrector.id=? AND corrector.owner_uid=?
      AND (corrector.member_uid=corrector.owner_uid OR (corrector.can_manage_field_evidence=1 AND corrector.can_view_field_evidence=1 AND corrector.can_run_reports=1))
      AND account.partner_type='installer' AND ${verifiedTradeAccountPredicate("account")})`, values: [...actor.values, access.memberId, access.ownerUid] };
}

export async function latestRentalCorrection(db: D1Database, ownerUid: string, workOrderId: string) {
  await ensureRentalCorrectionSchemaGuards(db);
  return await db.prepare(`SELECT * FROM trade_rental_corrections correction WHERE firebase_uid=? AND work_order_id=?
    AND status NOT IN ('withdrawn','superseded') AND (status<>'issued' OR issued_report_id=(SELECT report.id
      FROM trade_rental_reports report WHERE report.inspection_id=correction.source_inspection_id
        AND report.firebase_uid=correction.firebase_uid AND report.status='issued' ORDER BY report.revision DESC LIMIT 1))
    ORDER BY CASE WHEN status='issued' THEN 1 ELSE 0 END, created_at DESC, rowid DESC LIMIT 1`).bind(ownerUid, workOrderId).first<Row>();
}

function insertClonedRow(db: D1Database, table: string, row: Row) {
  const columns = Object.keys(row);
  if (columns.some(column => !/^[a-z][a-z0-9_]*$/.test(column))) throw new Error("RENTAL_CORRECTION_INVALID");
  return db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
    .bind(...columns.map(column => row[column] ?? null));
}

async function correctionBatch(db: D1Database, statements: D1PreparedStatement[]) {
  try { return await db.batch(statements); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("CHECK constraint failed: verified") || message.includes("trade_crm_write_guard_verified_check")
      || message.includes("UNIQUE constraint failed: trade_rental_corrections.firebase_uid, trade_rental_corrections.work_order_id")
      || message.includes("rental correction source mismatch")) throw new Error("RENTAL_MUTATION_CONFLICT", { cause: error });
    throw error;
  }
}

function object(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value !== "string") return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("RENTAL_CORRECTION_INVALID");
  return parsed;
}

/** Controlled historical revisions changed the frozen report without rewriting its source assessment. */
function retainFrozenAnswerCorrection(source: Row, modules: Row[], items: Row[], findings: Row[]) {
  const snapshot = object(source.report_snapshot);
  const correction = object(object(snapshot.report).answerCorrection);
  if (!Object.keys(correction).length) return;
  if (correction.field !== "accessStatus" || correction.checkKey !== "cooling_2027_readiness" || correction.toValue !== "Clear access") throw new Error("RENTAL_REPORT_SOURCE_CHANGED");
  const reportModules = Array.isArray(snapshot.modules) ? snapshot.modules.map(object) : [];
  const matches = reportModules.flatMap(module => (Array.isArray(module.sections) ? module.sections.map(object) : [])
    .flatMap(section => (Array.isArray(section.items) ? section.items.map(object) : [])
      .filter(item => item.id === correction.itemId && item.checkKey === correction.checkKey)
      .map(item => ({ item, moduleKey: module.key, sectionKey: section.key }))));
  if (matches.length !== 1 || object(matches[0].item.response).accessStatus !== correction.toValue) throw new Error("RENTAL_REPORT_SOURCE_CHANGED");
  const assessmentModule = modules.find(row => row.module_key === matches[0].moduleKey);
  const matchingItems = items.filter(row => row.module_id === assessmentModule?.id && row.section_key === matches[0].sectionKey
    && row.check_key === correction.checkKey && row.instance_key === matches[0].item.instanceKey);
  if (matchingItems.length !== 1) throw new Error("RENTAL_REPORT_SOURCE_CHANGED");
  const item = matchingItems[0];
  const response = object(item.response_json);
  if (response.accessStatus !== correction.fromValue && response.accessStatus !== correction.toValue) throw new Error("RENTAL_REPORT_SOURCE_CHANGED");
  item.response_json = JSON.stringify({ ...response, accessStatus: correction.toValue });
  for (const finding of findings.filter(row => row.item_id === item.id)) {
    const details = object(finding.details); const responseSnapshot = object(details.responseSnapshot);
    if (Object.hasOwn(responseSnapshot, "accessStatus")) finding.details = JSON.stringify({ ...details,
      responseSnapshot: { ...responseSnapshot, accessStatus: correction.toValue } });
  }
}

export async function beginRentalCorrection(db: D1Database, context: RentalCorrectionContext, input: {
  reportId: string; expectedRevision: number; reason: string;
}) {
  const { access, inspection, job } = context;
  if (!access.canManageFieldEvidence || !access.canRunReports || access.supportWorkOrderId
    || access.memberId !== String(inspection.assessor_member_id) || access.memberId !== String(job.assignee_member_id)) {
    throw new Error("ASSESSOR_REQUIRED");
  }
  if (inspection.status !== "issued" || job.stage === "cancelled") throw new Error("RENTAL_INSPECTION_LOCKED");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== Number(inspection.revision)) throw new Error("RENTAL_MUTATION_CONFLICT");
  await ensureRentalCorrectionSchemaGuards(db);
  const originalId = String(context.correction ? inspection.source_inspection_id : inspection.id);
  const source = await db.prepare(`SELECT * FROM trade_rental_reports WHERE inspection_id=? AND firebase_uid=? AND status='issued'
    ORDER BY revision DESC LIMIT 1`).bind(originalId, access.ownerUid).first<Row>();
  if (!source || source.id !== input.reportId || source.id !== inspection.issued_report_id) throw new Error("RENTAL_MUTATION_CONFLICT");
  const sourceHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(source.report_snapshot))))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
  if (sourceHash !== source.source_snapshot_sha256) throw new Error("RENTAL_REPORT_INVALID");
  const priorCorrectionId = object(object(object(source.report_snapshot).report).assessmentCorrection).correctionId;
  const priorCorrection = priorCorrectionId ? await db.prepare(`SELECT * FROM trade_rental_corrections
    WHERE id=? AND firebase_uid=? AND work_order_id=? AND source_inspection_id=? AND status='issued'`)
    .bind(priorCorrectionId, access.ownerUid, context.workOrderId, originalId).first<Row>() : null;
  if (priorCorrectionId && !priorCorrection) throw new Error("RENTAL_REPORT_SOURCE_CHANGED");
  const cloneInspection = priorCorrection || inspection;
  const tables = rentalAssessmentTables(Boolean(priorCorrection) || context.correction);
  const [modules, items, findings, evidence] = await Promise.all([
    db.prepare(`SELECT * FROM ${tables.modules} WHERE inspection_id=? AND firebase_uid=?`).bind(cloneInspection.id, access.ownerUid).all<Row>(),
    db.prepare(`SELECT * FROM ${tables.items} WHERE inspection_id=? AND firebase_uid=?`).bind(cloneInspection.id, access.ownerUid).all<Row>(),
    db.prepare(`SELECT * FROM ${tables.findings} WHERE inspection_id=? AND firebase_uid=?`).bind(cloneInspection.id, access.ownerUid).all<Row>(),
    db.prepare(`SELECT * FROM ${tables.evidence} WHERE inspection_id=? AND firebase_uid=?`).bind(cloneInspection.id, access.ownerUid).all<Row>(),
  ]);
  if (!modules.results.length || modules.results.some(row => row.status !== "complete")) throw new Error("RENTAL_MODULES_INCOMPLETE");
  retainFrozenAnswerCorrection(source, modules.results, items.results, findings.results);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const ids = new Map([...modules.results, ...items.results, ...findings.results].map(row => [String(row.id), crypto.randomUUID()]));
  const header: Row = { ...cloneInspection, id, inspection_number: `${String(inspection.inspection_number).split("-C")[0]}-C${id.slice(0, 8)}`,
    status: "in_progress", revision: 1, creation_request_id: `correction:${id}`, issued_report_id: "", submitted_at: "", issued_at: "", superseded_at: "",
    created_by_uid: access.actorUid, created_at: now, updated_at: now, source_inspection_id: originalId, source_report_id: source.id,
    source_report_sha256: source.pdf_sha256, source_snapshot_sha256: source.source_snapshot_sha256, correction_reason: input.reason };
  const clone = (row: Row): Row => ({ ...row, id: ids.get(String(row.id)) || crypto.randomUUID(), inspection_id: id,
    ...(row.module_id ? { module_id: ids.get(String(row.module_id)) } : {}),
    ...(row.item_id ? { item_id: ids.get(String(row.item_id)) } : {}),
    ...(row.finding_id ? { finding_id: ids.get(String(row.finding_id)) } : {}),
    created_at: now, updated_at: now });
  const actor = rentalCorrectionActorGuard(access);
  const statements = [db.prepare(`INSERT INTO trade_crm_write_guards(id,firebase_uid,operation_id,step_number,verified,created_at)
    VALUES(?,?,?,1,CASE WHEN ${actor.sql} AND EXISTS(SELECT 1 FROM trade_work_orders work JOIN trade_team_members member
      ON member.id=work.assignee_member_id AND member.owner_uid=work.firebase_uid
      WHERE work.id=? AND work.firebase_uid=? AND work.record_status='active' AND work.stage<>'cancelled' AND work.revision=?
        AND member.id=? AND member.status='active' AND (member.member_uid=member.owner_uid OR (member.can_manage_field_evidence=1 AND member.can_run_reports=1)))
      AND EXISTS(SELECT 1 FROM ${rentalAssessmentTables(context.correction).inspections} current WHERE current.id=? AND current.firebase_uid=? AND current.status='issued' AND current.revision=?)
      AND EXISTS(SELECT 1 FROM trade_rental_reports source WHERE source.id=? AND source.inspection_id=? AND source.firebase_uid=? AND source.status='issued'
        AND source.source_snapshot_sha256=? AND source.pdf_sha256=? AND NOT EXISTS(SELECT 1 FROM trade_rental_reports newer
          WHERE newer.inspection_id=source.inspection_id AND newer.firebase_uid=source.firebase_uid AND newer.status='issued' AND newer.revision>source.revision))
      THEN 1 ELSE 0 END,?)`).bind(crypto.randomUUID(), access.ownerUid, `rental-correction:${id}`, ...actor.values, context.workOrderId, access.ownerUid,
        job.revision, access.memberId, inspection.id, access.ownerUid, inspection.revision, source.id, originalId, access.ownerUid,
        source.source_snapshot_sha256, source.pdf_sha256, now), insertClonedRow(db, correctionTables.inspections, header)];
  for (const row of modules.results) {
    const answers = object(row.answers);
    for (const key of ["coverageConfirmed", "assessorDeclaration", "credentialConfirmed"]) delete answers[key];
    statements.push(insertClonedRow(db, correctionTables.modules, { ...clone(row), status: "draft", revision: 1,
      answers: JSON.stringify(answers), credential_snapshot: "{}", completed_by_uid: "", completed_at: "" }));
  }
  for (const row of items.results) statements.push(insertClonedRow(db, correctionTables.items, { ...clone(row), revision: 1 }));
  for (const row of findings.results) {
    const details = object(row.details);
    if (details.evidenceSourceItemId) details.evidenceSourceItemId = ids.get(String(details.evidenceSourceItemId)) || "";
    statements.push(insertClonedRow(db, correctionTables.findings, { ...clone(row), revision: 1, details: JSON.stringify(details) }));
  }
  for (const row of evidence.results) statements.push(insertClonedRow(db, correctionTables.evidence, clone(row)));
  statements.push(db.prepare(`INSERT INTO trade_rental_correction_events(id,inspection_id,firebase_uid,actor_type,actor_uid,event_type,summary,metadata,created_at)
    VALUES(?,?,?,'assessor',?,'correction_started','A separate report correction draft was started. The issued report is retained.',?,?)`)
    .bind(crypto.randomUUID(), id, access.ownerUid, access.actorUid, JSON.stringify({ sourceReportId: source.id, sourceSnapshotSha256: sourceHash }), now));
  await correctionBatch(db, statements);
  return header;
}

export async function discardRentalCorrection(db: D1Database, context: RentalCorrectionContext, expectedRevision: number) {
  if (!context.correction || !["draft", "scheduled", "in_progress", "submitted"].includes(String(context.inspection.status))) throw new Error("RENTAL_INSPECTION_LOCKED");
  if (expectedRevision !== Number(context.inspection.revision)) throw new Error("RENTAL_MUTATION_CONFLICT");
  const actor = rentalCorrectionActorGuard(context.access);
  const revision = expectedRevision + 1; const now = new Date().toISOString();
  const results = await correctionBatch(db, [
    db.prepare(`INSERT INTO trade_crm_write_guards(id,firebase_uid,operation_id,step_number,verified,created_at)
      VALUES(?,?,?,1,CASE WHEN ${actor.sql} AND EXISTS(SELECT 1 FROM trade_rental_corrections correction
        JOIN trade_work_orders work ON work.id=correction.work_order_id AND work.firebase_uid=correction.firebase_uid
        WHERE correction.id=? AND correction.firebase_uid=? AND correction.revision=? AND correction.status IN ('draft','scheduled','in_progress','submitted')
          AND work.record_status='active' AND work.stage<>'cancelled' AND work.assignee_member_id=?) THEN 1 ELSE 0 END,?)`)
      .bind(crypto.randomUUID(), context.access.ownerUid, `rental-correction-discard:${crypto.randomUUID()}`, ...actor.values,
        context.inspection.id, context.access.ownerUid, expectedRevision, context.access.memberId, now),
    db.prepare(`UPDATE trade_rental_corrections SET status='withdrawn',revision=?,superseded_at=?,updated_at=?
      WHERE id=? AND firebase_uid=? AND revision=? AND status IN ('draft','scheduled','in_progress','submitted')`)
      .bind(revision, now, now, context.inspection.id, context.access.ownerUid, expectedRevision),
    db.prepare(`INSERT INTO trade_rental_correction_events(id,inspection_id,firebase_uid,actor_type,actor_uid,event_type,summary,metadata,created_at)
      VALUES(?,?,?,'assessor',?,'correction_discarded','The correction draft was discarded. Issued report versions are retained.','{}',?)`)
      .bind(crypto.randomUUID(), context.inspection.id, context.access.ownerUid, context.access.actorUid, now),
  ]);
  if (Number(results[1]?.meta.changes) !== 1) throw new Error("RENTAL_MUTATION_CONFLICT");
}
