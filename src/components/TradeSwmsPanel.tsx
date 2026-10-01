"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import type { SwmsAnswers, SwmsPayload, SwmsRecord, SwmsSignatureStroke } from "@/lib/trade-swms";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import { TradeWorkPackSignaturePad } from "./TradeWorkPackSignaturePad";
import { useFormTimeTracking, WorkTimeStatus } from "./TradeWorkTimeTracking";
import styles from "./TradeSwmsPanel.module.css";

export function TradeSwmsPanel({ user, workOrderId, readOnly = false, onChanged }: {
  user: User; workOrderId: string; readOnly?: boolean; onChanged?: () => Promise<void>;
}) {
  const requestFetch = useTradeBusinessFetch();
  const [payload, setPayload] = useState<SwmsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const pending = useRef(false);
  const scope = useRef({ active: true });

  const request = useCallback(async (method: "GET" | "POST" | "PATCH", body?: Record<string, unknown>, signal?: AbortSignal) => {
    const identity = scope.current;
    const token = await user.getIdToken();
    if (!identity.active) throw new DOMException("Job changed", "AbortError");
    const response = await requestFetch(method === "GET" ? `/api/trade-swms?workOrderId=${encodeURIComponent(workOrderId)}` : "/api/trade-swms", {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...body, workOrderId }) : undefined, cache: "no-store", signal,
    });
    const next = await response.json().catch(() => null) as (SwmsPayload & { error?: string }) | null;
    if (!identity.active) throw new DOMException("Job changed", "AbortError");
    if (!response.ok || !next?.ok) throw new Error(next?.error || "The SWMS could not be loaded. Try again.");
    return next;
  }, [requestFetch, user, workOrderId]);

  useEffect(() => {
    const identity = { active: true };
    scope.current = identity;
    const controller = new AbortController();
    void request("GET", undefined, controller.signal).then(next => {
      if (identity.active) setPayload(next);
    }).catch(failure => {
      if (identity.active && failure.name !== "AbortError") setError(failure instanceof Error ? failure.message : "The SWMS could not be loaded.");
    });
    return () => { identity.active = false; controller.abort(); };
  }, [request]);

  async function mutate(method: "POST" | "PATCH", body: Record<string, unknown>, success: string) {
    if (pending.current || readOnly || !payload?.capabilities.canEdit) return false;
    const identity = scope.current;
    pending.current = true; setBusy(true); setError(""); setStatus("");
    try {
      const next = await request(method, { ...body, expectedJobRevision: payload.jobRevision });
      if (!identity.active) return false;
      setPayload(next); setOpen(true); setStatus(success);
      try { await onChanged?.(); }
      catch { if (identity.active) setStatus(`${success} Reopen Files if the list has not refreshed.`); }
      return identity.active;
    } catch (failure) {
      if (identity.active) setError(failure instanceof Error ? failure.message : "The SWMS could not be saved.");
      return false;
    } finally {
      pending.current = false;
      if (identity.active) setBusy(false);
    }
  }

  const record = payload?.record;
  return <section className={styles.panel} aria-label="Optional SWMS">
    <header className={styles.heading}><div><h4>SWMS <span className={styles.badge}>{record?.status === "complete" ? "Signed" : record ? "Draft" : "Optional"}</span></h4>
      <p>Safe work method statement, ready with your business and assigned team member.</p></div>
      {record ? <button type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>{open ? "Close SWMS" : record.status === "complete" || readOnly ? "View SWMS" : "Continue SWMS"}</button>
        : payload && !readOnly && payload.capabilities.canEdit ? <button type="button" disabled={busy} onClick={() => void mutate("POST", { action: "start" }, "SWMS added to this job.")}>{busy ? "Adding..." : "Add SWMS"}</button> : null}
    </header>
    {!payload && !error && <p className={styles.status} role="status">Loading SWMS...</p>}
    {payload && !record && (readOnly || !payload.capabilities.canEdit) && <p className={styles.hint}>{payload.capabilities.reason || "No SWMS has been added to this job."}</p>}
    {payload && record && open && <SwmsEditor key={`${record.id}:${record.revision}`} payload={payload} record={record} readOnly={readOnly} busy={busy}
      onSave={(answers, signature, finalize) => mutate("PATCH", { id: record.id, expectedRevision: record.revision, answers, finalize, ...(finalize ? { signature } : {}) }, finalize ? "Signed SWMS saved in this job’s Files." : "SWMS draft saved.")} />}
    {record?.status === "complete" && !open && <p className={styles.hint}>Signed by {record.signature?.signerName}. The PDF is available in the file list below.</p>}
    {error && <div className={`${styles.status} ${styles.error}`} role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={() => {
      const identity = scope.current;
      setError(""); void request("GET").then(next => { if (identity.active) setPayload(next); })
        .catch(failure => { if (identity.active) setError(failure instanceof Error ? failure.message : "The SWMS could not be loaded."); });
    }}>Reload saved SWMS</button></div>}
    {status && <p className={styles.status} role="status">{status}</p>}
  </section>;
}

