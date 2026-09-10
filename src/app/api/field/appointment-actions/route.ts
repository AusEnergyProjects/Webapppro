import { getD1 } from "../../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { assignedJob, canAssignJob, requireInstallerTeamAccess } from "@/lib/trade-team-server";
import { canRescheduleWithinScope } from "@/lib/trade-team-permission-policy.mjs";
import { PATCH as changeSchedule } from "../../trade-schedule/route";
import { scheduleWeekStartForDate } from "@/lib/trade-schedule";
import { jobSyncChangeStatements, nextJobRevision } from "@/lib/trade-team-sync-server";
import { previousTradeScheduleMutationGuardStatement } from "@/lib/trade-compliance-intent-replan-server";
import { cancelAppointmentInConnectedCalendars } from "@/lib/trade-calendar-sync-server";
import { sendDirectAppointmentCalendarInvite } from "@/lib/direct-appointment-invite-server";
import { rentalAssignmentRequiredGates, rentalAssignmentCredentialSql } from "@/lib/trade-rental-credentials";
import { deleteTradeJob, scheduleJobFileCleanup } from "@/lib/trade-job-deletion-server";

export const runtime = "edge";
type Row = Record<string, unknown>;

async function context(request: Request, workOrderId: string) {
  const access = await requireInstallerTeamAccess(request);
  const job = await assignedJob(access, workOrderId);
  const db = getD1();
  const [appointment, customer] = await Promise.all([
    db.prepare(`SELECT id, revision, status, starts_at, ends_at, assignee_member_id FROM trade_crm_appointments
      WHERE work_order_id = ? AND firebase_uid = ?
      ORDER BY CASE WHEN status IN ('scheduled', 'en_route', 'arrived', 'in_progress') THEN 0 ELSE 1 END,
        updated_at DESC, created_at DESC LIMIT 1`).bind(workOrderId, access.ownerUid).first<Row>(),
    db.prepare(`SELECT c.id, c.first_name, c.last_name, c.business_name, c.phone, c.email, c.updated_at
      FROM trade_crm_job_details d JOIN trade_crm_customers c ON c.id = d.crm_customer_id
        AND c.firebase_uid = d.firebase_uid AND c.record_status = 'active'
      WHERE d.work_order_id = ? AND d.firebase_uid = ? AND d.customer_source IN ('trade_owned', 'public_lead_released')`)
      .bind(workOrderId, access.ownerUid).first<Row>(),
  ]);
  const protectedJob = job.source_type === 'opportunity' || !['trade_owned', 'public_lead_released'].includes(job.customer_source);
  const mutable = !protectedJob && !['completed', 'cancelled'].includes(job.stage);
  const canReschedule = mutable && canRescheduleWithinScope(access, job.assignee_member_id);
  const active = Boolean(appointment && ['scheduled', 'en_route', 'arrived', 'in_progress'].includes(String(appointment.status)));
  const permissions = { reschedule: canReschedule && Boolean(appointment && (active || appointment.status === 'no_show')),
    noShow: canReschedule && active, cancel: mutable && Boolean(active || appointment?.status === 'no_show') && (access.isOwner || access.canManageJobs) && canReschedule,
    editCustomer: !protectedJob && Boolean(customer) && (access.isOwner || access.canManageCustomers),
    deleteJob: job.customer_source === 'trade_owned' && !protectedJob && (access.isOwner || access.canManageJobs) };
  return { access, job, appointment, customer: protectedJob ? null : customer, permissions };
}

