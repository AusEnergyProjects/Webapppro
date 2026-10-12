import type { TeamAccess } from "./trade-team-server";
import { verifiedTradeAccountPredicate } from "./trade-access-server";

export type TradeLeadAction = "view" | "manage" | "public_quote" | "quote_products" | "lead_email" | "quote" | "arrival" | "conversion";

/** Recheck the current selected business and actual actor after any asynchronous work. */
function authority(access: TeamAccess, action: TradeLeadAction) {
  if (access.fieldSessionId || access.crewId) return { sql: "0", values: [] as string[] };
  const permissions = ["lead_actor.can_view_leads = 1"];
  if (action !== "view") permissions.push("lead_actor.can_manage_leads = 1");
  if (action === "public_quote" || action === "conversion") {
    permissions.push("lead_actor.can_create_jobs = 1", "lead_actor.job_scope = 'team'");
  }
  if (action === "public_quote" || action === "quote_products" || action === "quote") {
    permissions.push("lead_actor.can_view_quotes = 1", "lead_actor.can_manage_quotes = 1");
  }
  if (action === "lead_email") permissions.push("lead_actor.can_view_customers = 1",
    "(lead_actor.can_manage_customers = 1 OR lead_actor.can_manage_jobs = 1 OR lead_actor.can_send_quotes = 1 OR lead_actor.can_manage_invoices = 1)");
  if (action === "quote") permissions.push("lead_actor.can_send_quotes = 1");
  if (action === "arrival") permissions.push("lead_actor.can_manage_jobs = 1",
    "lead_actor.job_scope = 'team'", "lead_actor.schedule_scope = 'team'");
  return {
    sql: `EXISTS (SELECT 1 FROM trade_accounts lead_business
      WHERE lead_business.firebase_uid = ? AND lead_business.partner_type = 'installer'
        AND ${verifiedTradeAccountPredicate("lead_business")})
      AND EXISTS (SELECT 1 FROM trade_team_members lead_actor
        WHERE lead_actor.id = ? AND lead_actor.owner_uid = ? AND lead_actor.member_uid = ?
          AND lead_actor.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM trade_crew_members lead_crew
            WHERE lead_crew.owner_uid = lead_actor.owner_uid AND lead_crew.member_id = lead_actor.id)
          AND (lead_actor.member_uid = lead_actor.owner_uid OR (${permissions.join(" AND ")})))`,
    values: [access.ownerUid, access.memberId, access.ownerUid, access.actorUid],
  };
}

export async function currentTradeLeadAccess(db: D1Database, access: TeamAccess, action: TradeLeadAction = "view") {
  const guard = authority(access, action);
  const row = await db.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END allowed`)
    .bind(...guard.values).first<{ allowed: number }>();
  return row?.allowed === 1;
}

export function tradeLeadMutationGuard(db: D1Database, access: TeamAccess, action: TradeLeadAction) {
  const guard = authority(access, action);
  // The established write-guard CHECK rolls back the whole D1 batch on revocation.
  return db.prepare(`INSERT INTO trade_crm_write_guards
    (id, firebase_uid, operation_id, step_number, verified, created_at)
    VALUES (?, ?, ?, 1, CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END, ?)`)
    .bind(crypto.randomUUID(), access.ownerUid, `tlink-lead:${action}:${crypto.randomUUID()}`,
      ...guard.values, new Date().toISOString());
}

export async function guardedTradeLeadMutationBatch<T = unknown>(db: D1Database, access: TeamAccess,
  action: TradeLeadAction, statements: D1PreparedStatement[]) {
  const results = await db.batch<T>([tradeLeadMutationGuard(db, access, action), ...statements]);
  return results.slice(1);
}

export function tradeLeadAccessChanged(error: unknown) {
  return error instanceof Error && /trade_crm_write_guard|CHECK constraint failed:\s*verified\s*=\s*1/i.test(error.message);
}
