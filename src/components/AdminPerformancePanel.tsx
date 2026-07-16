"use client";

import { useEffect, useState } from "react";

type RouteMetric = { routeKey: string; samples: number; p50Ms: number; p95Ms: number; maximumMs: number; averageDbMs: number; errors: number; errorRatePercent: number; cursorShare: number; status: "healthy" | "attention" | "insufficient"; lastSampledAt: string };
type QueryPlan = { key: string; details: string[] };
type Slo = { minimumSamples: number; p95Ms: number; averageDbMs: number; errorRatePercent: number; healthyRoutes: number; attentionRoutes: number; insufficientRoutes: number };

export function AdminPerformancePanel({ api }: { api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>> }) {
  const [routes, setRoutes] = useState<RouteMetric[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [slo, setSlo] = useState<Slo | null>(null);
  const [plans, setPlans] = useState<QueryPlan[]>([]);
  const [status, setStatus] = useState("Loading performance samples...");
  useEffect(() => {
    let active = true;
    void api("/api/admin/performance").then((result) => {
      if (!active) return;
      setRoutes((result.routes || []) as RouteMetric[]);
      setSampleCount(Number(result.sampleCount || 0));
      setSlo((result.slo || null) as Slo | null);
      setPlans((result.plans || []) as QueryPlan[]);
      setStatus("");
    }).catch(() => active && setStatus("Performance telemetry will appear after new dashboard traffic is sampled."));
    return () => { active = false; };
  }, [api]);
  return <section className="admin-panel admin-performance-panel" aria-labelledby="performance-title">
    <div className="admin-panel-heading"><span>Production telemetry</span><h2 id="performance-title">Dashboard response health</h2>
      <p>Privacy-safe API and database timing from the last seven days. No names, addresses, contact details or search terms are recorded.</p></div>
    {status ? <div className="admin-empty"><p>{status}</p></div> : <>
      <div className="admin-performance-summary"><strong>{sampleCount}</strong><span>sampled requests</span><small>Slow and failed requests are always retained. Routine traffic is sampled.</small></div>
      {slo && <div className="admin-performance-slo" aria-label="Service level objectives"><span><strong>{slo.healthyRoutes}</strong> within target</span><span className={slo.attentionRoutes ? "attention" : ""}><strong>{slo.attentionRoutes}</strong> need review</span><span><strong>{slo.insufficientRoutes}</strong> need more samples</span><small>Targets: p95 {slo.p95Ms} ms, database average {slo.averageDbMs} ms and errors at or below {slo.errorRatePercent}% after {slo.minimumSamples} samples.</small></div>}
      <div className="admin-performance-table tlink-data-table" role="table" aria-label="API performance by route">
        <div role="row"><span role="columnheader">Route</span><span role="columnheader">p50</span><span role="columnheader">p95</span><span role="columnheader">DB average</span><span role="columnheader">Maximum</span><span role="columnheader">Errors</span><span role="columnheader">Cursor use</span></div>
        {routes.map((route) => <div role="row" key={route.routeKey}><strong role="cell">{route.routeKey}<small>{route.samples} samples</small></strong><span role="cell">{route.p50Ms} ms</span><span role="cell" className={route.status === "attention" ? "attention" : ""}>{route.p95Ms} ms</span><span role="cell">{route.averageDbMs} ms</span><span role="cell">{route.maximumMs} ms</span><span role="cell">{route.errors} ({route.errorRatePercent}%)</span><span role="cell">{route.cursorShare}%</span></div>)}
      </div>
      <section className="admin-performance-plans"><h3>Current query-plan checks</h3><p>These controlled read-only checks show whether the keyset list shapes still use the expected database path. Review an attention route before adding an index.</p>{plans.map((plan) => <article key={plan.key}><strong>{plan.key}</strong><code>{plan.details.join("; ") || "No planner detail returned."}</code></article>)}</section>
    </>}
  </section>;
}
