import { getD1 } from "../../db";
import { isJobMember } from "./trade-job-collaboration";
import { requireFirebaseIdentity, type FirebaseIdentity } from "./firebase-server";
import { requireTradeMyobSecondFactor } from "./trade-mfa-server";
import {
  requireVerifiedTradeIdentity,
  tradeAccountProjection,
} from "./trade-access-server";
import { requestedTradeBusiness, selectTradeBusiness, TradeBusinessContextError } from "./trade-business-context-server";
import { canAssignWithinScope } from "./trade-team-permission-policy.mjs";
import { applyTradeCrewAccess } from "./trade-crews-server";
import { isFieldSessionRequest, requireFieldSessionAccess } from "./trade-field-session-server";

export type TeamScope = "own" | "team";
export type TeamAccess = {
  identity?: FirebaseIdentity;
  ownerUid: string;
  actorUid: string;
  actorEmail: string;
  memberId: string;
  displayName: string;
  fieldUsername?: string;
  isOwner: boolean;
  businessName: string;
  canCreateJobs: boolean;
  canManageJobs: boolean;
  canAssignJobs: boolean;
  jobScope: TeamScope;
  canViewCustomers: boolean;
  canManageCustomers: boolean;
  canViewQuotes: boolean;
  canManageQuotes: boolean;
  canSendQuotes: boolean;
  canSendSms?: boolean;
  canViewInvoices: boolean;
  canManageInvoices: boolean;
  canViewPriceBook: boolean;
  canManagePriceBook: boolean;
  canApplyDiscounts: boolean;
  scheduleScope: TeamScope;
  canRescheduleJobs: boolean;
  canManageTeam: boolean;
  canEditTeamPermissions: boolean;
  canViewFieldEvidence: boolean;
  canManageFieldEvidence: boolean;
  canManageForms: boolean;
  canRunReports: boolean;
  canSearchCustomers: boolean;
  fieldSessionId?: string;
  crewId?: string;
  crewLead?: boolean;
  crewMemberIds?: string[];
};

