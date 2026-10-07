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
import type { CreditexAuditAiReview, CreditexAuditAiSource } from "@/lib/creditex-job-audit-ai";
import { requestWattzunAssistant } from "@/lib/wattzun-appearance";
import { creditexAuditFromSearch, creditexAuditPanelFromHash } from "@/lib/creditex-workspace-navigation";

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
  const [correctionTarget, setCorrectionTarget] = useState("");
  const [closingFinding, setClosingFinding] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [reviewedEvidenceId, setReviewedEvidenceId] = useState("");
  const [aiReview, setAiReview] = useState<CreditexAuditAiReview | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [wattzunLoading, setWattzunLoading] = useState(false);
  const [wattzunError, setWattzunError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const callRef = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const requestId = useRef<{ signature: string; id: string } | null>(null);
  const endpoint = `/api/creditex/job-audit?intentId=${encodeURIComponent(intentId)}&actorMode=${actorMode === "admin" ? "admin" : "compliance"}`;
  const hasUnsaved = dirty || Boolean(resolutionNote.trim());

  const apply = useCallback((next: CreditexJobAuditWorkspace) => {
    setWorkspace(next);
    setAnswers(next.checklist?.answers || emptyCreditexJobAuditAnswers());
    setCallOutcome(next.checklist?.callOutcome || "unavailable");
    setCallReason(next.checklist?.callReason || "");
    setCallId(next.checklist?.callId || "");
    setNote(next.checklist?.note || "");
    setCorrectionTarget(""); setClosingFinding(""); setResolutionNote(""); setReviewedEvidenceId("");
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
      setAiReview(null); setAiError(""); setAiLoading(false);
      setWattzunError(""); setWattzunLoading(false);
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
  useEffect(() => { onDirtyChange?.(hasUnsaved); return () => onDirtyChange?.(false); }, [hasUnsaved, onDirtyChange]);
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 3000);
    return () => window.clearTimeout(timer);
  }, [success]);
  useEffect(() => { if (showCall && !loading) callRef.current?.focus(); }, [showCall, loading]);
  useEffect(() => {
    if (!workspace || actorMode !== "creditex") return;
    const revealSource = () => {
      if (creditexAuditFromSearch(window.location.search) !== workspace.target.intentId) return;
      const panel = creditexAuditPanelFromHash(window.location.hash);
      const target = panel ? document.getElementById(panel) : null;
      target?.closest("details")?.setAttribute("open", "");
      target?.scrollIntoView({ block: "center", behavior: "smooth" }); target?.focus();
    };
    const frame = window.requestAnimationFrame(revealSource);
    window.addEventListener("popstate", revealSource);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("popstate", revealSource); };
  }, [workspace, actorMode]);

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
    const correctionFile = workspace.files.find(item => JSON.stringify([item.kind, item.id, item.parentId]) === correctionTarget);
    const correctionRequirement = workspace.requirements.find(item => `requirement:${item.id}` === correctionTarget);
    const correction = correctionFile ? { file: { kind: correctionFile.kind, id: correctionFile.id, parentId: correctionFile.parentId } }
      : correctionRequirement ? { requirementId: correctionRequirement.id } : undefined;
    const payload = { intentId, expectedAuditRevision: workspace.checklist?.revision || 0,
      expectedSourceSha256: workspace.sourceSha256, action, answers, callOutcome, callReason, callId, note,
      ...(action === "correction_required" && correction ? { correction } : {}) };
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

  async function closeFinding() {
    if (!workspace || saving || !closingFinding || !resolutionNote.trim()) return;
    const current = sequence.current;
    const payload = { action: "resolve_finding", intentId, expectedSourceSha256: workspace.sourceSha256,
      findingId: closingFinding, resolutionNote, reviewedEvidenceId };
    const signature = JSON.stringify(payload);
    if (requestId.current?.signature !== signature) requestId.current = { signature, id: crypto.randomUUID() };
    setSaving(true); setError(""); setSuccess("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: requestId.current.id }) });
      const result: { ok: boolean; error?: string; workspace?: CreditexJobAuditWorkspace } = await response.json();
      if (!response.ok || !result.ok || !result.workspace) throw new Error(result.error || "The correction could not be closed.");
      if (current !== sequence.current) return;
      // Closing a finding must not discard an audit checklist the reviewer is still drafting.
      setWorkspace(result.workspace); setClosingFinding(""); setResolutionNote(""); setReviewedEvidenceId(""); requestId.current = null;
      setSuccess("Correction closed. Submission approval remains separate."); onChanged();
    } catch (failure) { if (current === sequence.current) setError(failure instanceof Error ? failure.message : "The correction could not be closed."); }
    finally { if (current === sequence.current) setSaving(false); }
  }

  async function reviewWithAi() {
    if (!workspace || aiLoading || !workspace.capabilities.canSave) return;
    const current = sequence.current;
    setAiLoading(true); setAiError(""); setAiReview(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/creditex/job-audit/ai?actorMode=${actorMode === "admin" ? "admin" : "compliance"}`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ intentId, expectedSourceSha256: workspace.sourceSha256, requestId: crypto.randomUUID() }),
      });
      const result: { ok: boolean; error?: string; review?: CreditexAuditAiReview } = await response.json();
      if (!response.ok || !result.ok || !result.review) throw new Error(result.error || "AI assistance is unavailable. Continue with the manual audit.");
      if (current === sequence.current) setAiReview(result.review);
    } catch (failure) { if (current === sequence.current) setAiError(failure instanceof Error ? failure.message : "AI assistance is unavailable."); }
    finally { if (current === sequence.current) setAiLoading(false); }
  }
  function viewAiSource(source: CreditexAuditAiSource) {
    if (!workspace) return;
    if (source.kind === "file") {
      const index = workspace.files.findIndex(file => file.id === source.fileId && file.kind === source.fileKind && file.parentId === source.parentId);
      if (index >= 0) setFileIndex(index);
    } else if (source.kind === "record") {
      const index = workspace.records.findIndex(record => record.id === source.recordId && record.kind === source.recordKind);
      if (index >= 0) setRecordIndex(index);
    }
    const target = document.getElementById(source.kind === "file" ? "audit-files" : source.kind === "finding" ? `audit-finding-${source.findingId}` : source.kind === "requirement" ? `audit-requirement-${source.requirementId}` : source.kind === "job" ? "creditex-full-audit-title" : "audit-records");
    target?.closest("details")?.setAttribute("open", "");
    target?.scrollIntoView({ block: "center", behavior: "smooth" }); target?.focus();
  }

  async function askWattzun() {
    if (!workspace?.capabilities.canSave || actorMode !== "creditex" || saving || wattzunLoading) return;
    const current = sequence.current;
    setWattzunLoading(true); setWattzunError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/wattzun/portal?portal=creditex", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result: { scopes?: { portal: string; scopeId: string }[] } = await response.json();
      if (!response.ok || !Array.isArray(result.scopes) || result.scopes.length !== 1 || result.scopes[0].portal !== "creditex"
        || typeof result.scopes[0].scopeId !== "string" || !result.scopes[0].scopeId) throw new Error("Reopen your Creditex workspace before asking Wattzun about this audit.");
      if (current !== sequence.current) return;
      const opened = await requestWattzunAssistant({ userUid: user.uid, portal: "creditex", scopeId: result.scopes[0].scopeId,
        mode: "message", workReference: { kind: "creditex_audit", recordId: intentId },
        initialMessage: "Summarise this audit, supported gaps and the next review steps." });
      if (!opened && current === sequence.current) setWattzunError("Wattzun could not open. Try again from the current Creditex workspace.");
    } catch (failure) { if (current === sequence.current) setWattzunError(failure instanceof Error ? failure.message : "Wattzun is unavailable. Continue with the audit desk."); }
    finally { if (current === sequence.current) setWattzunLoading(false); }
  }

  function close() { if (!saving && (!hasUnsaved || window.confirm("Discard the unsaved audit changes?"))) onClose(); }
  const record = workspace?.records[recordIndex];
  const currentPreview = preview?.key === fileKey ? preview : null;
  const canComplete = workspace?.capabilities.canComplete && creditexJobAuditComplete(answers, callOutcome, callReason);
  return <section id="creditex-full-audit-workspace" className={styles.desk} aria-labelledby="creditex-full-audit-title">
    <header className={styles.header}><div><span className={styles.eyebrow}>Job audit</span><h2 id="creditex-full-audit-title" tabIndex={-1} ref={headingRef}>{workspace ? `${workspace.target.jobNumber} · ${workspace.target.customerName}` : "Review job"}</h2>{workspace && <p>{workspace.target.activityTitle || workspace.target.jobTitle}</p>}</div><button type="button" onClick={close} disabled={saving}>Back to jobs</button></header>
    {loading && <p role="status">Loading answers and private files...</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p><button type="button" disabled={saving} onClick={() => { if (!hasUnsaved || window.confirm("Reload this job and discard the unsaved audit changes?")) void load(); }}>Reload job</button></div>}
    {success && <p role="status" className={styles.success}>{success}</p>}
    {!loading && workspace && <>
      {actorMode === "creditex" && workspace.capabilities.canSave && <div><button type="button" onClick={() => void askWattzun()} disabled={saving || wattzunLoading}>{wattzunLoading ? "Opening Wattzun..." : "Ask Wattzun about this audit"}</button>{wattzunError && <p role="alert">{wattzunError}</p>}</div>}
      <div className={styles.summary}><div><span>Customer &amp; site</span><strong>{workspace.target.customerName}</strong><p>{workspace.target.siteAddress || "Address not recorded"}</p>{workspace.target.addressReviewRequired && <p className={styles.warning}>Manual address: compare it with the job evidence.</p>}<p>{workspace.target.customerPhone || "Phone not recorded"}</p></div><div><span>Activity</span><strong>{displayDate(workspace.target.activityDate)}</strong><p>{workspace.target.assignee || "Assignee not recorded"}</p></div><div><span>Review status</span><strong>{workspace.auditCompleted ? "Audit completed" : workspace.checklist?.outcome === "correction_required" ? "Correction required" : "Awaiting audit"}</strong><p>{workspace.submissionReady ? "Submission approval recorded" : "Submission approval remains separate"}</p>{workspace.checklist && workspace.checklist.sourceSha256 !== workspace.sourceSha256 && <p className={styles.warning}>The job has changed since this audit. Review the current evidence before completing it again.</p>}</div></div>
      <div className={styles.layout}>
        <div className={styles.review}>
          <section id="audit-records" tabIndex={-1} className={styles.card} aria-label="Field answers">
            <header><h3>Field answers</h3><span>{workspace.records.length} forms</span></header>
            {workspace.records.length > 0 ? <>
              <label className={styles.control}>Form<select value={recordIndex} onChange={event => setRecordIndex(Number(event.target.value))}>{workspace.records.map((item, index) => <option key={`${item.kind}:${item.id}`} value={index}>{item.title} · {item.status}</option>)}</select></label>
              {record && <><p className={styles.muted}>Revision {record.revision} · Saved {displayDate(record.updatedAt)}</p><dl className={styles.answers}>{record.answers.map((answer, index) => <div key={`${answer.key}:${index}`}><dt>{answer.section && <small>{answer.section}</small>}{answer.label}</dt><dd><AnswerValue value={answer.value} /></dd></div>)}</dl>{!record.answers.length && <p>No answers recorded in this form.</p>}</>}
            </> : <p>No field forms have been submitted for this job.</p>}
          </section>
          <section id="audit-files" tabIndex={-1} className={styles.card} aria-label="Job files">
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
              {workspace.capabilities.canRequestCorrection && !file.unavailableReason && <button type="button" disabled={saving} onClick={() => { setCorrectionTarget(JSON.stringify([file.kind, file.id, file.parentId])); setDirty(true); }}>Use this file in correction</button>}
            </> : <p>No files have been submitted for this job.</p>}
          </section>
          {workspace.findings.length > 0 && <section id="audit-findings" tabIndex={-1} className={styles.card} aria-label="Corrections and closeout">
            <header><h3>Corrections and closeout</h3><span>{workspace.findings.filter(finding => finding.status === "open").length} open</span></header>
            <p className={styles.muted}>The assigned technician corrects the job. Creditex reviews the current evidence and closes each finding.</p>
            <ol className={styles.findings}>{workspace.findings.map(finding => <li key={finding.id} id={`audit-finding-${finding.id}`} tabIndex={-1}>
              <strong>{finding.requirementTitle || finding.evidenceLabel || "Case finding"}</strong>
              <span className={styles.muted}>{finding.status === "open" ? "Awaiting Creditex closeout" : "Closed"} · {displayDate(finding.raisedAt)}</span>
              <p>{finding.description}</p>
              {finding.evidenceLabel && <p className={styles.muted}>Original: {finding.evidenceLabel}</p>}
              {finding.evidenceId && workspace.files.some(item => item.kind === "case_evidence" && item.id === finding.evidenceId && !item.unavailableReason) && <button type="button" onClick={() => setFileIndex(workspace.files.findIndex(item => item.kind === "case_evidence" && item.id === finding.evidenceId))}>View original evidence</button>}
              {finding.status !== "open" && <><p>Review: {finding.resolutionNote || "Recorded in case history"}</p>{finding.reviewedEvidenceLabel && <p className={styles.muted}>Evidence reviewed: {finding.reviewedEvidenceLabel}</p>}<p className={styles.muted}>Closed {displayDate(finding.resolvedAt)}</p></>}
              {finding.status === "open" && workspace.capabilities.canResolveFindings && <>
                <button type="button" disabled={saving} aria-expanded={closingFinding === finding.id} onClick={() => { if (!resolutionNote.trim() || window.confirm("Discard the unsaved correction review?")) { setClosingFinding(closingFinding === finding.id ? "" : finding.id); setResolutionNote(""); setReviewedEvidenceId(""); } }}>Review correction</button>
                {closingFinding === finding.id && <div className={styles.closeout}>
                  <label className={styles.control}>Evidence checked (optional)<select value={reviewedEvidenceId} disabled={saving} onChange={event => setReviewedEvidenceId(event.target.value)}><option value="">Explained in review note</option>{workspace.files.filter(item => item.kind === "case_evidence" && !item.unavailableReason && (!finding.requirementId || item.requirementId === finding.requirementId) && ["received", "under_review", "accepted"].includes(item.evidenceStatus || "")).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                  {reviewedEvidenceId && <button type="button" onClick={() => setFileIndex(workspace.files.findIndex(item => item.kind === "case_evidence" && item.id === reviewedEvidenceId))}>View selected evidence</button>}
                  <label className={styles.control}>How was this resolved?<textarea rows={3} maxLength={2000} value={resolutionNote} disabled={saving} onChange={event => setResolutionNote(event.target.value)} placeholder="Record the corrected detail and what you checked." /></label>
                  <button type="button" disabled={saving || !resolutionNote.trim()} onClick={() => void closeFinding()}>Close correction</button>
                </div>}
              </>}
            </li>)}</ol>
          </section>}
          {workspace.requirements.length > 0 && <details id="audit-requirements" tabIndex={-1} className={styles.card}><summary>Case evidence requirements ({workspace.requirements.length})</summary><dl className={styles.answers}>{workspace.requirements.map(requirement => <div key={requirement.id} id={`audit-requirement-${requirement.id}`} tabIndex={-1}><dt>{requirement.title}</dt><dd>{requirement.description || "Review the governed requirement and its linked evidence."}</dd></div>)}</dl></details>}
          <section className={styles.card} aria-label="AI pre-review">
            <header><h3>AI pre-review</h3><button type="button" disabled={aiLoading || saving || !workspace.capabilities.canSave} onClick={() => void reviewWithAi()}>{aiLoading ? "Reviewing recorded information..." : "Review with AI"}</button></header>
            <p className={styles.muted}>Optional assistance with saved answers, case requirements and file metadata. AI does not inspect photos, PDFs, signatures or call recordings. A Creditex reviewer makes every decision.</p>
            {aiError && <p role="alert" className={styles.warning}>{aiError}</p>}
            {aiReview && aiReview.sourceSha256 !== workspace.sourceSha256 && <p role="status" className={styles.warning}>The job changed. Run AI pre-review again for the current evidence.</p>}
            {aiReview?.sourceSha256 === workspace.sourceSha256 && <><p>{aiReview.summary}</p><ol className={styles.findings}>{aiReview.items.map((item,index) => <li key={index}><strong>{item.kind === "contradiction" ? "Check conflicting information" : item.kind === "missing_information" ? "Check missing information" : "Review point"}</strong><p>{item.detail}</p><div className={styles.citations}>{item.sources.map(source => <button type="button" key={source.id} onClick={() => viewAiSource(source)}>View {source.label}</button>)}</div>{item.suggestedCorrection && <><p>Suggested wording: {item.suggestedCorrection}</p><button type="button" disabled={saving || !workspace.capabilities.canRequestCorrection} onClick={() => { if (!note.trim() || window.confirm("Replace your current correction note with this AI suggestion?")) { setNote(item.suggestedCorrection); setDirty(true); } }}>Use wording in correction note</button></>}</li>)}</ol><p className={styles.muted}>Suggestions only. Nothing has been approved, closed or sent.</p></>}
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
            {workspace.capabilities.canRequestCorrection && (workspace.files.length > 0 || workspace.requirements.length > 0) && <label className={styles.control}>Correction relates to<select value={correctionTarget} onChange={event => { setCorrectionTarget(event.target.value); setDirty(true); }}><option value="">General job correction</option><optgroup label="Files">{workspace.files.filter(item => !item.unavailableReason).map(item => <option key={`${item.kind}:${item.parentId}:${item.id}`} value={JSON.stringify([item.kind, item.id, item.parentId])}>{item.label}</option>)}</optgroup>{workspace.requirements.length > 0 && <optgroup label="Case requirements">{workspace.requirements.map(item => <option key={item.id} value={`requirement:${item.id}`}>{item.title}</option>)}</optgroup>}</select></label>}
          </fieldset>
          {workspace.capabilities.reason && <p className={styles.warning}>{workspace.capabilities.reason}</p>}
          <div className={styles.actions}><button type="button" disabled={saving || !workspace.capabilities.canSave} onClick={() => void save("save")}>{saving ? "Saving..." : "Save draft"}</button><button type="button" className={styles.correction} disabled={saving || !workspace.capabilities.canRequestCorrection || !note.trim()} onClick={() => void save("correction_required")}>Correction required</button><button type="button" className={styles.primary} disabled={saving || !canComplete} onClick={() => void save("audited")}>Mark audited</button></div>
          <p className={styles.muted}>Complete each check to mark audited. Add correction details to return the job for changes.</p>
          {workspace.notifications.length > 0 && <div className={styles.notifications} aria-label="Correction notifications">{workspace.notifications.map(notification => <div key={notification.id}><strong>Technician notification: {notification.status === "accepted" ? "Email accepted by provider" : notification.status}</strong><p>{notification.recipient}</p>{notification.error && <p className={styles.warning}>{notification.error} Open Job management below to review or retry this notification.</p>}</div>)}</div>}
          {workspace.history.length > 0 && <details className={styles.history}><summary>Audit history ({workspace.history.length})</summary><ol>{workspace.history.map(item => <li key={item.id}><strong>{item.outcome === "audited" ? "Audit completed" : item.outcome === "correction_required" ? "Correction required" : "Draft saved"}</strong><span>{item.actorName} · {displayDate(item.createdAt)}</span>{item.note && <p>{item.note}</p>}</li>)}</ol></details>}
        </section>
      </div>
      <details className={styles.management}><summary>Job management</summary>{hasUnsaved || saving ? <p>Save your audit answers before managing this job.</p> : <CreditexJobLifecycleActions user={user} intentId={intentId} actorMode={actorMode} onChanged={() => { void load(); onChanged(); }} />}</details>
    </>}
  </section>;
}
