import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { canAssignJob, requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { serviceFollowUpDueState } from "@/lib/trade-service-follow-ups";

export const runtime = "edge";

const ACTIONS = new Set(["save_preparation", "suppress", "complete", "reopen"]);

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY"].includes(code)) return adminJson({ ok: false, error: "This account does not have active installer follow-up access." }, 403);
  if (code === "DISPATCH_REQUIRED") return adminJson({ ok: false, error: "Only the owner, manager or coordinator can prepare service follow-ups." }, 403);
  if (code === "FOLLOW_UP_NOT_FOUND") return adminJson({ ok: false, error: "Service follow-up not found." }, 404);
  if (code === "MEMBER_NOT_FOUND") return adminJson({ ok: false, error: "Choose an active team member." }, 404);
  if (code === "SUPPRESSION_REASON_REQUIRED") return adminJson({ ok: false, error: "Add a suppression reason before suppressing this follow-up." }, 400);
  if (code === "REVISION_CONFLICT") return adminJson({ ok: false, error: "This follow-up changed after you opened it. Refresh the queue before saving again." }, 409);
  return adminJson({ ok: false, error: "The service follow-up request could not be completed." }, 500);
}

async function followUpPayload(ownerUid: string) {
  const db = getD1();
  const [rows, members, deliveryRows] = await Promise.all([
    db.prepare(`WITH lifecycle AS (
      SELECT p.id service_plan_id, p.service_type, p.cadence_months, p.next_due_at, p.work_order_id,
        a.id asset_id, a.asset_category, a.brand, a.model_number, a.crm_customer_id, a.service_site_id,
        c.customer_number, CASE WHEN c.business_name != '' THEN c.business_name ELSE TRIM(c.first_name || ' ' || c.last_name) END customer_name,
        s.site_label, s.suburb, s.address_state, s.postcode, w.work_number,
        CASE WHEN w.source_type = 'opportunity' OR d.customer_source = 'platform_private' THEN 1 ELSE 0 END protected_job,
        COALESCE(
          (SELECT ownership.customer_uid FROM customer_asset_ownerships ownership
            WHERE ownership.handover_pack_id = a.handover_pack_id AND ownership.status = 'active'
            ORDER BY ownership.updated_at DESC LIMIT 1),
          CASE WHEN NOT EXISTS (SELECT 1 FROM customer_asset_ownerships history WHERE history.handover_pack_id = a.handover_pack_id)
            THEN project.firebase_uid ELSE '' END, '') customer_uid
      FROM trade_asset_service_plans p
      JOIN trade_installed_assets a ON a.id = p.asset_id AND a.firebase_uid = p.firebase_uid
      JOIN trade_crm_customers c ON c.id = a.crm_customer_id AND c.firebase_uid = p.firebase_uid AND c.record_status = 'active'
      JOIN trade_crm_service_sites s ON s.id = a.service_site_id AND s.customer_id = c.id AND s.firebase_uid = p.firebase_uid AND s.record_status = 'active'
      LEFT JOIN trade_work_orders w ON w.id = p.work_order_id AND w.firebase_uid = p.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = p.work_order_id AND d.firebase_uid = p.firebase_uid
      LEFT JOIN trade_handover_packs pack ON pack.id = a.handover_pack_id AND pack.firebase_uid = p.firebase_uid
      LEFT JOIN customer_projects project ON project.id = pack.customer_project_id
      WHERE p.firebase_uid = ? AND p.status = 'active' AND a.record_status = 'active'
        AND a.review_status = 'confirmed' AND a.asset_status = 'active'
    )
    SELECT lifecycle.*,
      follow_up.id follow_up_id, follow_up.status stored_status, follow_up.assignee_member_id,
      follow_up.suppression_reason, follow_up.internal_notes, follow_up.reminder_subject, follow_up.reminder_body,
      follow_up.revision, follow_up.updated_at follow_up_updated_at, member.display_name assignee_label,
      (SELECT event.serviced_at FROM trade_asset_service_events event
        WHERE event.service_plan_id = lifecycle.service_plan_id AND event.event_type = 'service_completed'
        ORDER BY event.serviced_at DESC, event.created_at DESC LIMIT 1) last_serviced_at
    FROM lifecycle
    LEFT JOIN trade_service_follow_ups follow_up ON follow_up.firebase_uid = ? AND follow_up.service_plan_id = lifecycle.service_plan_id
      AND follow_up.due_at = lifecycle.next_due_at
    LEFT JOIN trade_team_members member ON member.id = follow_up.assignee_member_id AND member.owner_uid = follow_up.firebase_uid
    WHERE lifecycle.protected_job = 0 OR lifecycle.customer_uid != ''
    ORDER BY lifecycle.next_due_at, customer_name, lifecycle.asset_id LIMIT 500`).bind(ownerUid, ownerUid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, display_name, status FROM trade_team_members
      WHERE owner_uid = ? AND status = 'active' ORDER BY display_name, email`).bind(ownerUid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, follow_up_id, channel, provider, content_revision, status, attempts, provider_status,
      last_error, queued_at, sent_at, delivered_at, failed_at, created_at, updated_at
      FROM service_reminder_deliveries WHERE firebase_uid = ? ORDER BY created_at DESC LIMIT 1000`)
      .bind(ownerUid).all<Record<string, unknown>>(),
  ]);
  const now = new Date();
  const followUps = rows.results.map((row) => {
    const storedStatus = String(row.stored_status || "preparing");
    const status = storedStatus === "completed" || storedStatus === "suppressed" ? storedStatus
      : "preparing";
    return {
      key: `${row.service_plan_id}:${row.next_due_at}`, id: String(row.follow_up_id || ""), servicePlanId: String(row.service_plan_id),
      assetId: String(row.asset_id), customerId: String(row.crm_customer_id), serviceSiteId: String(row.service_site_id),
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number || ""), customerNumber: String(row.customer_number || ""),
      customerName: String(row.customer_name || "Customer"), siteLabel: String(row.site_label || "Service site"),
      siteSummary: [row.suburb, row.address_state, row.postcode].filter(Boolean).join(" "), assetCategory: String(row.asset_category),
      brand: String(row.brand), modelNumber: String(row.model_number), serviceType: String(row.service_type), cadenceMonths: Number(row.cadence_months),
      dueAt: String(row.next_due_at), dueState: serviceFollowUpDueState(String(row.next_due_at), now),
      status, storedStatus, assigneeMemberId: String(row.assignee_member_id || ""),
      assigneeLabel: String(row.assignee_label || ""), suppressionReason: String(row.suppression_reason || ""),
      internalNotes: String(row.internal_notes || ""), reminderSubject: String(row.reminder_subject || ""),
      reminderBody: String(row.reminder_body || ""), revision: Number(row.revision || 0), lastServicedAt: String(row.last_serviced_at || ""),
      protectedJob: Boolean(row.protected_job), updatedAt: String(row.follow_up_updated_at || ""),
      deliveries: deliveryRows.results.filter((delivery) => delivery.follow_up_id === row.follow_up_id).map((delivery) => ({
        id: String(delivery.id), channel: String(delivery.channel), provider: String(delivery.provider),
        contentRevision: Number(delivery.content_revision), status: String(delivery.status), attempts: Number(delivery.attempts),
        providerStatus: String(delivery.provider_status || ""), lastError: String(delivery.last_error || ""),
        queuedAt: String(delivery.queued_at), sentAt: String(delivery.sent_at || ""), deliveredAt: String(delivery.delivered_at || ""),
        failedAt: String(delivery.failed_at || ""), updatedAt: String(delivery.updated_at),
      })),
    };
  });
  return {
    followUps,
    members: members.results.map((row) => ({ id: String(row.id), displayName: String(row.display_name), status: String(row.status) })),
    channels: [],
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.canRunReports || !access.canViewCustomers || !access.canSearchCustomers) {
      throw new Error("DISPATCH_REQUIRED");
    }
    return adminJson({ ok: true, ...(await followUpPayload(access.ownerUid)) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    if (!access.canManageCustomers || !access.canRunReports || !access.canViewCustomers
      || !access.canSearchCustomers) throw new Error("DISPATCH_REQUIRED");
    const body = await request.json() as Record<string, unknown>;
    const action = cleanAdminText(body.action, 40);
    if (["prepare_reminder", "send_reminder", "retry_delivery"].includes(action)) {
      return adminJson({ ok: false, code: "CUSTOMER_ACCOUNTS_RETIRED", error: "Customer-account reminders have closed. You can still track service follow-ups here." }, 410);
    }
    if (!ACTIONS.has(action)) return adminJson({ ok: false, error: "Unsupported follow-up action." }, 400);
    const servicePlanId = cleanAdminText(body.servicePlanId, 180); const dueAt = cleanAdminText(body.dueAt, 10);
    const payload = await followUpPayload(access.ownerUid);
    const candidate = payload.followUps.find((item) => item.servicePlanId === servicePlanId && item.dueAt === dueAt);
    if (!candidate) throw new Error("FOLLOW_UP_NOT_FOUND");
    const memberId = cleanAdminText(body.memberId, 180);
    if (memberId !== candidate.assigneeMemberId
      && !canAssignJob(access, candidate.assigneeMemberId, memberId)) throw new Error("DISPATCH_REQUIRED");
    if (memberId) {
      const member = await getD1().prepare("SELECT id FROM trade_team_members WHERE id = ? AND owner_uid = ? AND status = 'active'")
        .bind(memberId, access.ownerUid).first();
      if (!member) throw new Error("MEMBER_NOT_FOUND");
    }
    const suppressionReason = cleanAdminText(body.suppressionReason, 300);
    if (action === "suppress" && !suppressionReason) throw new Error("SUPPRESSION_REASON_REQUIRED");
    const internalNotes = cleanAdminText(body.internalNotes, 1000); const db = getD1(); const now = new Date().toISOString();
    await db.prepare(`INSERT INTO trade_service_follow_ups
      (id, service_plan_id, asset_id, crm_customer_id, service_site_id, work_order_id, firebase_uid, due_at,
       status, assignee_member_id, suppression_reason, internal_notes, reminder_subject, reminder_body, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'preparing', '', '', '', '', '', 0, ?, ?)
      ON CONFLICT(firebase_uid, service_plan_id, due_at) DO NOTHING`)
      .bind(crypto.randomUUID(), candidate.servicePlanId, candidate.assetId, candidate.customerId, candidate.serviceSiteId,
        candidate.workOrderId, access.ownerUid, candidate.dueAt, now, now).run();
    const current = await db.prepare(`SELECT id, revision, reminder_subject, reminder_body FROM trade_service_follow_ups
      WHERE firebase_uid = ? AND service_plan_id = ? AND due_at = ?`).bind(access.ownerUid, servicePlanId, dueAt).first<Record<string, unknown>>();
    if (!current || Number(current.revision) !== Number(body.expectedRevision)) throw new Error("REVISION_CONFLICT");
    const nextStatus = action === "suppress" ? "suppressed"
      : action === "complete" ? "completed" : "preparing";
    const draft = { subject: String(current.reminder_subject || ""), body: String(current.reminder_body || "") };
    const nextRevision = Number(current.revision) + 1;
    const summary = action === "suppress" ? "Service follow-up suppressed with an internal reason."
        : action === "complete" ? "Service follow-up preparation completed." : action === "reopen" ? "Service follow-up reopened for preparation."
          : "Service follow-up preparation details updated.";
    const results = await db.batch([
      db.prepare(`UPDATE trade_service_follow_ups SET status = ?, assignee_member_id = ?, suppression_reason = ?,
        internal_notes = ?, reminder_subject = ?, reminder_body = ?, revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = ?`).bind(nextStatus, memberId,
          action === "suppress" ? suppressionReason : "", internalNotes, draft.subject, draft.body, nextRevision, now,
          current.id, access.ownerUid, current.revision),
      db.prepare(`INSERT INTO trade_service_follow_up_events (id, follow_up_id, firebase_uid, actor_uid, event_type, summary, created_at)
        SELECT ?, id, firebase_uid, ?, ?, ?, ? FROM trade_service_follow_ups
        WHERE id = ? AND firebase_uid = ? AND revision = ? AND updated_at = ?`)
        .bind(crypto.randomUUID(), access.actorUid, action, summary, now, current.id, access.ownerUid, nextRevision, now),
    ]);
    if (!results[0].meta.changes) throw new Error("REVISION_CONFLICT");
    return adminJson({ ok: true, ...(await followUpPayload(access.ownerUid)) });
  } catch (error) {
    if (error instanceof SyntaxError) return adminJson({ ok: false, error: "Invalid service follow-up request." }, 400);
    return errorResponse(error);
  }
}
