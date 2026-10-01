/** An appointment is the durable assignment for a visit; the scalar assignee is the job lead. */
export const COLLABORATING_VISIT_STATUSES = ["scheduled", "en_route", "arrived", "in_progress", "completed"] as const;
export const ACTIVE_VISIT_STATUSES = ["scheduled", "en_route", "arrived", "in_progress"] as const;

/** Static SQL only. The default member expression consumes exactly one binding. */
export function jobMemberSql(jobAlias: string, memberExpression = "?") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(jobAlias)
    || (memberExpression !== "?" && !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(memberExpression))) {
    throw new Error("Static job and member SQL references are required.");
  }
  return `${memberExpression} IN (
    SELECT ${jobAlias}.assignee_member_id
    UNION SELECT collaborating_visit.assignee_member_id FROM trade_crm_appointments collaborating_visit
      WHERE collaborating_visit.work_order_id = ${jobAlias}.id
        AND collaborating_visit.firebase_uid = ${jobAlias}.firebase_uid
        AND collaborating_visit.assignee_member_id <> ''
        AND collaborating_visit.status IN ('scheduled', 'en_route', 'arrived', 'in_progress', 'completed')
    UNION SELECT crew.lead_member_id FROM trade_crews crew
      JOIN trade_crew_members lead_membership ON lead_membership.owner_uid=crew.owner_uid
        AND lead_membership.crew_id=crew.id AND lead_membership.member_id=crew.lead_member_id
      JOIN trade_team_members crew_lead ON crew_lead.owner_uid=crew.owner_uid
        AND crew_lead.id=crew.lead_member_id AND crew_lead.status='active'
      JOIN trade_crew_members crew_person ON crew_person.owner_uid=crew.owner_uid AND crew_person.crew_id=crew.id
      JOIN trade_team_members crew_worker ON crew_worker.owner_uid=crew_person.owner_uid
        AND crew_worker.id=crew_person.member_id AND crew_worker.status='active'
      WHERE crew.owner_uid=${jobAlias}.firebase_uid AND crew_person.member_id IN (
        SELECT ${jobAlias}.assignee_member_id
        UNION SELECT crew_visit.assignee_member_id FROM trade_crm_appointments crew_visit
          WHERE crew_visit.work_order_id=${jobAlias}.id AND crew_visit.firebase_uid=${jobAlias}.firebase_uid
            AND crew_visit.status IN ('scheduled','en_route','arrived','in_progress','completed')
      )
  )`;
}

export async function isJobMember(db: D1Database, ownerUid: string, workOrderId: string, memberId: string) {
  if (!memberId) return false;
  const row = await db.prepare(`SELECT 1 assigned FROM trade_work_orders collaboration_job
    WHERE collaboration_job.id = ? AND collaboration_job.firebase_uid = ?
      AND collaboration_job.record_status = 'active' AND ${jobMemberSql("collaboration_job")}`)
    .bind(workOrderId, ownerUid, memberId).first<{ assigned: number }>();
  return Boolean(row?.assigned);
}
