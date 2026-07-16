import { getD1 } from "../../../../../db";
import { adminError, adminJson, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";

export const runtime = "edge";

const SLO = { minimumSamples: 20, p95Ms: 1000, averageDbMs: 300, errorRatePercent: 1 };
const QUERY_PLAN_CHECKS = [
  { key: "admin.accounts", sql: "EXPLAIN QUERY PLAN SELECT firebase_uid FROM trade_accounts ORDER BY updated_at DESC, firebase_uid DESC LIMIT 26" },
  { key: "admin.opportunities", sql: "EXPLAIN QUERY PLAN SELECT id FROM trade_opportunities ORDER BY updated_at DESC, id DESC LIMIT 26" },
  { key: "admin.products", sql: "EXPLAIN QUERY PLAN SELECT id FROM supplier_products ORDER BY updated_at DESC, id DESC LIMIT 26" },
];

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request, ["owner", "admin"]);
    const db = getD1();
    const rows = await db.prepare(`SELECT route_key, status_code, duration_ms, db_duration_ms, result_count, cursor_used, sampled_at
      FROM api_performance_samples WHERE sampled_at >= datetime('now', '-7 days')
      ORDER BY sampled_at DESC LIMIT 5000`).all<Record<string, unknown>>();
    const grouped = new Map<string, Record<string, unknown>[]>();
    rows.results.forEach((row) => { const key = String(row.route_key); grouped.set(key, [...(grouped.get(key) || []), row]); });
    const routes = [...grouped.entries()].map(([routeKey, samples]) => {
      const durations = samples.map((sample) => Number(sample.duration_ms || 0));
      const database = samples.map((sample) => Number(sample.db_duration_ms || 0));
      const errors = samples.filter((sample) => Number(sample.status_code) >= 400).length;
      const errorRatePercent = Math.round(errors / samples.length * 1000) / 10;
      const p95Ms = percentile(durations, 0.95);
      const averageDbMs = Math.round(database.reduce((sum, value) => sum + value, 0) / samples.length);
      const status = samples.length < SLO.minimumSamples ? "insufficient" : p95Ms <= SLO.p95Ms && averageDbMs <= SLO.averageDbMs && errorRatePercent <= SLO.errorRatePercent ? "healthy" : "attention";
      return {
        routeKey,
        samples: samples.length,
        p50Ms: percentile(durations, 0.5),
        p95Ms,
        maximumMs: Math.max(...durations),
        averageDbMs,
        errors,
        errorRatePercent,
        status,
        cursorShare: Math.round(samples.filter((sample) => Boolean(sample.cursor_used)).length / samples.length * 100),
        lastSampledAt: samples[0]?.sampled_at,
      };
    }).sort((left, right) => right.p95Ms - left.p95Ms);
    const plans = await Promise.all(QUERY_PLAN_CHECKS.map(async (check) => {
      const result = await db.prepare(check.sql).all<Record<string, unknown>>();
      return { key: check.key, details: result.results.map((row) => String(row.detail || "")).filter(Boolean) };
    }));
    return adminJson({ ok: true, window: "7 days", sampleCount: rows.results.length, slo: { ...SLO, healthyRoutes: routes.filter((route) => route.status === "healthy").length, attentionRoutes: routes.filter((route) => route.status === "attention").length, insufficientRoutes: routes.filter((route) => route.status === "insufficient").length }, routes, plans });
  } catch (error) { return adminError(error); }
}
