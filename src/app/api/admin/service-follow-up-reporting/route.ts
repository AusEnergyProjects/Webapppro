import { getD1 } from "../../../../../db";
import { adminError, adminJson, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";
import { mergeServiceFollowUpTrends, serviceFollowUpReportFilters } from "@/lib/service-follow-up-reporting";

export const runtime = "edge";

function aggregateRows(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => ({ label: String(row.label || "Unspecified"), total: Number(row.total || 0) }));
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request, ["owner", "admin"]);
    const filters = serviceFollowUpReportFilters(new URL(request.url));
    const db = getD1();
    const today = new Date().toISOString().slice(0, 10);
    const offset = (filters.page - 1) * filters.pageSize;
    const [dueTrend, deliveryTrend, optOutTrend, dueStates, assetCategories, serviceTypes, assignees, assigneeCount] = await Promise.all([
      db.prepare(`SELECT due_at day, COUNT(*) due, SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) ready
        FROM trade_service_follow_ups WHERE due_at >= ? AND due_at <= ?
        GROUP BY due_at ORDER BY due_at LIMIT 367`).bind(filters.start, filters.end).all<Record<string, unknown>>(),
      db.prepare(`SELECT substr(created_at, 1, 10) day,
          SUM(CASE WHEN sent_at != '' THEN 1 ELSE 0 END) sent,
          SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) delivered,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed,
          SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) bounced
        FROM service_reminder_deliveries WHERE created_at >= ? AND created_at < ? AND (? = 'all' OR channel = ?)
        GROUP BY substr(created_at, 1, 10) ORDER BY day LIMIT 367`)
        .bind(filters.startAt, filters.endExclusive, filters.channel, filters.channel).all<Record<string, unknown>>(),
      db.prepare(`SELECT substr(opted_out_at, 1, 10) day, COUNT(*) opted_out
        FROM customer_service_reminder_opt_outs WHERE opted_out_at >= ? AND opted_out_at < ? AND (? = 'all' OR channel = ?)
        GROUP BY substr(opted_out_at, 1, 10) ORDER BY day LIMIT 367`)
        .bind(filters.startAt, filters.endExclusive, filters.channel, filters.channel).all<Record<string, unknown>>(),
      db.prepare(`SELECT CASE WHEN due_at < ? THEN 'overdue' WHEN due_at <= date(?, '+30 days') THEN 'due_soon' ELSE 'upcoming' END label,
          COUNT(*) total FROM trade_service_follow_ups
        WHERE due_at >= ? AND due_at <= ? AND status NOT IN ('completed', 'suppressed')
        GROUP BY label ORDER BY CASE label WHEN 'overdue' THEN 1 WHEN 'due_soon' THEN 2 ELSE 3 END`)
        .bind(today, today, filters.start, filters.end).all<Record<string, unknown>>(),
      db.prepare(`SELECT CASE WHEN asset.asset_category = '' THEN 'Unspecified asset' ELSE asset.asset_category END label, COUNT(*) total
        FROM trade_service_follow_ups follow_up
        JOIN trade_installed_assets asset ON asset.id = follow_up.asset_id AND asset.firebase_uid = follow_up.firebase_uid
        WHERE follow_up.due_at >= ? AND follow_up.due_at <= ?
        GROUP BY label ORDER BY label COLLATE NOCASE LIMIT 50`).bind(filters.start, filters.end).all<Record<string, unknown>>(),
      db.prepare(`SELECT CASE WHEN plan.service_type = '' THEN 'Unspecified service' ELSE plan.service_type END label, COUNT(*) total
        FROM trade_service_follow_ups follow_up
        JOIN trade_asset_service_plans plan ON plan.id = follow_up.service_plan_id AND plan.firebase_uid = follow_up.firebase_uid
        WHERE follow_up.due_at >= ? AND follow_up.due_at <= ?
        GROUP BY label ORDER BY label COLLATE NOCASE LIMIT 50`).bind(filters.start, filters.end).all<Record<string, unknown>>(),
      db.prepare(`SELECT CASE WHEN member.display_name IS NULL OR member.display_name = '' THEN 'Unassigned' ELSE member.display_name END label, COUNT(*) total
        FROM trade_service_follow_ups follow_up
        LEFT JOIN trade_team_members member ON member.id = follow_up.assignee_member_id AND member.owner_uid = follow_up.firebase_uid
        WHERE follow_up.due_at >= ? AND follow_up.due_at <= ? AND follow_up.status NOT IN ('completed', 'suppressed')
        GROUP BY label ORDER BY label COLLATE NOCASE LIMIT ? OFFSET ?`)
        .bind(filters.start, filters.end, filters.pageSize, offset).all<Record<string, unknown>>(),
      db.prepare(`SELECT COUNT(*) total FROM (
        SELECT CASE WHEN member.display_name IS NULL OR member.display_name = '' THEN 'Unassigned' ELSE member.display_name END label
        FROM trade_service_follow_ups follow_up
        LEFT JOIN trade_team_members member ON member.id = follow_up.assignee_member_id AND member.owner_uid = follow_up.firebase_uid
        WHERE follow_up.due_at >= ? AND follow_up.due_at <= ? AND follow_up.status NOT IN ('completed', 'suppressed')
        GROUP BY label)`).bind(filters.start, filters.end).first<Record<string, unknown>>(),
    ]);
    const trend = mergeServiceFollowUpTrends(filters.start, filters.end, dueTrend.results, deliveryTrend.results, optOutTrend.results);
    const summary = trend.reduce((totals, row) => ({
      due: totals.due + row.due, ready: totals.ready + row.ready, sent: totals.sent + row.sent,
      delivered: totals.delivered + row.delivered, failed: totals.failed + row.failed,
      bounced: totals.bounced + row.bounced, optedOut: totals.optedOut + row.optedOut,
    }), { due: 0, ready: 0, sent: 0, delivered: 0, failed: 0, bounced: 0, optedOut: 0 });
    const totalAssigneeRows = Number(assigneeCount?.total || 0);
    return adminJson({
      ok: true,
      filters: { start: filters.start, end: filters.end, channel: filters.channel },
      summary,
      trend,
      breakdowns: {
        dueState: aggregateRows(dueStates.results),
        assetCategory: aggregateRows(assetCategories.results),
        serviceType: aggregateRows(serviceTypes.results),
      },
      assignees: {
        rows: aggregateRows(assignees.results), page: filters.page, pageSize: filters.pageSize,
        totalRows: totalAssigneeRows, totalPages: Math.max(1, Math.ceil(totalAssigneeRows / filters.pageSize)),
      },
      boundaries: { maximumDays: 366, maximumBreakdownRows: 50, customerIdentifiersIncluded: false },
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("reporting start date") || error.message.includes("reporting range"))) {
      return adminJson({ ok: false, error: error.message }, 400);
    }
    return adminError(error);
  }
}