export async function ensureOwnerTeamMember(ownerUid: string, email: string, displayName: string) {
  const db = getD1();
  const existing = await db.prepare(`SELECT id FROM trade_team_members
    WHERE owner_uid = ? AND (member_uid = ? OR email = ?) ORDER BY member_uid = ? DESC LIMIT 1`)
    .bind(ownerUid, ownerUid, email, ownerUid).first<{ id: string }>();
  const now = new Date().toISOString();
  if (existing) {
    await db.prepare(`UPDATE trade_team_members SET member_uid = ?, email = ?, display_name = ?, role = 'manager',
      can_create_jobs = 1, can_manage_jobs = 1, can_assign_jobs = 1, job_scope = 'team',
      can_view_customers = 1, can_manage_customers = 1,
      can_view_quotes = 1, can_manage_quotes = 1, can_send_quotes = 1,
      can_view_invoices = 1, can_manage_invoices = 1,
      can_view_price_book = 1, can_manage_price_book = 1, can_apply_discounts = 1,
      schedule_scope = 'team', can_reschedule_jobs = 1, can_manage_team = 1,
      can_edit_team_permissions = 1,
      can_view_field_evidence = 1, can_manage_field_evidence = 1, can_manage_forms = 1,
      can_run_reports = 1, can_search_customers = 1, status = 'active',
      accepted_at = CASE WHEN accepted_at = '' THEN ? ELSE accepted_at END, updated_at = ?
      WHERE id = ? AND owner_uid = ?
        AND (member_uid <> ? OR email <> ? OR display_name <> ? OR role <> 'manager'
          OR can_create_jobs <> 1 OR can_manage_jobs <> 1 OR can_assign_jobs <> 1 OR job_scope <> 'team'
          OR can_view_customers <> 1 OR can_manage_customers <> 1
          OR can_view_quotes <> 1 OR can_manage_quotes <> 1 OR can_send_quotes <> 1
          OR can_view_invoices <> 1 OR can_manage_invoices <> 1
          OR can_view_price_book <> 1 OR can_manage_price_book <> 1 OR can_apply_discounts <> 1
          OR schedule_scope <> 'team' OR can_reschedule_jobs <> 1 OR can_manage_team <> 1
          OR can_edit_team_permissions <> 1
          OR can_view_field_evidence <> 1 OR can_manage_field_evidence <> 1 OR can_manage_forms <> 1
          OR can_run_reports <> 1 OR can_search_customers <> 1 OR status <> 'active'
          OR accepted_at = '')`).bind(ownerUid, email, displayName, now, now, existing.id, ownerUid,
        ownerUid, email, displayName).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO trade_team_members
    (id, owner_uid, member_uid, email, display_name, role, can_create_jobs, can_manage_jobs, can_assign_jobs,
     job_scope, can_view_customers, can_manage_customers, can_view_quotes, can_manage_quotes,
     can_send_quotes, can_view_invoices, can_manage_invoices, can_view_price_book,
      can_manage_price_book, can_apply_discounts, schedule_scope, can_reschedule_jobs, can_manage_team,
     can_edit_team_permissions,
     can_view_field_evidence, can_manage_field_evidence, can_manage_forms, can_run_reports,
     can_search_customers, status, invited_at,
     accepted_at, last_active_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'manager', 1, 1, 1, 'team', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      'team', 1, 1, 1, 1, 1, 1, 1, 1, 'active', '', ?, ?, ?, ?)`)
    .bind(id, ownerUid, ownerUid, email, displayName, now, now, now, now).run();
  return id;
}

export async function requireInstallerTeamAccess(request: Request): Promise<TeamAccess> {
  if (isFieldSessionRequest(request)) {
    const access = await requireFieldSessionAccess(request);
    const requested = requestedTradeBusiness(request);
    if (requested !== null && requested !== access.ownerUid) throw new TradeBusinessContextError(
      "BUSINESS_ACCESS_REQUIRED", 403, "This app login belongs to a different business. Sign in to switch businesses.");
    await requireTradeMyobSecondFactor(undefined, access.ownerUid, access.actorUid);
    return access;
  }
  const identity = await requireFirebaseIdentity(request);
  const db = getD1();
  const selected = await selectTradeBusiness(request, identity);
  if (selected.role === "owner") {
    const verified = await requireVerifiedTradeIdentity(identity, { partnerTypes: ["installer"] });
    const displayName = selected.managerName?.trim() || verified.businessName || "Business owner";
    const memberId = await ensureOwnerTeamMember(identity.uid, identity.email, displayName);
    return { identity, ownerUid: identity.uid, actorUid: identity.uid, actorEmail: identity.email, memberId,
      displayName, isOwner: true,
      businessName: verified.businessName || "Installer business",
      canCreateJobs: true, canManageJobs: true, canAssignJobs: true, jobScope: "team",
      canViewCustomers: true, canManageCustomers: true,
      canViewQuotes: true, canManageQuotes: true, canSendQuotes: true, canSendSms: true,
      canViewInvoices: true, canManageInvoices: true,
      canViewPriceBook: true, canManagePriceBook: true, canApplyDiscounts: true,
      scheduleScope: "team", canRescheduleJobs: true, canManageTeam: true,
      canEditTeamPermissions: true,
      canViewFieldEvidence: true, canManageFieldEvidence: true, canManageForms: true,
      canRunReports: true, canSearchCustomers: true };
  }
  if (!identity.emailVerified) throw new Error("EMAIL_VERIFICATION_REQUIRED");
  const member = await db.prepare(`SELECT m.id, m.owner_uid, m.display_name,
      m.can_create_jobs, m.can_manage_jobs, m.can_assign_jobs, m.job_scope,
      m.can_view_customers, m.can_manage_customers,
      m.can_view_quotes, m.can_manage_quotes, m.can_send_quotes, m.can_send_sms,
      m.can_view_invoices, m.can_manage_invoices, m.can_view_price_book, m.can_manage_price_book,
      m.can_apply_discounts,
      m.schedule_scope, m.can_reschedule_jobs, m.can_manage_team,
      m.can_edit_team_permissions,
      m.can_view_field_evidence, m.can_manage_field_evidence, m.can_manage_forms,
      m.can_run_reports, m.can_search_customers, a.business_name
    FROM trade_team_members m JOIN trade_accounts a ON a.firebase_uid = m.owner_uid
    WHERE m.member_uid = ? AND m.owner_uid = ? AND m.id = ? AND m.status = 'active'`)
    .bind(identity.uid, selected.ownerUid, selected.memberId).first<Record<string, unknown>>();
  if (!member) throw new Error("TEAM_ACCESS_RECORD_REQUIRED");
  const ownerUid = String(member.owner_uid);
  const ownerAccount = await tradeAccountProjection(ownerUid);
  if (!ownerAccount || ownerAccount.partnerType !== "installer" || !ownerAccount.approvedAbnAccess) {
    throw new Error("ABN_REVIEW_REQUIRED");
  }
  await requireTradeMyobSecondFactor(identity, ownerUid);
  await db.prepare("UPDATE trade_team_members SET last_active_at = ? WHERE id = ? AND member_uid = ?")
    .bind(new Date().toISOString(), member.id, identity.uid).run();
  return applyTradeCrewAccess({ identity, ownerUid, actorUid: identity.uid, actorEmail: identity.email, memberId: String(member.id),
    displayName: String(member.display_name || identity.email), isOwner: false,
    businessName: String(member.business_name || "Installer business"),
    canCreateJobs: Boolean(member.can_create_jobs), canManageJobs: Boolean(member.can_manage_jobs),
    canAssignJobs: Boolean(member.can_assign_jobs),
    jobScope: member.job_scope === "team" ? "team" : "own",
    canViewCustomers: Boolean(member.can_view_customers), canManageCustomers: Boolean(member.can_manage_customers),
    canViewQuotes: Boolean(member.can_view_quotes), canManageQuotes: Boolean(member.can_manage_quotes),
    canSendQuotes: Boolean(member.can_send_quotes), canSendSms: Boolean(member.can_send_sms),
    canViewInvoices: Boolean(member.can_view_invoices), canManageInvoices: Boolean(member.can_manage_invoices),
    canViewPriceBook: Boolean(member.can_view_price_book), canManagePriceBook: Boolean(member.can_manage_price_book),
    canApplyDiscounts: Boolean(member.can_apply_discounts),
    scheduleScope: member.schedule_scope === "team" ? "team" : "own",
    canRescheduleJobs: Boolean(member.can_reschedule_jobs),
    canManageTeam: Boolean(member.can_manage_team),
    canEditTeamPermissions: Boolean(member.can_edit_team_permissions),
    canViewFieldEvidence: Boolean(member.can_view_field_evidence),
    canManageFieldEvidence: Boolean(member.can_manage_field_evidence),
    canManageForms: Boolean(member.can_manage_forms),
    canRunReports: Boolean(member.can_run_reports),
    canSearchCustomers: Boolean(member.can_search_customers) });
}

export function canDispatch(access: TeamAccess) {
  return access.isOwner || (access.canManageJobs && access.scheduleScope === "team");
}

export function canCreateJobs(access: TeamAccess) {
  return access.isOwner || access.canCreateJobs;
}

export function canManageJobs(access: TeamAccess) {
  return access.isOwner || access.canManageJobs;
}

export function canViewQuotes(access: TeamAccess) {
  return access.isOwner || access.canViewQuotes;
}

export function canManageQuotes(access: TeamAccess) {
  return access.isOwner || access.canManageQuotes;
}

export function canSendQuotes(access: TeamAccess) {
  return access.isOwner || access.canSendQuotes;
}

export function canViewSchedule(access: TeamAccess) {
  return access.isOwner || access.scheduleScope === "own" || access.scheduleScope === "team";
}

export function canManageTeamSchedule(access: TeamAccess) {
  return access.isOwner || (access.canRescheduleJobs && access.scheduleScope === "team");
}

export function canManageTeam(access: TeamAccess) {
  return access.isOwner || access.canManageTeam;
}

export function canAssignJob(access: TeamAccess, fromMemberId: string, toMemberId: string) {
  return canAssignWithinScope(access, fromMemberId, toMemberId);
}

export async function assignedJob(access: TeamAccess, workOrderId: string) {
  const row = await getD1().prepare(`SELECT work.id, work.source_type, work.source_reference,
      work.assignee_member_id, work.assignee_label, work.stage, work.service_category,
      work.revision, details.customer_source
    FROM trade_work_orders work
    LEFT JOIN trade_crm_job_details details
      ON details.work_order_id = work.id AND details.firebase_uid = work.firebase_uid
    WHERE work.id = ? AND work.firebase_uid = ? AND work.partner_type = 'installer'
      AND work.record_status = 'active'`)
    .bind(workOrderId, access.ownerUid).first<{ id: string; source_type: string; source_reference: string;
      assignee_member_id: string; assignee_label: string; stage: string; service_category: string;
      revision: number; customer_source: string }>();
  if (!row) throw new Error("JOB_NOT_FOUND");
  if (!access.isOwner && access.jobScope === "own" && row.assignee_member_id !== access.memberId
    && !(await isJobMember(getD1(), access.ownerUid, workOrderId, access.memberId))) {
    throw new Error("JOB_NOT_ASSIGNED");
  }
  return row;
}
