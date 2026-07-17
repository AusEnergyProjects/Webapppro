"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { downloadWorkspaceCsv } from "@/components/WorkspaceTableTools";

type Channel = "all" | "email" | "sms";
type Filters = { start: string; end: string; channel: Channel };
type Summary = { due: number; ready: number; sent: number; delivered: number; failed: number; bounced: number; optedOut: number };
type Trend = Summary & { day: string };
type Breakdown = { label: string; total: number };
type Report = {
  filters?: Filters;
  summary?: Summary;
  trend?: Trend[];
  breakdowns?: { dueState: Breakdown[]; assetCategory: Breakdown[]; serviceType: Breakdown[] };
  assignees?: { rows: Breakdown[]; page: number; pageSize: number; totalRows: number; totalPages: number };
};

function isoDateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const emptySummary: Summary = { due: 0, ready: 0, sent: 0, delivered: 0, failed: 0, bounced: 0, optedOut: 0 };

export function AdminServiceFollowUpReporting({ api }: { api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>> }) {
  const initial = { start: isoDateOffset(-29), end: isoDateOffset(0), channel: "all" as Channel };
  const [draft, setDraft] = useState<Filters>(initial);
  const [filters, setFilters] = useState<Filters>(initial);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Report>({});
  const [status, setStatus] = useState("Loading service follow-up reporting...");

  const load = useCallback(async (activeFilters: Filters, activePage: number) => {
    setStatus("Loading service follow-up reporting...");
    try {
      const query = new URLSearchParams({ ...activeFilters, page: String(activePage), pageSize: "25" });
      const result = await api(`/api/admin/service-follow-up-reporting?${query}`) as Report;
      setData(result);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Service follow-up reporting could not be loaded.");
    }
  }, [api]);

  useEffect(() => { const frame = window.requestAnimationFrame(() => void load(filters, page)); return () => window.cancelAnimationFrame(frame); }, [filters, load, page]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (draft.start > draft.end) { setStatus("Choose a start date on or before the end date."); return; }
    setPage(1);
    setFilters(draft);
    if (page === 1 && filters.start === draft.start && filters.end === draft.end && filters.channel === draft.channel) void load(draft, 1);
  }

  function exportVisible() {
    const rows = [
      ...(data.trend || []).map((row) => ({ section: "Daily trend", label: row.day, ...row, total: "" })),
      ...(data.breakdowns?.dueState || []).map((row) => ({ section: "Due state", label: readable(row.label), total: row.total })),
      ...(data.breakdowns?.assetCategory || []).map((row) => ({ section: "Asset category", label: readable(row.label), total: row.total })),
      ...(data.breakdowns?.serviceType || []).map((row) => ({ section: "Service type", label: readable(row.label), total: row.total })),
      ...(data.assignees?.rows || []).map((row) => ({ section: "Assigned workload", label: row.label, total: row.total })),
    ];
    downloadWorkspaceCsv(`tlink-service-follow-up-report-${filters.start}-to-${filters.end}.csv`, [
      { key: "section", label: "Section" }, { key: "label", label: "Date or label" }, { key: "due", label: "Due" },
      { key: "ready", label: "Ready" }, { key: "sent", label: "Sent" }, { key: "delivered", label: "Delivered" },
      { key: "failed", label: "Failed" }, { key: "bounced", label: "Bounced" }, { key: "optedOut", label: "Opted out" },
      { key: "total", label: "Total" },
    ], rows);
  }

  const summary = { ...emptySummary, ...(data.summary || {}) };
  const assignees = data.assignees || { rows: [], page: 1, pageSize: 25, totalRows: 0, totalPages: 1 };
  return <section className="admin-panel admin-follow-up-reporting" aria-labelledby="follow-up-reporting-title">
    <div className="admin-panel-heading"><span>Customer communications</span><h2 id="follow-up-reporting-title">Service follow-up workload and delivery</h2>
      <p>Aggregate operational reporting only. Customer names, contact details, addresses and message content are excluded.</p></div>
    <form className="admin-follow-up-report-filters" onSubmit={applyFilters}>
      <label><span>From</span><input type="date" value={draft.start} data-date-range-group="service-follow-up-reporting" data-date-range-role="start" onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))} /></label>
      <label><span>To</span><input type="date" value={draft.end} data-date-range-group="service-follow-up-reporting" data-date-range-role="end" onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))} /></label>
      <label><span>Delivery channel</span><select value={draft.channel} onChange={(event) => setDraft((current) => ({ ...current, channel: event.target.value as Channel }))}><option value="all">All channels</option><option value="email">Email</option><option value="sms">SMS</option></select></label>
      <button type="submit">Apply filters</button>
      <button type="button" className="secondary" disabled={!data.trend?.length} onClick={exportVisible}>Export visible aggregate rows CSV</button>
    </form>
    {status ? <div className="admin-empty"><p>{status}</p></div> : <>
      <div className="admin-follow-up-report-summary">{([
        ["Due", summary.due], ["Ready", summary.ready], ["Sent", summary.sent], ["Delivered", summary.delivered],
        ["Failed", summary.failed], ["Bounced", summary.bounced], ["Opted out", summary.optedOut],
      ] as Array<[string, number]>).map(([label, total]) => <article key={label}><strong>{total}</strong><span>{label}</span></article>)}</div>
      <div className="admin-follow-up-trend tlink-data-table" role="table" aria-label="Daily service follow-up trend">
        <div role="row"><span role="columnheader">Date</span><span role="columnheader">Due</span><span role="columnheader">Ready</span><span role="columnheader">Sent</span><span role="columnheader">Delivered</span><span role="columnheader">Failed</span><span role="columnheader">Bounced</span><span role="columnheader">Opted out</span></div>
        {(data.trend || []).map((row) => <div role="row" key={row.day}><strong role="cell">{row.day}</strong><span role="cell">{row.due}</span><span role="cell">{row.ready}</span><span role="cell">{row.sent}</span><span role="cell">{row.delivered}</span><span role="cell">{row.failed}</span><span role="cell">{row.bounced}</span><span role="cell">{row.optedOut}</span></div>)}
      </div>
      <div className="admin-follow-up-breakdowns">
        <section><h3>Open workload by due state</h3>{(data.breakdowns?.dueState || []).map((row) => <article key={row.label}><span>{readable(row.label)}</span><strong>{row.total}</strong></article>)}</section>
        <section><h3>Follow-ups by asset category</h3>{(data.breakdowns?.assetCategory || []).map((row) => <article key={row.label}><span>{readable(row.label)}</span><strong>{row.total}</strong></article>)}</section>
        <section><h3>Follow-ups by service type</h3>{(data.breakdowns?.serviceType || []).map((row) => <article key={row.label}><span>{readable(row.label)}</span><strong>{row.total}</strong></article>)}</section>
      </div>
      <section className="admin-follow-up-assignees"><div><h3>Assigned open workload</h3><p>Counts support workload balancing only. Delivery outcomes are not attributed to individual staff.</p></div>
        <div className="admin-follow-up-assignee-list">{assignees.rows.map((row) => <article key={row.label}><span>{row.label}</span><strong>{row.total}</strong></article>)}{!assignees.rows.length && <p>No assigned workload in this range.</p>}</div>
        <footer><button type="button" disabled={assignees.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous staff page</button><span>Page {assignees.page} of {assignees.totalPages} | {assignees.totalRows} aggregate rows</span><button type="button" disabled={assignees.page >= assignees.totalPages} onClick={() => setPage((current) => current + 1)}>Next staff page</button></footer>
      </section>
    </>}
  </section>;
}
