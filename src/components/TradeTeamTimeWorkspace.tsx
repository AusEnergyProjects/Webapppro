"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import { WorkTimeStatus } from "./TradeWorkTimeTracking";
import { workTimeLabel, type WorkTimeReport } from "@/lib/trade-work-time";
import styles from "./TradeTeamTimeWorkspace.module.css";

export function TradeTeamTimeWorkspace({ user }: { user: User }) {
  const fetch = useTradeBusinessFetch();
  const [week, setWeek] = useState("");
  const [memberId, setMemberId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ report: WorkTimeReport; key: string } | null>(null);
  const [people, setPeople] = useState<Array<{ memberId: string; name: string }>>([]);
  const [error, setError] = useState("");
  const key = `${week}:${memberId}:${workOrderId}:${refresh}`;
  const report = result?.key === key ? result.report : null;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError("");
      const params = new URLSearchParams({ ...(week ? { week } : {}), ...(memberId ? { memberId } : {}), ...(workOrderId ? { workOrderId } : {}) });
      try {
        const response = await fetch(`/api/trade-work-time?${params}`, { signal: controller.signal, headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
        const body: { ok: boolean; error?: string; report?: WorkTimeReport; people?: Array<{ memberId: string; name: string }> } = await response.json();
        if (!controller.signal.aborted && body.people) setPeople(body.people);
        if (!response.ok || !body.ok || !body.report) throw new Error(body.error || "Work activity could not be loaded.");
        if (controller.signal.aborted) return;
        setResult({ report: body.report, key });
        if (!memberId) setPeople(body.report.members);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Work activity could not be loaded."); }
    }
    void load();
    return () => controller.abort();
  }, [fetch, user, week, memberId, workOrderId, key]);
  const stamp = (value: string) => value && report ? new Intl.DateTimeFormat("en-AU", { timeZone: report.timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not completed";
  const sum = (metric: "appSeconds" | "formSeconds" | "workSeconds") => report?.members.reduce((total, person) => total + person[metric], 0) || 0;
  const jobs = report ? [...new Map(report.jobs.map(job => [job.workOrderId, job])).values()] : [];
  return <section className={styles.workspace} aria-label="Work activity and form timing">
    <header className={styles.heading}><div><span>TEAM ACTIVITY</span><h3>{report?.scope === "self" ? "My time" : report?.scope === "crew" ? "Crew time" : "Time and forms"}</h3><p>Automatically recorded as people use TLink and work through job forms.</p></div>
      <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh</button></header>
    <div className={styles.filters}>
      <label>Week containing<input type="date" value={week || report?.weekStart || ""} onChange={event => setWeek(event.target.value)} /></label>
      <label>Person<select value={memberId} onChange={event => setMemberId(event.target.value)}><option value="">Everyone I can view</option>{people.map(person => <option key={person.memberId} value={person.memberId}>{person.name}</option>)}</select></label>
      <label>Job<select value={workOrderId} onChange={event => setWorkOrderId(event.target.value)}><option value="">All assigned jobs</option>{jobs.map(job => <option key={job.workOrderId} value={job.workOrderId}>{job.workNumber || job.title}</option>)}{workOrderId && !jobs.some(job => job.workOrderId === workOrderId) && <option value={workOrderId}>Selected job</option>}</select></label>
      {(week || memberId || workOrderId) && <button type="button" onClick={() => { setWeek(""); setMemberId(""); setWorkOrderId(""); }}>This week, all activity</button>}
    </div>
    <WorkTimeStatus />
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!report && !error && <p role="status">Loading work activity...</p>}
    {report && <>
      <p className={styles.period}>{report.weekStart} to {report.weekEnd} · {report.timeZone}</p>
      <div className={styles.metrics}>
        <article><span>Active in TLink</span><strong>{workTimeLabel(sum("appSeconds"))}</strong><small>This week</small></article>
        <article><span>Elapsed job work</span><strong>{workTimeLabel(sum("workSeconds"))}</strong><small>Form work windows, including phone away</small></article>
        <article><span>Active form use</span><strong>{workTimeLabel(sum("formSeconds"))}</strong><small>Included in active TLink time</small></article>
        <article><span>Jobs worked on</span><strong>{jobs.length}</strong><small>{report.forms.length} forms open or worked on this week</small></article>
      </div>
      <p className={styles.explanation}>Elapsed work runs from opening a form through its steps to completion, including time doing the work with the phone away. An unfinished form keeps its window open. Only active app use pauses during idle or background time. Overlapping forms count once per person in job totals. Work windows can include breaks and are not approved payroll hours. Offline records appear after syncing.</p>
      {report.members.length > 1 && <section><h4>People this week</h4><div className={styles.tableWrap}><table><thead><tr><th>Person</th><th>Active in TLink</th><th>Elapsed work</th><th>Active form use</th><th>Jobs</th></tr></thead><tbody>{report.members.map(person => <tr key={person.memberId}><th>{person.name}</th><td>{workTimeLabel(person.appSeconds)}</td><td>{workTimeLabel(person.workSeconds)}</td><td>{workTimeLabel(person.formSeconds)}</td><td>{person.jobs}</td></tr>)}</tbody></table></div></section>}
      <section><h4>Forms and pages</h4><p className={styles.explanation}>Each form shows elapsed time across all sessions and weeks, with page timestamps and active app use underneath. Before and after steps retain the work time between them. Completion is recorded separately.</p>
        <div className={styles.formList}>{report.forms.map(form => <details key={form.key} className={styles.form}>
          <summary><div><strong>{form.title}</strong><span>{form.workNumber} · {form.members.join(", ")} · {form.completedAt ? "Completed" : "Work window open"}</span></div><div className={styles.duration}><strong>{workTimeLabel(form.elapsedSeconds)}</strong><span>{workTimeLabel(form.activeSeconds)} active form use</span></div></summary>
          <dl className={styles.timestamps}><div><dt>First recorded</dt><dd>{stamp(form.firstStartedAt)}</dd></div><div><dt>Last active</dt><dd>{stamp(form.lastActiveAt)}</dd></div><div><dt>Work finished</dt><dd>{stamp(form.workFinishedAt)}</dd></div><div><dt>Completion synced</dt><dd>{stamp(form.completedAt)}</dd></div></dl>
          <div className={styles.tableWrap}><table><thead><tr><th>Page</th><th>First opened</th><th>Last active</th><th>Elapsed work</th><th>Active form use</th></tr></thead><tbody>{form.pages.map(page => <tr key={page.key}><th>{page.title}</th><td>{stamp(page.firstStartedAt)}</td><td>{stamp(page.lastActiveAt)}</td><td>{workTimeLabel(page.elapsedSeconds)}</td><td>{workTimeLabel(page.activeSeconds)}</td></tr>)}</tbody></table></div>
        </details>)}{!report.forms.length && <p className={styles.empty}>No form activity recorded for this week yet. Timing starts when someone opens an editable form page.</p>}</div>
      </section>
      <section><h4>Job activity this week</h4><div className={styles.tableWrap}><table><thead><tr><th>Job</th><th>Person</th><th>First activity</th><th>Last activity</th><th>Elapsed work</th><th>Active app use</th></tr></thead><tbody>{report.jobs.map(job => <tr key={`${job.memberId}:${job.workOrderId}`}><th>{job.workNumber}<small>{job.title}</small></th><td>{job.memberName}</td><td>{stamp(job.firstStartedAt)}</td><td>{stamp(job.lastActiveAt)}</td><td>{workTimeLabel(job.elapsedSeconds)}</td><td>{workTimeLabel(job.activeSeconds)}</td></tr>)}</tbody></table>{!report.jobs.length && <p className={styles.empty}>No job activity recorded for this week.</p>}</div></section>
      <p className={styles.explanation}>Times shown are for people and jobs you currently have permission to view. Earlier forms have no active duration until timing is recorded.</p>
    </>}
  </section>;
}
