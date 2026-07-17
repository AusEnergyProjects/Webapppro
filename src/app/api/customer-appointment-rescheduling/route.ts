import { getD1 } from "../../../../db";
import { requireFirebaseIdentity, type FirebaseIdentity } from "@/lib/firebase-server";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { australiaSydneyLocalDateTime, normalisePreferredWindows, parsePreferredWindows } from "@/lib/appointment-rescheduling";

export const runtime = "edge";

async function customerIdentity(request: Request) {
  const identity = await requireFirebaseIdentity(request);
  if (!identity.emailVerified) throw new Error("EMAIL_VERIFICATION_REQUIRED");
  const account = await getD1().prepare(`SELECT firebase_uid FROM customer_accounts
    WHERE firebase_uid = ? AND LOWER(email) = LOWER(?) AND account_status = 'active'`).bind(identity.uid, identity.email).first();
  if (!account) throw new Error("CUSTOMER_ACCOUNT_REQUIRED");
  return identity;
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "EMAIL_VERIFICATION_REQUIRED") return adminJson({ ok: false, error: "Verify your account email before requesting an appointment change." }, 403);
  if (code === "CUSTOMER_ACCOUNT_REQUIRED") return adminJson({ ok: false, error: "Complete your active customer account before requesting an appointment change." }, 403);
  if (code === "APPOINTMENT_NOT_FOUND") return adminJson({ ok: false, error: "This future appointment is not available to your verified customer account." }, 404);
  if (code === "DUPLICATE_REQUEST" || code.includes("trade_crm_appointment_reschedule_active_idx")
    || (code.includes("UNIQUE constraint failed") && code.includes("trade_crm_appointment_reschedule_requests"))) {
    return adminJson({ ok: false, error: "This appointment already has a change request awaiting installer review." }, 409);
  }
  if (code === "REVISION_CONFLICT") return adminJson({ ok: false, error: "This appointment changed after you opened it. Refresh before requesting another time." }, 409);
  if (code === "INVALID_WINDOWS") return adminJson({ ok: false, error: "Choose one to three valid future windows, each within one day and no longer than 12 hours." }, 400);
  return adminJson({ ok: false, error: "The appointment change request could not be completed." }, 500);
}

const authorisedCustomerJoin = `
  JOIN trade_crm_job_details d ON d.work_order_id = a.work_order_id AND d.firebase_uid = a.firebase_uid
    AND d.customer_source = 'trade_owned' AND d.crm_customer_id != ''
  JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = a.firebase_uid AND c.record_status = 'active'
  LEFT JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.customer_id = c.id
    AND s.firebase_uid = a.firebase_uid AND s.record_status = 'active'`;

async function authorisedAppointment(identity: FirebaseIdentity, appointmentId: string) {
  return getD1().prepare(`SELECT a.id, a.work_order_id, a.firebase_uid, a.title, a.appointment_type, a.starts_at, a.ends_at,
      a.assignee_member_id, a.assignee_label, a.revision, d.crm_customer_id, w.work_number,
      s.site_label, s.suburb, s.address_state, s.postcode
    FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
    ${authorisedCustomerJoin}
    WHERE a.id = ? AND a.status = 'scheduled' AND a.starts_at > ?
      AND (LOWER(c.email) = LOWER(?) OR EXISTS (SELECT 1 FROM trade_crm_customer_contacts contact
        WHERE contact.firebase_uid = c.firebase_uid AND contact.customer_id = c.id
          AND contact.record_status = 'active' AND LOWER(contact.email) = LOWER(?)))`)
    .bind(appointmentId, australiaSydneyLocalDateTime(), identity.email, identity.email).first<Record<string, unknown>>();
}

