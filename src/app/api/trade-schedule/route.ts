import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { canAssignJob, canViewSchedule, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { addCalendarDays, appointmentEndsAt, assertAppointmentSlot, assertFutureAppointment, australiaLocalDateTime, defaultWorkingWindow, insideWorkingWindow, localDayAndMinute, normaliseLocalDateTime, normaliseScheduleRangeWeeks, normaliseWeekStart, scheduleConflictIds } from "@/lib/trade-schedule";
import { parsePreferredWindows } from "@/lib/appointment-rescheduling";
import { queueAppointmentNotifications } from "@/lib/appointment-notification-server";
import { syncCreatedAppointmentToConnectedCalendars } from "@/lib/trade-calendar-sync-server";
import {
  isTradeComplianceIntentScheduleConflict,
  plannedComplianceIntentReplanStatements,
  previousTradeScheduleMutationGuardStatement,
} from "@/lib/trade-compliance-intent-replan-server";
import { canRescheduleWithinScope } from "@/lib/trade-team-permission-policy.mjs";
import {
  assertTradeJobReadyForScheduling,
  assertTradeScheduleAvailable,
  isTradeJobScheduleEligibilityConflict,
  tradeJobScheduleEligibilityGuardStatement,
  tradeJobScheduleEligibilitySql,
  tradeScheduleAvailabilityGuardStatement,
} from "@/lib/trade-schedule-server";

export const runtime = "edge";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "JOB_SCHEDULE_ACCEPTANCE_REQUIRED" || isTradeJobScheduleEligibilityConflict(error)) {
    return adminJson({ ok: false, error: "Wait for the customer to accept the current Australian Energy Assessments quote before scheduling this job." }, 409);
  }
  if (isTradeComplianceIntentScheduleConflict(error)) {
    return adminJson({ ok: false, error: "This job, its selected time or its compliance plan changed after you opened it. Refresh the schedule before saving again." }, 409);
  }
  if (code.includes("Compliance-linked job activity date cannot change without case supersession")) {
    return adminJson({ ok: false, error: "This job is linked to a compliance case, so its planned installation date is locked. Governed case supersession is not available yet." }, 409);
  }
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (["TEAM_ACCESS_REQUIRED", "ACCOUNT_INACTIVE", "INSTALLER_ONLY"].includes(code)) return adminJson({ ok: false, error: "This account does not currently have active installer scheduling access." }, 403);
  if (code === "SCHEDULE_VIEW_REQUIRED") return adminJson({ ok: false, error: "Your team access does not include the schedule." }, 403);
  if (code === "DISPATCH_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow this schedule change." }, 403);
  if (code === "RESCHEDULE_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow appointment scheduling or rescheduling." }, 403);
  if (code === "ASSIGN_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow assigning this job to another person." }, 403);
  if (code === "MEMBER_CAPABILITY_REQUIRED") return adminJson({ ok: false, error: "This team member is not enabled for the job's service category." }, 409);
  if (code === "MEMBER_NOT_FOUND") return adminJson({ ok: false, error: "Choose an active team member." }, 404);
  if (code === "APPOINTMENT_NOT_FOUND") return adminJson({ ok: false, error: "Appointment not found." }, 404);
  if (code === "RESCHEDULE_REQUEST_NOT_FOUND") return adminJson({ ok: false, error: "Appointment change request not found." }, 404);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job not found." }, 404);
  if (code === "REVISION_CONFLICT") return adminJson({ ok: false, error: "This schedule item changed after you opened it. Refresh the week before saving again." }, 409);
  if (code === "INVALID_SCHEDULE_CHANGES") return adminJson({ ok: false, error: "Choose between one and five different appointments to save." }, 400);
  if (code === "DUPLICATE_SCHEDULE_JOB") return adminJson({ ok: false, error: "Save one appointment per job at a time." }, 400);
  if (code === "TERMINAL_JOB_LOCKED") return adminJson({ ok: false, error: "Completed or cancelled jobs cannot be rescheduled." }, 409);
  if (code.includes("NOT NULL constraint failed: trade_crm_appointment_reschedule_events.summary")
    || code.includes("NOT NULL constraint failed: trade_crm_appointment_revisions.starts_at")) {
    return adminJson({ ok: false, error: "This appointment request changed after you opened it. Refresh the week before deciding again." }, 409);
  }
  if (code === "APPOINTMENT_CONFLICT") return adminJson({ ok: false, error: "That team member already has an overlapping appointment." }, 409);
  if (code === "UNAVAILABLE_CONFLICT") return adminJson({ ok: false, error: "That team member is unavailable during the selected time." }, 409);
  if (code === "PAST_APPOINTMENT") return adminJson({ ok: false, error: "Choose a future appointment time." }, 400);
  if (code === "INVALID_APPOINTMENT_SLOT") return adminJson({ ok: false, error: "Choose an appointment time on a 15-minute interval." }, 400);
  if (["INVALID_WEEK", "INVALID_SCHEDULE_RANGE", "INVALID_TIME", "INVALID_HOURS", "INVALID_DURATION"].includes(code)) return adminJson({ ok: false, error: "Choose a valid week, start time and duration from 15 minutes to 8 hours." }, 400);
  if (code === "INVALID_DECISION") return adminJson({ ok: false, error: "Choose accept, reject or propose an alternative." }, 400);
  return adminJson({ ok: false, error: "The team schedule request could not be completed." }, 500);
}

async function activeMember(ownerUid: string, memberId: string) {
  const row = await getD1().prepare(`SELECT id, member_uid, display_name, capabilities FROM trade_team_members
    WHERE id = ? AND owner_uid = ? AND status = 'active'`).bind(memberId, ownerUid).first<Record<string, unknown>>();
  if (!row) throw new Error("MEMBER_NOT_FOUND");
  return row;
}