function fail(error: unknown) {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('JOB_DELETE_')) {
    return adminJson({ ok: false, code: error.code, error: error.message }, error.code === 'JOB_DELETE_NOT_ALLOWED' ? 403 : 409);
  }
  const code = error instanceof Error ? error.message : '';
  if (code === 'INVALID_DATE') return adminJson({ ok: false, error: 'Choose a valid appointment date.' }, 400);
  if (code === 'AUTH_REQUIRED') return adminJson({ ok: false, error: 'Sign in to continue.' }, 401);
  if (['JOB_NOT_FOUND', 'APPOINTMENT_NOT_FOUND'].includes(code)) return adminJson({ ok: false, error: 'Job or appointment not found.' }, 404);
  if (code === 'REVISION_CONFLICT' || code.includes('trade_crm_write_guard_verified_check')) return adminJson({ ok: false, error: 'This job changed. Reopen its actions and try again.', code: 'REVISION_CONFLICT' }, 409);
  if (['JOB_NOT_ASSIGNED', 'ACTION_NOT_ALLOWED', 'ABN_REVIEW_REQUIRED', 'TEAM_ACCESS_RECORD_REQUIRED', 'FIELD_ACCESS_REQUIRED', 'ACCOUNT_INACTIVE', 'EMAIL_VERIFICATION_REQUIRED'].includes(code)) return adminJson({ ok: false, error: 'Your current Team access does not allow this action.' }, 403);
  return adminJson({ ok: false, error: 'The appointment action could not be saved. Try again.' }, 500);
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const url = new URL(request.url);
    const { access, job, appointment, customer, permissions } = await context(request, cleanAdminText(url.searchParams.get('workOrderId'), 180));
    scheduleJobFileCleanup(getD1());
    const date = cleanAdminText(url.searchParams.get('appointmentDate'), 10) || String(appointment?.starts_at || '').slice(0, 10);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
    const credentialDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date > today ? date : today;
    const modules = await getD1().prepare(`SELECT module_key FROM trade_rental_inspection_modules m
      JOIN trade_rental_inspections i ON i.id = m.inspection_id AND i.firebase_uid = m.firebase_uid
      WHERE i.work_order_id = ? AND i.firebase_uid = ? AND m.status <> 'superseded'`).bind(job.id, access.ownerUid).all<Row>();
    const gates = rentalAssignmentRequiredGates(modules.results.map(row => String(row.module_key)));
    const members = permissions.reschedule ? await getD1().prepare(`SELECT id, display_name FROM trade_team_members
      WHERE owner_uid = ? AND status = 'active'
        AND (member_uid = ? OR EXISTS (SELECT 1 FROM json_each(capabilities) WHERE value = ?))
        AND (member_uid = ? OR ? = 0 OR EXISTS (SELECT 1 FROM json_each(capabilities) WHERE value = 'rental-inspection'))
        AND ${rentalAssignmentCredentialSql('trade_team_members.id', 'trade_team_members.owner_uid')}
      ORDER BY display_name COLLATE NOCASE LIMIT 100`).bind(access.ownerUid, access.ownerUid, job.service_category, access.ownerUid, modules.results.length,
        JSON.stringify(gates), credentialDate, credentialDate).all<Row>() : { results: [] };
    return adminJson({ ok: true, job: { id: job.id, revision: Number(job.revision), stage: job.stage },
      appointment: appointment ? { id: appointment.id, revision: Number(appointment.revision), status: appointment.status,
        startsAt: appointment.starts_at, endsAt: appointment.ends_at, memberId: appointment.assignee_member_id } : null,
      permissions, customer: customer ? { id: customer.id, updatedAt: customer.updated_at, firstName: customer.first_name,
        lastName: customer.last_name, businessName: customer.business_name, phone: customer.phone, email: customer.email } : null,
      assignees: members.results.filter(member => (access.isOwner || access.scheduleScope === 'team' || member.id === access.memberId)
        && (member.id === job.assignee_member_id || canAssignJob(access, job.assignee_member_id, String(member.id))))
        .map(member => ({ id: member.id, displayName: member.display_name })) });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const body = await request.json() as Row;
    const action = cleanAdminText(body.action, 40);
    const { access, job, appointment, customer, permissions } = await context(request, cleanAdminText(body.workOrderId, 180));
    if (Number(body.expectedRevision) !== Number(job.revision)) throw new Error('REVISION_CONFLICT');
    const db = getD1(); const now = new Date().toISOString();
    if (action === 'delete') {
      if (body.confirmDelete !== true) return adminJson({ ok: false, error: 'Confirm that you want to permanently delete this job.' }, 400);
      if (!permissions.deleteJob) throw new Error('ACTION_NOT_ALLOWED');
      return adminJson(await deleteTradeJob(db, access, job));
    }
    if (action === 'update_customer') {
      if (!permissions.editCustomer || !customer) throw new Error('ACTION_NOT_ALLOWED');
      const patch = body.customer && typeof body.customer === 'object' && !Array.isArray(body.customer) ? body.customer as Row : {};
      if (patch.expectedUpdatedAt !== customer.updated_at) throw new Error('REVISION_CONFLICT');
      const firstName = cleanAdminText(patch.firstName, 80); const lastName = cleanAdminText(patch.lastName, 80);
      const phone = cleanAdminText(patch.phone, 40); const email = cleanAdminText(patch.email, 180).toLowerCase();
      if ((!firstName && !lastName && !customer.business_name) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return adminJson({ ok: false, error: 'Add a name and check the email address.' }, 400);
      const related = await db.prepare(`SELECT w.id, w.revision, w.assignee_member_id FROM trade_work_orders w
        JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
        WHERE d.crm_customer_id = ? AND w.firebase_uid = ? AND w.record_status = 'active'`).bind(customer.id, access.ownerUid).all<Row>();
      const statements = [db.prepare(`UPDATE trade_crm_customers SET first_name = ?, last_name = ?, phone = ?, email = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND updated_at = ? AND record_status = 'active'`)
        .bind(firstName, lastName, phone, email, now, customer.id, access.ownerUid, customer.updated_at),
        previousTradeScheduleMutationGuardStatement(db, { ownerUid: access.ownerUid, changedAt: now }),
        db.prepare(`UPDATE trade_crm_customer_contacts SET first_name = ?, last_name = ?, phone = ?, email = ?, updated_at = ?
          WHERE customer_id = ? AND firebase_uid = ? AND is_primary = 1 AND record_status = 'active'`)
          .bind(firstName, lastName, phone, email, now, customer.id, access.ownerUid)];
      for (const relatedJob of related.results) statements.push(
        db.prepare(`UPDATE trade_work_orders SET revision = revision + 1, updated_at = ? WHERE id = ? AND firebase_uid = ? AND revision = ?`)
          .bind(now, relatedJob.id, access.ownerUid, relatedJob.revision),
        previousTradeScheduleMutationGuardStatement(db, { ownerUid: access.ownerUid, changedAt: now }),
        ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: String(relatedJob.id), revision: nextJobRevision(relatedJob.revision), changedAt: now, audienceMemberId: String(relatedJob.assignee_member_id || '') }));
      statements.push(db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, 'customer_contact_updated', ?, ?)`)
        .bind(crypto.randomUUID(), job.id, access.ownerUid, `Customer contact details updated by ${access.displayName}.`, now));
      await db.batch(statements);
      return adminJson({ ok: true, jobPatch: { revision: nextJobRevision(job.revision), customerName: customer.business_name || [firstName, lastName].filter(Boolean).join(' '), customerPhone: phone, customerEmail: email } });
    }
    if (!['reschedule', 'no_show', 'cancel'].includes(action)) return adminJson({ ok: false, error: 'Unsupported appointment action.' }, 400);
    if (!appointment || String(body.appointmentId) !== appointment.id || Number(body.expectedAppointmentRevision) !== Number(appointment.revision)) throw new Error('REVISION_CONFLICT');
    if (action === 'reschedule') {
      if (!permissions.reschedule) throw new Error('ACTION_NOT_ALLOWED');
      {
        const modules = await db.prepare(`SELECT module_key FROM trade_rental_inspection_modules m
          JOIN trade_rental_inspections i ON i.id = m.inspection_id AND i.firebase_uid = m.firebase_uid
          WHERE i.work_order_id = ? AND i.firebase_uid = ? AND m.status <> 'superseded'`)
          .bind(job.id, access.ownerUid).all<Row>();
        const gates = rentalAssignmentRequiredGates(modules.results.map(row => String(row.module_key)));
        const date = String(body.startsAt || '').slice(0, 10);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
        const checkedDate = date > today ? date : today;
        const eligible = !modules.results.length || await db.prepare(`SELECT id FROM trade_team_members WHERE id = ? AND owner_uid = ? AND status = 'active'
          AND (member_uid = ? OR EXISTS (SELECT 1 FROM json_each(capabilities) WHERE value = 'rental-inspection'))
          AND ${rentalAssignmentCredentialSql('trade_team_members.id', 'trade_team_members.owner_uid')}`)
          .bind(cleanAdminText(body.memberId, 180), access.ownerUid, access.ownerUid, JSON.stringify(gates), checkedDate, checkedDate).first<Row>();
        if (!eligible) return adminJson({ ok: false, code: 'RENTAL_ASSIGNEE_CREDENTIAL_REQUIRED',
          error: 'Choose a team member with the required current licence and supporting Team document for that appointment date.' }, 409);
      }
      const response = await changeSchedule(new Request(request.url, { method: 'PATCH', headers: request.headers, body: JSON.stringify({
        action: 'schedule_appointment', appointmentId: appointment.id, expectedRevision: appointment.revision,
        expectedJobRevision: job.revision, startsAt: body.startsAt, durationMinutes: body.durationMinutes,
        memberId: body.memberId, weekStart: scheduleWeekStartForDate(String(body.startsAt || '')) }) }));
      if (!response.ok) return response;
      const result = await response.json() as Row;
      const saved = await db.prepare(`SELECT a.id, a.status, a.starts_at, a.ends_at, w.revision, w.stage, w.scheduled_start, w.scheduled_end,
        w.assignee_member_id, w.assignee_label FROM trade_crm_appointments a
        JOIN trade_work_orders w ON w.id = a.work_order_id AND w.firebase_uid = a.firebase_uid
        WHERE a.id = ? AND a.firebase_uid = ?`).bind(appointment.id, access.ownerUid).first<Row>();
      return adminJson({ ok: true, jobPatch: saved ? { revision: Number(saved.revision), stage: saved.stage,
        lifecycleStatus: 'scheduled', appointmentId: saved.id, appointmentStatus: saved.status, appointmentStartsAt: saved.starts_at,
        appointmentEndsAt: saved.ends_at, scheduledStart: saved.scheduled_start, scheduledEnd: saved.scheduled_end,
        assigneeMemberId: saved.assignee_member_id, assigneeLabel: saved.assignee_label } : {},
        calendarSync: result.calendarSync, email: Array.isArray(result.customerEmails) ? result.customerEmails[0] : null });
    }
    if (action === 'no_show' ? !permissions.noShow : !permissions.cancel) throw new Error('ACTION_NOT_ALLOWED');
    const status = action === 'no_show' ? 'no_show' : 'cancelled';
    const otherAppointments = action === 'cancel' ? await db.prepare(`SELECT id, revision FROM trade_crm_appointments
      WHERE work_order_id = ? AND firebase_uid = ? AND id <> ? AND status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'no_show')`)
      .bind(job.id, access.ownerUid, appointment.id).all<Row>() : { results: [] };
    const revision = nextJobRevision(job.revision);
    await db.batch([
      ...otherAppointments.results.flatMap(other => [
        db.prepare(`UPDATE trade_crm_appointments SET status = 'cancelled', revision = revision + 1, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND revision = ? AND status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'no_show')`)
          .bind(now, other.id, access.ownerUid, other.revision),
        previousTradeScheduleMutationGuardStatement(db, { ownerUid: access.ownerUid, changedAt: now }),
      ]),
      db.prepare(`UPDATE trade_crm_appointments SET status = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = ? AND status = ?`)
        .bind(status, now, appointment.id, access.ownerUid, appointment.revision, appointment.status),
      previousTradeScheduleMutationGuardStatement(db, { ownerUid: access.ownerUid, changedAt: now }),
      db.prepare(`UPDATE trade_work_orders SET stage = ?, scheduled_start = '', scheduled_end = '', revision = ?, updated_at = ?
        WHERE id = ? AND firebase_uid = ? AND revision = ? AND assignee_member_id = ? AND stage = ?`)
        .bind(status, revision, now, job.id, access.ownerUid, job.revision, job.assignee_member_id, job.stage),
      previousTradeScheduleMutationGuardStatement(db, { ownerUid: access.ownerUid, changedAt: now }),
      db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), job.id, access.ownerUid, `appointment_${status}`,
          action === 'no_show' ? 'Customer was not available. Ready to contact and reschedule.' : 'Appointment and job cancelled.', now),
      ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: job.id, revision, changedAt: now, audienceMemberId: job.assignee_member_id }),
    ]);
    const [calendarSync, email] = await Promise.all([
      (async () => {
        const sync = await cancelAppointmentInConnectedCalendars(access.ownerUid, String(appointment.id));
        for (const other of otherAppointments.results) {
          const removed = await cancelAppointmentInConnectedCalendars(access.ownerUid, String(other.id));
          sync.attempted += removed.attempted; sync.synced += removed.synced; sync.failed += removed.failed;
        }
        return sync;
      })(),
      action === 'cancel' ? sendDirectAppointmentCalendarInvite({ ownerUid: access.ownerUid, appointmentId: String(appointment.id), origin: new URL(request.url).origin, change: 'cancelled' }) : Promise.resolve(null),
    ]);
    return adminJson({ ok: true, jobPatch: { revision, stage: status, lifecycleStatus: status, appointmentId: appointment.id,
      appointmentStatus: status, scheduledStart: '', scheduledEnd: '', appointmentStartsAt: '', appointmentEndsAt: '' }, calendarSync, email });
  } catch (error) { return fail(error); }
}
