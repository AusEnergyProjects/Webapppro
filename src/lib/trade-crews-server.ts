import { getD1 } from "../../db";
import type { TeamAccess } from "./trade-team-server";
import { jobMemberSql } from "./trade-job-collaboration";

export class TradeCrewError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type CrewIdentity = Pick<TeamAccess, "ownerUid" | "memberId" | "isOwner">;
export async function readTradeCrewScope(access: CrewIdentity, db: D1Database = getD1()): Promise<{ crewId: string; isLead: boolean } | null> {
  if (access.isOwner) return null;
  const row = await db.prepare(`SELECT c.id crew_id, c.lead_member_id
    FROM trade_crew_members membership JOIN trade_crews c ON c.id=membership.crew_id AND c.owner_uid=membership.owner_uid
    JOIN trade_team_members actor ON actor.id=membership.member_id AND actor.owner_uid=membership.owner_uid AND actor.status='active'
    WHERE membership.owner_uid=? AND membership.member_id=?`)
    .bind(access.ownerUid, access.memberId).first<{ crew_id: string; lead_member_id: string }>();
  return row ? { crewId: row.crew_id, isLead: row.lead_member_id === access.memberId } : null;
}

export async function readTradeCrewMemberIds(access: CrewIdentity, db: D1Database = getD1()): Promise<string[]> {
  const scope = await readTradeCrewScope(access, db);
  if (!scope) return [];
  if (!scope.isLead) return [access.memberId];
  const rows = await db.prepare(`SELECT membership.member_id FROM trade_crew_members membership
    JOIN trade_team_members member ON member.id=membership.member_id AND member.owner_uid=membership.owner_uid AND member.status='active'
    WHERE membership.owner_uid=? AND membership.crew_id=? ORDER BY membership.member_id`)
    .bind(access.ownerUid, scope.crewId).all<{ member_id: string }>();
  return rows.results.map(row => row.member_id);
}

export async function applyTradeCrewAccess(access: TeamAccess, db: D1Database = getD1()): Promise<TeamAccess> {
  const scope = await readTradeCrewScope(access, db);
  if (!scope) return access;
  return { ...access, crewId: scope.crewId, crewLead: scope.isLead,
    crewMemberIds: await readTradeCrewMemberIds(access, db), jobScope: "own", scheduleScope: "own",
    canCreateJobs: false,
    canAssignJobs: scope.isLead && access.canAssignJobs,
    canRescheduleJobs: scope.isLead && access.canRescheduleJobs,
    canManageTeam: false, canEditTeamPermissions: false,
    canViewCustomers: false, canManageCustomers: false, canSearchCustomers: false,
    canViewQuotes: false, canManageQuotes: false, canSendQuotes: false,
    canViewInvoices: false, canManageInvoices: false, canViewPriceBook: false, canManagePriceBook: false,
    canApplyDiscounts: false, canSendSms: false,
  };
}

export async function listTradeCrews(access: TeamAccess, db: D1Database = getD1()) {
  const scope = await readTradeCrewScope(access, db);
  if (!access.isOwner && !scope) throw new TradeCrewError(403, "Crew access is required.");
  const rows = await db.prepare(`SELECT id,name,company_name,lead_member_id,revision FROM trade_crews
    WHERE owner_uid=? AND (?=1 OR id=?) ORDER BY name,id`)
    .bind(access.ownerUid, access.isOwner ? 1 : 0, scope?.crewId || "").all<{
      id: string; name: string; company_name: string; lead_member_id: string; revision: number;
    }>();
  const members = await db.prepare(`SELECT member.id,member.display_name,member.status,COALESCE(membership.crew_id,'') crew_id
    FROM trade_team_members member LEFT JOIN trade_crew_members membership ON membership.member_id=member.id AND membership.owner_uid=member.owner_uid
    WHERE member.owner_uid=? AND member.member_uid<>member.owner_uid AND member.status<>'archived'
      AND (?=1 OR membership.crew_id=?) ORDER BY member.display_name,member.id`)
    .bind(access.ownerUid, access.isOwner ? 1 : 0, scope?.crewId || "").all<{ id: string; display_name: string; status: string; crew_id: string }>();
  return { isOwner: access.isOwner, crews: rows.results.map(row => ({ id: row.id, name: row.name, companyName: row.company_name,
    leadMemberId: row.lead_member_id, revision: row.revision,
    memberIds: members.results.filter(member => member.crew_id === row.id).map(member => member.id) })),
    members: members.results.map(row => ({ id: row.id, displayName: row.display_name, status: row.status, crewId: row.crew_id })) };
}

function textInput(value: unknown, maximum: number) {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new TradeCrewError(400, "Check the crew details.");
  return value.trim();
}

