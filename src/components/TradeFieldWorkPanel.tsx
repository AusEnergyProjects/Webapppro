"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";

type TimeEntry = { id: string; staffLabel: string; workDate: string; durationMinutes: number; notes: string; createdAt: string };
type Media = { id: string; category: string; fileName: string; contentType: string; sizeBytes: number; caption: string; source: string; photoRequirementId: string; requestRevision: number; checklistVersion: string; customerAcknowledgedAt: string; createdAt: string };
type Signoff = { id: string; signerRole: string; signerName: string; confirmationText: string; method: string; signedAt: string };
type ProofReview = { proofReady: boolean; counts: { total: number; required: number; supplied: number; accepted: number; retakeRequested: number; notNeeded: number; pending: number };
  completion: null | { current: boolean; evidenceCurrent: boolean; completedAt: string }; reviews: Array<{ requirementId: string; label: string; status: string; guidance: string; retakeAnswered: boolean }> };
type FieldBlocker = { key: string; label: string; target: string };
type FieldJob = { id: string; workNumber: string; title: string; status: string; customerName: string; serviceSite: string; scheduledStart: string; scheduledEnd: string;
  primaryAction: null | { action: string; label: string }; actionUnavailableReason: string; phone: string; address: string; directionsUrl: string;
  checklist: Array<{ key: string; label: string; complete: boolean; count: number; target: string }>; blockers: FieldBlocker[];
  completion: { ready: boolean; invoiceReady: boolean; handoverReady: boolean } };
type Result = { ok?: boolean; protectedJob?: boolean; timeEntries?: TimeEntry[]; media?: Media[]; signoffs?: Signoff[]; proofReview?: ProofReview | null; fieldJob?: FieldJob | null; blockers?: FieldBlocker[]; error?: string };

const day = () => new Date().toISOString().slice(0, 10);
const timeLabel = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim() : `${minutes}m`;

