"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import {
  tradeJobAuditOutcomeLabel,
  tradeJobLifecycleLabel,
  type TradeJobAuditOutcome,
  type TradeJobLifecycleStatus,
} from "@/lib/trade-job-lifecycle";

type FieldRecord = { id: string; intentId: string; title: string; programCode: string; status: "not_started" | "draft" | "submitted_for_creditex_review";
  lifecycleStatus: TradeJobLifecycleStatus; auditOutcome: TradeJobAuditOutcome | null; recordNumber: string; progress: { complete: number; total: number } };

function activityProgressText(item: FieldRecord) {
  if (item.lifecycleStatus === "cancelled") return "Cancelled";
  if (item.lifecycleStatus === "audited") return `Audit outcome: ${tradeJobAuditOutcomeLabel(item.auditOutcome)}`;
  if (item.lifecycleStatus === "completed") return "Completed and submitted to Creditex";
  if (item.lifecycleStatus === "partial") return `${item.progress.complete} of ${item.progress.total} required items saved`;
  if (item.lifecycleStatus === "scheduled") return "Scheduled and ready to start in the app";
  return "Ready to schedule";
}

export function TradeActivityFieldRecords({ user, workOrderId, canShare, refreshKey }: { user: User; workOrderId: string; canShare: boolean; refreshKey: number }) {
  const [records, setRecords] = useState<FieldRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<{ id: string; url: string; name: string } | null>(null);
  const [share, setShare] = useState<{ id: string; url: string } | null>(null);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/trade-activity-forms?workOrderId=${encodeURIComponent(workOrderId)}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.records)) throw new Error(body.error || "Activity forms could not be loaded.");
      setRecords(body.records);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Activity forms could not be loaded."); }
    finally { setBusy(false); }
  }, [user, workOrderId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load, refreshKey]);
  useEffect(() => () => { if (report) URL.revokeObjectURL(report.url); }, [report]);
  async function openReport(item: FieldRecord) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/trade-activity-forms?recordId=${encodeURIComponent(item.id)}&view=pdf`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!response.ok) throw new Error("The completed report could not be opened.");
      setReport({ id: item.id, url: URL.createObjectURL(await response.blob()), name: `${item.recordNumber}.pdf` });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The report could not be opened."); }
    finally { setBusy(false); }
  }
  async function shareReport(item: FieldRecord) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/trade-activity-forms", { method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "share_report", recordId: item.id }) });
      const body = await response.json();
      if (!response.ok || typeof body.reportUrl !== "string") throw new Error(body.error || "A report link could not be created.");
      setShare({ id: item.id, url: body.reportUrl });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "A report link could not be created."); }
    finally { setBusy(false); }
  }
  return <section className="crm-job-compliance" aria-label="Activity field records">
    <header><div><span>Job forms</span><h4>Activity forms and evidence</h4></div><button type="button" disabled={busy} onClick={() => void load()}>{busy ? "Loading..." : "Refresh progress"}</button></header>
    <p>Complete each activity in the TLink app. Answers, photos and signatures stay with its own job record. Creditex receives the completed record for review and handles certificate creation.</p>
    {error ? <p role="alert">{error}</p> : null}
    {records.map((item) => <article key={item.intentId}>
      <div><span>{item.recordNumber || item.programCode} · {tradeJobLifecycleLabel(item.lifecycleStatus)}{item.lifecycleStatus === "audited" && item.auditOutcome ? ` · ${tradeJobAuditOutcomeLabel(item.auditOutcome)}` : ""}</span><strong>{item.title}</strong><p>{activityProgressText(item)}</p></div>
      {item.status === "submitted_for_creditex_review" ? <div>
        <button type="button" disabled={busy} onClick={() => void openReport(item)}>Prepare PDF</button>
        {report?.id === item.id ? <a href={report.url} download={report.name}>Download completed report</a> : null}
        {canShare ? <button type="button" disabled={busy} onClick={() => void shareReport(item)}>Create share link</button> : null}
        {share?.id === item.id ? <p><a href={share.url} target="_blank" rel="noreferrer">Open shareable report</a> · Link expires in 30 days. Previous links for this report are replaced.</p> : null}
      </div> : <a href={`aeafield://job/${encodeURIComponent(workOrderId)}`}>Open job in TLink app</a>}
    </article>)}
    {!busy && !error && !records.length ? <p>No activity forms are attached to this job.</p> : null}
  </section>;
}
