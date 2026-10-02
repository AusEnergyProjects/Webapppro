import { getD1 } from '../../db';
import type { TeamAccess } from './trade-team-server';
import { BusinessTaskError, taskDueDate, taskStatus, taskText, type BusinessTask, type BusinessTaskList, type TaskPerson } from './trade-business-tasks';

type TaskRow = { id: string; title: string; detail: string; assignee_member_id: string; assignee_name: string; created_by_member_id: string; creator_name: string; status: string; due_on: string; revision: number; created_at: string; updated_at: string; completed_at: string; can_edit: number };

// Live membership, rather than cached permission flags, controls every read and write.
// Ordinary staff see tasks they assign or receive. Crew leads stay within their current crew.
const actorJoin = `JOIN trade_team_members actor ON actor.owner_uid=t.owner_uid AND actor.id=? AND actor.status='active'
  LEFT JOIN trade_crew_members actor_crew ON actor_crew.owner_uid=actor.owner_uid AND actor_crew.member_id=actor.id
  LEFT JOIN trade_crews crew ON crew.owner_uid=actor_crew.owner_uid AND crew.id=actor_crew.crew_id`;
const crewScope = `(actor.member_uid=actor.owner_uid OR actor_crew.crew_id IS NULL OR t.assignee_member_id=actor.id OR
  (crew.lead_member_id=actor.id AND EXISTS (SELECT 1 FROM trade_crew_members target_crew WHERE target_crew.owner_uid=t.owner_uid AND target_crew.crew_id=crew.id AND target_crew.member_id=t.assignee_member_id)))`;
const manager = `(actor.member_uid=actor.owner_uid OR (actor_crew.crew_id IS NULL AND actor.can_manage_team=1) OR crew.lead_member_id=actor.id)`;
const canEdit = `(${manager} OR t.created_by_member_id=actor.id)`;
const visible = `(${manager} OR t.assignee_member_id=actor.id OR t.created_by_member_id=actor.id) AND ${crewScope}`;
const taskFrom = `FROM trade_business_tasks t ${actorJoin}
  JOIN trade_team_members assignee ON assignee.owner_uid=t.owner_uid AND assignee.id=t.assignee_member_id
  JOIN trade_team_members creator ON creator.owner_uid=t.owner_uid AND creator.id=t.created_by_member_id`;
const selection = `t.*,assignee.display_name assignee_name,creator.display_name creator_name,${canEdit} can_edit`;

