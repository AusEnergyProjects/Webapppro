"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import styles from "./CreditexHomeDashboard.module.css";

type Destination = "cases" | "operations" | "submissions" | "connect" | "tasks" | "team" | "forms" | "settings";
type AuditDashboard = { awaitingAudit: number; correctionsRequired: number; auditCompleted: number; readyForSubmission: number; inProgress: number; total: number; countsUnit: "activities" };
function validDashboard(value: unknown): value is AuditDashboard {
  if (!value || typeof value !== "object" || !("countsUnit" in value) || value.countsUnit !== "activities") return false;
  const counts = ["awaitingAudit", "correctionsRequired", "auditCompleted", "readyForSubmission", "inProgress", "total"];
  return counts.every(key => { const entry = Object.getOwnPropertyDescriptor(value, key)?.value; return typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0; });
}
export function CreditexHomeDashboard({ user, canManageTeam, onNavigate }: {
  user: User; canManageTeam: boolean; onNavigate: (tab: Destination) => void;
}) {
  const [loaded, setLoaded] = useState<{ uid: string; dashboard: AuditDashboard } | null>(null);
  const dashboard = loaded?.uid === user.uid ? loaded.dashboard : null;
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/creditex/job-audit?view=dashboard", { signal: controller.signal, headers: { Authorization: "Bearer " + token }, cache: "no-store" });
        const result: { ok: boolean; dashboard?: unknown; error?: string } = await response.json();
        if (!response.ok || !result.ok || !validDashboard(result.dashboard)) throw new Error(result.error || "Your compliance workload could not be loaded.");
        if (!controller.signal.aborted) { setLoaded({ uid: user.uid, dashboard: result.dashboard }); setError(""); }
      } catch (failure) { if (!controller.signal.aborted) { setLoaded(null); setError(failure instanceof Error ? failure.message : "Your compliance workload could not be loaded."); } }
    })();
    return () => controller.abort();
  }, [user, reload]);
  const metrics = [
    { key: "awaitingAudit" as const, label: "Awaiting audit", detail: "Completed field work ready to check", destination: "cases" as const },
    { key: "correctionsRequired" as const, label: "Corrections required", detail: "Work returned for changes", destination: "operations" as const },
    { key: "auditCompleted" as const, label: "Audits completed", detail: "Checks match the current evidence", destination: "cases" as const },
    { key: "readyForSubmission" as const, label: "Ready for submission", detail: "Required approval recorded", destination: "submissions" as const },
  ];
  return <div className={styles.home}>
    <header className={styles.heading}><div><span>YOUR WORK AT A GLANCE</span><h1>Home dashboard</h1><p>Review the work. Resolve the exceptions. Keep submissions moving.</p></div><button type="button" onClick={() => onNavigate("cases")}>Open jobs</button></header>
    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => setReload(value => value + 1)}>Retry</button></div>}
    <div className={styles.metrics}>{metrics.map(metric => <button type="button" key={metric.key} onClick={() => onNavigate(metric.destination)}><span>{metric.label}</span><strong>{dashboard ? dashboard[metric.key] : error ? "Unavailable" : "..."}</strong><small>{metric.detail}</small></button>)}</div>
    <div className={styles.actions}>
      {([{ tab: "cases", title: "Audit a job", text: "Answers, files and the customer call in one place.", icon: "✓" }, { tab: "tasks", title: "My tasks & team", text: "Assign the next step and track what is done.", icon: "☷" }, { tab: "submissions", title: "Activity submissions", text: "Prepare approved work for lodgement.", icon: "↗" }] satisfies { tab: Destination; title: string; text: string; icon: string }[]).map(action => <button key={action.tab} type="button" onClick={() => onNavigate(action.tab)}><i aria-hidden="true">{action.icon}</i><strong>{action.title}</strong><span>{action.text}</span></button>)}
    </div>
    <div className={styles.grid}>
      <section className={styles.card}><header><div><span>COMPLIANCE WORKLOAD</span><h2>Checks &amp; corrections</h2></div><button type="button" onClick={() => { setLoaded(null); setReload(value => value + 1); }}>Refresh</button></header>
        <p>{dashboard ? dashboard.total + " current job activities in your authorised workspace. " + dashboard.inProgress + " still in progress." : error ? "Workload unavailable. Retry to load current counts." : "Loading current compliance workload..."}</p>
        {dashboard && <div className={styles.workload}>{metrics.map(metric => <div key={metric.key}><span>{metric.label}</span><div role="meter" aria-label={metric.label} aria-valuemin={0} aria-valuemax={Math.max(dashboard.total, 1)} aria-valuenow={dashboard[metric.key]}><i style={{ width: (dashboard.total ? Math.min(100, dashboard[metric.key] / dashboard.total * 100) : 0) + "%" }}/></div><strong>{dashboard[metric.key]}</strong></div>)}</div>}
        <p>Counts are per activity. An audited activity can also be ready for submission.</p>
      </section>
      <section className={styles.card}><header><div><span>KEEP WORK MOVING</span><h2>Team workspace</h2></div></header><p>Send a teammate a message, assign a task or update your workspace.</p><div className={styles.links}>
        <button type="button" onClick={() => onNavigate("connect")}>Customers & team <b aria-hidden="true">→</b></button>
        <button type="button" onClick={() => onNavigate("forms")}>Forms &amp; activity requirements <b aria-hidden="true">→</b></button>
        {canManageTeam && <button type="button" onClick={() => onNavigate("team")}>Manage team access <b aria-hidden="true">→</b></button>}
        <button type="button" onClick={() => onNavigate("settings")}>Profile &amp; workspace colours <b aria-hidden="true">→</b></button>
      </div></section>
    </div>
  </div>;
}
