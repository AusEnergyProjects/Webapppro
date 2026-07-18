import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { photoRequestProofOverview } from "@/lib/photo-request-review-server";
import { normalisePhotoRequirements } from "@/lib/trade-photo-requests";

export const runtime = "edge";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MEDIA_CATEGORIES = new Set(["before", "progress", "after", "document"]);
const SIGNER_ROLES = new Set(["technician", "customer"]);
const FIELD_TRANSITIONS = {
  start_travel: { from: "scheduled", to: "en_route", timestamp: "travel_started_at", label: "Start travel" },
  arrive: { from: "en_route", to: "arrived", timestamp: "arrived_at", label: "Arrive" },
  start_work: { from: "arrived", to: "in_progress", timestamp: "work_started_at", label: "Start work" },
  finish: { from: "in_progress", to: "completed", timestamp: "completed_at", label: "Finish" },
} as const;
type FieldTransition = keyof typeof FIELD_TRANSITIONS;

type EvidenceBucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ body: BodyInit; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
};

function bucket() {
  const value = (env as unknown as { EVIDENCE?: EvidenceBucket }).EVIDENCE;
  if (!value) throw new Error("STORAGE_UNAVAILABLE");
  return value;
}

function safeName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "job-file";
}

function fieldError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "PROFILE_REQUIRED") return adminJson({ ok: false, error: "Complete the installer profile first." }, 404);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Field tools are available to installer accounts only." }, 403);
  if (code === "FULL_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Complete trade verification before using field tools." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is not assigned to your team account." }, 403);
  if (code === "TEAM_MEMBERSHIP_REQUIRED") return adminJson({ ok: false, error: "No active installer team membership was found." }, 404);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Field tools require team access on the installer account." }, 403);
  if (code === "PROTECTED_CUSTOMER") return adminJson({ ok: false, error: "Customer sign-off for an AEA protected job must stay in the AEA customer pathway." }, 403);
  if (code === "STORAGE_UNAVAILABLE") return adminJson({ ok: false, error: "Job file storage is not available." }, 503);
  if (code === "FIELD_TRANSITION_CONFLICT") return adminJson({ ok: false, error: "The job changed on another device. Refresh before trying again." }, 409);
  return adminJson({ ok: false, error: "The field-work record could not be completed." }, 500);
}