function project(row: TaskRow): BusinessTask {
  return { id: row.id, title: row.title, detail: row.detail, assigneeMemberId: row.assignee_member_id, assigneeName: row.assignee_name,
    createdByMemberId: row.created_by_member_id, createdByName: row.creator_name, status: taskStatus(row.status), dueOn: row.due_on,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, canEdit: Boolean(row.can_edit) };
}
async function currentTask(access: TeamAccess, id: string, db: D1Database) {
  const row = await db.prepare(`SELECT ${selection} ${taskFrom} WHERE t.owner_uid=? AND t.id=? AND ${visible}`)
    .bind(access.memberId, access.ownerUid, id).first<TaskRow>();
  if (!row) throw new BusinessTaskError(404, 'This task is no longer available to you.');
  return row;
}
export async function taskPeople(access: TeamAccess, search: string, db: D1Database = getD1()): Promise<{ people: TaskPerson[]; hasMore: boolean; memberId: string }> {
  const query = search.trim().slice(0, 100);
  const rows = await db.prepare(`SELECT t.id,t.display_name name FROM trade_team_members t
    JOIN trade_team_members actor ON actor.owner_uid=t.owner_uid AND actor.id=? AND actor.status='active'
    LEFT JOIN trade_crew_members actor_crew ON actor_crew.owner_uid=actor.owner_uid AND actor_crew.member_id=actor.id
    LEFT JOIN trade_crews crew ON crew.owner_uid=actor_crew.owner_uid AND crew.id=actor_crew.crew_id
    WHERE t.owner_uid=? AND t.status='active' AND (actor.member_uid=actor.owner_uid OR actor_crew.crew_id IS NULL OR t.id=actor.id OR
      (crew.lead_member_id=actor.id AND EXISTS (SELECT 1 FROM trade_crew_members target_crew WHERE target_crew.owner_uid=t.owner_uid AND target_crew.crew_id=crew.id AND target_crew.member_id=t.id)))
    AND (?='' OR instr(lower(t.display_name),lower(?))>0) ORDER BY t.id=actor.id DESC,t.display_name,t.id LIMIT 31`)
    .bind(access.memberId, access.ownerUid, query, query).all<TaskPerson>();
  return { people: rows.results.slice(0, 30), hasMore: rows.results.length > 30, memberId: access.memberId };
}
export async function listBusinessTasks(access: TeamAccess, options: { view?: string; status?: string; page?: string }, db: D1Database = getD1()): Promise<BusinessTaskList> {
  const view = options.view || 'mine'; const status = options.status || 'active';
  if (!['mine', 'delegated', 'team'].includes(view) || !['active', 'done', 'all'].includes(status)) throw new BusinessTaskError(400, 'Choose a task view.');
  let page = options.page ? Number(options.page) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new BusinessTaskError(400, 'Choose a valid task page.');
  const permissions = await db.prepare(`SELECT ${manager} allowed FROM trade_team_members actor
    LEFT JOIN trade_crew_members actor_crew ON actor_crew.owner_uid=actor.owner_uid AND actor_crew.member_id=actor.id
    LEFT JOIN trade_crews crew ON crew.owner_uid=actor_crew.owner_uid AND crew.id=actor_crew.crew_id
    WHERE actor.owner_uid=? AND actor.id=? AND actor.status='active'`).bind(access.ownerUid, access.memberId).first<{ allowed: number }>();
  if (!permissions) throw new BusinessTaskError(403, 'Your team access has changed.');
  if (view === 'team' && !permissions.allowed) throw new BusinessTaskError(403, 'Team task access is required.');
  const filter = view === 'mine' ? 't.assignee_member_id=actor.id' : view === 'delegated' ? 't.created_by_member_id=actor.id AND t.assignee_member_id<>actor.id' : manager;
  const state = status === 'active' ? "t.status<>'done'" : status === 'done' ? "t.status='done'" : '1=1';
  const where = `t.owner_uid=? AND ${visible} AND ${filter} AND ${state}`;
  const count = await db.prepare(`SELECT count(*) total ${taskFrom} WHERE ${where}`).bind(access.memberId, access.ownerUid).first<{ total: number }>();
  const totalPages = Math.max(1, Math.ceil((count?.total || 0) / 25));
  page = Math.min(page, totalPages);
  const rows = await db.prepare(`SELECT ${selection} ${taskFrom} WHERE ${where} ORDER BY t.status='done',t.due_on='',t.due_on,t.created_at DESC,t.id LIMIT 25 OFFSET ?`)
    .bind(access.memberId, access.ownerUid, (page - 1) * 25).all<TaskRow>();
  return { tasks: rows.results.map(project), memberId: access.memberId, canViewTeam: Boolean(permissions.allowed), page, total: count?.total || 0, totalPages };
}
function audit(db: D1Database, access: TeamAccess, id: string, event: string, now: string) {
  return db.prepare(`INSERT INTO trade_team_member_events (id,owner_uid,team_member_id,actor_uid,entity_type,entity_id,event_type,metadata,created_at)
    SELECT ?,?,?,?,'business_task',?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(), access.ownerUid, access.memberId, access.actorUid, id, event, '{}', now);
}
export async function saveBusinessTask(access: TeamAccess, input: Record<string, unknown>, db: D1Database = getD1()) {
  const id = taskText(input.id, 128, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new BusinessTaskError(400, 'The task identifier is invalid.');
  const now = new Date().toISOString();
  if (input.action === 'create') {
    const title = taskText(input.title, 180, true); const detail = taskText(input.detail ?? '', 3000);
    const assignee = taskText(input.assigneeMemberId, 128, true); const dueOn = taskDueDate(input.dueOn);
    const result = await db.batch([
      db.prepare(`INSERT INTO trade_business_tasks (id,owner_uid,title,detail,assignee_member_id,created_by_member_id,status,due_on,revision,created_at,updated_at)
        SELECT ?,?,?,?,?,?,'open',?,1,?,? FROM trade_team_members target
        JOIN trade_team_members actor ON actor.owner_uid=target.owner_uid AND actor.id=? AND actor.status='active'
        LEFT JOIN trade_crew_members actor_crew ON actor_crew.owner_uid=actor.owner_uid AND actor_crew.member_id=actor.id
        LEFT JOIN trade_crews crew ON crew.owner_uid=actor_crew.owner_uid AND crew.id=actor_crew.crew_id
        WHERE target.owner_uid=? AND target.id=? AND target.status='active' AND
          (actor.member_uid=actor.owner_uid OR actor_crew.crew_id IS NULL OR target.id=actor.id OR
          (crew.lead_member_id=actor.id AND EXISTS (SELECT 1 FROM trade_crew_members target_crew WHERE target_crew.owner_uid=target.owner_uid AND target_crew.crew_id=crew.id AND target_crew.member_id=target.id)))
        ON CONFLICT(id) DO NOTHING`).bind(id, access.ownerUid, title, detail, assignee, access.memberId, dueOn, now, now, access.memberId, access.ownerUid, assignee),
      audit(db, access, id, 'task.created', now),
    ]);
    const row = await currentTask(access, id, db);
    if (!result[0].meta.changes && (row.created_by_member_id !== access.memberId || row.title !== title || row.detail !== detail || row.assignee_member_id !== assignee || row.due_on !== dueOn)) throw new BusinessTaskError(409, 'This task was already saved with different details. Refresh your list.');
    return project(row);
  }
  const previous = await currentTask(access, id, db);
  if (!Number.isInteger(input.revision) || input.revision !== previous.revision) throw new BusinessTaskError(409, 'This task changed. Refresh before saving.');
  if (input.action !== 'status' && input.action !== 'edit') throw new BusinessTaskError(400, 'Choose a task action.');
  if (input.action === 'edit' && !previous.can_edit) throw new BusinessTaskError(403, 'Only the person who assigned this task or a team manager can edit its details.');
  const status = input.action === 'status' ? taskStatus(input.status) : taskStatus(previous.status);
  const title = input.action === 'edit' ? taskText(input.title, 180, true) : previous.title;
  const detail = input.action === 'edit' ? taskText(input.detail ?? '', 3000) : previous.detail;
  const dueOn = input.action === 'edit' ? taskDueDate(input.dueOn) : previous.due_on;
  const assignee = input.action === 'edit' ? taskText(input.assigneeMemberId, 128, true) : previous.assignee_member_id;
  const targetScope = crewScope.replaceAll('t.assignee_member_id', 'target.id');
  const result = await db.batch([
    db.prepare(`UPDATE trade_business_tasks SET title=?,detail=?,assignee_member_id=?,due_on=?,status=?,completed_at=?,updated_at=?,revision=revision+1
      WHERE owner_uid=? AND id=? AND revision=? AND EXISTS (SELECT 1 ${taskFrom}
        JOIN trade_team_members target ON target.owner_uid=t.owner_uid AND target.id=?
        WHERE t.id=trade_business_tasks.id AND t.owner_uid=trade_business_tasks.owner_uid AND ${visible}
          AND (?='status' OR (${canEdit} AND target.status='active' AND ${targetScope})))`)
      .bind(title, detail, assignee, dueOn, status, status === 'done' ? previous.completed_at || now : '', now, access.ownerUid, id, previous.revision, access.memberId, assignee, input.action),
    audit(db, access, id, `task.${input.action}`, now),
  ]);
  if (!result[0].meta.changes) throw new BusinessTaskError(409, 'The task or team access changed. Refresh before saving.');
  // Reassignment may intentionally remove the actor's access. Do not return the old assignee's data.
  return { id, revision: previous.revision + 1 };
}
