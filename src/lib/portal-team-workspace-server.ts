import { getD1 } from "../../db";
import { requireAdminIdentity } from "./admin-server";
import { requireComplianceAccess } from "./compliance-access-server";
import {
  PortalTeamError, portalDueDate, portalIdentifier, portalRequestId, portalText,
  type PortalWorkspace, type PortalPeople, type PortalMessageList, type PortalTask, type PortalTaskList,
} from "./portal-team-workspace";

export type PortalTeamAccess = { workspace: PortalWorkspace; scopeId: string; memberId: string; uid: string };
type MemberRow = { id: string; uid: string; name: string; role: string; scope_id: string };
type MessageRow = { id: string; body: string; sender_id: string; sender_name: string; recipient_id: string; created_at: string };
type TaskRow = {
  id: string; title: string; detail: string; assignee_id: string; assignee_name: string; creator_id: string;
  creator_name: string; status: "open" | "done"; due_on: string; created_at: string; updated_at: string;
  completed_at: string; revision: number; can_edit: number;
};
const manager = "actor.role IN ('owner','admin')";
const editable = `(${manager} OR t.creator_id=actor.id)`;
const visible = `(${editable} OR t.assignee_id=actor.id)`;

export async function requirePortalTeamAccess(request: Request, workspace: PortalWorkspace): Promise<PortalTeamAccess> {
  if (workspace === "admin") {
    const actor = await requireAdminIdentity(request);
    return { workspace, scopeId: "platform", memberId: actor.adminId, uid: actor.uid };
  }
  const actor = await requireComplianceAccess(request, { claimPendingInvitation: false });
  return { workspace, scopeId: actor.organisationId, memberId: actor.membershipId, uid: actor.uid };
}

// This CTE deliberately uses the portal's own memberships, never trade-business identity.
// Every query repeats active membership and organisation checks, including the mutation itself.
function members(access: PortalTeamAccess) {
  return access.workspace === "admin"
    ? `WITH members AS (SELECT id,firebase_uid uid,display_name name,role,'platform' scope_id FROM admin_users
        WHERE status='active' AND role IN ('owner','admin','reviewer','support') AND firebase_uid<>'' AND firebase_uid NOT LIKE 'pending:%')`
    : `WITH members AS (SELECT m.id,m.firebase_uid uid,m.display_name name,m.role,m.organisation_id scope_id
        FROM compliance_users m JOIN compliance_organisations o ON o.id=m.organisation_id AND o.status='active'
        WHERE m.status='active' AND m.role IN ('admin','case_manager','reviewer','auditor') AND m.firebase_uid<>'' AND m.firebase_uid NOT LIKE 'pending:%')`;
}
function actorJoin() { return "JOIN members actor ON actor.id=? AND actor.uid=? AND actor.scope_id=?"; }
function actorBindings(access: PortalTeamAccess) { return [access.memberId, access.uid, access.scopeId]; }
async function currentActor(access: PortalTeamAccess, db: D1Database) {
  const actor = await db.prepare(`${members(access)} SELECT * FROM members WHERE id=? AND uid=? AND scope_id=?`)
    .bind(...actorBindings(access)).first<MemberRow>();
  if (!actor) throw new PortalTeamError(403, "Your workspace access changed. Refresh before continuing.");
  return actor;
}
export async function portalPeople(access: PortalTeamAccess, search: string, db: D1Database = getD1()): Promise<PortalPeople> {
  const actor = await currentActor(access, db); const query = portalText(search, 100);
  const rows = await db.prepare(`${members(access)} SELECT person.id,person.name,person.role FROM members person ${actorJoin()}
    WHERE person.scope_id=actor.scope_id AND (?='' OR instr(lower(person.name),lower(?))>0)
    ORDER BY person.id=actor.id DESC,person.name,person.id LIMIT 31`).bind(...actorBindings(access), query, query).all<{ id: string; name: string; role: string }>();
  return { people: rows.results.slice(0, 30), hasMore: rows.results.length > 30, memberId: actor.id, canViewTeam: ["owner", "admin"].includes(actor.role) };
}

