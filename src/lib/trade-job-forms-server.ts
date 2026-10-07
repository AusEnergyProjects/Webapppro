import { getD1 } from "../../db";
import { assignedJob, type TeamAccess } from "./trade-team-server";
import { tradeFormCompletion } from "./trade-form-library.mjs";

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
  job: Awaited<ReturnType<typeof assignedJob>>; form: TradeJobFormProjection;
}> {
  const job = await assignedJob(team, jobId);
  if (!team.canViewFieldEvidence) throw new Error("FIELD_EVIDENCE_VIEW_REQUIRED");
  const result = await getD1().prepare(`SELECT ${TRADE_JOB_FORM_COLUMNS} FROM trade_job_forms forms
    WHERE forms.id = ? AND forms.work_order_id = ? AND forms.firebase_uid = ?
      AND EXISTS (SELECT 1 FROM trade_work_orders work
        WHERE work.id = forms.work_order_id AND work.firebase_uid = forms.firebase_uid
          AND work.partner_type = 'installer' AND work.record_status = 'active')`)
    .bind(formId, jobId, team.ownerUid).all<Record<string, unknown>>();
  if (!result?.success || !Array.isArray(result.results) || result.results.length > 1) throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  const row = result.results[0];
  if (!row) throw new Error("JOB_FORM_NOT_FOUND");
  return { job, form: tradeJobFormProjection(row) };
}
