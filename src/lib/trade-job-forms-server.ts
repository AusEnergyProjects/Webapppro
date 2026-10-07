import { getD1 } from "../../db";
import { assignedJobStatement, requireAssignedJob, type TeamAccess, type AssignedTradeJob } from "./trade-team-server";
import { normalizeTradeFormAnswers, tradeFormCompletion } from "./trade-form-library.mjs";

import { reconcileTradeFormJobProgress } from "./trade-form-job-progress";
import { guardedOnlineChildMutationBatch, jobSyncChangeStatements, nextJobRevision } from "./trade-team-sync-server";
import { addMonthsToIsoDate } from "./asset-lifecycle.mjs";

export const TRADE_JOB_FORM_COLUMNS = `id, template_key, template_version, template_name, jurisdiction,
  template_snapshot, answers, status, revision, completed_by_uid, completed_at, created_at, updated_at`;

export type TradeJobFormProjection = {
  id: string; templateKey: string; templateVersion: number; templateName: string; jurisdiction: string;
  template: Record<string, unknown>; answers: Record<string, unknown>; status: string; revision: number;
  ready: boolean; missing: string[]; completedAt: string; createdAt: string; updatedAt: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function storedObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("FORM_PAYLOAD_UNAVAILABLE"); }
  if (!object(parsed)) throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  return parsed;
}

function selectedJobProjection(row: Record<string, unknown>): AssignedTradeJob {
  const { id, source_type, source_reference, assignee_member_id, assignee_label, stage, service_category, revision, customer_source } = row;
  if (typeof id !== "string" || typeof source_type !== "string" || typeof source_reference !== "string"
    || typeof assignee_member_id !== "string" || typeof assignee_label !== "string" || typeof stage !== "string"
    || typeof service_category !== "string" || typeof revision !== "number" || !Number.isSafeInteger(revision)
    || customer_source !== null && typeof customer_source !== "string") throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  return { id, source_type, source_reference, assignee_member_id, assignee_label, stage, service_category, revision, customer_source: customer_source ?? "" };
}

/** The public form list and internal selected-form reader share one projection. */
export function tradeJobFormProjection(row: Record<string, unknown>): TradeJobFormProjection {
  const { id, template_key: templateKey, template_name: templateName, jurisdiction, status,
    completed_at: completedAt, created_at: createdAt, updated_at: updatedAt } = row;
  const templateVersion = Number(row.template_version), revision = Number(row.revision || 1);
  if (typeof id !== "string" || !id || typeof templateKey !== "string" || typeof templateName !== "string"
    || typeof jurisdiction !== "string" || typeof status !== "string" || typeof completedAt !== "string"
    || typeof createdAt !== "string" || typeof updatedAt !== "string"
    || !Number.isSafeInteger(templateVersion) || templateVersion < 1 || !Number.isSafeInteger(revision) || revision < 1) throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  const template = storedObject(row.template_snapshot), answers = storedObject(row.answers);
  if (!Array.isArray(template.fields)) throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  const completion = tradeFormCompletion(template, answers);
  return { id, templateKey, templateVersion, templateName, jurisdiction, template, answers, status, revision,
    ready: completion.ready, missing: completion.missing, completedAt, createdAt, updatedAt };
}

/** Server-only: callers supply a freshly authorised canonical TeamAccess, never browser claims. */
export async function readSelectedTradeJobForm(team: TeamAccess, jobId: string, formId: string): Promise<{
  job: AssignedTradeJob; form: TradeJobFormProjection;
}> {
  if (!team.canViewFieldEvidence) throw new Error("FIELD_EVIDENCE_VIEW_REQUIRED");
  const payload = await getD1().batch<Record<string, unknown>>([
    assignedJobStatement(team, jobId),
    getD1().prepare(`SELECT ${TRADE_JOB_FORM_COLUMNS} FROM trade_job_forms forms
    WHERE forms.id = ? AND forms.work_order_id = ? AND forms.firebase_uid = ?
      AND EXISTS (SELECT 1 FROM trade_work_orders work
        WHERE work.id = forms.work_order_id AND work.firebase_uid = forms.firebase_uid
          AND work.partner_type = 'installer' AND work.record_status = 'active')`)
    .bind(formId, jobId, team.ownerUid),
  ]);
  if (!Array.isArray(payload) || payload.length !== 2 || !payload[0]?.success || !Array.isArray(payload[0].results)
    || payload[0].results.length > 1) throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  const candidate = payload[0].results[0];
  const job = await requireAssignedJob(team, jobId, candidate ? selectedJobProjection(candidate) : null);
  const result = payload[1];
  if (!result?.success || !Array.isArray(result.results) || result.results.length > 1) throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  const row = result.results[0];
  if (!row) throw new Error("JOB_FORM_NOT_FOUND");
  return { job, form: tradeJobFormProjection(row) };
}