function SwmsEditor({ payload, record, readOnly, busy, onSave }: {
  payload: SwmsPayload; record: SwmsRecord; readOnly: boolean; busy: boolean;
  onSave: (answers: SwmsAnswers, signature: readonly SwmsSignatureStroke[], finalize: boolean) => Promise<boolean>;
}) {
  const [answers, setAnswers] = useState(record.answers);
  const [signature, setSignature] = useState<readonly SwmsSignatureStroke[]>(record.signature?.strokes || []);
  const [signatureError, setSignatureError] = useState("");
  const complete = record.status === "complete";
  const disabled = readOnly || complete || !payload.capabilities.canEdit;
  const context = complete ? record.context : payload.context;
  const timing = useFormTimeTracking({ formKind: "swms", formId: record.id, workOrderId: record.workOrderId,
    pageKey: "swms", pageTitle: "Safe work method statement", enabled: !disabled, activateOnOpen: false });

  async function sign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || busy || !payload.capabilities.canSign) return;
    if (!signature.some(stroke => stroke.points.length > 1)) { setSignatureError("Add your signature before saving."); return; }
    setSignatureError("");
    if (await onSave(answers, signature, true)) timing.markCompleted();
  }

  return <div className={styles.body} {...timing.bind}>
    <dl className={styles.context}>
      <div><dt>Business</dt><dd>{context.businessName}{context.abn ? ` | ABN ${context.abn}` : ""}</dd></div>
      <div><dt>Assigned team member</dt><dd>{context.scheduledWorker.name || "Not assigned yet"}</dd></div>
      <div><dt>Job</dt><dd>{context.workNumber} | {context.jobTitle}</dd></div>
      <div><dt>Site</dt><dd>{context.siteAddress || "Include the work location in the work description."}</dd></div>
    </dl>
    <form onSubmit={event => void sign(event)} aria-busy={busy}>
      <div className={styles.fields}>{payload.template.fields.map(field => <label key={field.key}><span>{field.label}</span>
        <small>{field.hint}</small><textarea required={field.required} maxLength={4000} rows={3} disabled={disabled || busy} value={answers[field.key]}
          onChange={event => setAnswers(previous => ({ ...previous, [field.key]: event.target.value }))} /></label>)}</div>
      <p className={styles.declaration}>{payload.template.declaration}</p>
      {(complete || payload.capabilities.canSign) && <div className={styles.signature}><TradeWorkPackSignaturePad label="Team member signature"
        signerName={record.signature?.signerName || context.scheduledWorker.name} signerCapacity="Assigned team member" value={signature}
        disabled={disabled || busy} onChange={strokes => { setSignature(strokes); setSignatureError(""); }} /></div>}
      {!complete && !payload.capabilities.canSign && <p className={styles.hint}>{payload.capabilities.reason || "The assigned team member can sign this SWMS."}</p>}
      {signatureError && <p role="alert" className={styles.error}>{signatureError}</p>}
      {complete && <p className={styles.hint}>Signed {new Date(record.completedAt).toLocaleString("en-AU")}. The signed PDF is available in this job’s Files.</p>}
      {!disabled && <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void onSave(answers, signature, false)}>Save draft</button>
        {payload.capabilities.canSign && <button className={styles.primary} disabled={busy}>{busy ? "Saving..." : "Sign and save to Files"}</button>}</div>}
    </form><WorkTimeStatus />
  </div>;
}
