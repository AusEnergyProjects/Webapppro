import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { assignedJob, canAssignJob, canManageTeam, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";
import {
  guardedOnlineChildMutationBatch,
  guardedOnlineJobMutationBatch,
  jobSyncChangeStatements,
  nextJobRevision,
} from "@/lib/trade-team-sync-server";
import { abortMemberDeviceUploads } from "@/lib/trade-mobile-device-revocation";
import { memberLifecycleDecision } from "@/lib/trade-team-lifecycle-policy.mjs";

export const runtime = "edge";

const MEMBER_LIFECYCLE_STATUSES = new Set(["active", "suspended"]);
const ROSTER_STATUS_FILTERS = new Set(["active", "invited", "suspended"]);
const WORK_STAGES = new Set(["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_ALLOWED_PATTERN = /^[+0-9() .-]+$/;
const SCHEDULE_COLOURS = new Set(["emerald", "teal", "blue", "violet", "amber", "rose"]);
const ROSTER_PAGE_SIZE = 25;
const ROSTER_PAGE_SIZE_MAX = 50;

function parsedList(value: unknown) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch { return []; }
}

async function memberCapabilities(ownerUid: string, value: unknown) {
  const account = await getD1().prepare("SELECT capabilities FROM trade_accounts WHERE firebase_uid = ?")
    .bind(ownerUid).first<Record<string, unknown>>();
  const allowed = new Set(parsedList(account?.capabilities));
  const requested = [...new Set(parsedList(value))].slice(0, 30);
  if (requested.some((item) => !allowed.has(item))) throw new Error("CAPABILITY_NOT_ALLOWED");
  return requested;
}

function normalisePhone(value: unknown) {
  const raw = cleanAdminText(value, 40).normalize("NFKC");
  if (!raw) return "";
  if (!PHONE_ALLOWED_PATTERN.test(raw) || (raw.includes("+") && !raw.startsWith("+"))
    || (raw.match(/\+/g) || []).length > 1) throw new Error("PHONE_INVALID");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) throw new Error("PHONE_INVALID");
  if (raw.startsWith("+") || raw.startsWith("00")) return `+${digits.replace(/^00/, "")}`;
  if (/^0[23478]\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  return digits;
}

type MemberPermissions = {
  canCreateJobs: boolean;
  canManageJobs: boolean;
  canAssignJobs: boolean;
  jobScope: "own" | "team";
  canViewCustomers: boolean;
  canManageCustomers: boolean;
  canViewQuotes: boolean;
  canManageQuotes: boolean;
  canSendQuotes: boolean;
  canViewInvoices: boolean;
  canManageInvoices: boolean;
  canViewPriceBook: boolean;
  canManagePriceBook: boolean;
  canApplyDiscounts: boolean;
  scheduleScope: "own" | "team";
  canRescheduleJobs: boolean;
  canManageTeam: boolean;
  canEditTeamPermissions: boolean;
  canViewFieldEvidence: boolean;
  canManageFieldEvidence: boolean;
  canRunReports: boolean;
  canSearchCustomers: boolean;
};

const BOOLEAN_PERMISSION_KEYS = [
  "canCreateJobs", "canManageJobs", "canAssignJobs", "canViewCustomers", "canManageCustomers",
  "canViewQuotes", "canManageQuotes", "canSendQuotes", "canViewInvoices",
  "canManageInvoices", "canViewPriceBook", "canManagePriceBook", "canApplyDiscounts",
  "canRescheduleJobs",
  "canManageTeam", "canEditTeamPermissions", "canViewFieldEvidence", "canManageFieldEvidence", "canRunReports",
  "canSearchCustomers",
] as const;
const PERMISSION_KEYS = new Set<string>([...BOOLEAN_PERMISSION_KEYS, "jobScope", "scheduleScope"]);

function permissionInput(body: Record<string, unknown>) {
  const nested = body.permissions && typeof body.permissions === "object" && !Array.isArray(body.permissions)
    ? body.permissions as Record<string, unknown> : {};
  for (const [key, value] of Object.entries(nested)) {
    if (!PERMISSION_KEYS.has(key)
      || (key === "jobScope" || key === "scheduleScope"
        ? value !== "own" && value !== "team"
        : typeof value !== "boolean")) {
      throw new Error("PERMISSIONS_INVALID");
    }
  }
  const result: Record<string, unknown> = { ...nested };
  for (const key of PERMISSION_KEYS) {
    if (body[key] !== undefined) result[key] = body[key];
  }
  for (const key of BOOLEAN_PERMISSION_KEYS) {
    if (result[key] !== undefined && typeof result[key] !== "boolean") throw new Error("PERMISSIONS_INVALID");
  }
  for (const key of ["jobScope", "scheduleScope"] as const) {
    if (result[key] !== undefined && result[key] !== "own" && result[key] !== "team") {
      throw new Error("PERMISSIONS_INVALID");
    }
  }
  return result;
}

const SAFE_MEMBER_PERMISSIONS: MemberPermissions = {
  canCreateJobs: false, canManageJobs: false, canAssignJobs: false, jobScope: "own",
  canViewCustomers: false, canManageCustomers: false,
  canViewQuotes: false, canManageQuotes: false, canSendQuotes: false,
  canViewInvoices: false, canManageInvoices: false,
  canViewPriceBook: false, canManagePriceBook: false, canApplyDiscounts: false,
  scheduleScope: "own", canRescheduleJobs: false,
  canManageTeam: false, canEditTeamPermissions: false,
  canViewFieldEvidence: false, canManageFieldEvidence: false,
  canRunReports: false, canSearchCustomers: false,
};

function memberPermissions(body: Record<string, unknown>, current?: Record<string, unknown>): MemberPermissions {
  const value = (key: keyof Omit<MemberPermissions, "scheduleScope" | "jobScope">, column: string) => body[key] === undefined
    ? current ? Boolean(current[column]) : SAFE_MEMBER_PERMISSIONS[key]
    : body[key] === true;
  const canManageQuotes = value("canManageQuotes", "can_manage_quotes");
  const canSendQuotes = value("canSendQuotes", "can_send_quotes");
  const canManageCustomers = value("canManageCustomers", "can_manage_customers");
  const canManageInvoices = value("canManageInvoices", "can_manage_invoices");
  const canManagePriceBook = value("canManagePriceBook", "can_manage_price_book");
  const canManageFieldEvidence = value("canManageFieldEvidence", "can_manage_field_evidence");
  const canEditTeamPermissions = value("canEditTeamPermissions", "can_edit_team_permissions");
  return {
    canCreateJobs: value("canCreateJobs", "can_create_jobs"),
    canManageJobs: value("canManageJobs", "can_manage_jobs"),
    canAssignJobs: value("canAssignJobs", "can_assign_jobs"),
    jobScope: body.jobScope === undefined
      ? current?.job_scope === "team" ? "team" : "own"
      : body.jobScope === "team" ? "team" : "own",
    canViewCustomers: value("canViewCustomers", "can_view_customers") || canManageCustomers,
    canManageCustomers,
    canViewQuotes: value("canViewQuotes", "can_view_quotes") || canManageQuotes || canSendQuotes,
    canManageQuotes: canManageQuotes || canSendQuotes,
    canSendQuotes,
    canViewInvoices: value("canViewInvoices", "can_view_invoices") || canManageInvoices,
    canManageInvoices,
    canViewPriceBook: value("canViewPriceBook", "can_view_price_book") || canManagePriceBook,
    canManagePriceBook,
    canApplyDiscounts: value("canApplyDiscounts", "can_apply_discounts"),
    scheduleScope: body.scheduleScope === undefined
      ? current?.schedule_scope === "team" ? "team" : "own"
      : body.scheduleScope === "team" ? "team" : "own",
    canRescheduleJobs: value("canRescheduleJobs", "can_reschedule_jobs"),
    canManageTeam: value("canManageTeam", "can_manage_team") || canEditTeamPermissions,
    canEditTeamPermissions,
    canViewFieldEvidence: value("canViewFieldEvidence", "can_view_field_evidence") || canManageFieldEvidence,
    canManageFieldEvidence,
    canRunReports: value("canRunReports", "can_run_reports"),
    canSearchCustomers: value("canSearchCustomers", "can_search_customers"),
  };
}

function permissionBindings(value: MemberPermissions) {
  return [
    value.canCreateJobs ? 1 : 0, value.canManageJobs ? 1 : 0, value.canAssignJobs ? 1 : 0, value.jobScope,
    value.canViewCustomers ? 1 : 0, value.canManageCustomers ? 1 : 0,
    value.canViewQuotes ? 1 : 0, value.canManageQuotes ? 1 : 0, value.canSendQuotes ? 1 : 0,
    value.canViewInvoices ? 1 : 0, value.canManageInvoices ? 1 : 0,
    value.canViewPriceBook ? 1 : 0, value.canManagePriceBook ? 1 : 0, value.canApplyDiscounts ? 1 : 0,
    value.scheduleScope, value.canRescheduleJobs ? 1 : 0,
    value.canManageTeam ? 1 : 0, value.canEditTeamPermissions ? 1 : 0,
    value.canViewFieldEvidence ? 1 : 0, value.canManageFieldEvidence ? 1 : 0,
    value.canRunReports ? 1 : 0, value.canSearchCustomers ? 1 : 0,
  ];
}

function hasPermissionMutation(body: Record<string, unknown>) {
  return Boolean(body.permissions && typeof body.permissions === "object" && !Array.isArray(body.permissions))
    || [...PERMISSION_KEYS].some((key) => body[key] !== undefined);
}

function assertPermissionGrant(access: TeamAccess, permissions: MemberPermissions, before?: MemberPermissions) {
  if (access.isOwner) return;
  if (!access.canEditTeamPermissions) throw new Error("PERMISSION_EDIT_REQUIRED");
  const actorPermissions: Record<keyof Omit<MemberPermissions, "jobScope" | "scheduleScope">, boolean> = {
    canCreateJobs: access.canCreateJobs,
    canManageJobs: access.canManageJobs,
    canAssignJobs: access.canAssignJobs,
    canViewCustomers: access.canViewCustomers,
    canManageCustomers: access.canManageCustomers,
    canViewQuotes: access.canViewQuotes,
    canManageQuotes: access.canManageQuotes,
    canSendQuotes: access.canSendQuotes,
    canViewInvoices: access.canViewInvoices,
    canManageInvoices: access.canManageInvoices,
    canViewPriceBook: access.canViewPriceBook,
    canManagePriceBook: access.canManagePriceBook,
    canApplyDiscounts: access.canApplyDiscounts,
    canRescheduleJobs: access.canRescheduleJobs,
    canManageTeam: access.canManageTeam,
    canEditTeamPermissions: access.canEditTeamPermissions,
    canViewFieldEvidence: access.canViewFieldEvidence,
    canManageFieldEvidence: access.canManageFieldEvidence,
    canRunReports: access.canRunReports,
    canSearchCustomers: access.canSearchCustomers,
  };
  for (const key of BOOLEAN_PERMISSION_KEYS) {
    if (permissions[key] && !before?.[key] && !actorPermissions[key]) throw new Error("PERMISSION_ESCALATION");
  }
  if (permissions.jobScope === "team" && before?.jobScope !== "team" && access.jobScope !== "team") {
    throw new Error("PERMISSION_ESCALATION");
  }
  if (permissions.scheduleScope === "team" && before?.scheduleScope !== "team" && access.scheduleScope !== "team") {
    throw new Error("PERMISSION_ESCALATION");
  }
}

const PERMISSION_COLUMNS: Record<(typeof BOOLEAN_PERMISSION_KEYS)[number], string> = {
  canCreateJobs: "can_create_jobs", canManageJobs: "can_manage_jobs", canAssignJobs: "can_assign_jobs",
  canViewCustomers: "can_view_customers", canManageCustomers: "can_manage_customers",
  canViewQuotes: "can_view_quotes", canManageQuotes: "can_manage_quotes", canSendQuotes: "can_send_quotes",
  canViewInvoices: "can_view_invoices", canManageInvoices: "can_manage_invoices",
  canViewPriceBook: "can_view_price_book", canManagePriceBook: "can_manage_price_book",
  canApplyDiscounts: "can_apply_discounts", canRescheduleJobs: "can_reschedule_jobs",
  canManageTeam: "can_manage_team",
  canEditTeamPermissions: "can_edit_team_permissions", canViewFieldEvidence: "can_view_field_evidence",
  canManageFieldEvidence: "can_manage_field_evidence", canRunReports: "can_run_reports",
  canSearchCustomers: "can_search_customers",
};

function memberMutationActorGuard(access: TeamAccess, before: MemberPermissions, after: MemberPermissions,
  permissionsChanged: boolean) {
  if (access.isOwner) return { sql: "", bindings: [] as unknown[] };
  const clauses = ["actor.can_manage_team = 1"];
  if (permissionsChanged) {
    clauses.push("actor.can_edit_team_permissions = 1", "actor.id <> trade_team_members.id");
    for (const key of BOOLEAN_PERMISSION_KEYS) {
      if (after[key] && !before[key]) clauses.push(`actor.${PERMISSION_COLUMNS[key]} = 1`);
    }
    if (after.jobScope === "team" && before.jobScope !== "team") clauses.push("actor.job_scope = 'team'");
    if (after.scheduleScope === "team" && before.scheduleScope !== "team") clauses.push("actor.schedule_scope = 'team'");
  }
  return {
    sql: ` AND EXISTS (SELECT 1 FROM trade_team_members actor
      WHERE actor.id = ? AND actor.owner_uid = ? AND actor.member_uid = ? AND actor.status = 'active'
        AND ${clauses.join(" AND ")})`,
    bindings: [access.memberId, access.ownerUid, access.actorUid],
  };
}

function memberCreateActorGuard(access: TeamAccess, permissions: MemberPermissions, permissionsChanged: boolean) {
  if (access.isOwner) return { sql: "1 = 1", bindings: [] as unknown[] };
  const clauses = ["actor.can_manage_team = 1"];
  if (permissionsChanged) {
    clauses.push("actor.can_edit_team_permissions = 1");
    for (const key of BOOLEAN_PERMISSION_KEYS) {
      if (permissions[key]) clauses.push(`actor.${PERMISSION_COLUMNS[key]} = 1`);
    }
    if (permissions.jobScope === "team") clauses.push("actor.job_scope = 'team'");
    if (permissions.scheduleScope === "team") clauses.push("actor.schedule_scope = 'team'");
  }
  return {
    sql: `EXISTS (SELECT 1 FROM trade_team_members actor WHERE actor.id = ? AND actor.owner_uid = ?
      AND actor.member_uid = ? AND actor.status = 'active' AND ${clauses.join(" AND ")})`,
    bindings: [access.memberId, access.ownerUid, access.actorUid],
  };
}

function conditionalMemberAuditStatement(db: D1Database, access: TeamAccess, memberId: string,
  eventType: string, metadata: Record<string, unknown>, updatedAt: string) {
  return db.prepare(`INSERT INTO trade_team_member_events
    (id, owner_uid, team_member_id, actor_uid, entity_type, entity_id, event_type, metadata, created_at)
    SELECT ?, ?, ?, ?, 'member', ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM trade_team_members WHERE id = ? AND owner_uid = ? AND updated_at = ?)`)
    .bind(crypto.randomUUID(), access.ownerUid, memberId, access.actorUid, memberId,
      eventType, JSON.stringify(metadata), updatedAt, memberId, access.ownerUid, updatedAt);
}

function inviteReplacementStatements(db: D1Database, access: TeamAccess, memberId: string,
  inviteId: string, inviteTokenHash: string, expiresAt: string, now: string) {
  return [
    db.prepare(`DELETE FROM trade_team_invites
      WHERE team_member_id = ? AND owner_uid = ? AND consumed_at = ''
        AND EXISTS (SELECT 1 FROM trade_team_members member
          WHERE member.id = trade_team_invites.team_member_id
            AND member.owner_uid = trade_team_invites.owner_uid AND member.updated_at = ?)`)
      .bind(memberId, access.ownerUid, now),
    db.prepare(`INSERT INTO trade_team_invites
      (id, team_member_id, owner_uid, token_hash, expires_at, consumed_at, created_at)
      SELECT ?, ?, ?, ?, ?, '', ?
      WHERE EXISTS (SELECT 1 FROM trade_team_members member
        WHERE member.id = ? AND member.owner_uid = ? AND member.updated_at = ?
          AND member.member_uid = '' AND member.status = 'active')`)
      .bind(inviteId, memberId, access.ownerUid, inviteTokenHash, expiresAt, now,
        memberId, access.ownerUid, now),
    db.prepare(`INSERT INTO trade_team_member_events
      (id, owner_uid, team_member_id, actor_uid, entity_type, entity_id, event_type, metadata, created_at)
      SELECT ?, ?, ?, ?, 'member', ?, 'member.invite_issued', ?, ?
      WHERE EXISTS (SELECT 1 FROM trade_team_invites WHERE id = ? AND owner_uid = ? AND team_member_id = ?)`)
      .bind(crypto.randomUUID(), access.ownerUid, memberId, access.actorUid, memberId,
        JSON.stringify({ expiresAt }), now, inviteId, access.ownerUid, memberId),
  ];
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "TEAM_ACCESS_RECORD_REQUIRED") return adminJson({ ok: false, error: "No active team access was found for this account." }, 404);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Team access requires an administrator grant on the installer account." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Team operations are available to installer accounts only." }, 403);
  if (code === "OWNER_REQUIRED") return adminJson({ ok: false, error: "Only the business owner can manage team accounts." }, 403);
  if (code === "PERMISSION_EDIT_REQUIRED") return adminJson({ ok: false, error: "Your account cannot change team access permissions." }, 403);
  if (code === "PERMISSION_SELF_EDIT") return adminJson({ ok: false, error: "Team members cannot change their own access permissions." }, 403);
  if (code === "MEMBER_SELF_LIFECYCLE") return adminJson({ ok: false, error: "Team members cannot deactivate or reactivate their own access." }, 403);
  if (code === "PERMISSION_ESCALATION") return adminJson({ ok: false, error: "You cannot grant access beyond your own permissions or scopes." }, 403);
  if (code === "DISPATCH_REQUIRED") return adminJson({ ok: false, error: "Your team access does not allow job changes." }, 403);
  if (code === "ASSIGN_REQUIRED") return adminJson({ ok: false, error: "Your account cannot assign or reassign team jobs." }, 403);
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is not assigned to your team account." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "TERMINAL_JOB_LOCKED") return adminJson({ ok: false, error: "Completed and cancelled jobs are locked." }, 409);
  if (code === "ONLINE_MUTATION_CONFLICT") return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This job changed elsewhere. Refresh it before saving." }, 409);
  if (code === "MEMBER_NOT_FOUND") return adminJson({ ok: false, error: "Team member not found." }, 404);
  if (code === "PERMISSIONS_INVALID") return adminJson({ ok: false, error: "Check the saved permission values and access scopes." }, 400);
  if (code === "CAPABILITY_NOT_ALLOWED") return adminJson({ ok: false, error: "Choose only services saved on this business profile." }, 400);
  if (code === "MEMBER_CAPABILITY_REQUIRED") return adminJson({ ok: false, error: "This team member is not enabled for the job's service category." }, 409);
  if (code === "PHONE_INVALID") return adminJson({ ok: false, error: "Enter a valid phone number using digits and standard phone symbols." }, 400);
  if (code === "SCHEDULE_COLOUR_INVALID") return adminJson({ ok: false, error: "Choose one of the available schedule colours." }, 400);
  if (code === "MEMBER_CONFLICT") return adminJson({ ok: false, code: "REVISION_CONFLICT", error: "This team member changed elsewhere. Reload before saving." }, 409);
  return adminJson({ ok: false, error: "The team request could not be completed." }, 500);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64Url(new Uint8Array(digest));
}