function messageCursor(value: string) {
  if (!value) return { createdAt: "", id: "" };
  const delimiter = value.indexOf("|"); const createdAt = value.slice(0, delimiter); const id = value.slice(delimiter + 1);
  if (delimiter < 0 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) {
    throw new PortalTeamError(400, "Refresh the conversation to load its history.");
  }
  return { createdAt, id: portalRequestId(id) };
}
export async function portalMessages(access: PortalTeamAccess, peerId: string, before = "", db: D1Database = getD1()): Promise<PortalMessageList> {
  await currentActor(access, db); const peer = portalIdentifier(peerId); const cursor = messageCursor(before);
  const participant = await db.prepare(`${members(access)} SELECT person.id FROM members person ${actorJoin()}
    WHERE person.id=? AND person.scope_id=actor.scope_id`).bind(...actorBindings(access), peer).first();
  if (!participant || peer === access.memberId) throw new PortalTeamError(404, "This conversation is no longer available.");
  const rows = await db.prepare(`${members(access)} SELECT m.* FROM portal_team_messages m ${actorJoin()}
    JOIN members peer ON peer.id=? AND peer.scope_id=actor.scope_id
    WHERE m.workspace=? AND m.scope_id=actor.scope_id AND
      ((m.sender_id=actor.id AND m.recipient_id=peer.id) OR (m.sender_id=peer.id AND m.recipient_id=actor.id))
      AND (?='' OR m.created_at<? OR (m.created_at=? AND m.id<?))
    ORDER BY m.created_at DESC,m.id DESC LIMIT 51`)
    .bind(...actorBindings(access), peer, access.workspace, cursor.createdAt, cursor.createdAt, cursor.createdAt, cursor.id).all<MessageRow>();
  const selected = rows.results.slice(0, 50); const oldest = selected.at(-1);
  return { memberId: access.memberId, hasMore: rows.results.length > 50, before: oldest ? `${oldest.created_at}|${oldest.id}` : "",
    messages: selected.reverse().map(row => ({ id: row.id, body: row.body, senderId: row.sender_id, senderName: row.sender_name, recipientId: row.recipient_id, createdAt: row.created_at })) };
}
export async function sendPortalMessage(access: PortalTeamAccess, input: Record<string, unknown>, db: D1Database = getD1()) {
  await currentActor(access, db);
  const id = portalRequestId(input.id); const recipient = portalIdentifier(input.recipientId); const body = portalText(input.body, 4000, true);
  if (recipient === access.memberId) throw new PortalTeamError(400, "Choose a teammate to message.");
  const now = new Date().toISOString();
  await db.prepare(`${members(access)} INSERT INTO portal_team_messages(id,workspace,scope_id,sender_id,recipient_id,sender_uid,sender_name,body,created_at)
    SELECT ?,?,actor.scope_id,actor.id,person.id,actor.uid,actor.name,?,? FROM members person ${actorJoin()}
    WHERE person.id=? AND person.scope_id=actor.scope_id ON CONFLICT(id) DO NOTHING`)
    .bind(id, access.workspace, body, now, ...actorBindings(access), recipient).run();
  const row = await db.prepare(`${members(access)} SELECT m.* FROM portal_team_messages m ${actorJoin()}
    JOIN members peer ON peer.id=m.recipient_id AND peer.scope_id=actor.scope_id
    WHERE m.id=? AND m.workspace=? AND m.scope_id=actor.scope_id AND m.sender_id=actor.id AND m.sender_uid=actor.uid`)
    .bind(...actorBindings(access), id, access.workspace).first<MessageRow>();
  if (!row) throw new PortalTeamError(403, "The recipient or your workspace access changed. Refresh before sending.");
  if (row.body !== body || row.recipient_id !== recipient) throw new PortalTeamError(409, "This message was already sent with different details. Refresh the conversation.");
  return { id: row.id, createdAt: row.created_at };
}

