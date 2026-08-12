import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { listTradeTeamDocumentExpiryWarnings } from "@/lib/trade-team-document-expiry-server";

export const runtime = "edge";

type Row = Record<string, unknown>;
type JobTab = "schedule" | "quote" | "field" | "invoice";
type JobNotification = {
  id: string;
  targetKind: "job" | "opportunity" | "team";
  targetId: string;
  workOrderId: string;
  workNumber: string;
  title: string;
  summary: string;
  createdAt: string;
  targetTab: JobTab;
  source: "customer" | "field" | "team";
  read: boolean;
};

function notificationError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["ACCOUNT_INACTIVE", "INSTALLER_ONLY", "FULL_ACCESS_REQUIRED", "TEAM_ACCESS_REQUIRED", "TEAM_ACCESS_RECORD_REQUIRED"].includes(code)) {
    return adminJson({ ok: false, error: "An active installer account is required." }, 403);
  }
  return adminJson({ ok: false, error: "Job notifications could not be loaded." }, 500);
}

function jobScope(access: TeamAccess) {
  return { scope: !access.isOwner && access.jobScope === "own" ? "own" : "team", memberId: access.memberId || "" };
}

function scheduleScope(access: TeamAccess) {
  return { scope: !access.isOwner && access.scheduleScope === "own" ? "own" : "team", memberId: access.memberId || "" };
}

function limitedSummary(value: unknown, fallback: string) {
  const summary = String(value || "").trim();
  return (summary || fallback).slice(0, 240);
}

function jobContextAllowed(row: Row) {
  const source = String(row.customer_source || "");
  return row.source_type !== "opportunity" && source !== "platform_private";
}

function workEventPresentation(eventType: string) {
  if (eventType === "job_completed") return { title: "Field job completed", targetTab: "field" as const };
  if (eventType === "field_form_completed" || eventType === "offline_field_form_completed") return { title: "Field form completed", targetTab: "field" as const };
  if (eventType === "task_completed" || eventType === "offline_task_update") return { title: "Checklist updated", targetTab: "field" as const };
  if (eventType === "job_actual_recorded") return { title: "Work item completed", targetTab: "field" as const };
  return { title: "Field progress updated", targetTab: "field" as const };
}