async function customerPayload(identity: FirebaseIdentity) {
  const db = getD1(); const now = australiaSydneyLocalDateTime();
  const [appointments, requests] = await Promise.all([
    db.prepare(`SELECT a.id, a.title, a.appointment_type, a.starts_at, a.ends_at, a.revision, w.work_number,
        s.site_label, s.suburb, s.address_state, s.postcode
      FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      ${authorisedCustomerJoin}
      WHERE a.status = 'scheduled' AND a.starts_at > ?
        AND (LOWER(c.email) = LOWER(?) OR EXISTS (SELECT 1 FROM trade_crm_customer_contacts contact
          WHERE contact.firebase_uid = c.firebase_uid AND contact.customer_id = c.id
            AND contact.record_status = 'active' AND LOWER(contact.email) = LOWER(?)))
      ORDER BY a.starts_at LIMIT 100`).bind(now, identity.email, identity.email).all<Record<string, unknown>>(),
    db.prepare(`SELECT r.id, r.appointment_id, r.status, r.preferred_windows, r.reason, r.access_notes,
        r.requested_appointment_revision, r.original_starts_at, r.original_ends_at, r.proposed_starts_at,
        r.proposed_ends_at, r.decision_note, r.revision, r.requested_at, r.decided_at,
        a.title, a.starts_at current_starts_at, a.ends_at current_ends_at, w.work_number
      FROM trade_crm_appointment_reschedule_requests r
      JOIN trade_crm_appointments a ON a.id = r.appointment_id AND a.firebase_uid = r.firebase_uid
      JOIN trade_work_orders w ON w.id = r.work_order_id AND w.firebase_uid = r.firebase_uid
      JOIN trade_crm_customers c ON c.id = r.crm_customer_id AND c.firebase_uid = r.firebase_uid AND c.record_status = 'active'
      WHERE r.customer_firebase_uid = ? AND LOWER(r.actor_email) = LOWER(?)
        AND (LOWER(c.email) = LOWER(?) OR EXISTS (SELECT 1 FROM trade_crm_customer_contacts contact
          WHERE contact.firebase_uid = c.firebase_uid AND contact.customer_id = c.id
            AND contact.record_status = 'active' AND LOWER(contact.email) = LOWER(?)))
      ORDER BY r.requested_at DESC LIMIT 100`).bind(identity.uid, identity.email, identity.email, identity.email).all<Record<string, unknown>>(),
  ]);
  return {
    appointments: appointments.results.map((row) => ({ id: row.id, title: row.title, appointmentType: row.appointment_type,
      startsAt: row.starts_at, endsAt: row.ends_at, revision: Number(row.revision), workNumber: row.work_number,
      siteLabel: row.site_label || "Service site", siteSummary: [row.suburb, row.address_state, row.postcode].filter(Boolean).join(" ") })),
    requests: requests.results.map((row) => ({ id: row.id, appointmentId: row.appointment_id, title: row.title,
      workNumber: row.work_number, status: row.status, preferredWindows: parsePreferredWindows(row.preferred_windows),
      reason: row.reason, accessNotes: row.access_notes, requestedAppointmentRevision: Number(row.requested_appointment_revision),
      originalStartsAt: row.original_starts_at, originalEndsAt: row.original_ends_at,
      currentStartsAt: row.current_starts_at, currentEndsAt: row.current_ends_at,
      proposedStartsAt: row.proposed_starts_at, proposedEndsAt: row.proposed_ends_at, decisionNote: row.decision_note,
      revision: Number(row.revision), requestedAt: row.requested_at, decidedAt: row.decided_at })),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { const identity = await customerIdentity(request); return adminJson({ ok: true, ...(await customerPayload(identity)) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    if (Number(request.headers.get("content-length") || 0) > 20_000) return adminJson({ ok: false, error: "The appointment request was too large." }, 413);
    const identity = await customerIdentity(request); const body = await request.json() as Record<string, unknown>;
    const appointmentId = cleanAdminText(body.appointmentId, 180); const windows = normalisePreferredWindows(body.preferredWindows);
    const reason = cleanAdminText(body.reason, 500); const accessNotes = cleanAdminText(body.accessNotes, 500);
    if (!appointmentId || !reason) return adminJson({ ok: false, error: "Choose an appointment and provide a brief reason for the requested change." }, 400);
    const appointment = await authorisedAppointment(identity, appointmentId); if (!appointment) throw new Error("APPOINTMENT_NOT_FOUND");
    if (Number(body.expectedAppointmentRevision) !== Number(appointment.revision)) throw new Error("REVISION_CONFLICT");
    const db = getD1();
    const active = await db.prepare(`SELECT id FROM trade_crm_appointment_reschedule_requests
      WHERE appointment_id = ? AND active_key = ? LIMIT 1`).bind(appointmentId, appointmentId).first();
    if (active) throw new Error("DUPLICATE_REQUEST");
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO trade_crm_appointment_revisions
        (id, appointment_id, work_order_id, firebase_uid, revision, starts_at, ends_at, assignee_member_id,
         assignee_label, change_source, source_reference, changed_by_uid, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'customer_request_snapshot', ?, ?, ?)`).bind(
          crypto.randomUUID(), appointment.id, appointment.work_order_id, appointment.firebase_uid, appointment.revision,
          appointment.starts_at, appointment.ends_at, appointment.assignee_member_id, appointment.assignee_label, id, identity.uid, now),
      db.prepare(`INSERT INTO trade_crm_appointment_reschedule_requests
        (id, appointment_id, work_order_id, firebase_uid, crm_customer_id, customer_firebase_uid, actor_email,
         status, active_key, preferred_windows, reason, access_notes, requested_appointment_revision,
         original_starts_at, original_ends_at, original_assignee_member_id, original_assignee_label,
         requested_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          id, appointment.id, appointment.work_order_id, appointment.firebase_uid, appointment.crm_customer_id,
          identity.uid, identity.email, appointment.id, JSON.stringify(windows), reason, accessNotes,
          appointment.revision, appointment.starts_at, appointment.ends_at, appointment.assignee_member_id,
          appointment.assignee_label, now, now, now),
      db.prepare(`INSERT INTO trade_work_order_tasks
        (id, work_order_id, firebase_uid, title, due_at, status, completed_at, revision, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', '', 1, 999, ?, ?)`).bind(
          `${id}:review-task`, appointment.work_order_id, appointment.firebase_uid, `Review customer appointment change request ${id.slice(0, 8)}`,
          appointment.starts_at, now, now),
      db.prepare(`INSERT INTO trade_crm_appointment_reschedule_events
        (id, request_id, appointment_id, work_order_id, firebase_uid, actor_type, actor_uid, event_type,
         request_revision, from_starts_at, from_ends_at, summary, created_at)
        VALUES (?, ?, ?, ?, ?, 'customer', ?, 'requested', 1, ?, ?, ?, ?)`).bind(
          crypto.randomUUID(), id, appointment.id, appointment.work_order_id, appointment.firebase_uid, identity.uid,
          appointment.starts_at, appointment.ends_at, "Verified customer requested an appointment change for staff review.", now),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'appointment_reschedule_requested', ?, ?)`).bind(
          crypto.randomUUID(), appointment.work_order_id, appointment.firebase_uid, "Verified customer requested an appointment change. The existing schedule remains unchanged.", now),
    ]);
    return adminJson({ ok: true, id, ...(await customerPayload(identity)) }, 201);
  } catch (error) { return errorResponse(error); }
}
