import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";

type Row = Record<string, unknown>;
type JobTab = "schedule" | "quote" | "field" | "invoice";
type JobNotification = {
  id: string;
  workOrderId: string;
  workNumber: string;
  title: string;
  summary: string;
  createdAt: string;
  targetTab: JobTab;
  source: "customer" | "field";
  read: boolean;
};

function notificationError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_MEMBERSHIP_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, error: "An active installer account is required." }, 403);
  }
  return adminJson({ ok: false, error: "Job notifications could not be loaded." }, 500);
}

function jobScope(access: TeamAccess) {
  return { role: access.role, memberId: access.memberId || "" };
}

function limitedSummary(value: unknown, fallback: string) {
  const summary = String(value || "").trim();
  return (summary || fallback).slice(0, 240);
}

function workEventPresentation(eventType: string) {
  if (eventType === "job_completed") return { title: "Field job completed", targetTab: "field" as const };
  if (eventType === "field_form_completed" || eventType === "offline_field_form_completed") return { title: "Field form completed", targetTab: "field" as const };
  if (eventType === "task_completed" || eventType === "offline_task_update") return { title: "Checklist updated", targetTab: "field" as const };
  if (eventType === "job_actual_recorded") return { title: "Work item completed", targetTab: "field" as const };
  return { title: "Field progress updated", targetTab: "field" as const };
}

