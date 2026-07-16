type RoutePerformanceOptions = {
  db: D1Database;
  routeKey: string;
  startedAt: number;
  dbDurationMs: number;
  statusCode?: number;
  resultCount?: number;
  cursorUsed?: boolean;
  outcome?: "ok" | "error";
};

export function routeTimer() {
  const startedAt = performance.now();
  let dbDurationMs = 0;
  return {
    startedAt,
    get dbDurationMs() { return dbDurationMs; },
    async database<T>(work: Promise<T>) {
      const databaseStartedAt = performance.now();
      try { return await work; }
      finally { dbDurationMs += performance.now() - databaseStartedAt; }
    },
  };
}

export async function performanceJson(body: object, options: RoutePerformanceOptions) {
  const statusCode = options.statusCode || 200;
  const durationMs = Math.max(0, Math.round(performance.now() - options.startedAt));
  const dbDurationMs = Math.max(0, Math.round(options.dbDurationMs));
  const sampledAt = new Date().toISOString();
  const shouldPersist = durationMs >= 1_000 || statusCode >= 400 || Math.random() < 0.1;
  if (shouldPersist) {
    try {
      await options.db.prepare(`INSERT INTO api_performance_samples
        (id, route_key, method, status_code, outcome, duration_ms, db_duration_ms, result_count, cursor_used, sampled_at)
        VALUES (?, ?, 'GET', ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), options.routeKey.slice(0, 80), statusCode, options.outcome || (statusCode < 400 ? "ok" : "error"),
          durationMs, dbDurationMs, Math.max(0, options.resultCount || 0), options.cursorUsed ? 1 : 0, sampledAt).run();
    } catch (error) {
      console.error("Performance telemetry write failed", { routeKey: options.routeKey, error });
    }
  }
  return Response.json(body, {
    status: statusCode,
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": `db;dur=${dbDurationMs}, app;dur=${durationMs}`,
      "X-TLink-Response-Time": String(durationMs),
    },
  });
}