function taskFrom() {
  return `FROM portal_team_tasks t ${actorJoin()} LEFT JOIN members assignee ON assignee.id=t.assignee_id AND assignee.scope_id=t.scope_id`;
}
const taskSelection = `t.*,COALESCE(assignee.name,'Unavailable team member') assignee_name,${editable} can_edit`;
function projectTask(row: TaskRow): PortalTask {
  return { id: row.id, title: row.title, detail: row.detail, assigneeId: row.assignee_id, assigneeName: row.assignee_name,
    creatorId: row.creator_id, creatorName: row.creator_name, status: row.status, dueOn: row.due_on,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, revision: row.revision, canEdit: Boolean(row.can_edit) };
}
async function currentTask(access: PortalTeamAccess, id: string, db: D1Database) {
  const task = await db.prepare(`${members(access)} SELECT ${taskSelection} ${taskFrom()}
    WHERE t.id=? AND t.workspace=? AND t.scope_id=actor.scope_id AND ${visible}`)
    .bind(...actorBindings(access), id, access.workspace).first<TaskRow>();
  if (!task) throw new PortalTeamError(404, "This task is no longer available to you.");
  return task;
}
export async function portalTasks(access: PortalTeamAccess, options: { view?: string; status?: string; page?: string }, db: D1Database = getD1()): Promise<PortalTaskList> {
  const actor = await currentActor(access, db); const canViewTeam = ["owner", "admin"].includes(actor.role);
  const view = options.view || "mine"; const status = options.status || "open"; const requestedPage = Number(options.page || "1");
  if (!["mine", "assigned", "team"].includes(view) || !["open", "done", "all"].includes(status)
    || !Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 100000) throw new PortalTeamError(400, "Choose a valid task view.");
  if (view === "team" && !canViewTeam) throw new PortalTeamError(403, "Only workspace administrators can view all team tasks.");
  const filter = `t.workspace=? AND t.scope_id=actor.scope_id AND ${visible} AND
    (?='all' OR t.status=?) AND ((?='mine' AND t.assignee_id=actor.id) OR (?='assigned' AND t.creator_id=actor.id) OR (?='team' AND ${manager}))`;
  const bindings = [...actorBindings(access), access.workspace, status, status, view, view, view];
  const count = await db.prepare(`${members(access)} SELECT count(*) total ${taskFrom()} WHERE ${filter}`).bind(...bindings).first<{ total: number }>();
  const total = Number(count?.total || 0); const totalPages = Math.max(1, Math.ceil(total / 25)); const page = Math.min(requestedPage, totalPages);
  const rows = await db.prepare(`${members(access)} SELECT ${taskSelection} ${taskFrom()} WHERE ${filter}
    ORDER BY t.status,t.due_on='',t.due_on,t.created_at DESC,t.id LIMIT 25 OFFSET ?`).bind(...bindings, (page - 1) * 25).all<TaskRow>();
  return { tasks: rows.results.map(projectTask), page, totalPages, total, canViewTeam };
}
function taskAudit(db: D1Database, access: PortalTeamAccess, id: string, action: string, now: string) {
  return db.prepare(`INSERT INTO portal_team_events(id,workspace,scope_id,actor_id,actor_uid,entity_id,action,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(), access.workspace, access.scopeId, access.memberId, access.uid, id, action, now);
}
export async function savePortalTask(access: PortalTeamAccess, input: Record<string, unknown>, db: D1Database = getD1()) {
  await currentActor(access, db); const id = portalRequestId(input.id); const now = new Date().toISOString();
  if (input.action === "create_task") {
    const title = portalText(input.title, 180, true); const detail = portalText(input.detail ?? "", 3000);
    const assigneeId = portalIdentifier(input.assigneeId); const dueOn = portalDueDate(input.dueOn);
    const result = await db.batch([
      db.prepare(`${members(access)} INSERT INTO portal_team_tasks(id,workspace,scope_id,title,detail,assignee_id,creator_id,creator_uid,creator_name,due_on,created_at,updated_at)
        SELECT ?,?,actor.scope_id,?,?,person.id,actor.id,actor.uid,actor.name,?,?,? FROM members person ${actorJoin()}
        WHERE person.id=? AND person.scope_id=actor.scope_id ON CONFLICT(id) DO NOTHING`)
        .bind(id, access.workspace, title, detail, dueOn, now, now, ...actorBindings(access), assigneeId),
      taskAudit(db, access, id, "task.created", now),
    ]);
    const task = await currentTask(access, id, db);
    if (!result[0].meta.changes && (task.creator_id !== access.memberId || task.title !== title || task.detail !== detail || task.assignee_id !== assigneeId || task.due_on !== dueOn)) {
      throw new PortalTeamError(409, "This task was already saved with different details. Refresh the task list.");
    }
    return projectTask(task);
  }
  if (input.action !== "edit_task" && input.action !== "task_status") throw new PortalTeamError(400, "Choose a task action.");
  const previous = await currentTask(access, id, db);
  if (!Number.isInteger(input.revision) || input.revision !== previous.revision) throw new PortalTeamError(409, "This task changed. Refresh before saving.");
  const edit = input.action === "edit_task";
  if (edit && !previous.can_edit) throw new PortalTeamError(403, "Only the task creator or a workspace administrator can edit or reassign this task.");
  if (!edit && input.status !== "open" && input.status !== "done") throw new PortalTeamError(400, "Choose open or done.");
  const title = edit ? portalText(input.title, 180, true) : previous.title;
  const detail = edit ? portalText(input.detail ?? "", 3000) : previous.detail;
  const assignee = edit ? portalIdentifier(input.assigneeId) : previous.assignee_id;
  const dueOn = edit ? portalDueDate(input.dueOn) : previous.due_on;
  const status = edit ? previous.status : input.status;
  const result = await db.batch([
    db.prepare(`${members(access)} UPDATE portal_team_tasks SET title=?,detail=?,assignee_id=?,due_on=?,status=?,completed_at=?,updated_at=?,revision=revision+1
      WHERE id=? AND workspace=? AND scope_id=? AND revision=? AND EXISTS (
        SELECT 1 ${taskFrom()} JOIN members target ON target.id=? AND target.scope_id=t.scope_id
        WHERE t.id=portal_team_tasks.id AND t.workspace=portal_team_tasks.workspace AND t.scope_id=actor.scope_id AND ${visible}
        AND (?=0 OR ${editable}))`)
      .bind(title, detail, assignee, dueOn, status, status === "done" ? previous.completed_at || now : "", now,
        id, access.workspace, access.scopeId, previous.revision, ...actorBindings(access), assignee, edit ? 1 : 0),
    taskAudit(db, access, id, edit ? "task.edited" : status === "done" ? "task.completed" : "task.reopened", now),
  ]);
  if (!result[0].meta.changes) throw new PortalTeamError(409, "The task or team access changed. Refresh before saving.");
  return { id, revision: previous.revision + 1 };
}
