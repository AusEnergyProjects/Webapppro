import { getD1 } from "../../../../../db";
import { adminError, adminJson, requireAdminIdentity, sameOrigin } from "@/lib/admin-server";

export const runtime = "edge";

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: "Request origin was not accepted." }, 403);
  try {
    await requireAdminIdentity(request, ["owner", "admin"]);
    const rows = await getD1().prepare(`SELECT route_key, status_code, duration_ms, db_duration_ms, result_count, cursor_used, sampled_at
      FROM api_performance_samples WHERE sampled_at >= datetime('now', '-7 days')
      ORDER BY sampled_at DESC LIMIT 5000`).all<Record<string, unknown>>();
    const grouped = new Map<string, Record<string, unknown>[]>();
    rows.results.forEach((row) => { const key = String(row.route_key); grouped.set(key, [...(grouped.get(key) || []), row]); });
    const routes = [...grouped.entries()].map(([routeKey, samples]) => {
      const durations = samples.map((sample) => Number(sample.duration_ms || 0));
      const database = samples.map((sample) => Number(sample.db_duration_ms || 0));
      return {
        routeKey,
        samples: samples.length,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        maximumMs: Math.max(...durations),
        averageDbMs: Math.round(database.reduce((sum, value) => sum + value, 0) / samples.length),
        errors: samples.filter((sample) => Number(sample.status_code) >= 400).length,
        cursorShare: Math.round(samples.filter((sample) => Boolean(sample.cursor_used)).length / samples.length * 100),
        lastSampledAt: samples[0]?.sampled_at,
      };
    }).sort((left, right) => right.p95Ms - left.p95Ms);
    return adminJson({ ok: true, window: "7 days", sampleCount: rows.results.length, routes });
  } catch (error) { return adminError(error); }
}
