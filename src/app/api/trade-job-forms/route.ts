import { getD1 } from "../../../../db";
import { mfaErrorResponse, adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, requireInstallerTeamAccess } from "@/lib/trade-team-server";
import {
  guardedOnlineChildMutationBatch,
  jobSyncChangeStatements,
  nextJobRevision,
} from "@/lib/trade-team-sync-server";
import { publishedTradeFormTemplate, publishedTradeFormTemplatesFor } from "@/lib/trade-form-templates-server";
import { assertTradeFormAttachmentAccess, TradeFormSelectionError, tradeFormTemplateMetadata } from "@/lib/trade-job-form-attachment-server";
import { ENERGY_SERVICE_IDS, LEGACY_ENERGY_SERVICE_ALIASES } from "@/lib/energy-service-catalogue.mjs";
import { TRADE_JOB_FORM_COLUMNS, tradeJobFormProjection, saveTradeJobForm, TradeJobFormError } from "@/lib/trade-job-forms-server";

export const runtime = "edge";

function formError(error: unknown) {
  if (error instanceof TradeFormSelectionError) return adminJson({ ok: false, error: error.message }, error.status);
  if (error instanceof TradeJobFormError) return adminJson({ ok: false, error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  const mfa = mfaErrorResponse(error);
  if (mfa) return mfa;
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "TEAM_ACCESS_RECORD_REQUIRED") return adminJson({ ok: false, error: "No active installer team access was found." }, 404);
  if (code === "FIELD_EVIDENCE_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow field records." }, 403);
  if (code === "FIELD_EVIDENCE_MANAGEMENT_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow field record changes." }, 403);
  if (code === "FULL_ACCESS_REQUIRED" || code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Field forms require approved installer access." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Field forms are available to installer accounts." }, 403);
  if (code === "JOB_NOT_FOUND" || code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is not available to your account." }, 404);
  if (code === "TERMINAL_JOB_LOCKED") return adminJson({ ok: false, error: "Imported jobs must first be started in TLink. Completed and cancelled jobs are locked." }, 409);
  if (code === "ONLINE_MUTATION_CONFLICT") return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This job changed elsewhere. Refresh it before saving." }, 409);
  return adminJson({ ok: false, error: "The field form request could not be completed." }, 500);
}

async function formPayload(ownerUid: string, workOrderId: string) {
  const db = getD1();
  const payload = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT w.id, w.service_category, w.source_type, d.customer_source FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(workOrderId, ownerUid),
    db.prepare(`SELECT ${TRADE_JOB_FORM_COLUMNS}
    FROM trade_job_forms WHERE work_order_id = ? AND firebase_uid = ? ORDER BY created_at`)
    .bind(workOrderId, ownerUid),
  ]);
  if (!Array.isArray(payload) || payload.length !== 2 || !payload[0]?.success || !Array.isArray(payload[0].results) || payload[0].results.length > 1) throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  const work = payload[0].results[0];
  if (!work) throw new Error("JOB_NOT_FOUND");
  const rows = payload[1];
  if (!rows?.success || !Array.isArray(rows.results)) throw new Error("FORM_PAYLOAD_UNAVAILABLE");
  return {
    serviceCategory: String(work.service_category),
    protectedJob: work.source_type === "opportunity" || work.customer_source === "platform_private",
    templates: (await publishedTradeFormTemplatesFor(String(work.service_category), undefined, ownerUid)).map(tradeFormTemplateMetadata),
    forms: rows.results.map(tradeJobFormProjection),
  };
}