export function TradeFieldWorkPanel({ user, workOrderId, isProtected, onNavigate, onChanged }: { user: User; workOrderId: string; isProtected: boolean; onNavigate?: (target: "forms" | "tasks" | "notes" | "invoice" | "handover") => void; onChanged?: () => Promise<void> }) {
  const [data, setData] = useState<Result>({ protectedJob: isProtected, timeEntries: [], media: [], signoffs: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [online, setOnline] = useState(true);
  const [preview, setPreview] = useState<{ item: Media; url: string } | null>(null);
  const actionId = useRef("");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/trade-field-work?workOrderId=${encodeURIComponent(workOrderId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok) throw new Error(result.error || "Field records could not be loaded.");
    setData(result);
  }, [user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "Field records could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    if (!preview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); URL.revokeObjectURL(preview.url); };
  }, [preview]);

  const totalMinutes = useMemo(() => (data.timeEntries || []).reduce((sum, item) => sum + item.durationMinutes, 0), [data.timeEntries]);

  function openChecklist(target: string) {
    if (target === "evidence") document.getElementById("field-evidence")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (target === "work-plan") document.getElementById("field-work-plan")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (["forms", "tasks", "notes", "invoice", "handover"].includes(target)) onNavigate?.(target as "forms" | "tasks" | "notes" | "invoice" | "handover");
  }

  async function advance() {
    const fieldJob = data.fieldJob; if (!fieldJob?.primaryAction) return;
    if (!online) { setStatus(fieldJob.primaryAction.action === "finish" ? "Reconnect before finishing. Offline completion is not accepted because blockers and sync state must be checked." : "Reconnect before advancing the job. This web page does not queue field actions offline."); return; }
    if (fieldJob.primaryAction.action === "finish" && fieldJob.blockers.length) { setStatus(`Finish these items first: ${fieldJob.blockers.map((item) => item.label).join("; ")}.`); openChecklist(fieldJob.blockers[0].target); return; }
    actionId.current ||= `web-field-${crypto.randomUUID()}`; setBusy("transition"); setStatus("Syncing");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-field-work", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "field_transition", transition: fieldJob.primaryAction.action, clientActionId: actionId.current, workOrderId }) });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) throw new Error(result.blockers?.length ? `${result.error} ${result.blockers.map((item) => item.label).join("; ")}.` : result.error || "The job state could not be advanced.");
      setData(result); actionId.current = ""; setStatus("Saved"); await onChanged?.();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Action required"); }
    finally { setBusy(""); }
  }

  async function jsonAction(event: FormEvent<HTMLFormElement>, action: string, success: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(action); setStatus("Saving the field record...");
    try {
      const token = await user.getIdToken();
      const body: Record<string, unknown> = { action, workOrderId, ...values };
      if (action === "add_time") body.durationMinutes = Number(values.durationMinutes);
      if (action === "add_signoff") body.confirmed = values.confirmed === "yes";
      const response = await fetch("/api/trade-field-work", { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(result.error || "The field record could not be saved.");
      setData(result); form.reset(); setStatus(success);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The field record could not be saved."); }
    finally { setBusy(""); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    values.set("workOrderId", workOrderId); setBusy("upload"); setStatus("Uploading the private job file...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-field-work", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: values });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(result.error || "The job file could not be uploaded.");
      setData(result); form.reset(); setStatus("Job photo or document added.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The job file could not be uploaded."); }
    finally { setBusy(""); }
  }

  async function openPreview(item: Media) {
    setBusy(`preview:${item.id}`); setStatus(`Opening ${item.fileName}...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-field-work?preview=${encodeURIComponent(item.id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) { const result = await response.json().catch(() => ({})) as Result; throw new Error(result.error || "The file could not be opened."); }
      setPreview({ item, url: URL.createObjectURL(await response.blob()) }); setStatus("");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The file could not be opened."); }
    finally { setBusy(""); }
  }

  if (loading) return <div className="crm-empty"><strong>Opening field tools</strong><span>Loading time, files and sign-offs...</span></div>;

  return <div className="crm-field-work">
        {data.fieldJob && <><header className="crm-field-job-header"><div className="crm-field-job-heading"><span>{data.fieldJob.workNumber} | {data.fieldJob.status.replaceAll("_", " ")}</span><h3>{data.fieldJob.title}</h3><p>{data.fieldJob.customerName} | {data.fieldJob.serviceSite}</p>{data.fieldJob.scheduledStart && <small>{new Date(data.fieldJob.scheduledStart).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</small>}</div><div className="crm-field-job-primary">{data.fieldJob.primaryAction ? <button type="button" disabled={busy === "transition"} onClick={() => void advance()}>{busy === "transition" ? "Syncing..." : data.fieldJob.primaryAction.label}</button> : <strong>{data.fieldJob.actionUnavailableReason}</strong>}<span className={`crm-sync-state ${!online ? "offline" : status && status !== "Saved" && status !== "Syncing" ? "attention" : ""}`}>{!online ? "Offline" : busy === "transition" ? "Syncing" : status && status !== "Saved" ? "Action required" : "Saved"}</span></div></header><div className="crm-field-contact-actions">{data.fieldJob.phone && <a href={`tel:${data.fieldJob.phone.replace(/[^+\d]/g, "")}`}>Call</a>}{data.fieldJob.directionsUrl && <a href={data.fieldJob.directionsUrl} target="_blank" rel="noreferrer">Get directions</a>}</div><section className="crm-today-checklist" aria-labelledby="today-checklist-title"><header><span>Today</span><h4 id="today-checklist-title">What must happen on this job</h4></header><ol>{data.fieldJob.checklist.map((item) => <li key={item.key}><button type="button" onClick={() => openChecklist(item.target)}><span aria-hidden="true">{item.complete ? "✓" : item.count ? String(item.count) : "•"}</span><strong>{item.label}</strong><small>{item.complete ? "Ready" : item.count ? `${item.count} outstanding` : "Review"}</small></button></li>)}</ol>{data.fieldJob.blockers.length > 0 && <div className="crm-finish-blockers"><strong>Finish blockers</strong>{data.fieldJob.blockers.map((blocker) => <button type="button" key={blocker.key} onClick={() => openChecklist(blocker.target)}>{blocker.label}</button>)}</div>}{data.fieldJob.completion.invoiceReady && onNavigate && <div className="crm-field-next-paths"><button type="button" onClick={() => onNavigate("invoice")}>Prepare invoice</button><button type="button" onClick={() => onNavigate("handover")}>Open handover</button></div>}</section></>}
    <div className={`crm-field-privacy ${isProtected ? "protected" : "owned"}`}>
      <strong>{isProtected ? "AEA protected field record" : "Direct customer field record"}</strong>
      <span>{isProtected ? "Record work, time and site evidence without names, contact details or a precise address. Customer sign-off stays with AEA." : "This job belongs to your business, so the customer may complete a recorded sign-off."}</span>
    </div>
    <section className="crm-field-summary"><article><span>Time recorded</span><strong>{timeLabel(totalMinutes)}</strong></article><article><span>Job files</span><strong>{(data.media || []).length}</strong></article><article><span>Sign-offs</span><strong>{(data.signoffs || []).length}</strong></article></section>
    {data.proofReview && <section className={`crm-photo-proof-readiness ${data.proofReview.proofReady ? "ready" : "pending"}`}><header><div><span>Customer photo proof</span><h4>{data.proofReview.proofReady ? "Ready for field use" : data.proofReview.completion?.evidenceCurrent ? "Installer review in progress" : "Waiting for customer completion"}</h4></div><strong>{data.proofReview.counts.accepted} accepted | {data.proofReview.counts.retakeRequested} retake | {data.proofReview.counts.pending} pending</strong></header><ul>{data.proofReview.reviews.map((review) => <li key={review.requirementId}><span>{review.label}</span><strong>{review.status.replaceAll("_", " ")}</strong>{review.status === "retake_requested" && <small>{review.retakeAnswered ? "Replacement added" : "Replacement outstanding"}</small>}</li>)}</ul></section>}
    <div className="crm-field-grid" id="field-evidence">
      <section className="crm-field-card"><header><div><span>Technician time</span><h4>Log work completed</h4></div></header>
        <form className="crm-field-form" onSubmit={(event) => void jsonAction(event, "add_time", "Technician time added.")}>
          <label><span>Work date</span><input type="date" name="workDate" required defaultValue={day()} /></label>
          <label><span>Minutes worked</span><input type="number" name="durationMinutes" min="1" max="1440" required placeholder="90" /></label>
          <label className="wide"><span>Team member</span><input name="staffLabel" maxLength={80} placeholder="Name or crew" /></label>
          <label className="wide"><span>Work note</span><textarea name="notes" rows={2} maxLength={500} placeholder="What was completed" /></label>
          <button disabled={busy === "add_time"}>{busy === "add_time" ? "Saving..." : "Add time"}</button>
        </form>
        {(data.timeEntries || []).length > 0 && <ol className="crm-field-records">{(data.timeEntries || []).slice(0, 8).map((entry) => <li key={entry.id}><div><strong>{timeLabel(entry.durationMinutes)} | {entry.staffLabel || "Team"}</strong><span>{new Date(`${entry.workDate}T00:00:00`).toLocaleDateString("en-AU", { dateStyle: "medium" })}</span>{entry.notes && <p>{entry.notes}</p>}</div></li>)}</ol>}
      </section>
      <section className="crm-field-card"><header><div><span>Photos and files</span><h4>Keep site evidence together</h4></div></header>
        <form className="crm-field-form" onSubmit={(event) => void upload(event)}>
          <label><span>Type</span><select name="category"><option value="before">Before work</option><option value="progress">Work in progress</option><option value="after">Completed work</option><option value="document">Document</option></select></label>
          <label><span>Photo or PDF</span><input type="file" name="file" required accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
          <label className="wide"><span>Caption</span><input name="caption" maxLength={300} placeholder="Switchboard before upgrade" /></label>
          <button disabled={busy === "upload"}>{busy === "upload" ? "Uploading..." : "Add file"}</button>
        </form>
        {(data.media || []).length > 0 && <ol className="crm-field-records">{(data.media || []).map((item) => <li key={item.id}><div><strong>{item.caption || item.fileName}</strong><span>{item.source === "customer_request" ? "Customer requested photo" : item.category.replaceAll("_", " ")} | {Math.max(1, Math.round(item.sizeBytes / 1024))} KB</span>{item.source === "customer_request" && <small>Customer self-review confirmed | request revision {item.requestRevision}</small>}</div><button type="button" disabled={busy === `preview:${item.id}`} onClick={() => void openPreview(item)}>{busy === `preview:${item.id}` ? "Opening..." : "Preview"}</button></li>)}</ol>}
      </section>
      <section className="crm-field-card wide"><header><div><span>Digital sign-off</span><h4>Create a timestamped acknowledgement</h4><p>This is an operational record. Your business remains responsible for deciding when a formal contract or regulated certificate is required.</p></div></header>
        <form className="crm-field-form signoff" onSubmit={(event) => void jsonAction(event, "add_signoff", "Digital sign-off recorded.")}>
          <label><span>Signer</span><select name="signerRole"><option value="technician">Technician</option>{!isProtected && <option value="customer">Direct customer</option>}</select></label>
          <label><span>Full name</span><input name="signerName" required maxLength={100} /></label>
          <label className="wide confirm"><input type="checkbox" name="confirmed" value="yes" required /><span>I confirm this record is accurate and I am authorised to sign it.</span></label>
          <button disabled={busy === "add_signoff"}>{busy === "add_signoff" ? "Recording..." : "Record sign-off"}</button>
        </form>
        {(data.signoffs || []).length > 0 && <ol className="crm-field-records signoffs">{(data.signoffs || []).map((item) => <li key={item.id}><div><strong>{item.signerName}</strong><span>{item.signerRole} | {new Date(item.signedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span><p>{item.confirmationText}</p></div></li>)}</ol>}
      </section>
    </div>
    {status && status !== "Saved" && status !== "Syncing" && <p className="crm-inline-status" role="status">{status}</p>}
    {preview && <div className="crm-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPreview(null); }}>
      <section className="crm-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="field-preview-title">
        <header><div><span>Job file preview</span><strong id="field-preview-title">{preview.item.caption || preview.item.fileName}</strong><small>{preview.item.fileName} | {Math.max(1, Math.round(preview.item.sizeBytes / 1024))} KB</small></div><button type="button" onClick={() => setPreview(null)} aria-label="Close file preview">Close</button></header>
        <div className="crm-preview-content">{preview.item.contentType === "application/pdf"
          ? <iframe title={preview.item.caption || preview.item.fileName} src={preview.url} />
          : <img src={preview.url} alt={preview.item.caption || "Job evidence preview"} />}</div>
        <footer><a href={preview.url} download={preview.item.fileName}>Download file</a><button type="button" className="btn" onClick={() => setPreview(null)}>Done</button></footer>
      </section>
    </div>}
  </div>;
}
