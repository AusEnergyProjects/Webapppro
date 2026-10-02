"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import Image from "next/image";
import {
  CREDITEX_JOB_AUDIT_QUESTIONS, creditexJobAuditComplete, emptyCreditexJobAuditAnswers,
  type CreditexJobAuditAnswers, type CreditexJobAuditCallOutcome,
  type CreditexJobAuditSaveInput, type CreditexJobAuditWorkspace,
} from "@/lib/creditex-job-audit";
import { CreditexAuditCallPanel } from "./CreditexAuditCallPanel";
import { CreditexJobLifecycleActions } from "./CreditexJobLifecycleActions";
import styles from "./CreditexJobAuditDesk.module.css";

function displayDate(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function AnswerValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className={styles.muted}>Not answered</span>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "string" || typeof value === "number") return <>{String(value)}</>;
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}><AnswerValue value={item} /></li>)}</ul>;
  if (typeof value === "object") return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{key.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd><AnswerValue value={item} /></dd></div>)}</dl>;
  return <span className={styles.muted}>Unsupported answer</span>;
}

export function CreditexJobAuditDesk({ user, intentId, actorMode = "creditex", focusCall = false, onClose, onChanged, onDirtyChange }: {
  user: User; intentId: string; actorMode?: "creditex" | "admin"; focusCall?: boolean;
  onClose: () => void; onChanged: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [workspace, setWorkspace] = useState<CreditexJobAuditWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [answers, setAnswers] = useState<CreditexJobAuditAnswers>(emptyCreditexJobAuditAnswers);
  const [callOutcome, setCallOutcome] = useState<CreditexJobAuditCallOutcome>("unavailable");
  const [callReason, setCallReason] = useState("");
  const [callId, setCallId] = useState("");
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recordIndex, setRecordIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState(0);
  const [preview, setPreview] = useState<{ url: string; type: string; key: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [showCall, setShowCall] = useState(focusCall);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const callRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const requestId = useRef<{ signature: string; id: string } | null>(null);
  const endpoint = `/api/creditex/job-audit?intentId=${encodeURIComponent(intentId)}&actorMode=${actorMode === "admin" ? "admin" : "compliance"}`;

  const apply = useCallback((next: CreditexJobAuditWorkspace) => {
    setWorkspace(next);
    setAnswers(next.checklist?.answers || emptyCreditexJobAuditAnswers());
    setCallOutcome(next.checklist?.callOutcome || "unavailable");
    setCallReason(next.checklist?.callReason || "");
    setCallId(next.checklist?.callId || "");
    setNote(next.checklist?.note || "");
    setDirty(false);
  }, []);
  const selectAuditCall = useCallback((id: string) => {
    if (saving || !workspace?.capabilities.canSave) return;
    setCallId(id); setCallOutcome("completed"); setDirty(true);
  }, [saving, workspace?.capabilities.canSave]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++sequence.current;
    setLoading(true); setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(endpoint, { signal, headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result: { ok: boolean; error?: string; workspace?: CreditexJobAuditWorkspace } = await response.json();
      if (!response.ok || !result.ok || !result.workspace) throw new Error(result.error || "The job audit could not be loaded.");
      if (current !== sequence.current || signal?.aborted) return;
      apply(result.workspace);
      setRecordIndex(0); setFileIndex(0);
      requestId.current = null;
    } catch (failure) {
      if (current !== sequence.current || signal?.aborted) return;
      setWorkspace(null);
      setError(failure instanceof Error ? failure.message : "The job audit could not be loaded.");
    } finally { if (current === sequence.current && !signal?.aborted) setLoading(false); }
  }, [user, endpoint, apply]);

  useEffect(() => {
    const controller = new AbortController();
    const requestSequence = sequence;
    void Promise.resolve().then(() => { if (!controller.signal.aborted) void load(controller.signal); });
    headingRef.current?.focus();
    return () => { controller.abort(); requestSequence.current++; };
  }, [load]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 3000);
    return () => window.clearTimeout(timer);
  }, [success]);
  useEffect(() => { if (showCall && !loading) callRef.current?.focus(); }, [showCall, loading]);

  const file = workspace?.files[fileIndex];
  const fileKey = file ? `${workspace?.sourceSha256}:${file.kind}:${file.parentId}:${file.id}` : "";
  useEffect(() => {
    if (!file || file.unavailableReason) return;
    const controller = new AbortController();
    let objectUrl = "";
    void (async () => {
      try {
        await Promise.resolve();
        if (controller.signal.aborted) return;
        setPreview(null); setPreviewError(""); setPreviewLoading(true);
        if (!file.previewPath.startsWith("/api/creditex/") || file.previewPath.startsWith("//")) throw new Error("The private preview address is invalid.");
        const token = await user.getIdToken();
        const response = await fetch(file.previewPath, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(result?.error || "This file could not be opened. Your access or the evidence may have changed.");
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl, type: blob.type.split(";")[0].toLowerCase(), key: fileKey });
      } catch (failure) {
        if (!controller.signal.aborted) setPreviewError(failure instanceof Error ? failure.message : "The private preview could not be loaded.");
      } finally { if (!controller.signal.aborted) setPreviewLoading(false); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, fileKey, user, previewRetry]);

  async function save(action: CreditexJobAuditSaveInput["action"]) {
    if (!workspace || saving) return;
    const current = sequence.current;
    const payload = { intentId, expectedAuditRevision: workspace.checklist?.revision || 0,
      expectedSourceSha256: workspace.sourceSha256, action, answers, callOutcome, callReason, callId, note };
    const signature = JSON.stringify(payload);
    if (requestId.current?.signature !== signature) requestId.current = { signature, id: crypto.randomUUID() };
    setSaving(true); setError(""); setSuccess("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: requestId.current.id }) });
      const result: { ok: boolean; error?: string; workspace?: CreditexJobAuditWorkspace } = await response.json();
      if (!response.ok || !result.ok || !result.workspace) throw new Error(result.error || "The audit could not be saved.");
      if (current !== sequence.current) return;
      apply(result.workspace); requestId.current = null;
      setSuccess(action === "save" ? "Draft saved." : action === "audited" ? "Audit completed." : "Correction requested.");
      onChanged();
    } catch (failure) { if (current === sequence.current) setError(failure instanceof Error ? failure.message : "The audit could not be saved."); }
    finally { if (current === sequence.current) setSaving(false); }
  }

  function close() { if (!saving && (!dirty || window.confirm("Discard the unsaved audit answers?"))) onClose(); }
  const record = workspace?.records[recordIndex];
  const currentPreview = preview?.key === fileKey ? preview : null;
  const canComplete = workspace?.capabilities.canComplete && creditexJobAuditComplete(answers, callOutcome, callReason);
  return <section id="creditex-full-audit-workspace" className={styles.desk} aria-labelledby="creditex-full-audit-title">
    <header className={styles.header}><div><span className={styles.eyebrow}>Job audit</span><h2 id="creditex-full-audit-title" tabIndex={-1} ref={headingRef}>{workspace ? `${workspace.target.jobNumber} · ${workspace.target.customerName}` : "Review job"}</h2>{workspace && <p>{workspace.target.activityTitle || workspace.target.jobTitle}</p>}</div><button type="button" onClick={close} disabled={saving}>Back to jobs</button></header>
    {loading && <p role="status">Loading answers and private files...</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" disabled={saving} onClick={() => { if (!dirty || window.confirm("Reload this job and discard the unsaved audit answers?")) void load(); }}>Reload job</button></div>}
    {success && <p role="status" className={styles.success}>{success}</p>}
    {!loading && workspace && <>
      <div className={styles.summary}><div><span>Customer &amp; site</span><strong>{workspace.target.customerName}</strong><p>{workspace.target.siteAddress || "Address not recorded"}</p>{workspace.target.addressReviewRequired && <p className={styles.warning}>Manual address: compare it with the job evidence.</p>}<p>{workspace.target.customerPhone || "Phone not recorded"}</p></div><div><span>Activity</span><strong>{displayDate(workspace.target.activityDate)}</strong><p>{workspace.target.assignee || "Assignee not recorded"}</p></div><div><span>Review status</span><strong>{workspace.auditCompleted ? "Audit completed" : workspace.checklist?.outcome === "correction_required" ? "Correction required" : "Awaiting audit"}</strong><p>{workspace.submissionReady ? "Submission approval recorded" : "Submission approval remains separate"}</p>{workspace.checklist && workspace.checklist.sourceSha256 !== workspace.sourceSha256 && <p className={styles.warning}>The job has changed since this audit. Review the current evidence before completing it again.</p>}</div></div>
      <div className={styles.layout}>
        <div className={styles.review}>
          <section className={styles.card} aria-label="Field answers">
            <header><h3>Field answers</h3><span>{workspace.records.length} forms</span></header>
            {workspace.records.length > 0 ? <>
              <label className={styles.control}>Form<select value={recordIndex} onChange={event => setRecordIndex(Number(event.target.value))}>{workspace.records.map((item, index) => <option key={`${item.kind}:${item.id}`} value={index}>{item.title} · {item.status}</option>)}</select></label>
              {record && <><p className={styles.muted}>Revision {record.revision} · Saved {displayDate(record.updatedAt)}</p><dl className={styles.answers}>{record.answers.map((answer, index) => <div key={`${answer.key}:${index}`}><dt>{answer.section && <small>{answer.section}</small>}{answer.label}</dt><dd><AnswerValue value={answer.value} /></dd></div>)}</dl>{!record.answers.length && <p>No answers recorded in this form.</p>}</>}
            </> : <p>No field forms have been submitted for this job.</p>}
          </section>
          <section className={styles.card} aria-label="Job files">
            <header><h3>Files &amp; photos</h3><span>{workspace.files.length} files</span></header>
            {file ? <>
              <label className={styles.control}>File<select aria-label="Select file to preview" value={fileIndex} onChange={event => setFileIndex(Number(event.target.value))}>{workspace.files.map((item, index) => <option key={`${item.kind}:${item.parentId}:${item.id}`} value={index}>{index + 1}. {item.label}</option>)}</select></label>
              <div className={styles.preview} aria-busy={previewLoading}>
                {file.unavailableReason && <p>{file.unavailableReason}</p>}
                {!file.unavailableReason && previewLoading && <p role="status">Opening private file...</p>}
                {!file.unavailableReason && previewError && <div role="alert"><p>{previewError}</p><button type="button" onClick={() => setPreviewRetry(value => value + 1)}>Retry preview</button></div>}
                {currentPreview && (/^image\/(png|jpeg|webp|gif|avif)$/.test(currentPreview.type)
                  ? <Image src={currentPreview.url} alt={file.label} width={1200} height={900} unoptimized />
                  : currentPreview.type === "application/pdf" ? <iframe src={currentPreview.url} title={`Preview: ${file.label}`} />
                  : /^audio\//.test(currentPreview.type) ? <audio controls src={currentPreview.url} aria-label={file.label} />
                  : /^video\/(mp4|webm|ogg)$/.test(currentPreview.type) ? <video controls src={currentPreview.url} aria-label={file.label} />
                  : <p>Preview is unavailable for this file type. Download it to review.</p>)}
              </div>
              <nav className={styles.fileNav} aria-label="File previews"><button type="button" disabled={fileIndex === 0} onClick={() => setFileIndex(value => value - 1)}>Previous</button><span aria-live="polite">{fileIndex + 1} of {workspace.files.length}</span><button type="button" disabled={fileIndex >= workspace.files.length - 1} onClick={() => setFileIndex(value => value + 1)}>Next</button>{currentPreview && <a href={currentPreview.url} download={file.label}>Download</a>}</nav>
            </> : <p>No files have been submitted for this job.</p>}
          </section>
        </div>
        <section className={`${styles.card} ${styles.checklist}`} aria-label="Verification call and audit">
          <header><div><span className={styles.eyebrow}>Verification</span><h3>Quick audit</h3></div>{actorMode === "creditex" && workspace.capabilities.canCall && workspace.target.customerPhone && <button type="button" aria-expanded={showCall} onClick={() => setShowCall(value => !value)}>Call customer</button>}</header>
          {actorMode === "creditex" && workspace.capabilities.canCall && showCall && <div tabIndex={-1} ref={callRef} aria-label="Customer audit call controls"><CreditexAuditCallPanel user={user} jobIntentId={intentId} selectedCallId={callId} onCallSelected={saving || !workspace.capabilities.canSave ? undefined : selectAuditCall} /></div>}
          {callId && <p className={styles.muted}>A completed call is linked to this audit. <button type="button" disabled={saving} onClick={() => { setCallId(""); setDirty(true); }}>Remove link</button></p>}
          <fieldset disabled={saving || !workspace.capabilities.canSave} className={styles.questions}>
            <legend>Confirm the work and record the result</legend>
            <label className={styles.control}>Customer call<select value={callOutcome} onChange={event => { const value = event.target.value; if (value === "completed" || value === "unavailable" || value === "not_required") { setCallOutcome(value); setDirty(true); } }}><option value="unavailable">Not reached / not yet called</option><option value="completed">Call completed</option><option value="not_required">Call not required</option></select></label>
            {callOutcome === "not_required" && <label className={styles.control}>Reason a call is not required<input value={callReason} maxLength={1000} onChange={event => { setCallReason(event.target.value); setDirty(true); }} required /></label>}
            {CREDITEX_JOB_AUDIT_QUESTIONS.map(question => <fieldset key={question.key} className={styles.question}><legend>{question.label}</legend><div>{([['yes', 'Yes'], ['no', 'No'], ['not_checked', 'Not checked']] as const).map(([value, label]) => <label key={value} data-selected={answers[question.key] === value}><input type="radio" name={`audit-${intentId}-${question.key}`} value={value} checked={answers[question.key] === value} onChange={() => { setAnswers(current => ({ ...current, [question.key]: value })); setDirty(true); }} />{label}</label>)}</div></fieldset>)}
            <label className={styles.control}>Notes / correction details<textarea rows={3} maxLength={2000} value={note} onChange={event => { setNote(event.target.value); setDirty(true); }} placeholder="Only add what the next person needs to know." /></label>
          </fieldset>
          {workspace.capabilities.reason && <p className={styles.warning}>{workspace.capabilities.reason}</p>}
          <div className={styles.actions}><button type="button" disabled={saving || !workspace.capabilities.canSave} onClick={() => void save("save")}>{saving ? "Saving..." : "Save draft"}</button><button type="button" className={styles.correction} disabled={saving || !workspace.capabilities.canRequestCorrection || !note.trim()} onClick={() => void save("correction_required")}>Correction required</button><button type="button" className={styles.primary} disabled={saving || !canComplete} onClick={() => void save("audited")}>Mark audited</button></div>
          <p className={styles.muted}>Complete each check to mark audited. Add correction details to return the job for changes.</p>
          {workspace.history.length > 0 && <details className={styles.history}><summary>Audit history ({workspace.history.length})</summary><ol>{workspace.history.map(item => <li key={item.id}><strong>{item.outcome === "audited" ? "Audit completed" : item.outcome === "correction_required" ? "Correction required" : "Draft saved"}</strong><span>{item.actorName} · {displayDate(item.createdAt)}</span>{item.note && <p>{item.note}</p>}</li>)}</ol></details>}
        </section>
      </div>
      <details className={styles.management}><summary>Job management</summary>{dirty || saving ? <p>Save your audit answers before managing this job.</p> : <CreditexJobLifecycleActions user={user} intentId={intentId} actorMode={actorMode} onChanged={() => { void load(); onChanged(); }} />}</details>
    </>}
  </section>;
}
