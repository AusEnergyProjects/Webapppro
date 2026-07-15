import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { normalizeTradeFormAnswers, tradeFormCompletion, tradeFormTemplate, tradeFormTemplatesFor } from "@/lib/trade-form-library.mjs";
import { addMonthsToIsoDate } from "@/lib/asset-lifecycle.mjs";

export const runtime = "edge";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){8,}/;

function formError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "TEAM_MEMBERSHIP_REQUIRED") return adminJson({ ok: false, error: "No active installer team membership was found." }, 404);
  if (code === "FULL_ACCESS_REQUIRED" || code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Field forms require paid installer operations access." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Field forms are available to installer accounts." }, 403);
  if (code === "JOB_NOT_FOUND" || code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is not available to your account." }, 404);
  return adminJson({ ok: false, error: "The field form request could not be completed." }, 500);
}

function parseJson(value: unknown, fallback: unknown) {
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function containsPrivateData(value: unknown) {
  const text = JSON.stringify(value || {});
  return EMAIL_PATTERN.test(text) || PHONE_PATTERN.test(text);
}

async function formPayload(ownerUid: string, workOrderId: string) {
  const db = getD1();
  const work = await db.prepare(`SELECT w.id, w.service_category, w.source_type, d.customer_source FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
    .bind(workOrderId, ownerUid).first<Record<string, unknown>>();
  if (!work) throw new Error("JOB_NOT_FOUND");
  const rows = await db.prepare(`SELECT id, template_key, template_version, template_name, jurisdiction,
      template_snapshot, answers, status, completed_by_uid, completed_at, created_at, updated_at
    FROM trade_job_forms WHERE work_order_id = ? AND firebase_uid = ? ORDER BY created_at`)
    .bind(workOrderId, ownerUid).all<Record<string, unknown>>();
  return {
    protectedJob: work.source_type === "opportunity" || work.customer_source === "platform_private",
    templates: tradeFormTemplatesFor(String(work.service_category)).map((template) => ({
      key: template.key, version: template.version, name: template.name, jurisdiction: template.jurisdiction,
      description: template.description, guidance: template.guidance, fieldCount: template.fields.length,
    })),
    forms: rows.results.map((row) => {
      const snapshot = parseJson(row.template_snapshot, { fields: [] }) as Record<string, unknown>;
      const answers = parseJson(row.answers, {}) as Record<string, unknown>;
      const completion = tradeFormCompletion(snapshot, answers);
      return {
        id: row.id, templateKey: row.template_key, templateVersion: Number(row.template_version),
        templateName: row.template_name, jurisdiction: row.jurisdiction, template: snapshot, answers,
        status: row.status, ready: completion.ready, missing: completion.missing,
        completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
      };
    }),
  };
}

async function accessAndJob(request: Request, workOrderId: string) {
  const access = await requireInstallerTeamAccess(request, false);
  const job = await assignedJob(access, workOrderId);
  return { access, job };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const workOrderId = cleanAdminText(new URL(request.url).searchParams.get("workOrderId"), 180);
    const { access } = await accessAndJob(request, workOrderId);
    return adminJson({ ok: true, ...(await formPayload(access.ownerUid, workOrderId)) });
  } catch (error) { return formError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const { access, job } = await accessAndJob(request, workOrderId);
    const templateKey = cleanAdminText(body.templateKey, 100);
    const templateVersion = Math.max(1, Math.min(1000, Math.round(Number(body.templateVersion || 1))));
    const work = await getD1().prepare("SELECT service_category FROM trade_work_orders WHERE id = ? AND firebase_uid = ?")
      .bind(workOrderId, access.ownerUid).first<Record<string, unknown>>();
    const template = tradeFormTemplate(templateKey, templateVersion, String(work?.service_category || "other"));
    if (!template) return adminJson({ ok: false, error: "Choose a form available for this work type." }, 400);
    const existing = await getD1().prepare(`SELECT id FROM trade_job_forms
      WHERE work_order_id = ? AND firebase_uid = ? AND template_key = ? AND template_version = ?`)
      .bind(workOrderId, access.ownerUid, template.key, template.version).first();
    if (existing) return adminJson({ ok: true, ...(await formPayload(access.ownerUid, workOrderId)) });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const revision = nextJobRevision(job.revision);
    await getD1().batch([
      getD1().prepare(`INSERT INTO trade_job_forms
        (id, work_order_id, firebase_uid, template_key, template_version, template_name, jurisdiction,
         template_snapshot, answers, status, completed_by_uid, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'draft', '', '', ?, ?)
        ON CONFLICT(work_order_id, template_key, template_version) DO NOTHING`)
        .bind(id, workOrderId, access.ownerUid, template.key, template.version, template.name, template.jurisdiction,
          JSON.stringify(template), now, now),
      getD1().prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(revision, now, workOrderId, access.ownerUid),
      getD1().prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'field_form_started', ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, `${template.name} started.`, now),
      ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
        audienceMemberId: String(job.assignee_member_id || "") }),
    ]);
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
    const formId = cleanAdminText(body.formId, 180);
    const row = await getD1().prepare(`SELECT id, template_key, template_snapshot, status FROM trade_job_forms
      WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`).bind(formId, workOrderId, access.ownerUid)
      .first<Record<string, unknown>>();
    if (!row) return adminJson({ ok: false, error: "Field form not found." }, 404);
    if (row.status === "complete") return adminJson({ ok: false, error: "This completed form is locked. Start a newer template version if the record must be replaced." }, 409);
    const template = parseJson(row.template_snapshot, null) as Record<string, unknown> | null;
    if (!template || !Array.isArray(template.fields)) return adminJson({ ok: false, error: "The saved form template is invalid." }, 409);
    const answers = normalizeTradeFormAnswers(template, body.answers);
    if (containsPrivateData(answers)) return adminJson({ ok: false, error: "Keep customer contact details and phone numbers out of technical field forms." }, 400);
    const completion = tradeFormCompletion(template, answers);
    const complete = body.complete === true;
    if (complete && !completion.ready) return adminJson({ ok: false, error: `Complete the required fields: ${completion.missing.join(", ")}.` }, 400);
    const now = new Date().toISOString();
    const revision = nextJobRevision(job.revision);
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
    await getD1().batch([
      getD1().prepare(`UPDATE trade_job_forms SET answers = ?, status = ?, completed_by_uid = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND work_order_id = ? AND firebase_uid = ?`)
        .bind(JSON.stringify(answers), complete ? "complete" : "draft", complete ? access.actorUid : "",
          complete ? now : "", now, formId, workOrderId, access.ownerUid),
      getD1().prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(revision, now, workOrderId, access.ownerUid),
      getD1().prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, complete ? "field_form_completed" : "field_form_saved",
          complete ? `${String(template.name || "Field form")} completed.` : `${String(template.name || "Field form")} saved.`, now),
      ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
          audienceMemberId: String(job.assignee_member_id || "") }),
      ...lifecycleStatements,
    ]);
    return adminJson({ ok: true, ...(await formPayload(access.ownerUid, workOrderId)) });
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid field form request." }, 400);
    return formError(error);
  }
}