async function accessAndJob(request: Request, workOrderId: string) {
  const access = await requireInstallerTeamAccess(request);
  const job = await assignedJob(access, workOrderId);
  return { access, job };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const parameters = new URL(request.url).searchParams;
    if (parameters.get("mode") === "library") {
      const access = await requireInstallerTeamAccess(request);
      await assertTradeFormAttachmentAccess(access, getD1());
      const serviceCategory = parameters.get("serviceCategory") || "";
      if (![...ENERGY_SERVICE_IDS, ...Object.keys(LEGACY_ENERGY_SERVICE_ALIASES), "mounting-hardware", "controls"].includes(serviceCategory)) {
        return adminJson({ ok: false, error: "Choose an available work type." }, 400);
      }
      return adminJson({ ok: true, serviceCategory,
        templates: (await publishedTradeFormTemplatesFor(serviceCategory, getD1(), access.ownerUid)).map(tradeFormTemplateMetadata) });
    }
    const workOrderId = cleanAdminText(parameters.get("workOrderId"), 180);
    const { access } = await accessAndJob(request, workOrderId);
    if (!access.canViewFieldEvidence) throw new Error("FIELD_EVIDENCE_VIEW_REQUIRED");
    return adminJson({ ok: true, ...(await formPayload(access.ownerUid, workOrderId)) });
  } catch (error) { return formError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const { access, job } = await accessAndJob(request, workOrderId);
    if (!access.canManageFieldEvidence) throw new Error("FIELD_EVIDENCE_MANAGEMENT_REQUIRED");
    const templateKey = cleanAdminText(body.templateKey, 100);
    const templateVersion = Math.max(1, Math.min(1000, Math.round(Number(body.templateVersion || 1))));
    const work = await getD1().prepare(`SELECT service_category, stage, revision
      FROM trade_work_orders WHERE id = ? AND firebase_uid = ? AND record_status = 'active'`)
      .bind(workOrderId, access.ownerUid).first<Record<string, unknown>>();
    if (!work) throw new Error("JOB_NOT_FOUND");
    if (Number(work.revision) !== Number(job.revision)) throw new Error("ONLINE_MUTATION_CONFLICT");
    if (["imported", "completed", "cancelled"].includes(String(work.stage))) throw new Error("TERMINAL_JOB_LOCKED");
    const template = await publishedTradeFormTemplate(templateKey, templateVersion, String(work?.service_category || "other"), undefined, access.ownerUid);
    if (!template) return adminJson({ ok: false, error: "Choose a form available for this work type." }, 400);
    const existing = await getD1().prepare(`SELECT id FROM trade_job_forms
      WHERE work_order_id = ? AND firebase_uid = ? AND template_key = ? AND template_version = ?`)
      .bind(workOrderId, access.ownerUid, template.key, template.version).first();
    if (existing) return adminJson({ ok: true, ...(await formPayload(access.ownerUid, workOrderId)) });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const revision = nextJobRevision(job.revision);
    const jobStage = String(work.stage);
    await guardedOnlineChildMutationBatch(getD1(), [
      getD1().prepare(`INSERT INTO trade_job_forms
        (id, work_order_id, firebase_uid, template_key, template_version, template_name, jurisdiction,
         template_snapshot, answers, status, revision, completed_by_uid, completed_at, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, '{}', 'draft', 1, '', '', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM trade_work_orders work_order
          WHERE work_order.id = ? AND work_order.firebase_uid = ?
            AND work_order.record_status = 'active'
            AND work_order.stage = ?
            AND work_order.stage NOT IN ('imported', 'completed', 'cancelled')
            AND work_order.revision = ?
        )
        ON CONFLICT(work_order_id, template_key, template_version) DO NOTHING`)
        .bind(id, workOrderId, access.ownerUid, template.key, template.version, template.name, template.jurisdiction,
          JSON.stringify(template), now, now, workOrderId, access.ownerUid, jobStage, Number(work.revision)),
      getD1().prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
          AND stage = ? AND stage NOT IN ('imported', 'completed', 'cancelled') AND revision = ?
          AND EXISTS (
            SELECT 1 FROM trade_job_forms child
            WHERE child.id = ? AND child.work_order_id = trade_work_orders.id
              AND child.firebase_uid = trade_work_orders.firebase_uid
              AND child.revision = 1 AND child.updated_at = ?
          )`)
        .bind(revision, now, workOrderId, access.ownerUid, jobStage, Number(work.revision), id, now),
      getD1().prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'field_form_started', ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, `${template.name} started.`, now),
      ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
        audienceMemberId: String(job.assignee_member_id || "") }),
    ], {
      childKind: "form",
      childId: id,
      childRevision: 1,
      jobRevision: revision,
      jobStage,
      ownerUid: access.ownerUid,
      updatedAt: now,
      workOrderId,
    });
    return adminJson({ ok: true, ...(await formPayload(access.ownerUid, workOrderId)) }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid field form request." }, 400);
    return formError(error);
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const { access, job } = await accessAndJob(request, workOrderId);
    const result = await saveTradeJobForm(access, job, { workOrderId, formId: cleanAdminText(body.formId, 180),
      baseRevision: body.baseRevision, answers: body.answers, complete: body.complete }, request.signal);
    return adminJson({ ok: true, ...result, ...(await formPayload(access.ownerUid, workOrderId)) });
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid field form request." }, 400);
    return formError(error);
  }
}