async function payload(firebaseUid: string, workOrderId: string) {
  const db = getD1();
  const [time, media, signoffs] = await Promise.all([
    db.prepare(`SELECT id, staff_label, work_date, duration_minutes, notes, created_at
      FROM trade_crm_time_entries WHERE firebase_uid = ? AND work_order_id = ? ORDER BY work_date DESC, created_at DESC`)
      .bind(firebaseUid, workOrderId).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, category, file_name, content_type, size_bytes, caption, source, photo_requirement_id,
      request_revision, checklist_version, customer_acknowledged_at, created_at
      FROM trade_crm_job_media WHERE firebase_uid = ? AND work_order_id = ? ORDER BY created_at DESC`)
      .bind(firebaseUid, workOrderId).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, signer_role, signer_name, confirmation_text, method, signed_at
      FROM trade_crm_signoffs WHERE firebase_uid = ? AND work_order_id = ? ORDER BY signed_at DESC`)
      .bind(firebaseUid, workOrderId).all<Record<string, unknown>>(),
  ]);
  const request = await db.prepare(`SELECT id, revision, requirements, status FROM trade_crm_photo_requests
    WHERE firebase_uid = ? AND work_order_id = ?`).bind(firebaseUid, workOrderId).first<Record<string, unknown>>();
  let proofReview = null;
  if (request && request.status !== "revoked") {
    try {
      const requirements = normalisePhotoRequirements(JSON.parse(String(request.requirements || "[]")));
      proofReview = await photoRequestProofOverview({ ownerUid: firebaseUid, workOrderId, requestId: String(request.id),
        requestRevision: Number(request.revision), requirements });
    } catch { proofReview = null; }
  }
  const job = await db.prepare(`SELECT w.id, w.work_number, w.title, w.stage, w.site_area, w.scheduled_start, w.scheduled_end, w.source_type,
      d.customer_source, d.description, d.service_site_id,
      CASE WHEN c.business_name <> '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
      COALESCE((SELECT cc.phone FROM trade_crm_site_contacts sc JOIN trade_crm_customer_contacts cc
        ON cc.id = sc.customer_contact_id AND cc.firebase_uid = sc.firebase_uid
        WHERE sc.service_site_id = ss.id AND sc.firebase_uid = w.firebase_uid AND sc.record_status = 'active' AND cc.record_status = 'active'
        AND cc.phone <> '' ORDER BY sc.is_primary DESC, sc.created_at LIMIT 1), c.phone, '') customer_phone,
      ss.site_label, ss.address_line_1, ss.address_line_2, ss.suburb, ss.address_state, ss.postcode,
      a.id appointment_id, a.status appointment_status, a.starts_at, a.ends_at, a.travel_started_at, a.arrived_at, a.work_started_at, a.completed_at
    FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
    LEFT JOIN trade_crm_service_sites ss ON ss.id = d.service_site_id AND ss.firebase_uid = w.firebase_uid AND ss.record_status = 'active'
    LEFT JOIN trade_crm_appointments a ON a.id = (SELECT fa.id FROM trade_crm_appointments fa WHERE fa.work_order_id = w.id AND fa.firebase_uid = w.firebase_uid
      AND fa.status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'completed')
      ORDER BY CASE fa.status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 WHEN 'en_route' THEN 2 WHEN 'scheduled' THEN 3 ELSE 4 END, fa.starts_at DESC LIMIT 1)
    WHERE w.id = ? AND w.firebase_uid = ? AND w.record_status = 'active'`).bind(workOrderId, firebaseUid).first<Record<string, unknown>>();
  const [taskCount, formCount, issueCount, planCount, unsyncedCount] = await Promise.all([
    db.prepare("SELECT COUNT(*) count FROM trade_work_order_tasks WHERE work_order_id = ? AND firebase_uid = ? AND status <> 'done'").bind(workOrderId, firebaseUid).first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) count FROM trade_job_forms WHERE work_order_id = ? AND firebase_uid = ? AND status <> 'complete'").bind(workOrderId, firebaseUid).first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) count FROM trade_crm_job_notes WHERE work_order_id = ? AND firebase_uid = ? AND note_type = 'issue' AND issue_status = 'open'").bind(workOrderId, firebaseUid).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) count FROM trade_crm_job_plan_requirements r JOIN trade_crm_job_plans p ON p.id = r.job_plan_id AND p.firebase_uid = r.firebase_uid
      WHERE p.work_order_id = ? AND p.firebase_uid = ? AND r.status NOT IN ('installed', 'complete', 'completed', 'done', 'not_required')`).bind(workOrderId, firebaseUid).first<Record<string, unknown>>(),
    db.prepare("SELECT COUNT(*) count FROM trade_offline_actions WHERE owner_uid = ? AND entity_id = ? AND status IN ('processing', 'conflict')").bind(firebaseUid, workOrderId).first<Record<string, unknown>>(),
  ]);
  const direct = job?.source_type !== "opportunity" && job?.customer_source === "trade_owned";
  const address = direct ? [job?.address_line_1, job?.address_line_2, job?.suburb, job?.address_state, job?.postcode].filter(Boolean).join(", ") : "";
  const counts = { tasks: Number(taskCount?.count || 0), forms: Number(formCount?.count || 0), issues: Number(issueCount?.count || 0), plan: Number(planCount?.count || 0), unsynced: Number(unsyncedCount?.count || 0) };
  const blockers = [
    ...(counts.tasks ? [{ key: "tasks", label: `${counts.tasks} assigned task${counts.tasks === 1 ? " is" : "s are"} not complete`, target: "tasks" }] : []),
    ...(counts.forms ? [{ key: "forms", label: `${counts.forms} required form${counts.forms === 1 ? " is" : "s are"} not complete`, target: "forms" }] : []),
    ...(request && request.status !== "revoked" && !proofReview?.proofReady ? [{ key: "proof", label: "Required photo proof is not ready", target: "evidence" }] : []),
    ...(counts.issues ? [{ key: "issues", label: `${counts.issues} open issue${counts.issues === 1 ? " needs" : "s need"} attention`, target: "notes" }] : []),
    ...(counts.plan ? [{ key: "scope", label: `${counts.plan} work-plan item${counts.plan === 1 ? " is" : "s are"} not complete`, target: "work-plan" }] : []),
    ...(counts.unsynced ? [{ key: "sync", label: "Unsynchronised field changes need attention", target: "sync" }] : []),
  ];
  const appointmentStatus = String(job?.appointment_status || "");
  const fieldCompleted = appointmentStatus === "completed" && job?.stage === "completed";
  const action = Object.entries(FIELD_TRANSITIONS).find(([, transition]) => transition.from === appointmentStatus);
  const fieldJob = job ? { id: job.id, workNumber: job.work_number, title: job.title, status: appointmentStatus || job.stage,
    customerName: direct ? String(job.customer_name || "Direct customer") : job.source_type === "opportunity" ? "AEA protected customer" : "Internal job",
    serviceSite: direct ? String(job.site_label || job.suburb || "Service site") : String(job.site_area || "Protected service area"),
    scheduledStart: job.starts_at || job.scheduled_start, scheduledEnd: job.ends_at || job.scheduled_end,
    appointmentId: String(job.appointment_id || ""), primaryAction: action ? { action: action[0], label: action[1].label } : null,
    actionUnavailableReason: !job.appointment_id ? "Schedule this job before starting travel." : fieldCompleted ? "Field work is complete." : appointmentStatus === "completed" ? "This appointment was completed outside the field workflow. Reopen or schedule it before field work." : "This appointment cannot advance from its current state.",
    phone: direct ? String(job.customer_phone || "") : "", address, directionsUrl: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : "",
    timestamps: { travelStartedAt: job.travel_started_at || "", arrivedAt: job.arrived_at || "", workStartedAt: job.work_started_at || "", completedAt: job.completed_at || "" },
    checklist: [
      { key: "scope", label: "Scope and instructions", complete: Boolean(job.description) && !counts.plan, count: counts.plan, target: "notes" },
      { key: "tasks", label: "Assigned tasks", complete: !counts.tasks, count: counts.tasks, target: "tasks" },
      { key: "forms", label: "Required forms", complete: !counts.forms, count: counts.forms, target: "forms" },
      { key: "proof", label: "Required photo proof", complete: !request || request.status === "revoked" || Boolean(proofReview?.proofReady), count: request && request.status !== "revoked" && !proofReview?.proofReady ? 1 : 0, target: "evidence" },
      { key: "issues", label: "Open issues or blockers", complete: !counts.issues, count: counts.issues, target: "notes" },
    ], blockers, completion: { ready: blockers.length === 0, invoiceReady: fieldCompleted, handoverReady: fieldCompleted } } : null;
  return {
    timeEntries: time.results.map((row) => ({ id: row.id, staffLabel: row.staff_label, workDate: row.work_date,
      durationMinutes: Number(row.duration_minutes), notes: row.notes, createdAt: row.created_at })),
    media: media.results.map((row) => ({ id: row.id, category: row.category, fileName: row.file_name,
      contentType: row.content_type, sizeBytes: Number(row.size_bytes), caption: row.caption, source: row.source,
      photoRequirementId: row.photo_requirement_id, requestRevision: Number(row.request_revision || 0),
      checklistVersion: row.checklist_version, customerAcknowledgedAt: row.customer_acknowledged_at, createdAt: row.created_at })),
    signoffs: signoffs.results.map((row) => ({ id: row.id, signerRole: row.signer_role, signerName: row.signer_name,
      confirmationText: row.confirmation_text, method: row.method, signedAt: row.signed_at })),
    proofReview, fieldJob,
  };
}

async function advanceFieldJob(access: TeamAccess, job: Record<string, unknown>, workOrderId: string, body: Record<string, unknown>) {
  const action = cleanAdminText(body.transition, 30) as FieldTransition;
  const transition = FIELD_TRANSITIONS[action];
  if (!transition) return adminJson({ ok: false, error: "Choose the next available field-job action." }, 400);
  const clientActionId = cleanAdminText(body.clientActionId, 180);
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,179}$/.test(clientActionId)) return adminJson({ ok: false, error: "A stable field action reference is required." }, 400);
  const db = getD1(); const actionType = `field_${action}`;
  const receipt = await db.prepare("SELECT action_type, entity_id, status FROM trade_offline_actions WHERE owner_uid = ? AND client_action_id = ?")
    .bind(access.ownerUid, clientActionId).first<Record<string, unknown>>();
  if (receipt) {
    if (receipt.action_type !== actionType || receipt.entity_id !== workOrderId) return adminJson({ ok: false, error: "This field action reference was already used for different work." }, 409);
    return adminJson({ ok: true, duplicate: true, protectedJob: job.source_type === "opportunity", revision: Number(job.revision), ...(await payload(access.ownerUid, workOrderId)) });
  }
  const appointment = await db.prepare(`SELECT * FROM trade_crm_appointments WHERE work_order_id = ? AND firebase_uid = ?
    AND status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'completed')
    ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 WHEN 'en_route' THEN 2 WHEN 'scheduled' THEN 3 ELSE 4 END, starts_at DESC LIMIT 1`)
    .bind(workOrderId, access.ownerUid).first<Record<string, unknown>>();
  if (!appointment) return adminJson({ ok: false, error: "Schedule this job before starting field work." }, 409);
  if (appointment.status !== transition.from) return adminJson({ ok: false, error: `This action is out of order. The appointment is ${String(appointment.status).replaceAll("_", " ")}.` }, 409);
  if (action === "finish") {
    const current = await payload(access.ownerUid, workOrderId);
    const blockers = (current.fieldJob as { blockers?: Array<{ key: string; label: string; target: string }> } | null)?.blockers || [];
    if (blockers.length) return adminJson({ ok: false, error: "Finish the required job items before completing this work.", blockers }, 409);
  }
  const now = new Date().toISOString(); const revision = nextJobRevision(job.revision); const receiptId = crypto.randomUUID();
  const timestampColumn = transition.timestamp;
  const results = await db.batch([
    db.prepare(`INSERT INTO trade_offline_actions
      (id, owner_uid, actor_uid, member_id, device_id, client_action_id, payload_hash, action_type, entity_type, entity_id,
       base_revision, result_revision, status, lease_until, error_code, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'web-field', ?, ?, ?, 'job', ?, ?, ?, 'applied', '', '', ?, ?
      WHERE EXISTS (SELECT 1 FROM trade_crm_appointments WHERE id = ? AND firebase_uid = ? AND status = ?)`)
      .bind(receiptId, access.ownerUid, access.actorUid, access.memberId || "", clientActionId, `${workOrderId}:${action}`, actionType,
        workOrderId, Number(job.revision), revision, now, now, appointment.id, access.ownerUid, transition.from),
    db.prepare(`UPDATE trade_crm_appointments SET status = ?, ${timestampColumn} = ?, last_transition_by_uid = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND status = ? AND EXISTS (SELECT 1 FROM trade_offline_actions WHERE id = ?)`)
      .bind(transition.to, now, access.actorUid, now, appointment.id, access.ownerUid, transition.from, receiptId),
    db.prepare(`UPDATE trade_work_orders SET stage = CASE WHEN ? = 'start_work' THEN 'in_progress' WHEN ? = 'finish' THEN 'completed' ELSE stage END,
      revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND EXISTS (SELECT 1 FROM trade_offline_actions WHERE id = ?)`)
      .bind(action, action, revision, now, workOrderId, access.ownerUid, receiptId),
    db.prepare(`UPDATE trade_crm_job_details SET pipeline_stage = CASE WHEN ? = 'start_work' THEN 'in_progress' WHEN ? = 'finish' THEN 'complete' ELSE pipeline_stage END,
      updated_at = ? WHERE work_order_id = ? AND firebase_uid = ? AND EXISTS (SELECT 1 FROM trade_offline_actions WHERE id = ?)`)
      .bind(action, action, now, workOrderId, access.ownerUid, receiptId),
    db.prepare(`UPDATE trade_crm_job_plans SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE work_order_id = ? AND firebase_uid = ? AND ? = 'finish' AND EXISTS (SELECT 1 FROM trade_offline_actions WHERE id = ?)`)
      .bind(now, now, workOrderId, access.ownerUid, action, receiptId),
    db.prepare(`UPDATE trade_crm_job_plan_phases SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE firebase_uid = ? AND job_plan_id IN (SELECT id FROM trade_crm_job_plans WHERE work_order_id = ? AND firebase_uid = ?)
      AND ? = 'finish' AND EXISTS (SELECT 1 FROM trade_offline_actions WHERE id = ?)`)
      .bind(now, now, access.ownerUid, workOrderId, access.ownerUid, action, receiptId),
    db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
      SELECT ?, ?, ?, 'field_state_changed', ?, ? WHERE EXISTS (SELECT 1 FROM trade_offline_actions WHERE id = ?)`)
      .bind(crypto.randomUUID(), workOrderId, access.ownerUid, `${transition.label} recorded by ${access.displayName || "field worker"}.`, now, receiptId),
    db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
      SELECT ?, ?, ?, 'job_completed', 'Required work, forms, proof and blockers cleared. Invoice and handover preparation are ready.', ?
      WHERE ? = 'finish' AND EXISTS (SELECT 1 FROM trade_offline_actions WHERE id = ?)`)
      .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now, action, receiptId),
  ]);
  if (!results[0]?.meta.changes) throw new Error("FIELD_TRANSITION_CONFLICT");
  await db.batch(jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now, audienceMemberId: String(job.assignee_member_id || "") }));
  return adminJson({ ok: true, protectedJob: job.source_type === "opportunity", revision, ...(await payload(access.ownerUid, workOrderId)) });
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    const url = new URL(request.url);
    const downloadId = cleanAdminText(url.searchParams.get("download"), 180);
    if (downloadId) {
      const record = await getD1().prepare(`SELECT m.object_key, m.file_name, m.content_type, m.work_order_id FROM trade_crm_job_media m
        JOIN trade_work_orders w ON w.id = m.work_order_id
        WHERE m.id = ? AND m.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
        .bind(downloadId, access.ownerUid, access.ownerUid).first<{ object_key: string; file_name: string; content_type: string; work_order_id: string }>();
      if (!record) return adminJson({ ok: false, error: "Job file not found." }, 404);
      await assignedJob(access, record.work_order_id);
      const object = await bucket().get(record.object_key);
      if (!object) return adminJson({ ok: false, error: "Stored job file not found." }, 404);
      return new Response(object.body, { headers: { "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${safeName(record.file_name)}"`,
        "Content-Type": object.httpMetadata?.contentType || record.content_type, "X-Content-Type-Options": "nosniff" } });
    }
    const workOrderId = cleanAdminText(url.searchParams.get("workOrderId"), 180);
    const job = await assignedJob(access, workOrderId);
    return adminJson({ ok: true, protectedJob: job.source_type === "opportunity", revision: Number(job.revision),
      ...(await payload(access.ownerUid, workOrderId)) });
  } catch (error) { return fieldError(error); }
}

async function upload(request: Request, access: TeamAccess) {
  let form: FormData;
  try { form = await request.formData(); }
  catch { return adminJson({ ok: false, error: "The job upload could not be read." }, 400); }
  const workOrderId = cleanAdminText(form.get("workOrderId"), 180);
  const job = await assignedJob(access, workOrderId);
  const file = form.get("file");
  const categoryValue = cleanAdminText(form.get("category"), 20);
  const category = MEDIA_CATEGORIES.has(categoryValue) ? categoryValue : "progress";
  if (!(file instanceof File) || !file.name) return adminJson({ ok: false, error: "Choose a photo or PDF." }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return adminJson({ ok: false, error: "Upload a JPEG, PNG, WebP or PDF file." }, 400);
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return adminJson({ ok: false, error: "The file must be no larger than 8 MB." }, 400);
  const id = crypto.randomUUID();
  const objectKey = `crm-job-media/${access.ownerUid}/${workOrderId}/${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const revision = nextJobRevision(job.revision);
  const store = bucket();
  await store.put(objectKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type },
    customMetadata: { owner: access.ownerUid, actor: access.actorUid, workOrderId, mediaId: id } });
  try {
    await getD1().batch([
      getD1().prepare(`INSERT INTO trade_crm_job_media
        (id, work_order_id, firebase_uid, category, file_name, content_type, size_bytes, object_key, caption, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, workOrderId, access.ownerUid, category, safeName(file.name), file.type, file.size, objectKey,
          cleanAdminText(form.get("caption"), 300), now, now),
      getD1().prepare(`INSERT INTO trade_work_order_events
        (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'field_file_added', 'Field photo or document added.', ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, now),
      getD1().prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(revision, now, workOrderId, access.ownerUid),
      ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
        audienceMemberId: job.assignee_member_id }),
    ]);
  } catch (error) { await store.delete(objectKey); throw error; }
  return adminJson({ ok: true, revision, ...(await payload(access.ownerUid, workOrderId)) }, 201);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) return await upload(request, access);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid field-work request." }, 400); }
    const workOrderId = cleanAdminText(body.workOrderId, 180);
    const job = await assignedJob(access, workOrderId);
    const action = cleanAdminText(body.action, 30);
    if (action === "field_transition") return await advanceFieldJob(access, job, workOrderId, body);
    const now = new Date().toISOString();
    let recordStatement: D1PreparedStatement;
    if (action === "add_time") {
      const duration = Number(body.durationMinutes);
      const workDate = cleanAdminText(body.workDate, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
        return adminJson({ ok: false, error: "Add a valid work date and between 1 minute and 24 hours." }, 400);
      }
      recordStatement = getD1().prepare(`INSERT INTO trade_crm_time_entries
        (id, work_order_id, firebase_uid, staff_label, work_date, duration_minutes, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, access.isOwner ? cleanAdminText(body.staffLabel, 80) : access.displayName, workDate,
          duration, cleanAdminText(body.notes, 500), now, now);
    } else if (action === "add_signoff") {
      const signerRole = cleanAdminText(body.signerRole, 20);
      const signerName = cleanAdminText(body.signerName, 100);
      if (!SIGNER_ROLES.has(signerRole) || !signerName || body.confirmed !== true) {
        return adminJson({ ok: false, error: "Choose the signer, enter their name and confirm the statement." }, 400);
      }
      if (job.source_type === "opportunity" && signerRole === "customer") throw new Error("PROTECTED_CUSTOMER");
      const confirmation = signerRole === "customer"
        ? "I confirm the recorded work has been presented to me for review."
        : "I confirm the field record is accurate to the best of my knowledge.";
      recordStatement = getD1().prepare(`INSERT INTO trade_crm_signoffs
        (id, work_order_id, firebase_uid, signer_role, signer_name, confirmation_text, method, signed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'typed', ?, ?)`)
        .bind(crypto.randomUUID(), workOrderId, access.ownerUid, signerRole, signerName, confirmation, now, now);
    } else return adminJson({ ok: false, error: "Unsupported field-work action." }, 400);
    const revision = nextJobRevision(job.revision);
    await getD1().batch([
      recordStatement,
      getD1().prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(revision, now, workOrderId, access.ownerUid),
      ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
        audienceMemberId: job.assignee_member_id }),
    ]);
    return adminJson({ ok: true, protectedJob: job.source_type === "opportunity", revision,
      ...(await payload(access.ownerUid, workOrderId)) }, 201);
  } catch (error) { return fieldError(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    const id = cleanAdminText(new URL(request.url).searchParams.get("id"), 180);
    const record = await getD1().prepare(`SELECT m.object_key, m.work_order_id FROM trade_crm_job_media m
      JOIN trade_work_orders w ON w.id = m.work_order_id
      WHERE m.id = ? AND m.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
      .bind(id, access.ownerUid, access.ownerUid).first<{ object_key: string; work_order_id: string }>();
    if (!record) return adminJson({ ok: false, error: "Job file not found." }, 404);
    const job = await assignedJob(access, record.work_order_id);
    await bucket().delete(record.object_key);
    const now = new Date().toISOString(); const revision = nextJobRevision(job.revision);
    await getD1().batch([
      getD1().prepare("DELETE FROM trade_crm_job_media WHERE id = ? AND firebase_uid = ?").bind(id, access.ownerUid),
      getD1().prepare("UPDATE trade_work_orders SET revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(revision, now, record.work_order_id, access.ownerUid),
      ...jobSyncChangeStatements(getD1(), { ownerUid: access.ownerUid, workOrderId: record.work_order_id,
        revision, changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    return adminJson({ ok: true, revision, ...(await payload(access.ownerUid, record.work_order_id)) });
  } catch (error) { return fieldError(error); }
}
