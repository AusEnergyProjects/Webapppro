import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { canDispatch, requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { addCalendarDays, defaultWorkingWindow, insideWorkingWindow, localDayAndMinute, normaliseLocalDateTime, normaliseWeekStart, rangesOverlap } from "@/lib/trade-schedule";
import { parsePreferredWindows } from "@/lib/appointment-rescheduling";

export const runtime = "edge";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["TEAM_ACCESS_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY"].includes(code)) return adminJson({ ok: false, error: "This account does not currently have active installer scheduling access." }, 403);
  if (code === "DISPATCH_REQUIRED") return adminJson({ ok: false, error: "Only the owner, manager or coordinator can change the team schedule." }, 403);
  if (code === "MEMBER_NOT_FOUND") return adminJson({ ok: false, error: "Choose an active team member." }, 404);
  if (code === "APPOINTMENT_NOT_FOUND") return adminJson({ ok: false, error: "Appointment not found." }, 404);
  if (code === "RESCHEDULE_REQUEST_NOT_FOUND") return adminJson({ ok: false, error: "Appointment change request not found." }, 404);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job not found." }, 404);
  if (code === "REVISION_CONFLICT") return adminJson({ ok: false, error: "This schedule item changed after you opened it. Refresh the week before saving again." }, 409);
  if (code.includes("NOT NULL constraint failed: trade_crm_appointment_reschedule_events.summary")
    || code.includes("NOT NULL constraint failed: trade_crm_appointment_revisions.starts_at")) {
    return adminJson({ ok: false, error: "This appointment request changed after you opened it. Refresh the week before deciding again." }, 409);
  }
  if (code === "APPOINTMENT_CONFLICT") return adminJson({ ok: false, error: "That team member already has an overlapping appointment." }, 409);
  if (code === "UNAVAILABLE_CONFLICT") return adminJson({ ok: false, error: "That team member is unavailable during the selected time." }, 409);
  if (code === "WORKING_HOURS_CONFLICT") return adminJson({ ok: false, error: "The selected time is outside that team member's recorded working hours." }, 409);
  if (["INVALID_WEEK", "INVALID_TIME", "INVALID_HOURS"].includes(code)) return adminJson({ ok: false, error: "Choose a valid week, time range and working-hours window." }, 400);
  if (code === "INVALID_DECISION") return adminJson({ ok: false, error: "Choose accept, reject or propose an alternative." }, 400);
  return adminJson({ ok: false, error: "The team schedule request could not be completed." }, 500);
}

async function activeMember(ownerUid: string, memberId: string) {
  const row = await getD1().prepare(`SELECT id, display_name, role FROM trade_team_members
    WHERE id = ? AND owner_uid = ? AND status = 'active'`).bind(memberId, ownerUid).first<Record<string, unknown>>();
  if (!row) throw new Error("MEMBER_NOT_FOUND");
  return row;
}

async function assertScheduleAvailable(ownerUid: string, memberId: string, startsAt: string, endsAt: string, excludeAppointmentId = "") {
  const db = getD1();
  const { weekday } = localDayAndMinute(startsAt);
  const [hours, overlap, unavailable] = await Promise.all([
    db.prepare(`SELECT start_minute, end_minute, is_available FROM trade_team_working_hours
      WHERE owner_uid = ? AND team_member_id = ? AND weekday = ?`).bind(ownerUid, memberId, weekday).first<Record<string, unknown>>(),
    db.prepare(`SELECT id FROM trade_crm_appointments WHERE firebase_uid = ? AND assignee_member_id = ?
      AND status = 'scheduled' AND id <> ? AND starts_at < ? AND COALESCE(NULLIF(ends_at, ''), starts_at) > ? LIMIT 1`)
      .bind(ownerUid, memberId, excludeAppointmentId, endsAt, startsAt).first(),
    db.prepare(`SELECT id FROM trade_team_unavailability WHERE owner_uid = ? AND team_member_id = ?
      AND starts_at < ? AND ends_at > ? LIMIT 1`).bind(ownerUid, memberId, endsAt, startsAt).first(),
  ]);
  if (overlap) throw new Error("APPOINTMENT_CONFLICT");
  if (unavailable) throw new Error("UNAVAILABLE_CONFLICT");
  const window = hours ? { isAvailable: Boolean(hours.is_available), startMinute: Number(hours.start_minute), endMinute: Number(hours.end_minute) } : defaultWorkingWindow(weekday);
  if (!insideWorkingWindow(startsAt, endsAt, window)) throw new Error("WORKING_HOURS_CONFLICT");
}