function documentExpiryDate(value: unknown) {
  const date = String(value || "");
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

async function notifications(access: TeamAccess) {
  const db = getD1();
  const scope = jobScope(access);
  const scheduling = scheduleScope(access);
  const none = () => Promise.resolve({ results: [] as Row[] });
  const [photoCompletions, quoteQuestions, quoteDecisions, quoteViews, appointmentRequests, fieldEvents, signoffs, allocatedProjectLeads, acceptedProjectQuotes, documentExpiries, reads] = await Promise.all([
    access.canViewFieldEvidence ? db.prepare(`SELECT completion.id, completion.work_order_id, completion.supplied_count, completion.completed_at,
        work.work_number, work.title, work.source_type, detail.customer_source
      FROM trade_crm_photo_request_completions completion
      JOIN trade_work_orders work ON work.id = completion.work_order_id AND work.firebase_uid = completion.firebase_uid
        AND work.record_status = 'active'
      LEFT JOIN trade_crm_job_details detail ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
      WHERE completion.firebase_uid = ? AND (? <> 'own' OR work.assignee_member_id = ?)
      ORDER BY completion.completed_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.scope, scope.memberId).all<Row>() : none(),
    access.canViewQuotes ? db.prepare(`SELECT question.id, question.work_order_id, question.question, question.asked_at,
        work.work_number, work.title, work.source_type, detail.customer_source, quote.quote_number
      FROM trade_crm_quote_questions question
      JOIN trade_work_orders work ON work.id = question.work_order_id AND work.firebase_uid = question.firebase_uid
        AND work.record_status = 'active'
      LEFT JOIN trade_crm_job_details detail ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
      JOIN trade_crm_quotes quote ON quote.id = question.quote_id AND quote.firebase_uid = question.firebase_uid
      WHERE question.firebase_uid = ? AND (? <> 'own' OR work.assignee_member_id = ?)
      ORDER BY question.asked_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.scope, scope.memberId).all<Row>() : none(),
    access.canViewQuotes ? db.prepare(`SELECT acceptance.id, acceptance.work_order_id, acceptance.decision, acceptance.signer_name,
        acceptance.selected_total_cents, acceptance.decided_at, work.work_number, work.title,
        work.source_type, detail.customer_source, quote.quote_number
      FROM trade_crm_quote_acceptances acceptance
      JOIN trade_work_orders work ON work.id = acceptance.work_order_id AND work.firebase_uid = acceptance.firebase_uid
        AND work.record_status = 'active'
      LEFT JOIN trade_crm_job_details detail ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
      JOIN trade_crm_quotes quote ON quote.id = acceptance.quote_id AND quote.firebase_uid = acceptance.firebase_uid
      WHERE acceptance.firebase_uid = ? AND (? <> 'own' OR work.assignee_member_id = ?)
      ORDER BY acceptance.decided_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.scope, scope.memberId).all<Row>() : none(),
    access.canViewQuotes ? db.prepare(`SELECT event.id, event.work_order_id, event.occurred_at, work.work_number, work.title,
        work.source_type, detail.customer_source, quote.quote_number
      FROM trade_crm_quote_events event
      JOIN trade_work_orders work ON work.id = event.work_order_id AND work.firebase_uid = event.firebase_uid
        AND work.record_status = 'active'
      LEFT JOIN trade_crm_job_details detail ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
      JOIN trade_crm_quotes quote ON quote.id = event.quote_id AND quote.firebase_uid = event.firebase_uid
      WHERE event.firebase_uid = ? AND event.actor_type = 'link_holder' AND event.event_type = 'viewed'
        AND (? <> 'own' OR work.assignee_member_id = ?)
      ORDER BY event.occurred_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.scope, scope.memberId).all<Row>() : none(),
    access.canRescheduleJobs ? db.prepare(`SELECT event.id, event.work_order_id, event.summary, event.created_at,
        work.work_number, work.title, work.source_type, detail.customer_source
      FROM trade_crm_appointment_reschedule_events event
      JOIN trade_work_orders work ON work.id = event.work_order_id AND work.firebase_uid = event.firebase_uid
        AND work.record_status = 'active'
      LEFT JOIN trade_crm_job_details detail ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
      LEFT JOIN trade_crm_appointments appointment ON appointment.id = event.appointment_id
        AND appointment.firebase_uid = event.firebase_uid
      WHERE event.firebase_uid = ? AND event.actor_type = 'customer' AND event.event_type = 'requested'
        AND (? <> 'own' OR appointment.assignee_member_id = ?)
      ORDER BY event.created_at DESC LIMIT 80`)
      .bind(access.ownerUid, scheduling.scope, scheduling.memberId).all<Row>() : none(),
    access.canViewFieldEvidence ? db.prepare(`SELECT event.id, event.work_order_id, event.event_type, event.summary, event.created_at,
        work.work_number, work.title, work.source_type, detail.customer_source
      FROM trade_work_order_events event
      JOIN trade_work_orders work ON work.id = event.work_order_id AND work.firebase_uid = event.firebase_uid
        AND work.record_status = 'active'
      LEFT JOIN trade_crm_job_details detail ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
      WHERE event.firebase_uid = ?
        AND event.event_type IN ('field_state_changed', 'offline_stage_update', 'task_completed', 'offline_task_update',
          'field_form_completed', 'offline_field_form_completed', 'job_actual_recorded', 'job_completed')
        AND NOT (event.event_type = 'field_state_changed' AND EXISTS (
          SELECT 1 FROM trade_work_order_events completed
          WHERE completed.firebase_uid = event.firebase_uid AND completed.work_order_id = event.work_order_id
            AND completed.event_type = 'job_completed' AND completed.created_at = event.created_at
        ))
        AND (? <> 'own' OR work.assignee_member_id = ?)
      ORDER BY event.created_at DESC LIMIT 120`)
      .bind(access.ownerUid, scope.scope, scope.memberId).all<Row>() : none(),
    access.canViewFieldEvidence ? db.prepare(`SELECT signoff.id, signoff.work_order_id, signoff.signer_role, signoff.signer_name, signoff.signed_at,
        work.work_number, work.title, work.source_type, detail.customer_source
      FROM trade_crm_signoffs signoff
      JOIN trade_work_orders work ON work.id = signoff.work_order_id AND work.firebase_uid = signoff.firebase_uid
        AND work.record_status = 'active'
      LEFT JOIN trade_crm_job_details detail ON detail.work_order_id = work.id AND detail.firebase_uid = work.firebase_uid
      WHERE signoff.firebase_uid = ? AND signoff.signer_role IN ('customer', 'technician')
        AND (? <> 'own' OR work.assignee_member_id = ?)
      ORDER BY signoff.signed_at DESC LIMIT 80`)
      .bind(access.ownerUid, scope.scope, scope.memberId).all<Row>() : none(),
    access.canViewQuotes && scope.scope === "team" ? db.prepare(`SELECT assignment.id opportunity_match_id, assignment.matched_at
      FROM trade_opportunity_matches assignment
      JOIN trade_opportunities opportunity ON opportunity.id = assignment.opportunity_id
      WHERE assignment.firebase_uid = ?
        AND assignment.status IN ('offered', 'viewed', 'interested', 'connected')
        AND opportunity.status IN ('open', 'paused')
      ORDER BY assignment.matched_at DESC LIMIT 80`)
      .bind(access.ownerUid).all<Row>() : none(),
    access.canViewQuotes && scope.scope === "team" ? db.prepare(`SELECT event.id, event.opportunity_match_id, event.occurred_at
      FROM customer_project_activity_events event
      JOIN customer_project_quotes quote ON quote.id = event.quote_id
        AND quote.installer_uid = event.installer_uid
        AND quote.customer_decision = 'accepted'
      JOIN customer_project_contact_releases release
        ON release.quote_id = event.quote_id
        AND release.opportunity_match_id = event.opportunity_match_id
        AND release.customer_uid = event.customer_uid
        AND release.installer_uid = event.installer_uid
        AND release.status = 'active'
      WHERE event.installer_uid = ?
        AND event.event_type = 'customer_installer_accepted'
      ORDER BY event.occurred_at DESC LIMIT 80`)
      .bind(access.ownerUid).all<Row>() : none(),
    (access.isOwner || access.canManageTeam)
      ? listTradeTeamDocumentExpiryWarnings(db, access.ownerUid)
        .then((results) => ({ results: results as unknown as Row[] }))
      : none(),
    db.prepare(`SELECT notification_key FROM trade_job_notification_reads
      WHERE firebase_uid = ? AND read_by_uid = ? ORDER BY read_at DESC LIMIT 500`)
      .bind(access.ownerUid, access.actorUid).all<Row>(),
  ]);

  const items: Omit<JobNotification, "read">[] = [
    ...photoCompletions.results.map((row) => ({ id: `customer-photos-ready:${String(row.id)}`,
      targetKind: "job" as const, targetId: String(row.work_order_id),
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number), title: "Customer photos ready",
      summary: `${Number(row.supplied_count)} ${Number(row.supplied_count) === 1 ? "file is" : "files are"} ready to review${jobContextAllowed(row) ? ` for ${String(row.title)}` : ""}.`,
      createdAt: String(row.completed_at), targetTab: "field" as const, source: "customer" as const })),
    ...quoteQuestions.results.map((row) => ({ id: `quote-question:${String(row.id)}`,
      targetKind: "job" as const, targetId: String(row.work_order_id),
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number), title: "Customer asked a quote question",
      summary: jobContextAllowed(row) ? limitedSummary(row.question, `Open ${String(row.quote_number)} to read and reply.`) : `Open ${String(row.quote_number)} to read and reply.`, createdAt: String(row.asked_at),
      targetTab: "quote" as const, source: "customer" as const })),
    ...quoteDecisions.results.map((row) => { const accepted = row.decision === "accepted"; const amount = Number(row.selected_total_cents || 0);
      return { id: `quote-decision:${String(row.id)}`, workOrderId: String(row.work_order_id), workNumber: String(row.work_number),
        targetKind: "job" as const, targetId: String(row.work_order_id),
        title: accepted ? "Quote accepted" : "Quote declined",
        summary: accepted ? `${String(row.quote_number)} was accepted${jobContextAllowed(row) ? ` by ${String(row.signer_name || "the customer")}` : ""} for ${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount / 100)}.`
          : `${String(row.quote_number)} was declined${jobContextAllowed(row) ? ` by ${String(row.signer_name || "the customer")}` : ""}.`, createdAt: String(row.decided_at),
        targetTab: "quote" as const, source: "customer" as const }; }),
    ...quoteViews.results.map((row) => ({ id: `quote-view:${String(row.id)}`,
      targetKind: "job" as const, targetId: String(row.work_order_id),
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number), title: "Customer opened quote",
      summary: `${String(row.quote_number)}${jobContextAllowed(row) ? ` for ${String(row.title)}` : ""} was opened.`, createdAt: String(row.occurred_at),
      targetTab: "quote" as const, source: "customer" as const })),
    ...appointmentRequests.results.map((row) => ({ id: `appointment-request:${String(row.id)}`,
      targetKind: "job" as const, targetId: String(row.work_order_id),
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number), title: "Customer requested a schedule change",
      summary: jobContextAllowed(row) ? limitedSummary(row.summary, "Review the customer's requested appointment change.") : "Review the requested appointment change.", createdAt: String(row.created_at),
      targetTab: "schedule" as const, source: "customer" as const })),
    ...fieldEvents.results.map((row) => { const presentation = workEventPresentation(String(row.event_type)); return {
      id: `field-event:${String(row.id)}`, targetKind: "job" as const, targetId: String(row.work_order_id),
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number),
      title: presentation.title, summary: jobContextAllowed(row) ? limitedSummary(row.summary, `Field work changed for ${String(row.title)}.`) : "Field work changed.",
      createdAt: String(row.created_at), targetTab: presentation.targetTab, source: "field" as const }; }),
    ...signoffs.results.map((row) => { const customer = row.signer_role === "customer"; return {
      id: `job-signoff:${String(row.id)}`, targetKind: "job" as const, targetId: String(row.work_order_id),
      workOrderId: String(row.work_order_id), workNumber: String(row.work_number),
      title: customer ? "Customer sign-off recorded" : "Technician sign-off recorded",
      summary: jobContextAllowed(row)
        ? `${String(row.signer_name || (customer ? "Customer" : "Technician"))} signed the field record for ${String(row.title)}.`
        : `${customer ? "Customer" : "Technician"} sign-off was recorded.`,
      createdAt: String(row.signed_at), targetTab: "field" as const, source: customer ? "customer" as const : "field" as const }; }),
    ...allocatedProjectLeads.results.map((row) => ({
      id: `platform-lead-allocated:${String(row.opportunity_match_id)}`,
      targetKind: "opportunity" as const,
      targetId: String(row.opportunity_match_id),
      workOrderId: "",
      workNumber: "TLink lead",
      title: "New lead ready to review",
      summary: "A new privacy-safe customer enquiry is ready in your Leads workspace.",
      createdAt: String(row.matched_at),
      targetTab: "quote" as const,
      source: "customer" as const,
    })),
    ...acceptedProjectQuotes.results.map((row) => ({
      id: `platform-quote-accepted:${String(row.id)}`,
      targetKind: "opportunity" as const,
      targetId: String(row.opportunity_match_id),
      workOrderId: "",
      workNumber: "TLink lead",
      title: "Customer wants to get in touch",
      summary: "Contact details are ready. Call or email the customer and schedule the next step.",
      createdAt: String(row.occurred_at),
      targetTab: "quote" as const,
      source: "customer" as const,
    })),
    ...documentExpiries.results.map((row) => ({
      id: `team-document-expiry:${String(row.id)}`,
      targetKind: "team" as const,
      targetId: String(row.team_member_id),
      workOrderId: "",
      workNumber: "Team document",
      title: `${String(row.member_name)}: ${String(row.document_title)} expires soon`,
      summary: `${String(row.document_title)} for ${String(row.member_name)} expires on ${documentExpiryDate(row.expires_at)}.`,
      createdAt: String(row.created_at),
      targetTab: "field" as const,
      source: "team" as const,
    })),
  ];
  const readKeys = new Set(reads.results.map((row) => String(row.notification_key)));
  const visible = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
    .map((item) => ({ ...item, read: readKeys.has(item.id) }));
  return { items: visible, unreadCount: visible.filter((item) => !item.read).length };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    return adminJson({ ok: true, ...(await notifications(access)) });
  } catch (error) { return notificationError(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
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