type RosterOptions = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  capability?: string;
  memberId?: string;
  includeWork?: boolean;
  workPage?: number;
  workPageSize?: number;
  assigneePage?: number;
  assigneePageSize?: number;
  assigneeSearch?: string;
  assigneeCapability?: string;
};

async function teamPayload(access: TeamAccess, options: RosterOptions = {}) {
  const db = getD1();
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const pageSize = Math.min(ROSTER_PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(options.pageSize) || ROSTER_PAGE_SIZE)));
  const rosterSearch = cleanAdminText(options.search, 120).toLowerCase();
  const rosterStatus = ROSTER_STATUS_FILTERS.has(String(options.status)) ? String(options.status) : "all";
  const rosterCapability = cleanAdminText(options.capability, 80);
  const rosterMemberId = cleanAdminText(options.memberId, 180);
  const includeWork = options.includeWork === true;
  const workPage = Math.max(1, Math.floor(Number(options.workPage) || 1));
  const workPageSize = Math.min(100, Math.max(1, Math.floor(Number(options.workPageSize) || 50)));
  const assigneePage = Math.max(1, Math.floor(Number(options.assigneePage) || 1));
  const assigneePageSize = Math.min(50, Math.max(1, Math.floor(Number(options.assigneePageSize) || 25)));
  const assigneeSearch = cleanAdminText(options.assigneeSearch, 120).toLowerCase();
  const assigneeCapability = cleanAdminText(options.assigneeCapability, 80);
  const conditions = ["owner_uid = ?"];
  const bindings: unknown[] = [access.ownerUid];
  if (rosterMemberId) {
    conditions.push("id = ?");
    bindings.push(rosterMemberId);
  }
  if (rosterSearch) {
    conditions.push("(lower(display_name) LIKE ? OR lower(email) LIKE ? OR lower(first_name || ' ' || last_name) LIKE ? OR lower(phone) LIKE ?)");
    const pattern = `%${rosterSearch.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  if (rosterStatus === "suspended") { conditions.push("status = 'suspended'"); }
  if (rosterStatus === "invited") {
    conditions.push(`status = 'active' AND EXISTS (SELECT 1 FROM trade_team_invites pending_invite
      WHERE pending_invite.team_member_id = trade_team_members.id
        AND pending_invite.owner_uid = trade_team_members.owner_uid
        AND pending_invite.consumed_at = '' AND pending_invite.expires_at > ?)`);
    bindings.push(new Date().toISOString());
  }
  if (rosterStatus === "active") {
    conditions.push(`status = 'active' AND NOT EXISTS (SELECT 1 FROM trade_team_invites pending_invite
      WHERE pending_invite.team_member_id = trade_team_members.id
        AND pending_invite.owner_uid = trade_team_members.owner_uid
        AND pending_invite.consumed_at = '' AND pending_invite.expires_at > ?)`);
    bindings.push(new Date().toISOString());
  }
  if (rosterCapability) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(trade_team_members.capabilities) WHERE value = ?)");
    bindings.push(rosterCapability);
  }
  const where = conditions.join(" AND ");
  const rosterTotalRow = !canManageTeam(access) ? null : await db.prepare(`SELECT COUNT(*) count
    FROM trade_team_members WHERE ${where}`).bind(...bindings).first<Record<string, unknown>>();
  const rosterTotal = Number(rosterTotalRow?.count || 0);
  const offset = (page - 1) * pageSize;
  const memberRows = !canManageTeam(access) ? { results: [] as Record<string, unknown>[] } : await db.prepare(`SELECT id, member_uid, email, display_name,
      first_name, last_name, phone, schedule_colour, capabilities, status,
      can_create_jobs, can_manage_jobs, can_assign_jobs, job_scope, can_view_customers, can_manage_customers,
      can_view_quotes, can_manage_quotes, can_send_quotes, can_view_invoices, can_manage_invoices,
      can_view_price_book, can_manage_price_book, can_apply_discounts, schedule_scope,
      can_reschedule_jobs, can_manage_team, can_edit_team_permissions,
      can_view_field_evidence, can_manage_field_evidence, can_run_reports, can_search_customers,
      invited_at, accepted_at, last_active_at, updated_at,
      (SELECT COUNT(*) FROM trade_team_member_files file
        WHERE file.owner_uid = trade_team_members.owner_uid AND file.team_member_id = trade_team_members.id
          AND file.status = 'active') file_count,
      EXISTS(SELECT 1 FROM trade_team_invites i WHERE i.team_member_id = trade_team_members.id AND i.consumed_at = '' AND i.expires_at > ?) invite_pending
    FROM trade_team_members WHERE ${where}
    ORDER BY status = 'active' DESC, display_name COLLATE NOCASE, email COLLATE NOCASE, id
    LIMIT ? OFFSET ?`)
    .bind(new Date().toISOString(), ...bindings, pageSize, offset).all<Record<string, unknown>>();
  const assigneeConditions = ["owner_uid = ?", "status = 'active'"];
  const assigneeBindings: unknown[] = [access.ownerUid];
  if (assigneeSearch) {
    assigneeConditions.push("lower(display_name) LIKE ?");
    assigneeBindings.push(`%${assigneeSearch.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  }
  if (assigneeCapability) {
    assigneeConditions.push("(member_uid = owner_uid OR EXISTS (SELECT 1 FROM json_each(trade_team_members.capabilities) WHERE value = ?))");
    assigneeBindings.push(assigneeCapability);
  }
  const canListAssignees = access.isOwner || access.canAssignJobs;
  const assigneeWhere = assigneeConditions.join(" AND ");
  const assigneeTotal = !canListAssignees ? 0 : Number((await db.prepare(`SELECT COUNT(*) count
    FROM trade_team_members WHERE ${assigneeWhere}`).bind(...assigneeBindings).first<Record<string, unknown>>())?.count || 0);
  const assigneeRows = !canListAssignees ? { results: [] as Record<string, unknown>[] } : await db.prepare(`SELECT id, member_uid, display_name, status, capabilities
      FROM trade_team_members WHERE ${assigneeWhere}
      ORDER BY display_name COLLATE NOCASE, id
      LIMIT ? OFFSET ?`).bind(...assigneeBindings, assigneePageSize, (assigneePage - 1) * assigneePageSize)
      .all<Record<string, unknown>>();
  const workCount = !includeWork ? 0 : Number((await db.prepare(`SELECT COUNT(*) count FROM trade_work_orders w
    WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND (? <> 'own' OR w.assignee_member_id = ?)`)
    .bind(access.ownerUid, access.jobScope, access.memberId).first<Record<string, unknown>>())?.count || 0);
  const jobRows = !includeWork ? { results: [] as Record<string, unknown>[] } : await db.prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.site_area, w.stage,
      w.priority, w.scheduled_start, w.scheduled_end, w.assignee_member_id, w.assignee_label,
      w.source_type, d.customer_source, c.address_line_1, c.address_line_2, c.suburb,
      c.address_state, c.postcode, w.revision, w.updated_at
    FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
    WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND (? <> 'own' OR w.assignee_member_id = ?)
    ORDER BY w.scheduled_start = '', w.scheduled_start, w.priority = 'urgent' DESC, w.updated_at DESC, w.id
    LIMIT ? OFFSET ?`)
    .bind(access.ownerUid, access.jobScope, access.memberId, workPageSize, (workPage - 1) * workPageSize).all<Record<string, unknown>>();
  const jobIds = jobRows.results.map((row) => String(row.id));
  const taskRows = !jobIds.length ? { results: [] as Record<string, unknown>[] } : await db.prepare(`SELECT t.id, t.work_order_id, t.title, t.due_at, t.status, t.completed_at, t.revision
    FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
    WHERE t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
      AND t.work_order_id IN (${jobIds.map(() => "?").join(",")})
    ORDER BY t.status = 'done', t.due_at = '', t.due_at, t.created_at`)
    .bind(access.ownerUid, access.ownerUid, ...jobIds).all<Record<string, unknown>>();
  return {
    access: { businessName: access.businessName, displayName: access.displayName,
      memberId: access.memberId,
      isOwner: access.isOwner, canManageTeam: canManageTeam(access),
      permissions: { canCreateJobs: access.canCreateJobs, canManageJobs: access.canManageJobs,
        canAssignJobs: access.canAssignJobs,
        jobScope: access.jobScope, canViewCustomers: access.canViewCustomers,
        canManageCustomers: access.canManageCustomers,
        canViewQuotes: access.canViewQuotes, canManageQuotes: access.canManageQuotes,
        canSendQuotes: access.canSendQuotes, canViewInvoices: access.canViewInvoices,
        canManageInvoices: access.canManageInvoices, canViewPriceBook: access.canViewPriceBook,
        canManagePriceBook: access.canManagePriceBook, canApplyDiscounts: access.canApplyDiscounts,
        scheduleScope: access.scheduleScope,
        canRescheduleJobs: access.canRescheduleJobs,
        canManageTeam: access.canManageTeam, canEditTeamPermissions: access.canEditTeamPermissions,
        canViewFieldEvidence: access.canViewFieldEvidence,
        canManageFieldEvidence: access.canManageFieldEvidence,
        canRunReports: access.canRunReports,
        canSearchCustomers: access.canSearchCustomers } },
    members: memberRows.results.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name,
      firstName: row.first_name, lastName: row.last_name, phone: row.phone,
      scheduleColour: row.schedule_colour,
      capabilities: parsedList(row.capabilities), staffCode: String(row.id).slice(0, 8).toUpperCase(),
      status: row.status,
      invitedAt: row.invited_at, acceptedAt: row.accepted_at,
      lastActiveAt: row.last_active_at, updatedAt: row.updated_at, hasLogin: Boolean(row.member_uid),
      invitePending: Boolean(row.invite_pending), isOwner: row.member_uid === access.ownerUid,
      fileCount: Number(row.file_count || 0), permissions: {
        canCreateJobs: Boolean(row.can_create_jobs), canManageJobs: Boolean(row.can_manage_jobs),
        canAssignJobs: Boolean(row.can_assign_jobs),
        jobScope: row.job_scope === "team" ? "team" : "own",
        canViewCustomers: Boolean(row.can_view_customers), canManageCustomers: Boolean(row.can_manage_customers),
        canViewQuotes: Boolean(row.can_view_quotes), canManageQuotes: Boolean(row.can_manage_quotes),
        canSendQuotes: Boolean(row.can_send_quotes), canViewInvoices: Boolean(row.can_view_invoices),
        canManageInvoices: Boolean(row.can_manage_invoices), canViewPriceBook: Boolean(row.can_view_price_book),
        canManagePriceBook: Boolean(row.can_manage_price_book),
        canApplyDiscounts: Boolean(row.can_apply_discounts),
        scheduleScope: row.schedule_scope === "team" ? "team" : "own",
        canRescheduleJobs: Boolean(row.can_reschedule_jobs),
        canManageTeam: Boolean(row.can_manage_team), canEditTeamPermissions: Boolean(row.can_edit_team_permissions),
        canViewFieldEvidence: Boolean(row.can_view_field_evidence),
        canManageFieldEvidence: Boolean(row.can_manage_field_evidence),
        canRunReports: Boolean(row.can_run_reports),
        canSearchCustomers: Boolean(row.can_search_customers),
      } })),
    assignees: assigneeRows.results.map((row) => ({ id: row.id, displayName: row.display_name,
      status: row.status, capabilities: parsedList(row.capabilities), isSelf: row.id === access.memberId,
      isOwner: row.member_uid === access.ownerUid })),
    assigneeRoster: { page: assigneePage, pageSize: assigneePageSize, total: assigneeTotal,
      totalPages: Math.max(1, Math.ceil(assigneeTotal / assigneePageSize)), search: assigneeSearch,
      capability: assigneeCapability },
    roster: { page, pageSize, total: rosterTotal, totalPages: Math.max(1, Math.ceil(rosterTotal / pageSize)),
      search: rosterSearch, status: rosterStatus, capability: rosterCapability },
    work: { included: includeWork, page: workPage, pageSize: workPageSize, total: workCount,
      totalPages: Math.max(1, Math.ceil(workCount / workPageSize)) },
    jobs: jobRows.results.map((row) => {
      const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private";
      const address = protectedJob ? "" : [row.address_line_1, row.address_line_2, row.suburb, row.address_state, row.postcode]
        .map((item) => String(item || "").trim()).filter(Boolean).join(", ");
      return { id: row.id, workNumber: row.work_number,
        title: protectedJob ? `${String(row.service_category || "Service")} job` : row.title, serviceCategory: row.service_category,
        siteArea: row.site_area, stage: row.stage, priority: row.priority, scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end, assigneeMemberId: row.assignee_member_id, assigneeLabel: row.assignee_label,
        protectedJob, serviceAddress: address, revision: Number(row.revision || 1), updatedAt: row.updated_at,
        tasks: taskRows.results.filter((task) => task.work_order_id === row.id).map((task) => ({ id: task.id,
          title: task.title, dueAt: task.due_at, status: task.status, completedAt: task.completed_at,
          revision: Number(task.revision || 1) })) };
    }),
  };
}

async function mutableAssignedJobState(
  db: D1Database,
  access: TeamAccess,
  workOrderId: string,
) {
  const assigned = await assignedJob(access, workOrderId);
  const current = await db.prepare(`SELECT w.stage, w.revision, w.assignee_member_id, w.assignee_label,
      w.service_category, w.source_type, d.customer_source
    FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    WHERE w.id = ? AND w.firebase_uid = ? AND w.partner_type = 'installer'
      AND w.record_status = 'active'`)
    .bind(workOrderId, access.ownerUid)
    .first<{
      stage: string;
      revision: number;
      assignee_member_id: string;
      assignee_label: string;
      service_category: string;
    }>();
  if (!current) throw new Error("JOB_NOT_FOUND");
  if (Number(current.revision) !== Number(assigned.revision)) throw new Error("ONLINE_MUTATION_CONFLICT");
  if (["completed", "cancelled"].includes(String(current.stage))) throw new Error("TERMINAL_JOB_LOCKED");
  return current;
}

async function mutableAssignableJobState(db: D1Database, access: TeamAccess, workOrderId: string) {
  const current = await db.prepare(`SELECT stage, revision, assignee_member_id, assignee_label, service_category
    FROM trade_work_orders
    WHERE id = ? AND firebase_uid = ? AND partner_type = 'installer'
      AND record_status = 'active'`)
    .bind(workOrderId, access.ownerUid)
    .first<{
      stage: string;
      revision: number;
      assignee_member_id: string;
      assignee_label: string;
      service_category: string;
    }>();
  if (!current) throw new Error("JOB_NOT_FOUND");
  if (["completed", "cancelled"].includes(String(current.stage))) throw new Error("TERMINAL_JOB_LOCKED");
  return current;
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    const search = new URL(request.url).searchParams;
    return adminJson({ ok: true, ...(await teamPayload(access, {
      page: Number(search.get("page") || 1), pageSize: Number(search.get("pageSize") || ROSTER_PAGE_SIZE),
      search: search.get("search") || "", status: search.get("status") || "all",
      capability: search.get("capability") || "",
      memberId: search.get("memberId") || "",
      includeWork: search.get("includeWork") === "1",
      workPage: Number(search.get("workPage") || 1),
      workPageSize: Number(search.get("workPageSize") || 50),
      assigneePage: Number(search.get("assigneePage") || 1),
      assigneePageSize: Number(search.get("assigneePageSize") || 25),
      assigneeSearch: search.get("assigneeSearch") || "",
      assigneeCapability: search.get("assigneeCapability") || "",
    })) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return adminJson({ ok: false, error: "Invalid team request." }, 400); }
  const action = cleanAdminText(body.action, 30);
  try {
    if (action === "accept_invite") {
      const identity = await requireFirebaseIdentity(request);
      const token = cleanAdminText(body.token, 300);
      if (!token) return adminJson({ ok: false, error: "The invitation link is incomplete." }, 400);
      const now = new Date().toISOString();
      const invite = await getD1().prepare(`SELECT i.id, i.team_member_id, i.owner_uid, i.expires_at, i.consumed_at,
          m.email, m.status FROM trade_team_invites i JOIN trade_team_members m ON m.id = i.team_member_id
        WHERE i.token_hash = ?`).bind(await tokenHash(token)).first<Record<string, unknown>>();
      if (!invite || invite.consumed_at || String(invite.expires_at) <= now || invite.status === "suspended") {
        return adminJson({ ok: false, error: "This invitation has expired or has already been used." }, 410);
      }
      if (String(invite.email).toLowerCase() !== identity.email) {
        return adminJson({ ok: false, error: `Sign in with ${String(invite.email)} to accept this invitation.` }, 403);
      }
      const existing = await getD1().prepare(`SELECT id FROM trade_team_members
        WHERE member_uid = ? AND status = 'active' AND id <> ? LIMIT 1`).bind(identity.uid, invite.team_member_id).first();
      if (existing) return adminJson({ ok: false, error: "This account is already active in another installer team." }, 409);
      const accepted = await getD1().batch([
        getD1().prepare(`UPDATE trade_team_members SET member_uid = ?, status = 'active', accepted_at = ?,
          last_active_at = ?, updated_at = ?
          WHERE id = ? AND owner_uid = ? AND member_uid = '' AND status = 'active'
            AND NOT EXISTS (SELECT 1 FROM trade_team_members other
              WHERE other.member_uid = ? AND other.status = 'active' AND other.id <> trade_team_members.id)
            AND EXISTS (SELECT 1 FROM trade_team_invites active_invite
              WHERE active_invite.id = ? AND active_invite.team_member_id = trade_team_members.id
                AND active_invite.owner_uid = trade_team_members.owner_uid
                AND active_invite.consumed_at = '' AND active_invite.expires_at > ?)`)
          .bind(identity.uid, now, now, now, invite.team_member_id, invite.owner_uid,
            identity.uid, invite.id, now),
        getD1().prepare(`UPDATE trade_team_invites SET consumed_at = ?
          WHERE id = ? AND consumed_at = '' AND expires_at > ?
            AND EXISTS (SELECT 1 FROM trade_team_members member
              WHERE member.id = trade_team_invites.team_member_id AND member.owner_uid = trade_team_invites.owner_uid
                AND member.member_uid = ? AND member.accepted_at = ?)`)
          .bind(now, invite.id, now, identity.uid, now),
      ]);
      if (!accepted[0]?.meta.changes || !accepted[1]?.meta.changes) {
        return adminJson({ ok: false, error: "This invitation is no longer available." }, 409);
      }
      const access = await requireInstallerTeamAccess(request);
      return adminJson({ ok: true, accepted: true, ...(await teamPayload(access)) });
    }

    const access = await requireInstallerTeamAccess(request);
    if (!canManageTeam(access)) throw new Error("OWNER_REQUIRED");
    if (!["add_member", "invite_member", "reissue_invite"].includes(action)) return adminJson({ ok: false, error: "Unsupported team action." }, 400);
    const db = getD1(); const now = new Date().toISOString();
    const inviteId = crypto.randomUUID();
    const inviteTokenBytes = new Uint8Array(32); crypto.getRandomValues(inviteTokenBytes);
    const inviteToken = base64Url(inviteTokenBytes);
    const inviteTokenHash = await tokenHash(inviteToken);
    const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    let memberId = cleanAdminText(body.memberId, 180);
    let email = cleanAdminText(body.email, 180).toLowerCase();
    let firstName = cleanAdminText(body.firstName, 80);
    let lastName = cleanAdminText(body.lastName, 80);
    let phone = normalisePhone(body.phone);
    let scheduleColour = cleanAdminText(body.scheduleColour, 20) || "emerald";
    if (!SCHEDULE_COLOURS.has(scheduleColour)) throw new Error("SCHEDULE_COLOUR_INVALID");
    let displayName = cleanAdminText(body.displayName, 100)
      || [firstName, lastName].filter(Boolean).join(" ");
    const requestedPermissions = permissionInput(body);
    let permissions = memberPermissions(requestedPermissions);
    if (hasPermissionMutation(body)) assertPermissionGrant(access, permissions);
    let capabilities = await memberCapabilities(access.ownerUid, body.capabilities);
    if (action === "add_member") {
      if (!displayName || (email && !EMAIL_PATTERN.test(email))) {
        return adminJson({ ok: false, error: "Add a valid name, optional login email and phone number." }, 400);
      }
      if (email) {
        const duplicate = await db.prepare("SELECT id FROM trade_team_members WHERE owner_uid = ? AND email = ?")
          .bind(access.ownerUid, email).first();
        if (duplicate) return adminJson({ ok: false, error: "That login email is already used by someone in this team." }, 409);
      }
      memberId = crypto.randomUUID();
      const createGuard = memberCreateActorGuard(access, permissions, hasPermissionMutation(body));
      const created = await db.batch([
        db.prepare(`INSERT INTO trade_team_members
          (id, owner_uid, member_uid, email, display_name, first_name, last_name, phone, schedule_colour, capabilities, role,
           can_create_jobs, can_manage_jobs, can_assign_jobs, job_scope,
           can_view_customers, can_manage_customers, can_view_quotes, can_manage_quotes, can_send_quotes,
           can_view_invoices, can_manage_invoices, can_view_price_book, can_manage_price_book, can_apply_discounts,
           schedule_scope, can_reschedule_jobs, can_manage_team, can_edit_team_permissions,
           can_view_field_evidence,
           can_manage_field_evidence, can_run_reports, can_search_customers, status, invited_at,
           accepted_at, last_active_at, created_at, updated_at)
           SELECT ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'active', '', '', '', ?, ? WHERE ${createGuard.sql}`)
          .bind(memberId, access.ownerUid, email, displayName, firstName, lastName, phone, scheduleColour, JSON.stringify(capabilities), "field",
            ...permissionBindings(permissions), now, now, ...createGuard.bindings),
        conditionalMemberAuditStatement(db, access, memberId, "member.created", {
          hasLoginEmail: Boolean(email), permissions,
        }, now),
        ...(email ? inviteReplacementStatements(db, access, memberId, inviteId,
          inviteTokenHash, inviteExpiresAt, now) : []),
      ]);
      if (!created[0]?.meta.changes) throw new Error("PERMISSION_ESCALATION");
      if (email && !created[3]?.meta.changes) throw new Error("MEMBER_CONFLICT");
      if (!email) return adminJson({ ok: true, ...(await teamPayload(access)) }, 201);
    } else if (action === "reissue_invite") {
      const existing = await db.prepare(`SELECT id, member_uid, email, display_name, first_name, last_name, phone, schedule_colour, capabilities,
          status, updated_at, can_create_jobs, can_manage_jobs, can_assign_jobs, job_scope,
          can_view_customers, can_manage_customers, can_view_quotes, can_manage_quotes, can_send_quotes,
          can_view_invoices, can_manage_invoices, can_view_price_book, can_manage_price_book, can_apply_discounts,
          schedule_scope, can_reschedule_jobs, can_manage_team, can_edit_team_permissions,
          can_view_field_evidence, can_manage_field_evidence,
          can_run_reports, can_search_customers
        FROM trade_team_members
        WHERE id = ? AND owner_uid = ?`).bind(memberId, access.ownerUid).first<Record<string, unknown>>();
      if (!existing) throw new Error("MEMBER_NOT_FOUND");
      const expectedUpdatedAt = cleanAdminText(body.expectedUpdatedAt, 80);
      if (!expectedUpdatedAt || expectedUpdatedAt !== String(existing.updated_at || "")) {
        throw new Error("MEMBER_CONFLICT");
      }
      if (existing.member_uid) return adminJson({ ok: false, error: "This person already has login access." }, 409);
      if (!EMAIL_PATTERN.test(String(existing.email))) return adminJson({ ok: false, error: "Add a login email before creating an invitation." }, 400);
      email = String(existing.email); displayName = String(existing.display_name);
      firstName = String(existing.first_name || ""); lastName = String(existing.last_name || "");
      phone = String(existing.phone || "");
      scheduleColour = String(existing.schedule_colour || "emerald");
      capabilities = parsedList(existing.capabilities);
      permissions = memberPermissions({}, existing);
      const actorGuard = memberMutationActorGuard(access, permissions, permissions, false);
      const reissued = await db.batch([
        db.prepare(`UPDATE trade_team_members SET invited_at = ?, updated_at = ?
          WHERE id = ? AND owner_uid = ? AND member_uid = '' AND status = 'active'
            AND updated_at = ?${actorGuard.sql}`)
          .bind(now, now, memberId, access.ownerUid, existing.updated_at, ...actorGuard.bindings),
        conditionalMemberAuditStatement(db, access, memberId, "member.invitation_reissued", {}, now),
        ...inviteReplacementStatements(db, access, memberId, inviteId, inviteTokenHash, inviteExpiresAt, now),
      ]);
      if (!reissued[0]?.meta.changes || !reissued[3]?.meta.changes) throw new Error("MEMBER_CONFLICT");
    } else {
      if (!EMAIL_PATTERN.test(email) || !displayName) {
        return adminJson({ ok: false, error: "Add a valid name, email and phone number." }, 400);
      }
      if (memberId) {
        const current = await db.prepare(`SELECT id, member_uid, updated_at, schedule_colour,
            can_create_jobs, can_manage_jobs, can_assign_jobs, job_scope, can_view_customers, can_manage_customers,
            can_view_quotes, can_manage_quotes, can_send_quotes, can_view_invoices, can_manage_invoices,
            can_view_price_book, can_manage_price_book, can_apply_discounts, schedule_scope,
            can_reschedule_jobs, can_manage_team, can_edit_team_permissions,
            can_view_field_evidence, can_manage_field_evidence, can_run_reports, can_search_customers
          FROM trade_team_members WHERE id = ? AND owner_uid = ?`)
          .bind(memberId, access.ownerUid).first<Record<string, unknown>>();
        if (!current) throw new Error("MEMBER_NOT_FOUND");
        const expectedUpdatedAt = cleanAdminText(body.expectedUpdatedAt, 80);
        if (!expectedUpdatedAt || expectedUpdatedAt !== String(current.updated_at || "")) {
          throw new Error("MEMBER_CONFLICT");
        }
        if (current.member_uid) return adminJson({ ok: false, error: "This person already has login access." }, 409);
        if (body.scheduleColour === undefined) scheduleColour = String(current.schedule_colour || "emerald");
        permissions = memberPermissions(requestedPermissions, current);
        const beforePermissions = memberPermissions({}, current);
        const permissionsChanged = hasPermissionMutation(body);
        if (permissionsChanged) assertPermissionGrant(access, permissions, beforePermissions);
        const duplicate = await db.prepare("SELECT id FROM trade_team_members WHERE owner_uid = ? AND email = ? AND id <> ?")
          .bind(access.ownerUid, email, memberId).first();
        if (duplicate) return adminJson({ ok: false, error: "That login email is already used by someone in this team." }, 409);
        const actorGuard = memberMutationActorGuard(access, beforePermissions, permissions, permissionsChanged);
        const invited = await db.batch([
          db.prepare(`UPDATE trade_team_members SET email = ?, display_name = ?, first_name = ?, last_name = ?,
            phone = ?, schedule_colour = ?, capabilities = ?, can_create_jobs = ?, can_manage_jobs = ?, can_assign_jobs = ?, job_scope = ?, can_view_customers = ?,
            can_manage_customers = ?, can_view_quotes = ?, can_manage_quotes = ?, can_send_quotes = ?,
            can_view_invoices = ?, can_manage_invoices = ?, can_view_price_book = ?, can_manage_price_book = ?, can_apply_discounts = ?,
            schedule_scope = ?, can_reschedule_jobs = ?, can_manage_team = ?, can_edit_team_permissions = ?, can_view_field_evidence = ?,
            can_manage_field_evidence = ?, can_run_reports = ?, can_search_customers = ?, invited_at = ?, updated_at = ?
            WHERE id = ? AND owner_uid = ? AND updated_at = ?${actorGuard.sql}`).bind(email, displayName, firstName, lastName, phone, scheduleColour,
              JSON.stringify(capabilities), ...permissionBindings(permissions),
              now, now, memberId, access.ownerUid, current.updated_at, ...actorGuard.bindings),
          conditionalMemberAuditStatement(db, access, memberId, "member.invitation_updated", { permissions }, now),
          ...inviteReplacementStatements(db, access, memberId, inviteId, inviteTokenHash, inviteExpiresAt, now),
        ]);
        if (!invited[0]?.meta.changes || !invited[3]?.meta.changes) throw new Error("MEMBER_CONFLICT");
      } else {
      const existing = await db.prepare("SELECT id, status FROM trade_team_members WHERE owner_uid = ? AND email = ?").bind(access.ownerUid, email).first<Record<string, unknown>>();
      if (existing) return adminJson({ ok: false, error: "That email already belongs to this team. Open that member before inviting them." }, 409);
      memberId = crypto.randomUUID();
      const createGuard = memberCreateActorGuard(access, permissions, hasPermissionMutation(body));
      const invited = await db.batch([
        db.prepare(`INSERT INTO trade_team_members
          (id, owner_uid, member_uid, email, display_name, first_name, last_name, phone, schedule_colour, capabilities, role,
           can_create_jobs, can_manage_jobs, can_assign_jobs, job_scope,
           can_view_customers, can_manage_customers, can_view_quotes, can_manage_quotes, can_send_quotes,
           can_view_invoices, can_manage_invoices, can_view_price_book, can_manage_price_book, can_apply_discounts,
           schedule_scope, can_reschedule_jobs, can_manage_team, can_edit_team_permissions,
           can_view_field_evidence,
           can_manage_field_evidence, can_run_reports, can_search_customers, status, invited_at,
           accepted_at, last_active_at, created_at, updated_at)
          SELECT ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            'active', ?, '', '', ?, ? WHERE ${createGuard.sql}`)
          .bind(memberId, access.ownerUid, email, displayName, firstName, lastName, phone, scheduleColour,
            JSON.stringify(capabilities), "field",
            ...permissionBindings(permissions), now, now, now, ...createGuard.bindings),
        conditionalMemberAuditStatement(db, access, memberId, "member.invited", { permissions }, now),
        ...inviteReplacementStatements(db, access, memberId, inviteId, inviteTokenHash, inviteExpiresAt, now),
      ]);
      if (!invited[0]?.meta.changes) throw new Error("PERMISSION_ESCALATION");
      if (!invited[3]?.meta.changes) throw new Error("MEMBER_CONFLICT");
      }
    }
    const inviteUrl = new URL("/direct-trade/team", request.url); inviteUrl.searchParams.set("invite", inviteToken);
    return adminJson({ ok: true, invite: { memberId, email, displayName, firstName, lastName, phone,
      permissions, inviteUrl: inviteUrl.toString(), expiresInDays: 7 },
      ...(await teamPayload(access)) }, 201);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return adminJson({ ok: false, error: "Invalid team update." }, 400); }
    const action = cleanAdminText(body.action, 30); const db = getD1(); const now = new Date().toISOString();
    if (action === "update_member") {
      if (!canManageTeam(access)) throw new Error("OWNER_REQUIRED");
      const memberId = cleanAdminText(body.memberId, 180);
      const current = await db.prepare(`SELECT member_uid, email, display_name, first_name, last_name, phone, schedule_colour,
          capabilities, status, updated_at,
          can_create_jobs, can_manage_jobs, can_assign_jobs, job_scope, can_view_customers, can_manage_customers,
          can_view_quotes, can_manage_quotes, can_send_quotes, can_view_invoices, can_manage_invoices,
          can_view_price_book, can_manage_price_book, can_apply_discounts, schedule_scope,
          can_reschedule_jobs, can_manage_team, can_edit_team_permissions,
          can_view_field_evidence, can_manage_field_evidence, can_run_reports, can_search_customers
        FROM trade_team_members WHERE id = ? AND owner_uid = ?`)
        .bind(memberId, access.ownerUid).first<Record<string, unknown>>();
      if (!current) throw new Error("MEMBER_NOT_FOUND");
      const expectedUpdatedAt = cleanAdminText(body.expectedUpdatedAt, 80);
      if (!expectedUpdatedAt || expectedUpdatedAt !== String(current.updated_at || "")) {
        throw new Error("MEMBER_CONFLICT");
      }
      const status = body.status === undefined ? String(current.status) : cleanAdminText(body.status, 20);
      if (!MEMBER_LIFECYCLE_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid account status." }, 400);
      if (String(current.member_uid) === access.ownerUid) return adminJson({ ok: false, error: "The business owner remains active." }, 409);
      const lifecycleChanged = status !== String(current.status);
      if (lifecycleChanged) {
        const decision = memberLifecycleDecision(access, { memberId, memberUid: String(current.member_uid || "") });
        if (!decision.allowed) {
          if (decision.reason === "self_protected") throw new Error("MEMBER_SELF_LIFECYCLE");
          if (decision.reason === "owner_protected") return adminJson({ ok: false, error: "The business owner remains active." }, 409);
          throw new Error("OWNER_REQUIRED");
        }
      }
      const firstName = body.firstName === undefined ? String(current.first_name || "") : cleanAdminText(body.firstName, 80);
      const lastName = body.lastName === undefined ? String(current.last_name || "") : cleanAdminText(body.lastName, 80);
      const phone = body.phone === undefined ? String(current.phone || "") : normalisePhone(body.phone);
      const scheduleColour = body.scheduleColour === undefined
        ? String(current.schedule_colour || "emerald") : cleanAdminText(body.scheduleColour, 20);
      if (!SCHEDULE_COLOURS.has(scheduleColour)) throw new Error("SCHEDULE_COLOUR_INVALID");
      const requestedEmail = body.email === undefined ? String(current.email || "") : cleanAdminText(body.email, 180).toLowerCase();
      const email = current.member_uid ? String(current.email || "") : requestedEmail;
      const displayName = cleanAdminText(body.displayName, 100) || [firstName, lastName].filter(Boolean).join(" ")
        || String(current.display_name || "");
      if (!displayName || (email && !EMAIL_PATTERN.test(email))) {
        return adminJson({ ok: false, error: "Add a valid name, email and phone number." }, 400);
      }
      if (email) {
        const duplicate = await db.prepare(`SELECT id FROM trade_team_members
          WHERE owner_uid = ? AND email = ? AND id <> ?`).bind(access.ownerUid, email, memberId).first();
        if (duplicate) return adminJson({ ok: false, error: "That login email is already used by someone in this team." }, 409);
      }
      const requestedPermissions = permissionInput(body);
      const permissionsChanged = hasPermissionMutation(body);
      if (permissionsChanged && (memberId === access.memberId || String(current.member_uid) === access.actorUid)) {
        throw new Error("PERMISSION_SELF_EDIT");
      }
      const beforePermissions = memberPermissions({}, current);
      const permissions = memberPermissions(requestedPermissions, current);
      if (permissionsChanged) assertPermissionGrant(access, permissions, beforePermissions);
      const capabilities = body.capabilities === undefined
        ? parsedList(current.capabilities)
        : await memberCapabilities(access.ownerUid, body.capabilities);
      const actorGuard = memberMutationActorGuard(access, beforePermissions, permissions, permissionsChanged);
      const results = await db.batch([
        db.prepare(`UPDATE trade_team_members SET email = ?, display_name = ?, first_name = ?, last_name = ?,
          phone = ?, schedule_colour = ?, capabilities = ?, status = ?,
          can_create_jobs = ?, can_manage_jobs = ?, can_assign_jobs = ?, job_scope = ?, can_view_customers = ?,
          can_manage_customers = ?, can_view_quotes = ?, can_manage_quotes = ?, can_send_quotes = ?,
          can_view_invoices = ?, can_manage_invoices = ?, can_view_price_book = ?, can_manage_price_book = ?,
          can_apply_discounts = ?, schedule_scope = ?, can_reschedule_jobs = ?,
          can_manage_team = ?, can_edit_team_permissions = ?, can_view_field_evidence = ?,
          can_manage_field_evidence = ?, can_run_reports = ?, can_search_customers = ?, updated_at = ?
          WHERE id = ? AND owner_uid = ? AND updated_at = ?${actorGuard.sql}`).bind(email, displayName, firstName, lastName, phone, scheduleColour,
            JSON.stringify(capabilities), status,
            ...permissionBindings(permissions), now, memberId, access.ownerUid, current.updated_at, ...actorGuard.bindings),
        conditionalMemberAuditStatement(db, access, memberId, "member.updated", {
          status, capabilities, permissionsBefore: beforePermissions, permissionsAfter: permissions,
          permissionsChanged,
        }, now),
        ...(lifecycleChanged && status === "suspended" ? [
          db.prepare(`UPDATE trade_mobile_devices
            SET status = 'revoked', push_token = '', push_token_updated_at = ?, revoked_at = ?,
              revoked_by_uid = ?, updated_at = ?
            WHERE owner_uid = ? AND member_id = ? AND status = 'active'
              AND EXISTS (SELECT 1 FROM trade_team_members member
                WHERE member.id = ? AND member.owner_uid = ? AND member.status = 'suspended'
                  AND member.updated_at = ?)`)
            .bind(now, now, access.actorUid, now, access.ownerUid, memberId,
              memberId, access.ownerUid, now),
          db.prepare(`UPDATE trade_team_invites SET consumed_at = ?
            WHERE owner_uid = ? AND team_member_id = ? AND consumed_at = ''
              AND EXISTS (SELECT 1 FROM trade_team_members member
                WHERE member.id = trade_team_invites.team_member_id
                  AND member.owner_uid = trade_team_invites.owner_uid
                  AND member.status = 'suspended' AND member.updated_at = ?)`)
            .bind(now, access.ownerUid, memberId, now),
        ] : []),
      ]);
      if (!results[0]?.meta.changes) throw new Error("MEMBER_CONFLICT");
      if (lifecycleChanged && status === "suspended") {
        await abortMemberDeviceUploads(access.ownerUid, memberId);
      }
    } else if (action === "assign_job") {
      const workOrderId = cleanAdminText(body.workOrderId, 180); const memberId = cleanAdminText(body.memberId, 180);
      const job = await mutableAssignableJobState(db, access, workOrderId);
      if (!canAssignJob(access, String(job.assignee_member_id || ""), memberId)) throw new Error("ASSIGN_REQUIRED");
      let label = "";
      if (memberId) {
        const member = await db.prepare(`SELECT display_name, member_uid, capabilities FROM trade_team_members
          WHERE id = ? AND owner_uid = ? AND status = 'active'`).bind(memberId, access.ownerUid).first<Record<string, unknown>>();
        if (!member) throw new Error("MEMBER_NOT_FOUND");
        const serviceCategory = String(job.service_category || "");
        if (String(member.member_uid || "") !== access.ownerUid && serviceCategory
          && !parsedList(member.capabilities).includes(serviceCategory)) {
          throw new Error("MEMBER_CAPABILITY_REQUIRED");
        }
        label = String(member.display_name);
      }
      const revision = nextJobRevision(job.revision);
      const jobStage = String(job.stage);
      await guardedOnlineJobMutationBatch(db, [
        db.prepare(`UPDATE trade_work_orders
          SET assignee_member_id = ?, assignee_label = ?, revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
            AND stage = ? AND stage NOT IN ('completed', 'cancelled') AND revision = ?
            AND assignee_member_id = ?`)
          .bind(memberId, label, revision, now, workOrderId, access.ownerUid,
            jobStage, Number(job.revision), String(job.assignee_member_id || "")),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'team_assignment', ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, access.ownerUid, memberId
            ? `Assigned to ${label}.`
            : "Team assignment cleared.", now),
        ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
          audienceMemberId: memberId, previousAudienceMemberId: job.assignee_member_id }),
      ], {
        kind: "assignment",
        assigneeLabel: label,
        assigneeMemberId: memberId,
        jobRevision: revision,
        jobStage,
        ownerUid: access.ownerUid,
        updatedAt: now,
        workOrderId,
      });
    } else if (action === "update_job") {
      if (!access.canManageJobs) throw new Error("DISPATCH_REQUIRED");
      const workOrderId = cleanAdminText(body.workOrderId, 180);
      const job = await mutableAssignedJobState(db, access, workOrderId);
      const stage = cleanAdminText(body.stage, 30);
      if (!WORK_STAGES.has(stage)) return adminJson({ ok: false, error: "Choose a valid job stage." }, 400);
      const revision = nextJobRevision(job.revision);
      await guardedOnlineJobMutationBatch(db, [
        db.prepare(`UPDATE trade_work_orders SET stage = ?, revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
            AND stage = ? AND stage NOT IN ('completed', 'cancelled') AND revision = ?`)
          .bind(stage, revision, now, workOrderId, access.ownerUid,
            String(job.stage), Number(job.revision)),
        ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId, revision, changedAt: now,
          audienceMemberId: job.assignee_member_id }),
      ], {
        kind: "stage",
        jobRevision: revision,
        jobStage: stage,
        ownerUid: access.ownerUid,
        updatedAt: now,
        workOrderId,
      });
    } else if (action === "update_task") {
      if (!access.canManageJobs) throw new Error("DISPATCH_REQUIRED");
      const taskId = cleanAdminText(body.taskId, 180); const status = cleanAdminText(body.status, 20);
      if (!["pending", "done"].includes(status)) return adminJson({ ok: false, error: "Choose a valid task status." }, 400);
      const task = await db.prepare(`SELECT t.work_order_id, t.revision, w.stage job_stage,
          w.revision job_revision, w.assignee_member_id
        FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
        WHERE t.id = ? AND t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
        .bind(taskId, access.ownerUid, access.ownerUid).first<Record<string, unknown>>();
      if (!task) throw new Error("JOB_NOT_FOUND");
      if (["completed", "cancelled"].includes(String(task.job_stage))) throw new Error("TERMINAL_JOB_LOCKED");
      const job = await assignedJob(access, String(task.work_order_id));
      if (Number(job.revision) !== Number(task.job_revision)) throw new Error("ONLINE_MUTATION_CONFLICT");
      const taskRevision = nextJobRevision(task.revision); const jobRevision = nextJobRevision(task.job_revision);
      const jobStage = String(task.job_stage);
      await guardedOnlineChildMutationBatch(db, [
        db.prepare(`UPDATE trade_work_order_tasks SET status = ?, completed_at = ?, revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND revision = ?
            AND EXISTS (
              SELECT 1 FROM trade_work_orders work_order
              WHERE work_order.id = trade_work_order_tasks.work_order_id
                AND work_order.firebase_uid = trade_work_order_tasks.firebase_uid
                AND work_order.record_status = 'active'
                AND work_order.stage = ?
                AND work_order.stage NOT IN ('completed', 'cancelled')
                AND work_order.revision = ?
            )`)
          .bind(status, status === "done" ? now : "", taskRevision, now, taskId, access.ownerUid,
            Number(task.revision), jobStage, Number(task.job_revision)),
        db.prepare(`UPDATE trade_work_orders SET revision = ?, updated_at = ?
          WHERE id = ? AND firebase_uid = ? AND record_status = 'active'
            AND stage = ? AND stage NOT IN ('completed', 'cancelled') AND revision = ?
            AND EXISTS (
              SELECT 1 FROM trade_work_order_tasks child
              WHERE child.id = ? AND child.work_order_id = trade_work_orders.id
                AND child.firebase_uid = trade_work_orders.firebase_uid
                AND child.revision = ? AND child.updated_at = ?
            )`)
          .bind(jobRevision, now, task.work_order_id, access.ownerUid, jobStage,
            Number(task.job_revision), taskId, taskRevision, now),
        ...jobSyncChangeStatements(db, { ownerUid: access.ownerUid, workOrderId: String(task.work_order_id),
          revision: jobRevision, changedAt: now, audienceMemberId: String(task.assignee_member_id || "") }),
      ], {
        childKind: "task",
        childId: taskId,
        childRevision: taskRevision,
        jobRevision,
        jobStage,
        ownerUid: access.ownerUid,
        updatedAt: now,
        workOrderId: String(task.work_order_id),
      });
    } else return adminJson({ ok: false, error: "Unsupported team update." }, 400);
    return adminJson({ ok: true, ...(await teamPayload(access)) });
  } catch (error) { return errorResponse(error); }
}