function parsedCapabilities(value: unknown) {
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

function assertScheduleTarget(access: TeamAccess, memberId: string) {
  if (!access.isOwner && access.scheduleScope === "own" && memberId !== access.memberId) {
    throw new Error("RESCHEDULE_REQUIRED");
  }
}

function assertCurrentScheduleAssignment(access: TeamAccess, memberId: string) {
  if (!canRescheduleWithinScope(access, memberId)) throw new Error("RESCHEDULE_REQUIRED");
}

function assertAssignmentChange(access: TeamAccess, fromMemberId: string, toMemberId: string) {
  if (fromMemberId === toMemberId) return;
  if (!canAssignJob(access, fromMemberId, toMemberId)) throw new Error("ASSIGN_REQUIRED");
}

function assertMemberCapability(member: Record<string, unknown>, serviceCategory: string, ownerUid: string) {
  if (String(member.member_uid || "") !== ownerUid && serviceCategory
    && !parsedCapabilities(member.capabilities).includes(serviceCategory)) {
    throw new Error("MEMBER_CAPABILITY_REQUIRED");
  }
}

function scheduleMemberGuardStatement(
  db: D1Database,
  { ownerUid, memberId, serviceCategory, changedAt }: {
    ownerUid: string;
    memberId: string;
    serviceCategory: string;
    changedAt: string;
  },
) {
  return db.prepare(`INSERT INTO trade_crm_write_guards
    (id, firebase_uid, operation_id, step_number, verified, created_at)
    VALUES (?, ?, ?, 1, CASE WHEN EXISTS (
      SELECT 1 FROM trade_team_members selected_member
      WHERE selected_member.id = ? AND selected_member.owner_uid = ? AND selected_member.status = 'active'
        AND (selected_member.member_uid = ? OR ? = '' OR EXISTS (
          SELECT 1 FROM json_each(selected_member.capabilities) WHERE value = ?
        ))
    ) THEN 1 ELSE 0 END, ?)`)
    .bind(crypto.randomUUID(), ownerUid, `schedule-member:${crypto.randomUUID()}`,
      memberId, ownerUid, ownerUid, serviceCategory, serviceCategory, changedAt);
}

async function schedulePayload(access: TeamAccess, rangeStart: string, rangeWeeks = 1) {
  const db = getD1(); const ownerUid = access.ownerUid;
  const ownOnly = !access.isOwner && access.scheduleScope === "own";
  const availabilityOwnOnly = !access.isOwner && !access.canManageTeam;
  const rangeEnd = addCalendarDays(rangeStart, normaliseScheduleRangeWeeks(rangeWeeks) * 7);
  const [members, availabilityMembers, hours, unavailable, appointmentRows, unassignedJobs, rescheduleRows] = await Promise.all([
    db.prepare(`SELECT id, member_uid, display_name, status, schedule_colour FROM trade_team_members WHERE owner_uid = ? AND status = 'active'
      AND (? = 0 OR id = ?) ORDER BY display_name, email`).bind(ownerUid, ownOnly ? 1 : 0, access.memberId).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, member_uid, display_name, status, schedule_colour FROM trade_team_members WHERE owner_uid = ? AND status = 'active'
      AND (? = 0 OR id = ?) ORDER BY display_name, email`).bind(ownerUid, availabilityOwnOnly ? 1 : 0, access.memberId).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, team_member_id, weekday, start_minute, end_minute, is_available FROM trade_team_working_hours
      WHERE owner_uid = ? AND (? = 0 OR team_member_id = ?) ORDER BY team_member_id, weekday`)
      .bind(ownerUid, availabilityOwnOnly ? 1 : 0, access.memberId).all<Record<string, unknown>>(),
    db.prepare(`SELECT id, team_member_id, starts_at, ends_at, reason FROM trade_team_unavailability
      WHERE owner_uid = ? AND (? = 0 OR team_member_id = ?) AND starts_at < ? AND ends_at >= ? ORDER BY starts_at`)
      .bind(ownerUid, availabilityOwnOnly ? 1 : 0, access.memberId, `${rangeEnd}T00:00`, `${rangeStart}T00:00`).all<Record<string, unknown>>(),
    db.prepare(`SELECT a.id, a.work_order_id, a.appointment_type, a.title, a.starts_at, a.ends_at, a.assignee_member_id,
        a.assignee_label, a.status, a.notes, a.revision, w.work_number, w.service_category, w.site_area, w.source_type,
        d.customer_source, d.quote_status, d.quoted_value_cents, c.first_name customer_first_name, c.last_name customer_last_name,
        c.business_name customer_business_name, c.email customer_email, c.phone customer_phone,
        s.site_label, s.address_line_1, s.address_line_2, s.suburb, s.address_state, s.postcode
      FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
      LEFT JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.firebase_uid = w.firebase_uid
      WHERE a.firebase_uid = ? AND a.status IN ('scheduled', 'en_route', 'arrived', 'in_progress') AND a.starts_at < ?
        AND COALESCE(NULLIF(a.ends_at, ''), a.starts_at) >= ? AND (? = 0 OR a.assignee_member_id = ?)
      ORDER BY a.starts_at, a.created_at`)
      .bind(ownerUid, `${rangeEnd}T00:00`, `${rangeStart}T00:00`, ownOnly ? 1 : 0, access.memberId).all<Record<string, unknown>>(),
    (!access.canAssignJobs || ownOnly) ? Promise.resolve({ results: [] as Record<string, unknown>[] }) : db.prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.site_area, w.priority, w.stage, w.revision, w.source_type,
        w.assignee_member_id, w.assignee_label,
        d.customer_source, c.first_name customer_first_name, c.last_name customer_last_name,
        c.business_name customer_business_name, s.site_label, s.suburb, s.address_state, s.postcode
      FROM trade_work_orders w LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid AND c.record_status = 'active'
      LEFT JOIN trade_crm_service_sites s ON s.id = d.service_site_id AND s.firebase_uid = w.firebase_uid
      WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
        AND ${tradeJobScheduleEligibilitySql("w", "d")}
        AND w.stage NOT IN ('completed', 'cancelled') AND NOT EXISTS (
          SELECT 1 FROM trade_crm_appointments pending WHERE pending.work_order_id = w.id
            AND pending.firebase_uid = w.firebase_uid AND pending.status IN ('scheduled', 'en_route', 'arrived', 'in_progress')
        )
      ORDER BY w.priority = 'urgent' DESC, w.updated_at DESC LIMIT 100`).bind(ownerUid).all<Record<string, unknown>>(),
    !access.canRescheduleJobs ? Promise.resolve({ results: [] as Record<string, unknown>[] }) : db.prepare(`SELECT r.id, r.appointment_id, r.work_order_id, r.status, r.preferred_windows, r.reason, r.access_notes,
        r.requested_appointment_revision, r.original_starts_at, r.original_ends_at, r.proposed_starts_at,
        r.proposed_ends_at, r.proposed_assignee_member_id, r.proposed_assignee_label, r.decision_note,
        r.revision, r.requested_at, r.decided_at, a.title, a.starts_at current_starts_at,
        a.ends_at current_ends_at, a.assignee_member_id current_assignee_member_id,
        a.assignee_label current_assignee_label, a.revision appointment_revision, w.work_number,
        w.service_category, w.source_type, d.customer_source
      FROM trade_crm_appointment_reschedule_requests r
      JOIN trade_crm_appointments a ON a.id = r.appointment_id AND a.firebase_uid = r.firebase_uid
      JOIN trade_work_orders w ON w.id = r.work_order_id AND w.firebase_uid = r.firebase_uid
      LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
      WHERE r.firebase_uid = ? AND r.status IN ('pending', 'alternative_proposed')
        AND (? = 0 OR a.assignee_member_id = ?)
      ORDER BY r.requested_at LIMIT 100`).bind(ownerUid, ownOnly ? 1 : 0, access.memberId).all<Record<string, unknown>>(),
  ]);
  const workingHours = hours.results.map((row) => ({ id: row.id, teamMemberId: row.team_member_id, weekday: Number(row.weekday), startMinute: Number(row.start_minute), endMinute: Number(row.end_minute), isAvailable: Boolean(row.is_available) }));
  const conflictIds = scheduleConflictIds(appointmentRows.results.map((row) => ({
    id: String(row.id), assigneeMemberId: row.assignee_member_id,
    startsAt: String(row.starts_at), endsAt: String(row.ends_at || row.starts_at),
  })));
  const workingHoursByMemberAndDay = new Map(workingHours.map((item) => [`${item.teamMemberId}:${item.weekday}`, item]));
  const appointments = appointmentRows.results.map((row) => {
    const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private";
    const conflicts = conflictIds.has(String(row.id));
    const weekday = localDayAndMinute(String(row.starts_at)).weekday;
    const savedHours = workingHoursByMemberAndDay.get(`${row.assignee_member_id}:${weekday}`);
    const workingWindow = savedHours || defaultWorkingWindow(weekday);
    const customerDisplayName = protectedJob ? "Australian Energy Assessments protected customer"
      : ["trade_owned", "public_lead_released"].includes(String(row.customer_source || ""))
        ? String(row.customer_business_name || "").trim() || [row.customer_first_name, row.customer_last_name].map((value) => String(value || "").trim()).filter(Boolean).join(" ") || "Customer"
        : "No customer linked";
    const suburbLabel = protectedJob ? String(row.site_area || "Protected service region") : String(row.suburb || row.site_area || "Suburb not recorded");
    const assignedViewer = !access.isOwner && String(row.assignee_member_id || "") === access.memberId;
    const canSeeOperationalDetails = !protectedJob && (access.isOwner || access.jobScope === "team" || assignedViewer);
    const canSeeCustomerContact = !protectedJob && (access.isOwner || access.canViewCustomers);
    return { id: row.id, workOrderId: row.work_order_id, workNumber: row.work_number,
      title: protectedJob ? `${String(row.service_category || "Service")} appointment` : row.title, appointmentType: row.appointment_type,
      startsAt: row.starts_at, endsAt: row.ends_at, assigneeMemberId: row.assignee_member_id, assigneeLabel: row.assignee_label,
      status: row.status, revision: Number(row.revision || 1), serviceCategory: row.service_category, customerDisplayName, suburbLabel,
      siteLabel: protectedJob ? row.site_area || "Protected service region" : row.site_label || "Site not selected",
      siteSummary: protectedJob ? "Australian Energy Assessments protected job" : [row.suburb, row.address_state, row.postcode].filter(Boolean).join(" "),
      addressLine1: canSeeOperationalDetails ? String(row.address_line_1 || "") : "",
      addressLine2: canSeeOperationalDetails ? String(row.address_line_2 || "") : "",
      addressSuburb: canSeeOperationalDetails ? String(row.suburb || "") : "",
      addressState: canSeeOperationalDetails ? String(row.address_state || "") : "",
      addressPostcode: canSeeOperationalDetails ? String(row.postcode || "") : "",
      notes: canSeeOperationalDetails ? String(row.notes || "") : "",
      customerEmail: canSeeCustomerContact ? String(row.customer_email || "") : "",
      customerPhone: canSeeCustomerContact ? String(row.customer_phone || "") : "",
      quoteStatus: access.canViewQuotes ? String(row.quote_status || "not_started") : "restricted",
      quotedValueCents: access.canViewQuotes ? Number(row.quoted_value_cents || 0) : 0, protectedJob, conflicts,
      outsideWorkingHours: !insideWorkingWindow(String(row.starts_at), String(row.ends_at || row.starts_at), workingWindow) };
  });
  return { weekStart: rangeStart, weekEnd: rangeEnd, rangeStart, rangeEnd, rangeWeeks,
    access: { memberId: access.memberId, isOwner: access.isOwner,
      permissions: { canAssignJobs: access.canAssignJobs, canRescheduleJobs: access.canRescheduleJobs,
        canManageTeam: access.canManageTeam, jobScope: access.jobScope, scheduleScope: access.scheduleScope } },
    members: members.results.map((row) => ({ id: row.id, displayName: row.display_name, status: row.status,
      scheduleColour: row.schedule_colour, isOwner: row.member_uid === ownerUid })),
    availabilityMembers: availabilityMembers.results.map((row) => ({ id: row.id, displayName: row.display_name, status: row.status,
      scheduleColour: row.schedule_colour, isOwner: row.member_uid === ownerUid })),
    workingHours,
    unavailability: unavailable.results.map((row) => ({ id: row.id, teamMemberId: row.team_member_id, startsAt: row.starts_at, endsAt: row.ends_at, reason: row.reason })),
    appointments, rescheduleRequests: rescheduleRows.results.map((row) => { const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private"; return ({ id: row.id, appointmentId: row.appointment_id,
      workOrderId: row.work_order_id, workNumber: row.work_number,
      title: protectedJob ? "Appointment change request" : row.title, status: row.status,
      preferredWindows: parsePreferredWindows(row.preferred_windows),
      reason: protectedJob ? "Customer requested a schedule change" : row.reason,
      accessNotes: protectedJob ? "" : row.access_notes,
      requestedAppointmentRevision: Number(row.requested_appointment_revision), originalStartsAt: row.original_starts_at,
      originalEndsAt: row.original_ends_at, proposedStartsAt: row.proposed_starts_at, proposedEndsAt: row.proposed_ends_at,
      proposedAssigneeMemberId: row.proposed_assignee_member_id, proposedAssigneeLabel: row.proposed_assignee_label,
      decisionNote: row.decision_note, revision: Number(row.revision), requestedAt: row.requested_at, decidedAt: row.decided_at,
      currentStartsAt: row.current_starts_at, currentEndsAt: row.current_ends_at,
      currentAssigneeMemberId: row.current_assignee_member_id, currentAssigneeLabel: row.current_assignee_label,
      appointmentRevision: Number(row.appointment_revision) }); }),
    unassignedJobs: (ownOnly ? [] : unassignedJobs.results).map((row) => { const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private";
      const customerDisplayName = protectedJob ? "Australian Energy Assessments protected customer"
        : ["trade_owned", "public_lead_released"].includes(String(row.customer_source || ""))
          ? String(row.customer_business_name || "").trim() || [row.customer_first_name, row.customer_last_name].map((value) => String(value || "").trim()).filter(Boolean).join(" ") || "Customer"
          : "No customer linked";
      const suburbLabel = protectedJob ? String(row.site_area || "Protected service region") : String(row.suburb || row.site_area || "Suburb not recorded");
      return { id: row.id, workNumber: row.work_number,
      title: protectedJob ? `${String(row.service_category || "Service")} job` : row.title, serviceCategory: row.service_category, customerDisplayName, suburbLabel,
      siteLabel: protectedJob ? row.site_area || "Protected service region" : row.site_label || "Site not selected",
      siteSummary: protectedJob ? "Australian Energy Assessments protected job" : [row.suburb, row.address_state, row.postcode].filter(Boolean).join(" "),
      priority: row.priority, stage: row.stage, revision: Number(row.revision || 1), assigneeMemberId: row.assignee_member_id, assigneeLabel: row.assignee_label }; }) };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try { const access = await requireInstallerTeamAccess(request); if (!canViewSchedule(access)) throw new Error("SCHEDULE_VIEW_REQUIRED");
    const search = new URL(request.url).searchParams;
    const rangeStart = normaliseWeekStart(search.get("rangeStart") || search.get("weekStart"));
    const rangeWeeks = normaliseScheduleRangeWeeks(search.get("rangeWeeks"), 1);
    return adminJson({ ok: true, ...(await schedulePayload(access, rangeStart, rangeWeeks)) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const body = await request.json() as Record<string, unknown>; const action = cleanAdminText(body.action, 40); const db = getD1(); const now = new Date().toISOString();
    const availabilityAction = ["save_working_hours", "add_unavailability", "remove_unavailability"].includes(action);
    if (!availabilityAction && !access.isOwner && !access.canRescheduleJobs) throw new Error("RESCHEDULE_REQUIRED");
    const ownOnly = !access.isOwner && access.scheduleScope === "own";
    const rangeStart = normaliseWeekStart(body.rangeStart || body.weekStart); const rangeWeeks = normaliseScheduleRangeWeeks(body.rangeWeeks, 1);
    const account = await db.prepare("SELECT address_state FROM trade_accounts WHERE firebase_uid = ?").bind(access.ownerUid).first<Record<string, unknown>>();
    const localNow = australiaLocalDateTime(String(account?.address_state || "NSW"));
    const notifications: Parameters<typeof queueAppointmentNotifications>[0][] = [];
    const syncAppointmentIds: string[] = [];
    if (action === "save_working_hours") {
      const memberId = cleanAdminText(body.memberId, 180); await activeMember(access.ownerUid, memberId);
      if (!access.isOwner && !access.canManageTeam && memberId !== access.memberId) throw new Error("DISPATCH_REQUIRED");
      const weekday = Number(body.weekday); const startMinute = Number(body.startMinute); const endMinute = Number(body.endMinute); const isAvailable = Boolean(body.isAvailable);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)
        || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute) throw new Error("INVALID_HOURS");
      await db.prepare(`INSERT INTO trade_team_working_hours (id, owner_uid, team_member_id, weekday, start_minute, end_minute, is_available, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_uid, team_member_id, weekday) DO UPDATE SET start_minute = excluded.start_minute,
        end_minute = excluded.end_minute, is_available = excluded.is_available, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), access.ownerUid, memberId, weekday, startMinute, endMinute, isAvailable ? 1 : 0, now, now).run();
    } else if (action === "add_unavailability") {
      const memberId = cleanAdminText(body.memberId, 180); await activeMember(access.ownerUid, memberId);
      if (!access.isOwner && !access.canManageTeam && memberId !== access.memberId) throw new Error("DISPATCH_REQUIRED");
      const startsAt = normaliseLocalDateTime(body.startsAt); const endsAt = normaliseLocalDateTime(body.endsAt); if (endsAt <= startsAt) throw new Error("INVALID_TIME");
      await db.prepare(`INSERT INTO trade_team_unavailability (id, owner_uid, team_member_id, starts_at, ends_at, reason, created_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), access.ownerUid, memberId, startsAt, endsAt, cleanAdminText(body.reason, 200) || "Unavailable", access.actorUid, now, now).run();
    } else if (action === "remove_unavailability") {
      const id = cleanAdminText(body.id, 180);
      const row = await db.prepare("SELECT team_member_id FROM trade_team_unavailability WHERE id = ? AND owner_uid = ?")
        .bind(id, access.ownerUid).first<Record<string, unknown>>();
      if (!row) throw new Error("MEMBER_NOT_FOUND");
      if (!access.isOwner && !access.canManageTeam && row.team_member_id !== access.memberId) throw new Error("DISPATCH_REQUIRED");
      await db.prepare("DELETE FROM trade_team_unavailability WHERE id = ? AND owner_uid = ?").bind(id, access.ownerUid).run();
    } else if (action === "review_reschedule_request") {
      const requestId = cleanAdminText(body.requestId, 180); const decision = cleanAdminText(body.decision, 40);
      if (!["accepted", "rejected", "alternative_proposed"].includes(decision)) throw new Error("INVALID_DECISION");
      const current = await db.prepare(`SELECT r.*, a.starts_at current_starts_at, a.ends_at current_ends_at,
          a.assignee_member_id current_assignee_member_id, a.assignee_label current_assignee_label,
          a.revision appointment_revision, a.status appointment_status, w.revision job_revision,
          w.service_category
        FROM trade_crm_appointment_reschedule_requests r
        JOIN trade_crm_appointments a ON a.id = r.appointment_id AND a.firebase_uid = r.firebase_uid
        JOIN trade_work_orders w ON w.id = r.work_order_id AND w.firebase_uid = r.firebase_uid
        WHERE r.id = ? AND r.firebase_uid = ? AND r.status IN ('pending', 'alternative_proposed')`)
        .bind(requestId, access.ownerUid).first<Record<string, unknown>>();
      if (!current || current.appointment_status !== "scheduled") throw new Error("RESCHEDULE_REQUEST_NOT_FOUND");
      assertCurrentScheduleAssignment(access, String(current.current_assignee_member_id || ""));
      if (Number(body.expectedRequestRevision) !== Number(current.revision)
        || Number(body.expectedAppointmentRevision) !== Number(current.appointment_revision)) throw new Error("REVISION_CONFLICT");
      const requestRevision = Number(current.revision) + 1; const decisionNote = cleanAdminText(body.decisionNote, 500);
      if (decision === "rejected") {
        await db.batch([
          db.prepare(`UPDATE trade_crm_appointment_reschedule_requests SET status = 'rejected', active_key = ?,
            decision_note = ?, revision = ?, decided_by_uid = ?, decided_at = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND revision = ?
              AND (? = 0 OR EXISTS (SELECT 1 FROM trade_crm_appointments current_appointment
                WHERE current_appointment.id = trade_crm_appointment_reschedule_requests.appointment_id
                  AND current_appointment.firebase_uid = trade_crm_appointment_reschedule_requests.firebase_uid
                  AND current_appointment.assignee_member_id = ?))`).bind(
              `closed:${requestId}`, decisionNote, requestRevision, access.actorUid, now, now, requestId, access.ownerUid, current.revision,
              ownOnly ? 1 : 0, access.memberId),
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
        const memberId = cleanAdminText(body.memberId, 180); assertScheduleTarget(access, memberId);
        assertAssignmentChange(access, String(current.current_assignee_member_id || ""), memberId);
        const member = await activeMember(access.ownerUid, memberId);
        assertMemberCapability(member, String(current.service_category || ""), access.ownerUid);
        const startsAt = normaliseLocalDateTime(body.startsAt); const endsAt = appointmentEndsAt(startsAt, body.durationMinutes);
        assertFutureAppointment(startsAt, localNow);
        await assertTradeScheduleAvailable({ ownerUid: access.ownerUid, memberId, startsAt, endsAt, excludeAppointmentId: String(current.appointment_id) });
        if (decision === "alternative_proposed") {
          await db.batch([
            db.prepare(`UPDATE trade_crm_appointment_reschedule_requests SET status = 'alternative_proposed',
              proposed_starts_at = ?, proposed_ends_at = ?, proposed_assignee_member_id = ?, proposed_assignee_label = ?,
              decision_note = ?, revision = ?, decided_by_uid = ?, decided_at = ?, updated_at = ?
              WHERE id = ? AND firebase_uid = ? AND revision = ?
                AND EXISTS (SELECT 1 FROM trade_crm_appointments current_appointment
                  WHERE current_appointment.id = trade_crm_appointment_reschedule_requests.appointment_id
                    AND current_appointment.firebase_uid = trade_crm_appointment_reschedule_requests.firebase_uid
                    AND current_appointment.assignee_member_id = ?)`)
              .bind(
                startsAt, endsAt, memberId, member.display_name, decisionNote, requestRevision, access.actorUid, now, now,
                requestId, access.ownerUid, current.revision, current.current_assignee_member_id),
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
          await assertTradeJobReadyForScheduling(access.ownerUid, String(current.work_order_id));
          const complianceIntentStatements = await plannedComplianceIntentReplanStatements(db, {
            actorUid: access.actorUid,
            changedAt: now,
            ownerUid: access.ownerUid,
            plannedStart: startsAt,
            workOrderId: String(current.work_order_id),
          });
          await db.batch([
            ...complianceIntentStatements,
            db.prepare(`INSERT OR IGNORE INTO trade_crm_appointment_revisions
              (id, appointment_id, work_order_id, firebase_uid, revision, starts_at, ends_at, assignee_member_id,
               assignee_label, change_source, source_reference, changed_by_uid, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reschedule_prior', ?, ?, ?)`).bind(
                crypto.randomUUID(), current.appointment_id, current.work_order_id, access.ownerUid, current.appointment_revision,
                current.current_starts_at, current.current_ends_at, current.current_assignee_member_id,
                current.current_assignee_label, requestId, access.actorUid, now),
            db.prepare(`UPDATE trade_crm_appointments SET starts_at = ?, ends_at = ?, assignee_member_id = ?, assignee_label = ?,
              revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND revision = ?
                AND assignee_member_id = ?
                AND EXISTS (SELECT 1 FROM trade_crm_appointment_reschedule_requests guard
                  WHERE guard.id = ? AND guard.firebase_uid = ? AND guard.revision = ?
                    AND guard.status IN ('pending', 'alternative_proposed'))`).bind(
                startsAt, endsAt, memberId, member.display_name, appointmentRevision, now, current.appointment_id,
                access.ownerUid, current.appointment_revision, current.current_assignee_member_id,
                requestId, access.ownerUid, current.revision),
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
              revision = ?, updated_at = ? WHERE id = ? AND firebase_uid = ? AND revision = ?
                AND assignee_member_id = ?`).bind(
                memberId, member.display_name, startsAt.slice(0, 10), endsAt.slice(0, 10), jobRevision, now,
                current.work_order_id, access.ownerUid, current.job_revision, current.current_assignee_member_id),
            previousTradeScheduleMutationGuardStatement(db, {
              changedAt: now,
              ownerUid: access.ownerUid,
            }),
            tradeJobScheduleEligibilityGuardStatement(db, {
              ownerUid: access.ownerUid,
              workOrderId: String(current.work_order_id),
              changedAt: now,
            }),
            tradeScheduleAvailabilityGuardStatement(db, {
              ownerUid: access.ownerUid,
              memberId,
              startsAt,
              endsAt,
              changedAt: now,
              excludeAppointmentId: String(current.appointment_id),
            }),
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
          notifications.push({ appointmentId: String(current.appointment_id), ownerUid: access.ownerUid,
            eventType: "appointment_changed", appointmentRevision, origin: new URL(request.url).origin, occurredAt: now });
          syncAppointmentIds.push(String(current.appointment_id));
        }
      }
    } else if (action === "save_schedule_changes") {
      if (!Array.isArray(body.changes) || body.changes.length < 1 || body.changes.length > 5) {
        throw new Error("INVALID_SCHEDULE_CHANGES");
      }
      const changes = body.changes.map((rawChange) => {
        if (!rawChange || typeof rawChange !== "object" || Array.isArray(rawChange)) {
          throw new Error("INVALID_SCHEDULE_CHANGES");
        }
        const change = rawChange as Record<string, unknown>;
        const appointmentId = cleanAdminText(change.appointmentId, 180);
        const memberId = cleanAdminText(change.memberId, 180);
        const expectedRevision = Number(change.expectedRevision);
        if (!appointmentId || !memberId || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
          throw new Error("INVALID_SCHEDULE_CHANGES");
        }
        const startsAt = assertAppointmentSlot(normaliseLocalDateTime(change.startsAt));
        const endsAt = appointmentEndsAt(startsAt, change.durationMinutes);
        assertFutureAppointment(startsAt, localNow);
        return { appointmentId, memberId, expectedRevision, startsAt, endsAt };
      });
      const appointmentIds = changes.map((change) => change.appointmentId);
      if (new Set(appointmentIds).size !== appointmentIds.length) throw new Error("INVALID_SCHEDULE_CHANGES");
      const currentRows = await db.prepare(`SELECT a.id, a.work_order_id, a.starts_at, a.ends_at,
          a.assignee_member_id, a.assignee_label, a.status, a.revision,
          w.revision job_revision, w.stage job_stage, w.assignee_member_id job_assignee_member_id,
          w.service_category
        FROM trade_crm_appointments a
        JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
        WHERE a.firebase_uid = ? AND a.id IN (${appointmentIds.map(() => "?").join(", ")})
          AND a.status = 'scheduled' AND w.partner_type = 'installer' AND w.record_status = 'active'`)
        .bind(access.ownerUid, ...appointmentIds).all<Record<string, unknown>>();
      if (currentRows.results.length !== changes.length) throw new Error("APPOINTMENT_NOT_FOUND");
      const currentById = new Map(currentRows.results.map((row) => [String(row.id), row]));
      const workOrderIds = currentRows.results.map((row) => String(row.work_order_id));
      if (new Set(workOrderIds).size !== workOrderIds.length) throw new Error("DUPLICATE_SCHEDULE_JOB");
      const members = new Map<string, Record<string, unknown>>();
      const prepared = [] as Array<{
        appointmentId: string;
        memberId: string;
        expectedRevision: number;
        startsAt: string;
        endsAt: string;
        current: Record<string, unknown>;
        member: Record<string, unknown>;
        appointmentRevision: number;
        jobRevision: number;
      }>;
      for (const change of changes) {
        const current = currentById.get(change.appointmentId);
        if (!current) throw new Error("APPOINTMENT_NOT_FOUND");
        if (["completed", "cancelled"].includes(String(current.job_stage))) throw new Error("TERMINAL_JOB_LOCKED");
        if (change.expectedRevision !== Number(current.revision)
          || String(current.job_assignee_member_id || "") !== String(current.assignee_member_id || "")) {
          throw new Error("REVISION_CONFLICT");
        }
        assertCurrentScheduleAssignment(access, String(current.assignee_member_id || ""));
        assertScheduleTarget(access, change.memberId);
        assertAssignmentChange(access, String(current.assignee_member_id || ""), change.memberId);
        let member = members.get(change.memberId);
        if (!member) {
          member = await activeMember(access.ownerUid, change.memberId);
          members.set(change.memberId, member);
        }
        assertMemberCapability(member, String(current.service_category || ""), access.ownerUid);
        await assertTradeJobReadyForScheduling(access.ownerUid, String(current.work_order_id));
        prepared.push({
          ...change,
          current,
          member,
          appointmentRevision: Number(current.revision) + 1,
          jobRevision: nextJobRevision(current.job_revision),
        });
      }
      for (let leftIndex = 0; leftIndex < prepared.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < prepared.length; rightIndex += 1) {
          const left = prepared[leftIndex];
          const right = prepared[rightIndex];
          if (left.memberId === right.memberId && left.startsAt < right.endsAt && left.endsAt > right.startsAt) {
            throw new Error("APPOINTMENT_CONFLICT");
          }
        }
      }
      for (const item of prepared) {
        await assertTradeScheduleAvailable({
          ownerUid: access.ownerUid,
          memberId: item.memberId,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          excludeAppointmentIds: appointmentIds,
        });
      }
      const batchReference = crypto.randomUUID();
      const statements: D1PreparedStatement[] = [];
      for (const item of prepared) {
        statements.push(...await plannedComplianceIntentReplanStatements(db, {
          actorUid: access.actorUid,
          changedAt: now,
          ownerUid: access.ownerUid,
          plannedStart: item.startsAt,
          workOrderId: String(item.current.work_order_id),
        }));
      }
      for (const item of prepared) {
        statements.push(
          db.prepare(`INSERT OR IGNORE INTO trade_crm_appointment_revisions
            (id, appointment_id, work_order_id, firebase_uid, revision, starts_at, ends_at, assignee_member_id,
             assignee_label, change_source, source_reference, changed_by_uid, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'schedule_batch_prior', ?, ?, ?)`)
            .bind(crypto.randomUUID(), item.appointmentId, item.current.work_order_id, access.ownerUid,
              item.current.revision, item.current.starts_at, item.current.ends_at,
              item.current.assignee_member_id, item.current.assignee_label, batchReference, access.actorUid, now),
          db.prepare(`UPDATE trade_crm_appointments
            SET starts_at = ?, ends_at = ?, assignee_member_id = ?, assignee_label = ?, revision = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND status = 'scheduled' AND revision = ? AND assignee_member_id = ?
              AND EXISTS (
                SELECT 1 FROM trade_work_orders current_job
                WHERE current_job.id = trade_crm_appointments.work_order_id
                  AND current_job.firebase_uid = trade_crm_appointments.firebase_uid
                  AND current_job.partner_type = 'installer' AND current_job.record_status = 'active'
                  AND current_job.stage = ? AND current_job.stage NOT IN ('completed', 'cancelled')
                  AND current_job.revision = ? AND current_job.assignee_member_id = ?
              )`)
            .bind(item.startsAt, item.endsAt, item.memberId, item.member.display_name,
              item.appointmentRevision, now, item.appointmentId, access.ownerUid,
              item.current.revision, item.current.assignee_member_id, item.current.job_stage,
              item.current.job_revision, item.current.job_assignee_member_id),
          previousTradeScheduleMutationGuardStatement(db, {
            changedAt: now,
            ownerUid: access.ownerUid,
          }),
          db.prepare(`INSERT INTO trade_crm_appointment_revisions
            (id, appointment_id, work_order_id, firebase_uid, revision, starts_at, ends_at, assignee_member_id,
             assignee_label, change_source, source_reference, changed_by_uid, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'schedule_batch_saved', ?, ?, ?)`)
            .bind(crypto.randomUUID(), item.appointmentId, item.current.work_order_id, access.ownerUid,
              item.appointmentRevision, item.startsAt, item.endsAt, item.memberId,
              item.member.display_name, batchReference, access.actorUid, now),
        );
      }
      for (const item of prepared) {
        statements.push(
          db.prepare(`UPDATE trade_work_orders
            SET assignee_member_id = ?, assignee_label = ?, scheduled_start = ?, scheduled_end = ?, revision = ?, updated_at = ?
            WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer' AND record_status = 'active'
              AND stage = ? AND stage NOT IN ('completed', 'cancelled') AND revision = ? AND assignee_member_id = ?
              AND EXISTS (
                SELECT 1 FROM trade_crm_appointments saved_appointment
                WHERE saved_appointment.id = ? AND saved_appointment.work_order_id = trade_work_orders.id
                  AND saved_appointment.firebase_uid = trade_work_orders.firebase_uid
                  AND saved_appointment.status = 'scheduled' AND saved_appointment.revision = ?
                  AND saved_appointment.assignee_member_id = ? AND saved_appointment.starts_at = ? AND saved_appointment.ends_at = ?
              )`)
            .bind(item.memberId, item.member.display_name, item.startsAt.slice(0, 10), item.endsAt.slice(0, 10),
              item.jobRevision, now, item.current.work_order_id, access.ownerUid, item.current.job_stage,
              item.current.job_revision, item.current.job_assignee_member_id, item.appointmentId,
              item.appointmentRevision, item.memberId, item.startsAt, item.endsAt),
          previousTradeScheduleMutationGuardStatement(db, {
            changedAt: now,
            ownerUid: access.ownerUid,
          }),
        );
      }
      for (const item of prepared) {
        statements.push(
          scheduleMemberGuardStatement(db, {
            ownerUid: access.ownerUid,
            memberId: item.memberId,
            serviceCategory: String(item.current.service_category || ""),
            changedAt: now,
          }),
          tradeJobScheduleEligibilityGuardStatement(db, {
            ownerUid: access.ownerUid,
            workOrderId: String(item.current.work_order_id),
            changedAt: now,
          }),
          tradeScheduleAvailabilityGuardStatement(db, {
            ownerUid: access.ownerUid,
            memberId: item.memberId,
            startsAt: item.startsAt,
            endsAt: item.endsAt,
            changedAt: now,
            excludeAppointmentId: item.appointmentId,
          }),
          db.prepare(`UPDATE customer_project_arrival_proposals SET preparation_acknowledged_at = '', updated_at = ?
            WHERE crm_appointment_id = ? AND preparation_acknowledged_at <> ''`).bind(now, item.appointmentId),
          db.prepare(`INSERT INTO trade_work_order_events
            (id, work_order_id, firebase_uid, event_type, summary, created_at)
            VALUES (?, ?, ?, 'schedule_updated', ?, ?)`)
            .bind(crypto.randomUUID(), item.current.work_order_id, access.ownerUid,
              `Appointment moved to ${item.startsAt} with ${String(item.member.display_name || "the selected team member")}.`, now),
          ...jobSyncChangeStatements(db, {
            ownerUid: access.ownerUid,
            workOrderId: String(item.current.work_order_id),
            revision: item.jobRevision,
            changedAt: now,
            audienceMemberId: item.memberId,
            previousAudienceMemberId: String(item.current.assignee_member_id || ""),
          }),
        );
      }
      if (statements.length > 95) throw new Error("INVALID_SCHEDULE_CHANGES");
      await db.batch(statements);
      for (const item of prepared) {
        notifications.push({
          appointmentId: item.appointmentId,
          ownerUid: access.ownerUid,
          eventType: String(item.current.assignee_member_id || "") === item.memberId ? "appointment_changed" : "staff_assigned",
          appointmentRevision: item.appointmentRevision,
          origin: new URL(request.url).origin,
          occurredAt: now,
        });
        syncAppointmentIds.push(item.appointmentId);
      }
    } else if (action === "schedule_appointment") {
      const appointmentId = cleanAdminText(body.appointmentId, 180); const memberId = cleanAdminText(body.memberId, 180);
      assertScheduleTarget(access, memberId); const member = await activeMember(access.ownerUid, memberId);
      const startsAt = normaliseLocalDateTime(body.startsAt); const endsAt = appointmentEndsAt(startsAt, body.durationMinutes);
      assertFutureAppointment(startsAt, localNow);
      const current = await db.prepare(`SELECT a.id, a.work_order_id, a.revision, a.assignee_member_id,
          w.revision job_revision, w.stage job_stage, w.service_category
        FROM trade_crm_appointments a JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
        WHERE a.id = ? AND a.firebase_uid = ? AND a.status = 'scheduled'`).bind(appointmentId, access.ownerUid).first<Record<string, unknown>>();
      if (!current) throw new Error("APPOINTMENT_NOT_FOUND");
      if (["completed", "cancelled"].includes(String(current.job_stage))) throw new Error("TERMINAL_JOB_LOCKED");
      if (Number(body.expectedRevision) !== Number(current.revision)) throw new Error("REVISION_CONFLICT");
      await assertTradeJobReadyForScheduling(access.ownerUid, String(current.work_order_id));
      assertCurrentScheduleAssignment(access, String(current.assignee_member_id || ""));
      assertAssignmentChange(access, String(current.assignee_member_id || ""), memberId);
      assertMemberCapability(member, String(current.service_category || ""), access.ownerUid);
      await assertTradeScheduleAvailable({ ownerUid: access.ownerUid, memberId, startsAt, endsAt, excludeAppointmentId: appointmentId });
      const revision = Number(current.revision) + 1; const jobRevision = nextJobRevision(current.job_revision);
      const complianceIntentStatements = await plannedComplianceIntentReplanStatements(db, {
        actorUid: access.actorUid,
        changedAt: now,
        ownerUid: access.ownerUid,
        plannedStart: startsAt,
        workOrderId: String(current.work_order_id),
      });
      await db.batch([
        ...complianceIntentStatements,
        db.prepare(`UPDATE trade_crm_appointments SET starts_at = ?, ends_at = ?, assignee_member_id = ?, assignee_label = ?, revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND revision = ? AND assignee_member_id = ?
            AND EXISTS (SELECT 1 FROM trade_work_orders current_job
              WHERE current_job.id = trade_crm_appointments.work_order_id
                AND current_job.firebase_uid = trade_crm_appointments.firebase_uid
                AND current_job.partner_type = 'installer' AND current_job.record_status = 'active'
                AND current_job.stage = ? AND current_job.stage NOT IN ('completed', 'cancelled')
                AND current_job.revision = ? AND current_job.assignee_member_id = ?)`)
          .bind(startsAt, endsAt, memberId, member.display_name, revision, now, appointmentId, access.ownerUid,
            current.revision, current.assignee_member_id, current.job_stage, current.job_revision, current.assignee_member_id),
        previousTradeScheduleMutationGuardStatement(db, {
          changedAt: now,
          ownerUid: access.ownerUid,
        }),
        db.prepare(`UPDATE trade_work_orders SET assignee_member_id = ?, assignee_label = ?, scheduled_start = ?, scheduled_end = ?, revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND revision = ? AND assignee_member_id = ?
            AND stage = ? AND stage NOT IN ('completed', 'cancelled')`)
          .bind(memberId, member.display_name, startsAt.slice(0, 10), endsAt.slice(0, 10), jobRevision, now,
            current.work_order_id, access.ownerUid, current.job_revision, current.assignee_member_id, current.job_stage),
        previousTradeScheduleMutationGuardStatement(db, {
          changedAt: now,
          ownerUid: access.ownerUid,
        }),
        tradeJobScheduleEligibilityGuardStatement(db, {
          ownerUid: access.ownerUid,
          workOrderId: String(current.work_order_id),
          changedAt: now,
        }),
        tradeScheduleAvailabilityGuardStatement(db, {
          ownerUid: access.ownerUid,
          memberId,
          startsAt,
          endsAt,
          changedAt: now,
          excludeAppointmentId: appointmentId,
        }),
        db.prepare(`UPDATE customer_project_arrival_proposals SET preparation_acknowledged_at = '', updated_at = ?
          WHERE crm_appointment_id = ? AND preparation_acknowledged_at <> ''`).bind(now, appointmentId),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'schedule_updated', ?, ?)`).bind(crypto.randomUUID(), current.work_order_id, access.ownerUid, `Appointment assigned to ${member.display_name} for ${startsAt}.`, now),
        ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: String(current.work_order_id), revision: jobRevision, changedAt: now,
          audienceMemberId: memberId, previousAudienceMemberId: String(current.assignee_member_id || "") }),
      ]);
      notifications.push({ appointmentId, ownerUid: access.ownerUid,
        eventType: current.assignee_member_id ? "appointment_changed" : "staff_assigned",
        appointmentRevision: revision, origin: new URL(request.url).origin, occurredAt: now });
      syncAppointmentIds.push(appointmentId);
    } else if (action === "schedule_job") {
      const workOrderId = cleanAdminText(body.workOrderId, 180); const memberId = cleanAdminText(body.memberId, 180);
      assertScheduleTarget(access, memberId); const member = await activeMember(access.ownerUid, memberId);
      const startsAt = normaliseLocalDateTime(body.startsAt); const endsAt = appointmentEndsAt(startsAt, body.durationMinutes);
      assertFutureAppointment(startsAt, localNow);
      const job = await db.prepare(`SELECT w.id, w.work_number, w.title, w.revision, w.stage, w.assignee_member_id,
          w.service_category, w.source_type, d.customer_source
        FROM trade_work_orders w
        LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
        WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'`)
        .bind(workOrderId, access.ownerUid).first<Record<string, unknown>>();
      if (!job) throw new Error("JOB_NOT_FOUND");
      if (["completed", "cancelled"].includes(String(job.stage))) throw new Error("TERMINAL_JOB_LOCKED");
      if (Number(body.expectedRevision) !== Number(job.revision)) throw new Error("REVISION_CONFLICT");
      await assertTradeJobReadyForScheduling(access.ownerUid, workOrderId);
      assertCurrentScheduleAssignment(access, String(job.assignee_member_id || ""));
      assertAssignmentChange(access, String(job.assignee_member_id || ""), memberId);
      assertMemberCapability(member, String(job.service_category || ""), access.ownerUid);
      await assertTradeScheduleAvailable({ ownerUid: access.ownerUid, memberId, startsAt, endsAt }); const revision = nextJobRevision(job.revision);
      const appointmentId = crypto.randomUUID();
      const complianceIntentStatements = await plannedComplianceIntentReplanStatements(db, {
        actorUid: access.actorUid,
        changedAt: now,
        ownerUid: access.ownerUid,
        plannedStart: startsAt,
        workOrderId,
      });
      await db.batch([
        ...complianceIntentStatements,
        db.prepare(`INSERT INTO trade_crm_appointments (id, work_order_id, firebase_uid, appointment_type, title, starts_at, ends_at, assignee_member_id,
          assignee_label, status, notes, revision, created_at, updated_at) VALUES (?, ?, ?, 'work', ?, ?, ?, ?, ?, 'scheduled', '', 1, ?, ?)`)
          .bind(appointmentId, workOrderId, access.ownerUid, job.title, startsAt, endsAt, memberId, member.display_name, now, now),
        db.prepare(`UPDATE trade_work_orders SET assignee_member_id = ?, assignee_label = ?, scheduled_start = ?, scheduled_end = ?, stage = 'scheduled', revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND revision = ? AND assignee_member_id = ?
            AND stage = ? AND stage NOT IN ('completed', 'cancelled')`)
          .bind(memberId, member.display_name, startsAt.slice(0, 10), endsAt.slice(0, 10), revision, now,
            workOrderId, access.ownerUid, job.revision, job.assignee_member_id, job.stage),
        previousTradeScheduleMutationGuardStatement(db, {
          changedAt: now,
          ownerUid: access.ownerUid,
        }),
        tradeJobScheduleEligibilityGuardStatement(db, {
          ownerUid: access.ownerUid,
          workOrderId,
          changedAt: now,
        }),
        tradeScheduleAvailabilityGuardStatement(db, {
          ownerUid: access.ownerUid,
          memberId,
          startsAt,
          endsAt,
          changedAt: now,
          excludeAppointmentId: appointmentId,
        }),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'schedule_created', ?, ?)`).bind(crypto.randomUUID(), workOrderId, access.ownerUid, `${job.work_number} scheduled with ${member.display_name} for ${startsAt}.`, now),
        ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now, audienceMemberId: memberId,
          previousAudienceMemberId: String(job.assignee_member_id || "") }),
      ]);
      syncAppointmentIds.push(appointmentId);
    } else return adminJson({ ok: false, error: "Unsupported schedule action." }, 400);
    for (const notification of notifications) await queueAppointmentNotifications(notification);
    const calendarSync = { connected: 0, attempted: 0, created: 0, updated: 0, unchanged: 0, synced: 0, failed: 0 };
    for (const appointmentId of Array.from(new Set(syncAppointmentIds))) {
      try {
        const result = await syncCreatedAppointmentToConnectedCalendars(access.ownerUid, appointmentId, { force: true });
        calendarSync.connected = Math.max(calendarSync.connected, Number(result.connected || 0));
        calendarSync.attempted += Number(result.attempted || 0);
        calendarSync.created += Number(result.created || 0);
        calendarSync.updated += Number(result.updated || 0);
        calendarSync.unchanged += Number(result.unchanged || 0);
        calendarSync.synced += Number(result.synced || 0);
        calendarSync.failed += Number(result.failed || 0);
      } catch { calendarSync.failed += 1; }
    }
    return adminJson({ ok: true, ...(await schedulePayload(access, rangeStart, rangeWeeks)), calendarSync });
  } catch (error) { return errorResponse(error); }
}