export async function saveTradeCrew(access: TeamAccess, input: Record<string, unknown>, db: D1Database = getD1()) {
  if (!access.isOwner) throw new TradeCrewError(403, "Only the business owner can change crews.");
  const id = input.id ? textInput(input.id, 128) : crypto.randomUUID();
  const name = textInput(input.name, 120);
  const companyName = textInput(input.companyName ?? "", 180);
  const leadMemberId = textInput(input.leadMemberId, 128);
  if (!name || !leadMemberId || !Array.isArray(input.memberIds) || input.memberIds.length > 200) throw new TradeCrewError(400, "Choose a crew name, lead and members.");
  const memberIds = [...new Set(input.memberIds.map(value => textInput(value, 128)))];
  if (!memberIds.includes(leadMemberId) || memberIds.some(value => !value)) throw new TradeCrewError(400, "The crew lead must be included in the crew.");
  const previous = await db.prepare("SELECT revision,lead_member_id FROM trade_crews WHERE owner_uid=? AND id=?")
    .bind(access.ownerUid, id).first<{ revision: number; lead_member_id: string }>();
  if ((Boolean(input.id) && !previous) || (previous && input.revision !== previous.revision)) throw new TradeCrewError(409, "This crew changed. Refresh and try again.");
  const people = await db.prepare(`SELECT member.id,member.status,member.member_uid,COALESCE(membership.crew_id,'') crew_id
    FROM trade_team_members member LEFT JOIN trade_crew_members membership ON membership.owner_uid=member.owner_uid AND membership.member_id=member.id
    WHERE member.owner_uid=? AND member.id IN (SELECT value FROM json_each(?))`)
    .bind(access.ownerUid, JSON.stringify(memberIds)).all<{ id: string; status: string; member_uid: string; crew_id: string }>();
  if (people.results.length !== memberIds.length || people.results.some(row => row.status !== "active" || row.member_uid === access.ownerUid || (row.crew_id && row.crew_id !== id))) {
    throw new TradeCrewError(400, "Choose active people from this business who are not in another crew.");
  }
  const oldMembers = await db.prepare("SELECT member_id FROM trade_crew_members WHERE owner_uid=? AND crew_id=?")
    .bind(access.ownerUid, id).all<{ member_id: string }>();
  const affected = [...new Set([...memberIds, ...oldMembers.results.map(row => row.member_id)])];
  const now = new Date().toISOString(); const revision = (previous?.revision || 0) + 1;
  const guard = "EXISTS (SELECT 1 FROM trade_crews WHERE id=? AND owner_uid=? AND revision=? AND updated_at=?)";
  const guardValues = [id, access.ownerUid, revision, now];
  const statements = [previous
    ? db.prepare("UPDATE trade_crews SET name=?,company_name=?,lead_member_id=?,revision=?,updated_at=? WHERE id=? AND owner_uid=? AND revision=?")
      .bind(name, companyName, leadMemberId, revision, now, id, access.ownerUid, previous.revision)
    : db.prepare("INSERT INTO trade_crews (id,owner_uid,name,company_name,lead_member_id,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, access.ownerUid, name, companyName, leadMemberId, revision, now, now),
    // Check this statement's write, not a timestamp another concurrent save can share.
    db.prepare(`INSERT INTO trade_crews (id,owner_uid,name,lead_member_id,revision,created_at,updated_at)
      SELECT NULL,?,'',?,0,?,? WHERE changes()<>1`).bind(access.ownerUid, leadMemberId, now, now),
    db.prepare(`DELETE FROM trade_crew_members WHERE owner_uid=? AND crew_id=? AND ${guard}`).bind(access.ownerUid, id, ...guardValues),
    ...memberIds.map(memberId => db.prepare(`INSERT INTO trade_crew_members (owner_uid,crew_id,member_id,created_at) SELECT ?,?,?,? WHERE ${guard}`)
      .bind(access.ownerUid, id, memberId, now, ...guardValues)),
    // Membership is a restriction. Removing it must never restore previously broad scopes.
    db.prepare(`UPDATE trade_team_members SET job_scope='own',schedule_scope='own',can_create_jobs=0,can_manage_team=0,can_edit_team_permissions=0,
      can_view_customers=0,can_manage_customers=0,can_search_customers=0,can_view_quotes=0,can_manage_quotes=0,can_send_quotes=0,
      can_view_invoices=0,can_manage_invoices=0,can_view_price_book=0,can_manage_price_book=0,can_apply_discounts=0,can_send_sms=0,updated_at=?
      WHERE owner_uid=? AND id IN (SELECT value FROM json_each(?)) AND ${guard}`)
      .bind(now, access.ownerUid, JSON.stringify(memberIds), ...guardValues),
    db.prepare(`INSERT INTO trade_team_member_events (id,owner_uid,team_member_id,actor_uid,entity_type,entity_id,event_type,metadata,created_at)
      SELECT ? || ':' || value,?,value,?,'member',value,'member.crew_changed',?,? FROM json_each(?) WHERE ${guard}`)
      .bind(crypto.randomUUID(), access.ownerUid, access.actorUid, JSON.stringify({ crewId: id, name, companyName, leadMemberId, memberIds, revision }), now, JSON.stringify(affected), ...guardValues),
    // Send explicit removals as well as additions so existing offline caches converge after every membership change.
    db.prepare(`INSERT INTO trade_team_sync_changes (owner_uid,audience_member_id,entity_type,entity_id,operation,revision,changed_at)
      SELECT ?,audience.value,'job',w.id,CASE WHEN w.record_status='active' AND ${jobMemberSql("w", "audience.value")} THEN 'upsert' ELSE 'delete' END,w.revision,?
      FROM trade_work_orders w CROSS JOIN json_each(?) audience WHERE w.firebase_uid=? AND ${guard}`)
      .bind(access.ownerUid, now, JSON.stringify(affected), access.ownerUid, ...guardValues),
    db.prepare(`INSERT INTO trade_crews (id,owner_uid,name,lead_member_id,revision,created_at,updated_at)
      SELECT NULL,?,'',?,0,?,? WHERE NOT (${guard})`).bind(access.ownerUid, leadMemberId, now, now, ...guardValues),
  ];
  try { await db.batch(statements); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/constraint|CREW_|UNIQUE|FOREIGN KEY|NOT NULL/i.test(message)) throw new TradeCrewError(409, "The crew or its members changed. Refresh and try again.");
    throw error;
  }
  return { id, revision };
}