async function notifications(access: TeamAccess) {
  const db = getD1();
  const scope = jobScope(access);
  const [photoCompletions, quoteQuestions, quoteDecisions, quoteViews, appointmentRequests, paymentEvents, fieldEvents, signoffs, reads] = await Promise.all([
    db.prepare(`SELECT completion.id, completion.work_order_id, completion.supplied_count, completion.completed_at,
        work.work_number, work.title
      FROM trade_crm_photo_request_completions completion
      JOIN trade_work_orders work ON work.id = completion.work_order_id AND work.firebase_uid = completion.firebase_uid
        AND work.record_status = 'active'
      WHERE completion.firebase_uid = ? AND (? <> 'technician' OR work.assignee_member_id = ?)
      ORDER BY completion.completed_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.role, scope.memberId).all<Row>(),
    db.prepare(`SELECT question.id, question.work_order_id, question.question, question.asked_at,
        work.work_number, work.title, quote.quote_number
      FROM trade_crm_quote_questions question
      JOIN trade_work_orders work ON work.id = question.work_order_id AND work.firebase_uid = question.firebase_uid
        AND work.record_status = 'active'
      JOIN trade_crm_quotes quote ON quote.id = question.quote_id AND quote.firebase_uid = question.firebase_uid
      WHERE question.firebase_uid = ? AND (? <> 'technician' OR work.assignee_member_id = ?)
      ORDER BY question.asked_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.role, scope.memberId).all<Row>(),
    db.prepare(`SELECT acceptance.id, acceptance.work_order_id, acceptance.decision, acceptance.signer_name,
        acceptance.selected_total_cents, acceptance.decided_at, work.work_number, work.title, quote.quote_number
      FROM trade_crm_quote_acceptances acceptance
      JOIN trade_work_orders work ON work.id = acceptance.work_order_id AND work.firebase_uid = acceptance.firebase_uid
        AND work.record_status = 'active'
      JOIN trade_crm_quotes quote ON quote.id = acceptance.quote_id AND quote.firebase_uid = acceptance.firebase_uid
      WHERE acceptance.firebase_uid = ? AND (? <> 'technician' OR work.assignee_member_id = ?)
      ORDER BY acceptance.decided_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.role, scope.memberId).all<Row>(),
    db.prepare(`SELECT event.id, event.work_order_id, event.occurred_at, work.work_number, work.title, quote.quote_number
      FROM trade_crm_quote_events event
      JOIN trade_work_orders work ON work.id = event.work_order_id AND work.firebase_uid = event.firebase_uid
        AND work.record_status = 'active'
      JOIN trade_crm_quotes quote ON quote.id = event.quote_id AND quote.firebase_uid = event.firebase_uid
      WHERE event.firebase_uid = ? AND event.actor_type = 'link_holder' AND event.event_type = 'viewed'
        AND (? <> 'technician' OR work.assignee_member_id = ?)
      ORDER BY event.occurred_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.role, scope.memberId).all<Row>(),
    db.prepare(`SELECT event.id, event.work_order_id, event.summary, event.created_at,
        work.work_number, work.title
      FROM trade_crm_appointment_reschedule_events event
      JOIN trade_work_orders work ON work.id = event.work_order_id AND work.firebase_uid = event.firebase_uid
        AND work.record_status = 'active'
      WHERE event.firebase_uid = ? AND event.actor_type = 'customer' AND event.event_type = 'requested'
        AND (? <> 'technician' OR work.assignee_member_id = ?)
      ORDER BY event.created_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.role, scope.memberId).all<Row>(),
    db.prepare(`SELECT event.id, event.work_order_id, event.status, event.amount_cents, event.provider,
        event.received_at, work.work_number, work.title
      FROM trade_crm_payment_events event
      JOIN trade_work_orders work ON work.id = event.work_order_id AND work.firebase_uid = event.firebase_uid
        AND work.record_status = 'active'
      WHERE event.firebase_uid = ? AND event.status IN ('paid', 'failed', 'review_required')
        AND (? <> 'technician' OR work.assignee_member_id = ?)
      ORDER BY event.received_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.role, scope.memberId).all<Row>(),
    db.prepare(`SELECT event.id, event.work_order_id, event.event_type, event.summary, event.created_at,
        work.work_number, work.title
      FROM trade_work_order_events event
      JOIN trade_work_orders work ON work.id = event.work_order_id AND work.firebase_uid = event.firebase_uid
        AND work.record_status = 'active'
      WHERE event.firebase_uid = ?
        AND event.event_type IN ('field_state_changed', 'offline_stage_update', 'task_completed', 'offline_task_update',
          'field_form_completed', 'offline_field_form_completed', 'job_actual_recorded', 'job_completed')
        AND NOT (event.event_type = 'field_state_changed' AND EXISTS (
          SELECT 1 FROM trade_work_order_events completed
          WHERE completed.firebase_uid = event.firebase_uid AND completed.work_order_id = event.work_order_id
            AND completed.event_type = 'job_completed' AND completed.created_at = event.created_at
        ))
        AND (? <> 'technician' OR work.assignee_member_id = ?)
      ORDER BY event.created_at DESC LIMIT 120`)
      .bind(access.ownerUid, scope.role, scope.memberId).all<Row>(),
    db.prepare(`SELECT signoff.id, signoff.work_order_id, signoff.signer_role, signoff.signer_name, signoff.signed_at,
        work.work_number, work.title
      FROM trade_crm_signoffs signoff
      JOIN trade_work_orders work ON work.id = signoff.work_order_id AND work.firebase_uid = signoff.firebase_uid
        AND work.record_status = 'active'
      WHERE signoff.firebase_uid = ? AND signoff.signer_role IN ('customer', 'technician')
        AND (? <> 'technician' OR work.assignee_member_id = ?)
      ORDER BY signoff.signed_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.role, scope.memberId).all<Row>(),
    db.prepare(`SELECT notification_key FROM trade_job_notification_reads
      WHERE firebase_uid = ? AND read_by_uid = ? ORDER BY read_at DESC LIMIT 500`)
      .bind(access.ownerUid, access.actorUid).all<Row>(),
  ]);

  const items: Omit<JobNotification, "read">[] = [
    ...photoCompletions.results.map((row) => ({ id: `customer-photos-ready:${String(row.id)}`,
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number), title: "Customer photos ready",
      summary: `${Number(row.supplied_count)} ${Number(row.supplied_count) === 1 ? "file is" : "files are"} ready to review for ${String(row.title)}.`,
      createdAt: String(row.completed_at), targetTab: "field" as const, source: "customer" as const })),
    ...quoteQuestions.results.map((row) => ({ id: `quote-question:${String(row.id)}`,
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number), title: "Customer asked a quote question",
      summary: limitedSummary(row.question, `Open ${String(row.quote_number)} to read and reply.`), createdAt: String(row.asked_at),
      targetTab: "quote" as const, source: "customer" as const })),
    ...quoteDecisions.results.map((row) => { const accepted = row.decision === "accepted"; const amount = Number(row.selected_total_cents || 0);
      return { id: `quote-decision:${String(row.id)}`, workOrderId: String(row.work_order_id), workNumber: String(row.work_number),
        title: accepted ? "Quote accepted" : "Quote declined",
        summary: accepted ? `${String(row.quote_number)} was accepted by ${String(row.signer_name || "the customer")} for ${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount / 100)}.`
          : `${String(row.quote_number)} was declined by ${String(row.signer_name || "the customer")}.`, createdAt: String(row.decided_at),
        targetTab: "quote" as const, source: "customer" as const }; }),
    ...quoteViews.results.map((row) => ({ id: `quote-view:${String(row.id)}`,
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number), title: "Customer opened quote",
      summary: `${String(row.quote_number)} for ${String(row.title)} was opened.`, createdAt: String(row.occurred_at),
      targetTab: "quote" as const, source: "customer" as const })),
    ...appointmentRequests.results.map((row) => ({ id: `appointment-request:${String(row.id)}`,
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number), title: "Customer requested a schedule change",
      summary: limitedSummary(row.summary, "Review the customer's requested appointment change."), createdAt: String(row.created_at),
      targetTab: "schedule" as const, source: "customer" as const })),
    ...paymentEvents.results.map((row) => { const paid = row.status === "paid"; const failed = row.status === "failed";
      const amount = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(row.amount_cents || 0) / 100);
      return { id: `payment-event:${String(row.id)}`, workOrderId: String(row.work_order_id), workNumber: String(row.work_number),
        title: paid ? "Customer payment received" : failed ? "Customer payment failed" : "Customer payment needs review",
        summary: paid ? `${amount} was paid through ${String(row.provider)} for ${String(row.title)}.`
          : failed ? `The ${String(row.provider)} payment for ${String(row.title)} failed.`
            : `The ${String(row.provider)} payment for ${String(row.title)} needs amount or currency review.`,
        createdAt: String(row.received_at), targetTab: "invoice" as const, source: "customer" as const }; }),
    ...fieldEvents.results.map((row) => { const presentation = workEventPresentation(String(row.event_type)); return {
      id: `field-event:${String(row.id)}`, workOrderId: String(row.work_order_id), workNumber: String(row.work_number),
      title: presentation.title, summary: limitedSummary(row.summary, `Field work changed for ${String(row.title)}.`),
      createdAt: String(row.created_at), targetTab: presentation.targetTab, source: "field" as const }; }),
    ...signoffs.results.map((row) => { const customer = row.signer_role === "customer"; return {
      id: `job-signoff:${String(row.id)}`, workOrderId: String(row.work_order_id), workNumber: String(row.work_number),
      title: customer ? "Customer sign-off recorded" : "Technician sign-off recorded",
      summary: `${String(row.signer_name || (customer ? "Customer" : "Technician"))} signed the field record for ${String(row.title)}.`,
      createdAt: String(row.signed_at), targetTab: "field" as const, source: customer ? "customer" as const : "field" as const }; }),
  ];
  const readKeys = new Set(reads.results.map((row) => String(row.notification_key)));
  const visible = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
    .map((item) => ({ ...item, read: readKeys.has(item.id) }));
  return { items: visible, unreadCount: visible.filter((item) => !item.read).length };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    return adminJson({ ok: true, ...(await notifications(access)) });
  } catch (error) { return notificationError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request, false);
    const body = await request.json().catch(() => ({})) as Row;
    const notificationKey = cleanAdminText(body.notificationKey, 240);
    const current = await notifications(access);
    if (!current.items.some((item) => item.id === notificationKey)) {
      return adminJson({ ok: false, error: "Job notification not found." }, 404);
    }
    await getD1().prepare(`INSERT OR IGNORE INTO trade_job_notification_reads
      (id, firebase_uid, notification_key, read_by_uid, read_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), access.ownerUid, notificationKey, access.actorUid, new Date().toISOString()).run();
    return adminJson({ ok: true, ...(await notifications(access)) });
  } catch (error) { return notificationError(error); }
}