async function schedulePayload(ownerUid: string, weekStart: string) {
  const db = getD1(); const weekEnd = addCalendarDays(weekStart, 7);
  const [members, hours, unavailable, appointmentRows, unassignedJobs, rescheduleRows] = await Promise.all([
    db.prepare(`SELECT id, display_name, role, status FROM trade_team_members WHERE owner_uid = ? AND status = 'active'
      ORDER BY display_name, email`).bind(ownerUid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, team_member_id, weekday, start_minute, end_minute, is_available FROM trade_team_working_hours
      WHERE owner_uid = ? ORDER BY team_member_id, weekday`).bind(ownerUid).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, team_member_id, starts_at, ends_at, reason FROM trade_team_unavailability
      WHERE owner_uid = ? AND starts_at < ? AND ends_at >= ? ORDER BY starts_at`).bind(ownerUid, `${weekEnd}T00:00`, `${weekStart}T00:00`).all<Record<string, unknown>>(),
    db.prepare(`SELECT a.id, a.work_order_id, a.appointment_type, a.title, a.starts_at, a.ends_at, a.assignee_member_id,
        a.assignee_label, a.status, a.revision, w.work_number, w.service_category, w.site_area, w.source_type,
        d.customer_source, s.site_label, s.suburb, s.address_state, s.postcode
      FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.firebase_uid = w.firebase_uid
      WHERE a.firebase_uid = ? AND a.status = 'scheduled' AND a.starts_at < ?
        AND COALESCE(NULLIF(a.ends_at, ''), a.starts_at) >= ? ORDER BY a.starts_at, a.created_at`)
      .bind(ownerUid, `${weekEnd}T00:00`, `${weekStart}T00:00`).all<Record<string, unknown>>(),
    db.prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.site_area, w.priority, w.stage, w.revision, w.source_type,
        w.assignee_member_id, w.assignee_label,
        d.customer_source, s.site_label, s.suburb, s.address_state, s.postcode
      FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.firebase_uid = w.firebase_uid
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
        AND w.stage NOT IN ('completed', 'cancelled') AND NOT EXISTS (
          SELECT 1 FROM trade_crm_appointments pending WHERE pending.work_order_id = w.id
            AND pending.firebase_uid = w.firebase_uid AND pending.status = 'scheduled'
        )
      ORDER BY w.priority = 'urgent' DESC, w.updated_at DESC LIMIT 100`).bind(ownerUid).all<Record<string, unknown>>(),
    db.prepare(`SELECT r.id, r.appointment_id, r.work_order_id, r.status, r.preferred_windows, r.reason, r.access_notes,
        r.requested_appointment_revision, r.original_starts_at, r.original_ends_at, r.proposed_starts_at,
        r.proposed_ends_at, r.proposed_assignee_member_id, r.proposed_assignee_label, r.decision_note,
        r.revision, r.requested_at, r.decided_at, a.title, a.starts_at current_starts_at,
        a.ends_at current_ends_at, a.assignee_member_id current_assignee_member_id,
        a.assignee_label current_assignee_label, a.revision appointment_revision, w.work_number
      FROM trade_crm_appointment_reschedule_requests r
      JOIN trade_crm_appointments a ON a.id = r.appointment_id AND a.firebase_uid = r.firebase_uid
      JOIN trade_work_orders w ON w.id = r.work_order_id AND w.firebase_uid = r.firebase_uid
      WHERE r.firebase_uid = ? AND r.status IN ('pending', 'alternative_proposed')
      ORDER BY r.requested_at LIMIT 100`).bind(ownerUid).all<Record<string, unknown>>(),
  ]);
  const appointments = appointmentRows.results.map((row) => {
    const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private";
    const conflicts = appointmentRows.results.some((other) => other.id !== row.id && other.assignee_member_id && other.assignee_member_id === row.assignee_member_id
      && rangesOverlap(String(row.starts_at), String(row.ends_at || row.starts_at), String(other.starts_at), String(other.ends_at || other.starts_at)));
    return { id: row.id, workOrderId: row.work_order_id, workNumber: row.work_number, title: row.title, appointmentType: row.appointment_type,
      startsAt: row.starts_at, endsAt: row.ends_at, assigneeMemberId: row.assignee_member_id, assigneeLabel: row.assignee_label,
      status: row.status, revision: Number(row.revision || 1), serviceCategory: row.service_category,
      siteLabel: protectedJob ? row.site_area || "Protected service region" : row.site_label || "Site not selected",
      siteSummary: protectedJob ? "AEA protected job" : [row.suburb, row.address_state, row.postcode].filter(Boolean).join(" "), protectedJob, conflicts };
  });
  return { weekStart, weekEnd, members: members.results.map((row) => ({ id: row.id, displayName: row.display_name, role: row.role, status: row.status })),
    workingHours: hours.results.map((row) => ({ id: row.id, teamMemberId: row.team_member_id, weekday: Number(row.weekday), startMinute: Number(row.start_minute), endMinute: Number(row.end_minute), isAvailable: Boolean(row.is_available) })),
    unavailability: unavailable.results.map((row) => ({ id: row.id, teamMemberId: row.team_member_id, startsAt: row.starts_at, endsAt: row.ends_at, reason: row.reason })),
    appointments, rescheduleRequests: rescheduleRows.results.map((row) => ({ id: row.id, appointmentId: row.appointment_id,
      workOrderId: row.work_order_id, workNumber: row.work_number, title: row.title, status: row.status,
      preferredWindows: parsePreferredWindows(row.preferred_windows), reason: row.reason, accessNotes: row.access_notes,
      requestedAppointmentRevision: Number(row.requested_appointment_revision), originalStartsAt: row.original_starts_at,
      originalEndsAt: row.original_ends_at, proposedStartsAt: row.proposed_starts_at, proposedEndsAt: row.proposed_ends_at,
      proposedAssigneeMemberId: row.proposed_assignee_member_id, proposedAssigneeLabel: row.proposed_assignee_label,
      decisionNote: row.decision_note, revision: Number(row.revision), requestedAt: row.requested_at, decidedAt: row.decided_at,
      currentStartsAt: row.current_starts_at, currentEndsAt: row.current_ends_at,
      currentAssigneeMemberId: row.current_assignee_member_id, currentAssigneeLabel: row.current_assignee_label,
      appointmentRevision: Number(row.appointment_revision) })),
    unassignedJobs: unassignedJobs.results.map((row) => { const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private"; return { id: row.id, workNumber: row.work_number, title: row.title, serviceCategory: row.service_category,
      siteLabel: protectedJob ? row.site_area || "Protected service region" : row.site_label || "Site not selected",
      siteSummary: protectedJob ? "AEA protected job" : [row.suburb, row.address_state, row.postcode].filter(Boolean).join(" "),
      priority: row.priority, stage: row.stage, revision: Number(row.revision || 1), assigneeMemberId: row.assignee_member_id, assigneeLabel: row.assignee_label }; }) };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { const access = await requireInstallerTeamAccess(request); if (!canDispatch(access)) throw new Error("DISPATCH_REQUIRED");
    const weekStart = normaliseWeekStart(new URL(request.url).searchParams.get("weekStart"));
    return adminJson({ ok: true, ...(await schedulePayload(access.ownerUid, weekStart)) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request); if (!canDispatch(access)) throw new Error("DISPATCH_REQUIRED");
    const body = await request.json() as Record<string, unknown>; const action = cleanAdminText(body.action, 40); const db = getD1(); const now = new Date().toISOString();
    const weekStart = normaliseWeekStart(body.weekStart);
    if (action === "save_working_hours") {
      const memberId = cleanAdminText(body.memberId, 180); await activeMember(access.ownerUid, memberId);
      const weekday = Number(body.weekday); const startMinute = Number(body.startMinute); const endMinute = Number(body.endMinute); const isAvailable = Boolean(body.isAvailable);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)
        || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute) throw new Error("INVALID_HOURS");
      await db.prepare(`INSERT INTO trade_team_working_hours (id, owner_uid, team_member_id, weekday, start_minute, end_minute, is_available, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_uid, team_member_id, weekday) DO UPDATE SET start_minute = excluded.start_minute,
        end_minute = excluded.end_minute, is_available = excluded.is_available, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), access.ownerUid, memberId, weekday, startMinute, endMinute, isAvailable ? 1 : 0, now, now).run();
    } else if (action === "add_unavailability") {
      const memberId = cleanAdminText(body.memberId, 180); await activeMember(access.ownerUid, memberId);
      const startsAt = normaliseLocalDateTime(body.startsAt); const endsAt = normaliseLocalDateTime(body.endsAt); if (endsAt <= startsAt) throw new Error("INVALID_TIME");
      await db.prepare(`INSERT INTO trade_team_unavailability (id, owner_uid, team_member_id, starts_at, ends_at, reason, created_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), access.ownerUid, memberId, startsAt, endsAt, cleanAdminText(body.reason, 200) || "Unavailable", access.actorUid, now, now).run();
    } else if (action === "remove_unavailability") {
      await db.prepare("DELETE FROM trade_team_unavailability WHERE id = ? AND owner_uid = ?").bind(cleanAdminText(body.id, 180), access.ownerUid).run();
    } else if (action === "review_reschedule_request") {
      const requestId = cleanAdminText(body.requestId, 180); const decision = cleanAdminText(body.decision, 40);
      if (!["accepted", "rejected", "alternative_proposed"].includes(decision)) throw new Error("INVALID_DECISION");
      const current = await db.prepare(`SELECT r.*, a.starts_at current_starts_at, a.ends_at current_ends_at,
          a.assignee_member_id current_assignee_member_id, a.assignee_label current_assignee_label,
          a.revision appointment_revision, a.status appointment_status, w.revision job_revision
        FROM trade_crm_appointment_reschedule_requests r
        JOIN trade_crm_appointments a ON a.id = r.appointment_id AND a.firebase_uid = r.firebase_uid
        JOIN trade_work_orders w ON w.id = r.work_order_id AND w.firebase_uid = r.firebase_uid
        WHERE r.id = ? AND r.firebase_uid = ? AND r.status IN ('pending', 'alternative_proposed')`)
        .bind(requestId, access.ownerUid).first<Record<string, unknown>>();
      if (!current || current.appointment_status !== "scheduled") throw new Error("RESCHEDULE_REQUEST_NOT_FOUND");
      if (Number(body.expectedRequestRevision) !== Number(current.revision)
        || Number(body.expectedAppointmentRevision) !== Number(current.appointment_revision)) throw new Error("REVISION_CONFLICT");
      const requestRevision = Number(current.revision) + 1; const decisionNote = cleanAdminText(body.decisionNote, 500);
      if (decision === "rejected") {
        await db.batch([
          db.prepare(`UPDATE trade_crm_appointment_reschedule_requests SET status = 'rejected', active_key = ?,
            decision_note = ?, revision = ?, decided_by_uid = ?, decided_at = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND revision = ?`).bind(
              `closed:${requestId}`, decisionNote, requestRevision, access.actorUid, now, now, requestId, access.ownerUid, current.revision),
          db.prepare(`INSERT INTO trade_crm_appointment_reschedule_events
            (id, request_id, appointment_id, work_order_id, firebase_uid, actor_type, actor_uid, event_type,
             request_revision, from_starts_at, from_ends_at, summary, created_at)
            VALUES (?, ?, ?, ?, ?, 'staff', ?, 'rejected', ?, ?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END, ?)`).bind(
              crypto.randomUUID(), requestId, current.appointment_id, current.work_order_id, access.ownerUid, access.actorUid,
              requestRevision, current.current_starts_at, current.current_ends_at, "Dispatch rejected the appointment change request. The schedule was not changed.", now),
          db.prepare(`UPDATE trade_work_order_tasks SET status = 'completed', completed_at = ?, revision = revision + 1, updated_at = ?
            WHERE id = ? AND firebase_uid = ?`).bind(now, now, `${requestId}:review-task`, access.ownerUid),
          db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
            VALUES (?, ?, ?, 'appointment_reschedule_rejected', ?, ?)`).bind(
              crypto.randomUUID(), current.work_order_id, access.ownerUid, "Customer appointment change request rejected. The existing schedule remains unchanged.", now),
        ]);
      } else {
        const memberId = cleanAdminText(body.memberId, 180); const member = await activeMember(access.ownerUid, memberId);
        const startsAt = normaliseLocalDateTime(body.startsAt); const endsAt = normaliseLocalDateTime(body.endsAt);
        if (endsAt <= startsAt) throw new Error("INVALID_TIME");
        await assertScheduleAvailable(access.ownerUid, memberId, startsAt, endsAt, String(current.appointment_id));
        if (decision === "alternative_proposed") {
          await db.batch([
            db.prepare(`UPDATE trade_crm_appointment_reschedule_requests SET status = 'alternative_proposed',
              proposed_starts_at = ?, proposed_ends_at = ?, proposed_assignee_member_id = ?, proposed_assignee_label = ?,
              decision_note = ?, revision = ?, decided_by_uid = ?, decided_at = ?, updated_at = ?
              WHERE id = ? AND firebase_uid = ? AND revision = ?`).bind(
                startsAt, endsAt, memberId, member.display_name, decisionNote, requestRevision, access.actorUid, now, now,
                requestId, access.ownerUid, current.revision),
            db.prepare(`INSERT INTO trade_crm_appointment_reschedule_events
              (id, request_id, appointment_id, work_order_id, firebase_uid, actor_type, actor_uid, event_type,
               request_revision, from_starts_at, from_ends_at, to_starts_at, to_ends_at, summary, created_at)
              VALUES (?, ?, ?, ?, ?, 'staff', ?, 'alternative_proposed', ?, ?, ?, ?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END, ?)`).bind(
                crypto.randomUUID(), requestId, current.appointment_id, current.work_order_id, access.ownerUid, access.actorUid,
                requestRevision, current.current_starts_at, current.current_ends_at, startsAt, endsAt,
                "Dispatch proposed an alternative appointment window. The schedule was not changed.", now),
            db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
              VALUES (?, ?, ?, 'appointment_reschedule_alternative', ?, ?)`).bind(
                crypto.randomUUID(), current.work_order_id, access.ownerUid, "Alternative appointment window proposed for customer review. The existing schedule remains unchanged.", now),
          ]);
        } else {
          const appointmentRevision = Number(current.appointment_revision) + 1; const jobRevision = nextJobRevision(current.job_revision);
          await db.batch([
            db.prepare(`INSERT OR IGNORE INTO trade_crm_appointment_revisions
              (id, appointment_id, work_order_id, firebase_uid, revision, starts_at, ends_at, assignee_member_id,
               assignee_label, change_source, source_reference, changed_by_uid, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reschedule_prior', ?, ?, ?)`).bind(
                crypto.randomUUID(), current.appointment_id, current.work_order_id, access.ownerUid, current.appointment_revision,
                current.current_starts_at, current.current_ends_at, current.current_assignee_member_id,
                current.current_assignee_label, requestId, access.actorUid, now),
            db.prepare(`UPDATE trade_crm_appointments SET starts_at = ?, ends_at = ?, assignee_member_id = ?, assignee_label = ?,
              revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND revision = ?
                AND EXISTS (SELECT 1 FROM trade_crm_appointment_reschedule_requests guard
                  WHERE guard.id = ? AND guard.firebase_uid = ? AND guard.revision = ?
                    AND guard.status IN ('pending', 'alternative_proposed'))`).bind(
                startsAt, endsAt, memberId, member.display_name, appointmentRevision, now, current.appointment_id,
                access.ownerUid, current.appointment_revision, requestId, access.ownerUid, current.revision),
            db.prepare(`INSERT INTO trade_crm_appointment_revisions
              (id, appointment_id, work_order_id, firebase_uid, revision, starts_at, ends_at, assignee_member_id,
               assignee_label, change_source, source_reference, changed_by_uid, created_at)
              VALUES (?, ?, ?, ?, ?, CASE WHEN changes() = 1 THEN ? ELSE NULL END, ?, ?, ?, 'reschedule_accepted', ?, ?, ?)`).bind(
                crypto.randomUUID(), current.appointment_id, current.work_order_id, access.ownerUid, appointmentRevision,
                startsAt, endsAt, memberId, member.display_name, requestId, access.actorUid, now),
            db.prepare(`UPDATE trade_crm_appointment_reschedule_requests SET status = 'accepted', active_key = ?,
              proposed_starts_at = ?, proposed_ends_at = ?, proposed_assignee_member_id = ?, proposed_assignee_label = ?,
              decision_note = ?, revision = ?, decided_by_uid = ?, decided_at = ?, updated_at = ?
              WHERE id = ? AND firebase_uid = ? AND revision = ?`).bind(
                `closed:${requestId}`, startsAt, endsAt, memberId, member.display_name, decisionNote, requestRevision,
                access.actorUid, now, now, requestId, access.ownerUid, current.revision),
            db.prepare(`UPDATE trade_work_order_tasks SET status = 'completed', completed_at = ?, revision = revision + 1, updated_at = ?
              WHERE id = ? AND firebase_uid = ?`).bind(now, now, `${requestId}:review-task`, access.ownerUid),
            db.prepare(`UPDATE trade_work_orders SET assignee_member_id = ?, assignee_label = ?, scheduled_start = ?, scheduled_end = ?,
              revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?`).bind(
                memberId, member.display_name, startsAt.slice(0, 10), endsAt.slice(0, 10), jobRevision, now,
                current.work_order_id, access.ownerUid),
            db.prepare(`UPDATE customer_project_arrival_proposals SET preparation_acknowledged_at = '', updated_at = ?
              WHERE crm_appointment_id = ? AND preparation_acknowledged_at <> ''`).bind(now, current.appointment_id),
            db.prepare(`INSERT INTO trade_crm_appointment_reschedule_events
              (id, request_id, appointment_id, work_order_id, firebase_uid, actor_type, actor_uid, event_type,
               request_revision, from_starts_at, from_ends_at, to_starts_at, to_ends_at, summary, created_at)
              VALUES (?, ?, ?, ?, ?, 'staff', ?, 'accepted', ?, ?, ?, ?, ?, ?, ?)`).bind(
                crypto.randomUUID(), requestId, current.appointment_id, current.work_order_id, access.ownerUid, access.actorUid,
                requestRevision, current.current_starts_at, current.current_ends_at, startsAt, endsAt,
                "Dispatch accepted the appointment change request and updated the schedule.", now),
            db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
              VALUES (?, ?, ?, 'appointment_reschedule_accepted', ?, ?)`).bind(
                crypto.randomUUID(), current.work_order_id, access.ownerUid, `Customer appointment change accepted for ${startsAt}.`, now),
            ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: String(current.work_order_id),
              revision: jobRevision, changedAt: now, audienceMemberId: memberId,
              previousAudienceMemberId: String(current.current_assignee_member_id || "") }),
          ]);
        }
      }
    } else if (action === "schedule_appointment") {
      const appointmentId = cleanAdminText(body.appointmentId, 180); const memberId = cleanAdminText(body.memberId, 180); const member = await activeMember(access.ownerUid, memberId);
      const startsAt = normaliseLocalDateTime(body.startsAt); const endsAt = normaliseLocalDateTime(body.endsAt); if (endsAt <= startsAt) throw new Error("INVALID_TIME");
      const current = await db.prepare(`SELECT a.id, a.work_order_id, a.revision, a.assignee_member_id, w.revision job_revision
        FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
        WHERE a.id = ? AND a.firebase_uid = ? AND a.status = 'scheduled'`).bind(appointmentId, access.ownerUid).first<Record<string, unknown>>();
      if (!current) throw new Error("APPOINTMENT_NOT_FOUND"); if (Number(body.expectedRevision) !== Number(current.revision)) throw new Error("REVISION_CONFLICT");
      await assertScheduleAvailable(access.ownerUid, memberId, startsAt, endsAt, appointmentId);
      const revision = Number(current.revision) + 1; const jobRevision = nextJobRevision(current.job_revision);
      await db.batch([
        db.prepare(`UPDATE trade_crm_appointments SET starts_at = ?, ends_at = ?, assignee_member_id = ?, assignee_label = ?, revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND revision = ?`).bind(startsAt, endsAt, memberId, member.display_name, revision, now, appointmentId, access.ownerUid, current.revision),
        db.prepare(`UPDATE trade_work_orders SET assignee_member_id = ?, assignee_label = ?, scheduled_start = ?, scheduled_end = ?, revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ?`).bind(memberId, member.display_name, startsAt.slice(0, 10), endsAt.slice(0, 10), jobRevision, now, current.work_order_id, access.ownerUid),
        db.prepare(`UPDATE customer_project_arrival_proposals SET preparation_acknowledged_at = '', updated_at = ?
          WHERE crm_appointment_id = ? AND preparation_acknowledged_at <> ''`).bind(now, appointmentId),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'schedule_updated', ?, ?)`).bind(crypto.randomUUID(), current.work_order_id, access.ownerUid, `Appointment assigned to ${member.display_name} for ${startsAt}.`, now),
        ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: String(current.work_order_id), revision: jobRevision, changedAt: now,
          audienceMemberId: memberId, previousAudienceMemberId: String(current.assignee_member_id || "") }),
      ]);
    } else if (action === "schedule_job") {
      const workOrderId = cleanAdminText(body.workOrderId, 180); const memberId = cleanAdminText(body.memberId, 180); const member = await activeMember(access.ownerUid, memberId);
      const startsAt = normaliseLocalDateTime(body.startsAt); const endsAt = normaliseLocalDateTime(body.endsAt); if (endsAt <= startsAt) throw new Error("INVALID_TIME");
      const job = await db.prepare(`SELECT id, work_number, title, revision, assignee_member_id FROM trade_work_orders WHERE id = ? AND firebase_uid = ?
        AND partner_type = 'installer' AND record_status = 'active'`).bind(workOrderId, access.ownerUid).first<Record<string, unknown>>();
      if (!job) throw new Error("JOB_NOT_FOUND"); if (Number(body.expectedRevision) !== Number(job.revision)) throw new Error("REVISION_CONFLICT");
      await assertScheduleAvailable(access.ownerUid, memberId, startsAt, endsAt); const revision = nextJobRevision(job.revision);
      await db.batch([
        db.prepare(`INSERT INTO trade_crm_appointments (id, work_order_id, firebase_uid, appointment_type, title, starts_at, ends_at, assignee_member_id,
          assignee_label, status, notes, revision, created_at, updated_at) VALUES (?, ?, ?, 'work', ?, ?, ?, ?, ?, 'scheduled', '', 1, ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, access.ownerUid, job.title, startsAt, endsAt, memberId, member.display_name, now, now),
        db.prepare(`UPDATE trade_work_orders SET assignee_member_id = ?, assignee_label = ?, scheduled_start = ?, scheduled_end = ?, stage = 'scheduled', revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ?`).bind(memberId, member.display_name, startsAt.slice(0, 10), endsAt.slice(0, 10), revision, now, workOrderId, access.ownerUid),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'schedule_created', ?, ?)`).bind(crypto.randomUUID(), workOrderId, access.ownerUid, `${job.work_number} scheduled with ${member.display_name} for ${startsAt}.`, now),
        ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now, audienceMemberId: memberId,
          previousAudienceMemberId: String(job.assignee_member_id || "") }),
      ]);
    } else return adminJson({ ok: false, error: "Unsupported schedule action." }, 400);
    return adminJson({ ok: true, ...(await schedulePayload(access.ownerUid, weekStart)) });
  } catch (error) { return errorResponse(error); }
}
