import { getD1 } from "../../../../db";
import { adminJson, cleanAdminText, sameOrigin } from "@/lib/admin-server";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import { assignedJob, canDispatch, canManageTeam, requireInstallerTeamAccess, type TeamAccess } from "@/lib/trade-team-server";

export const runtime = "edge";

const ROLES = new Set(["manager", "coordinator", "technician"]);
const MEMBER_STATUSES = new Set(["active", "suspended"]);
const WORK_STAGES = new Set(["backlog", "ready", "scheduled", "in_progress", "blocked", "completed", "cancelled"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_LIMIT = 50;

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return adminJson({ ok: false, error: "Sign in to continue." }, 401);
  if (code === "TEAM_MEMBERSHIP_REQUIRED") return adminJson({ ok: false, error: "No active team membership was found for this account." }, 404);
  if (code === "TEAM_ACCESS_REQUIRED") return adminJson({ ok: false, error: "Team access requires an administrator grant on the installer account." }, 403);
  if (code === "ACCOUNT_INACTIVE") return adminJson({ ok: false, error: "This installer account is not active." }, 403);
  if (code === "INSTALLER_ONLY") return adminJson({ ok: false, error: "Team operations are available to installer accounts only." }, 403);
  if (code === "OWNER_REQUIRED") return adminJson({ ok: false, error: "Only the business owner can manage team accounts." }, 403);
  if (code === "DISPATCH_REQUIRED") return adminJson({ ok: false, error: "Your team role does not allow dispatch changes." }, 403);
  if (code === "JOB_NOT_ASSIGNED") return adminJson({ ok: false, error: "This job is not assigned to your team account." }, 403);
  if (code === "JOB_NOT_FOUND") return adminJson({ ok: false, error: "Job record not found." }, 404);
  if (code === "MEMBER_NOT_FOUND") return adminJson({ ok: false, error: "Team member not found." }, 404);
  if (code === "TEAM_LIMIT_REACHED") return adminJson({ ok: false, error: "This workspace has reached its 50 member team limit." }, 409);
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

async function teamPayload(access: TeamAccess) {
  const db = getD1();
  const memberRows = access.role === "technician" ? { results: [] as Record<string, unknown>[] } : await db.prepare(`SELECT id, email, display_name, role, status,
      invited_at, accepted_at, last_active_at, updated_at
    FROM trade_team_members WHERE owner_uid = ? ORDER BY status = 'active' DESC, display_name, email`)
    .bind(access.ownerUid).all<Record<string, unknown>>();
  const jobRows = await db.prepare(`SELECT w.id, w.work_number, w.title, w.service_category, w.site_area, w.stage,
      w.priority, w.scheduled_start, w.scheduled_end, w.assignee_member_id, w.assignee_label,
      w.source_type, d.customer_source, c.address_line_1, c.address_line_2, c.suburb,
      c.address_state, c.postcode, w.updated_at
    FROM trade_work_orders w
    LEFT JOIN trade_crm_job_details d ON d.work_order_id = w.id AND d.firebase_uid = w.firebase_uid
    LEFT JOIN trade_crm_customers c ON c.id = d.crm_customer_id AND c.firebase_uid = w.firebase_uid
    WHERE w.firebase_uid = ? AND w.partner_type = 'installer' AND w.record_status = 'active'
      AND (? <> 'technician' OR w.assignee_member_id = ?)
    ORDER BY w.scheduled_start = '', w.scheduled_start, w.priority = 'urgent' DESC, w.updated_at DESC LIMIT 500`)
    .bind(access.ownerUid, access.role, access.memberId).all<Record<string, unknown>>();
  const taskRows = await db.prepare(`SELECT t.id, t.work_order_id, t.title, t.due_at, t.status, t.completed_at
    FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
    WHERE t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'
      AND (? <> 'technician' OR w.assignee_member_id = ?)
    ORDER BY t.status = 'done', t.due_at = '', t.due_at, t.created_at`)
    .bind(access.ownerUid, access.ownerUid, access.role, access.memberId).all<Record<string, unknown>>();
  return {
    access: { businessName: access.businessName, role: access.role, displayName: access.displayName,
      isOwner: access.isOwner, canDispatch: canDispatch(access), canManageTeam: canManageTeam(access) },
    members: memberRows.results.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name,
      role: row.role, status: row.status, invitedAt: row.invited_at, acceptedAt: row.accepted_at,
      lastActiveAt: row.last_active_at, updatedAt: row.updated_at })),
    jobs: jobRows.results.map((row) => {
      const protectedJob = row.source_type === "opportunity" || row.customer_source === "platform_private";
      const address = protectedJob ? "" : [row.address_line_1, row.address_line_2, row.suburb, row.address_state, row.postcode]
        .map((item) => String(item || "").trim()).filter(Boolean).join(", ");
      return { id: row.id, workNumber: row.work_number, title: row.title, serviceCategory: row.service_category,
        siteArea: row.site_area, stage: row.stage, priority: row.priority, scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end, assigneeMemberId: row.assignee_member_id, assigneeLabel: row.assignee_label,
        protectedJob, serviceAddress: address, updatedAt: row.updated_at,
        tasks: taskRows.results.filter((task) => task.work_order_id === row.id).map((task) => ({ id: task.id,
          title: task.title, dueAt: task.due_at, status: task.status, completedAt: task.completed_at })) };
    }),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    const access = await requireInstallerTeamAccess(request);
    return adminJson({ ok: true, ...(await teamPayload(access)) });
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
      await getD1().batch([
        getD1().prepare(`UPDATE trade_team_members SET member_uid = ?, status = 'active', accepted_at = ?,
          last_active_at = ?, updated_at = ? WHERE id = ? AND owner_uid = ?`)
          .bind(identity.uid, now, now, now, invite.team_member_id, invite.owner_uid),
        getD1().prepare("UPDATE trade_team_invites SET consumed_at = ? WHERE id = ? AND consumed_at = ''")
          .bind(now, invite.id),
      ]);
      const access = await requireInstallerTeamAccess(request);
      return adminJson({ ok: true, accepted: true, ...(await teamPayload(access)) });
    }

    const access = await requireInstallerTeamAccess(request);
    if (!canManageTeam(access)) throw new Error("OWNER_REQUIRED");
    if (action !== "invite_member" && action !== "reissue_invite") return adminJson({ ok: false, error: "Unsupported team action." }, 400);
    const db = getD1(); const now = new Date().toISOString();
    let memberId = cleanAdminText(body.memberId, 180);
    let email = cleanAdminText(body.email, 180).toLowerCase();
    let displayName = cleanAdminText(body.displayName, 100);
    let role = cleanAdminText(body.role, 30);
    if (action === "reissue_invite") {
      const existing = await db.prepare(`SELECT id, email, display_name, role, status FROM trade_team_members
        WHERE id = ? AND owner_uid = ?`).bind(memberId, access.ownerUid).first<Record<string, unknown>>();
      if (!existing) throw new Error("MEMBER_NOT_FOUND");
      if (existing.status === "active") return adminJson({ ok: false, error: "This member has already accepted their invitation." }, 409);
      email = String(existing.email); displayName = String(existing.display_name); role = String(existing.role);
    } else {
      if (!EMAIL_PATTERN.test(email) || !displayName || !ROLES.has(role)) return adminJson({ ok: false, error: "Add a valid name, email and team role." }, 400);
      const count = await db.prepare("SELECT COUNT(*) count FROM trade_team_members WHERE owner_uid = ? AND status <> 'removed'")
        .bind(access.ownerUid).first<Record<string, unknown>>();
      if (Number(count?.count || 0) >= TEAM_LIMIT) throw new Error("TEAM_LIMIT_REACHED");
      const existing = await db.prepare("SELECT id, status FROM trade_team_members WHERE owner_uid = ? AND email = ?")
        .bind(access.ownerUid, email).first<Record<string, unknown>>();
      if (existing?.status === "active") return adminJson({ ok: false, error: "That email is already an active team member." }, 409);
      memberId = existing ? String(existing.id) : crypto.randomUUID();
      await db.prepare(`INSERT INTO trade_team_members
        (id, owner_uid, member_uid, email, display_name, role, status, invited_at, accepted_at, last_active_at, created_at, updated_at)
        VALUES (?, ?, '', ?, ?, ?, 'invited', ?, '', '', ?, ?)
        ON CONFLICT(owner_uid, email) DO UPDATE SET display_name = excluded.display_name, role = excluded.role,
          status = 'invited', member_uid = '', invited_at = excluded.invited_at, accepted_at = '', updated_at = excluded.updated_at`)
        .bind(memberId, access.ownerUid, email, displayName, role, now, now, now).run();
    }
    await db.prepare("DELETE FROM trade_team_invites WHERE team_member_id = ? AND consumed_at = ''").bind(memberId).run();
    const tokenBytes = new Uint8Array(32); crypto.getRandomValues(tokenBytes); const token = base64Url(tokenBytes);
    await db.prepare(`INSERT INTO trade_team_invites
      (id, team_member_id, owner_uid, token_hash, expires_at, consumed_at, created_at)
      VALUES (?, ?, ?, ?, ?, '', ?)`)
      .bind(crypto.randomUUID(), memberId, access.ownerUid, await tokenHash(token),
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), now).run();
    const inviteUrl = new URL("/direct-trade/team", request.url); inviteUrl.searchParams.set("invite", token);
    return adminJson({ ok: true, invite: { memberId, email, displayName, role, inviteUrl: inviteUrl.toString(), expiresInDays: 7 },
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
      const memberId = cleanAdminText(body.memberId, 180); const role = cleanAdminText(body.role, 30);
      const status = cleanAdminText(body.status, 20);
      if (!ROLES.has(role) || !MEMBER_STATUSES.has(status)) return adminJson({ ok: false, error: "Choose a valid role and account status." }, 400);
      const current = await db.prepare(`SELECT member_uid FROM trade_team_members WHERE id = ? AND owner_uid = ?`)
        .bind(memberId, access.ownerUid).first<Record<string, unknown>>();
      if (!current) throw new Error("MEMBER_NOT_FOUND");
      if (status === "active" && !String(current.member_uid || "")) {
        return adminJson({ ok: false, error: "This person must accept their secure invitation before the account can be activated." }, 409);
      }
      const result = await db.prepare(`UPDATE trade_team_members SET role = ?, status = ?, updated_at = ?
        WHERE id = ? AND owner_uid = ?`).bind(role, status, now, memberId, access.ownerUid).run();
      if (!result.meta.changes) throw new Error("MEMBER_NOT_FOUND");
    } else if (action === "assign_job") {
      if (!canDispatch(access)) throw new Error("DISPATCH_REQUIRED");
      const workOrderId = cleanAdminText(body.workOrderId, 180); const memberId = cleanAdminText(body.memberId, 180);
      await assignedJob(access, workOrderId);
      let label = "";
      if (memberId) {
        const member = await db.prepare(`SELECT display_name FROM trade_team_members
          WHERE id = ? AND owner_uid = ? AND status = 'active'`).bind(memberId, access.ownerUid).first<Record<string, unknown>>();
        if (!member) throw new Error("MEMBER_NOT_FOUND"); label = String(member.display_name);
      }
      await db.batch([
        db.prepare("UPDATE trade_work_orders SET assignee_member_id = ?, assignee_label = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
          .bind(memberId, label, now, workOrderId, access.ownerUid),
        db.prepare(`INSERT INTO trade_work_order_events (id, work_order_id, firebase_uid, event_type, summary, created_at)
          VALUES (?, ?, ?, 'team_assignment', ?, ?)`)
          .bind(crypto.randomUUID(), workOrderId, access.ownerUid, memberId ? `Assigned to ${label}.` : "Team assignment cleared.", now),
      ]);
    } else if (action === "update_job") {
      const workOrderId = cleanAdminText(body.workOrderId, 180); await assignedJob(access, workOrderId);
      const stage = cleanAdminText(body.stage, 30);
      if (!WORK_STAGES.has(stage)) return adminJson({ ok: false, error: "Choose a valid job stage." }, 400);
      await db.prepare("UPDATE trade_work_orders SET stage = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(stage, now, workOrderId, access.ownerUid).run();
    } else if (action === "update_task") {
      const taskId = cleanAdminText(body.taskId, 180); const status = cleanAdminText(body.status, 20);
      if (!['pending', 'done'].includes(status)) return adminJson({ ok: false, error: "Choose a valid task status." }, 400);
      const task = await db.prepare(`SELECT t.work_order_id FROM trade_work_order_tasks t JOIN trade_work_orders w ON w.id = t.work_order_id
        WHERE t.id = ? AND t.firebase_uid = ? AND w.firebase_uid = ? AND w.record_status = 'active'`)
        .bind(taskId, access.ownerUid, access.ownerUid).first<Record<string, unknown>>();
      if (!task) throw new Error("JOB_NOT_FOUND"); await assignedJob(access, String(task.work_order_id));
      await db.prepare("UPDATE trade_work_order_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND firebase_uid = ?")
        .bind(status, status === "done" ? now : "", now, taskId, access.ownerUid).run();
    } else return adminJson({ ok: false, error: "Unsupported team update." }, 400);
    return adminJson({ ok: true, ...(await teamPayload(access)) });
  } catch (error) { return errorResponse(error); }
}
