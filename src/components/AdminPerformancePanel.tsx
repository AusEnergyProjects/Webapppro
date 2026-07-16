"use client";

import { useEffect, useState } from "react";

type RouteMetric = { routeKey: string; samples: number; p50Ms: number; p95Ms: number; maximumMs: number; averageDbMs: number; errors: number; cursorShare: number; lastSampledAt: string };

export function AdminPerformancePanel({ api }: { api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>> }) {
  const [routes, setRoutes] = useState<RouteMetric[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [status, setStatus] = useState("Loading performance samples...");
  useEffect(() => {
    let active = true;
    void api("/api/admin/performance").then((result) => {
      if (!active) return;
      setRoutes((result.routes || []) as RouteMetric[]);
      setSampleCount(Number(result.sampleCount || 0));
      setStatus("");
    }).catch(() => active && setStatus("Performance telemetry will appear after new dashboard traffic is sampled."));
    return () => { active = false; };
  }, [api]);
  return <section className="admin-panel admin-performance-panel" aria-labelledby="performance-title">
    <div className="admin-panel-heading"><span>Production telemetry</span><h2 id="performance-title">Dashboard response health</h2>
      <p>Privacy-safe API and database timing from the last seven days. No names, addresses, contact details or search terms are recorded.</p></div>
    {status ? <div className="admin-empty"><p>{status}</p></div> : <>
      <div className="admin-performance-summary"><strong>{sampleCount}</strong><span>sampled requests</span><small>Slow and failed requests are always retained. Routine traffic is sampled.</small></div>
      <div className="admin-performance-table tlink-data-table" role="table" aria-label="API performance by route">
        <div role="row"><span role="columnheader">Route</span><span role="columnheader">p50</span><span role="columnheader">p95</span><span role="columnheader">DB average</span><span role="columnheader">Maximum</span><span role="columnheader">Errors</span><span role="columnheader">Cursor use</span></div>
        {routes.map((route) => <div role="row" key={route.routeKey}><strong role="cell">{route.routeKey}<small>{route.samples} samples</small></strong><span role="cell">{route.p50Ms} ms</span><span role="cell" className={route.p95Ms > 1000 ? "attention" : ""}>{route.p95Ms} ms</span><span role="cell">{route.averageDbMs} ms</span><span role="cell">{route.maximumMs} ms</span><span role="cell">{route.errors}</span><span role="cell">{route.cursorShare}%</span></div>)}
      </div>
    </>}
  </section>;
}