export class TradeJobFormError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); this.name = "TradeJobFormError"; }
}
export type TradeJobFormSaveInput = { workOrderId: string; formId: string; baseRevision?: unknown; answers?: unknown; complete?: unknown };

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){8,}/;

function parseJson(value: unknown, fallback: unknown) {
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function containsPrivateData(value: Record<string, unknown>, template: Record<string, unknown>) {
  const dateFields = new Set<string>();
  for (const field of Array.isArray(template.fields) ? template.fields : []) {
    if (field && typeof field === "object" && field.type === "date" && typeof field.key === "string") dateFields.add(field.key);
  }
  // Canonical normalization has already rejected invalid dates. Exempt only an
  // ISO date in its actual date field, never date-like text in ordinary answers.
  const text = JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key, answer]) =>
    !dateFields.has(key) || typeof answer !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(answer))));
  return EMAIL_PATTERN.test(text) || PHONE_PATTERN.test(text);
}

/** Canonical mutation shared by HTTP and Wattzun. Both supply freshly checked team and job authority. */
export async function saveTradeJobForm(access: TeamAccess, job: AssignedTradeJob, body: TradeJobFormSaveInput, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!access.canManageFieldEvidence) throw new Error("FIELD_EVIDENCE_MANAGEMENT_REQUIRED");
  const { workOrderId, formId } = body;
  if (!workOrderId || !formId || workOrderId.length > 180 || formId.length > 180 || job.id !== workOrderId) throw new Error("JOB_NOT_FOUND");
  const row = await getD1().prepare(`SELECT form.id, form.template_key, form.template_snapshot, form.answers, form.completed_by_uid,
      form.status, form.revision, work_order.stage job_stage, work_order.revision job_revision
    FROM trade_job_forms form
    JOIN trade_work_orders work_order
      ON work_order.id = form.work_order_id
      AND work_order.firebase_uid = form.firebase_uid
    WHERE form.id = ? AND form.work_order_id = ? AND form.firebase_uid = ?
      AND work_order.record_status = 'active'`).bind(formId, workOrderId, access.ownerUid)
    .first<Record<string, unknown>>();
  signal?.throwIfAborted();
  if (!row) throw new TradeJobFormError(404, "Field form not found.");
  if (Number(row.job_revision) !== Number(job.revision)) throw new Error("ONLINE_MUTATION_CONFLICT");
  const template = parseJson(row.template_snapshot, null) as Record<string, unknown> | null;
  if (!template || !Array.isArray(template.fields)) throw new TradeJobFormError(409, "The saved form template is invalid.");
  const replayRevision = Number(body.baseRevision);
  if (row.status === "complete" && body.complete === true && row.completed_by_uid === access.actorUid
    && Number.isInteger(replayRevision) && replayRevision + 1 === Number(row.revision)
    && !["imported", "cancelled"].includes(String(row.job_stage))
    && JSON.stringify(normalizeTradeFormAnswers(template, body.answers))
      === JSON.stringify(normalizeTradeFormAnswers(template, parseJson(row.answers, {})))) {
    // Retry an acknowledged identity without changing the immutable form or its original timestamps.
    const jobProgress = await reconcileTradeFormJobProgress(access, workOrderId, { afterSave: true });
    return { duplicate: true, jobProgress };
  }
  if (["imported", "completed", "cancelled"].includes(String(row.job_stage))) throw new Error("TERMINAL_JOB_LOCKED");
  if (row.status === "complete") throw new TradeJobFormError(409, "This completed form is locked. Start a newer template version if the record must be replaced.");
  const baseRevision = Number(body.baseRevision || row.revision);
  if (!Number.isInteger(baseRevision) || baseRevision !== Number(row.revision)) {
    throw new TradeJobFormError(409, "This form changed elsewhere. Refresh it before saving.", "REVISION_CONFLICT");
  }
  const answers = normalizeTradeFormAnswers(template, body.answers);
  if (containsPrivateData(answers, template)) throw new TradeJobFormError(400, "Keep customer contact details and phone numbers out of technical field forms.");
  const completion = tradeFormCompletion(template, answers);
  const complete = body.complete === true;
  if (complete && !completion.ready) throw new TradeJobFormError(400, `Complete the required fields: ${completion.missing.join(", ")}.`);
  const now = new Date().toISOString();
  const revision = nextJobRevision(job.revision);
  const formRevision = nextJobRevision(row.revision);
  const jobStage = String(row.job_stage);
  const answerJson = JSON.stringify(answers);
  const formStatus = complete ? "complete" : "draft";
  const lifecycleStatements: D1PreparedStatement[] = [];
  if (complete && row.template_key === "service-visit-support" && job.source_type === "recurring_service" && job.source_reference) {
    const plan = await getD1().prepare(`SELECT id, asset_id, handover_pack_id, work_order_id, cadence_months
      FROM trade_asset_service_plans WHERE id = ? AND firebase_uid = ?`)
      .bind(job.source_reference, access.ownerUid).first<Record<string, unknown>>();
    if (plan) {
      const servicedAt = String(answers.work_date || now.slice(0, 10));
      const nextDueAt = addMonthsToIsoDate(servicedAt, Number(plan.cadence_months));
      lifecycleStatements.push(
        getD1().prepare(`INSERT INTO trade_asset_service_events
          (id, service_plan_id, asset_id, handover_pack_id, work_order_id, firebase_uid, event_type,
           serviced_at, summary, provider_reference, next_due_at, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, 'service_completed', ?, 'Scheduled service form completed.', ?, ?, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM trade_asset_service_events
            WHERE service_plan_id = ? AND event_type = 'service_completed' AND provider_reference = ?)`)
          .bind(crypto.randomUUID(), plan.id, plan.asset_id, plan.handover_pack_id, plan.work_order_id, access.ownerUid,
            servicedAt, workOrderId, nextDueAt, now, now, plan.id, workOrderId),
        getD1().prepare(`UPDATE trade_asset_service_plans SET next_due_at = ?, status = 'active', updated_at = ?
          WHERE id = ? AND firebase_uid = ?`).bind(nextDueAt, now, plan.id, access.ownerUid),
      );
    }
  }
  signal?.throwIfAborted();
  await guardedOnlineChildMutationBatch(getD1(), [
    getD1().prepare(`UPDATE trade_job_forms SET answers = ?, status = ?, revision = ?,
      completed_by_uid = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND work_order_id = ? AND firebase_uid = ? AND revision = ?
        AND status <> 'complete'
        AND EXISTS (
          SELECT 1 FROM trade_work_orders work_order
          WHERE work_order.id = trade_job_forms.work_order_id
            AND work_order.firebase_uid = trade_job_forms.firebase_uid
            AND work_order.record_status = 'active'
            AND work_order.stage = ?
            AND work_order.stage NOT IN ('imported', 'completed', 'cancelled')
            AND work_order.revision = ?
        )`)
      .bind(answerJson, formStatus, formRevision, complete ? access.actorUid : "",
        complete ? now : "", now, formId, workOrderId, access.ownerUid, baseRevision,
        jobStage, Number(row.job_revision)),
    getD1().prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
        AND stage = ? AND stage NOT IN ('imported', 'completed', 'cancelled') AND revision = ?
        AND EXISTS (
          SELECT 1 FROM trade_job_forms child
          WHERE child.id = ? AND child.work_order_id = trade_work_orders.id
            AND child.firebase_uid = trade_work_orders.firebase_uid
            AND child.answers = ? AND child.status = ?
            AND child.revision = ? AND child.updated_at = ?
        )`)
      .bind(revision, now, workOrderId, access.ownerUid, jobStage, Number(row.job_revision),
        formId, answerJson, formStatus, formRevision, now),
    getD1().prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), workOrderId, access.ownerUid, complete ? "field_form_completed" : "field_form_saved",
        complete ? `${String(template.name || "Field form")} completed.` : `${String(template.name || "Field form")} saved.`, now),
    ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
        audienceMemberId: String(job.assignee_member_id || "") }),
    ...lifecycleStatements,
  ], {
    childKind: "form",
    childId: formId,
    childRevision: formRevision,
    jobRevision: revision,
    jobStage,
    ownerUid: access.ownerUid,
    updatedAt: now,
    workOrderId,
  });
  const jobProgress = await reconcileTradeFormJobProgress(access, workOrderId, { afterSave: true });
  return { jobProgress };
}
