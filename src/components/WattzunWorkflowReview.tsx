"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { createTradeBusinessFetch } from "@/lib/trade-business-client";
import { isWattzunWorkflowResult, type WattzunWorkflowOperation, type WattzunWorkflowRequest, type WattzunWorkflowResult } from "@/lib/wattzun-workflow";
import styles from "./WattzunWorkflowReview.module.css";

type Props = {
  user: User;
  scopeId: string;
  proposal: WattzunWorkflowOperation;
  initialResult?: WattzunWorkflowResult;
  onResult: (result: WattzunWorkflowResult) => void;
  onNavigate?: (href: string) => void;
  onCancel: () => void;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resultForOperation(value: unknown, operation: WattzunWorkflowOperation): value is WattzunWorkflowResult {
  if (!isWattzunWorkflowResult(value)) return false;
  if (value.state === "review") return value.kind === operation.kind;
  if (value.state === "choose_job") return value.proposal.kind === operation.kind;
  if (value.state === "complete") return value.receipt.kind === operation.kind;
  return true;
}

function jobDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeZone: "Australia/Sydney" }).format(date);
}

/** A new actor, business or proposal gets a new review and aborts the old request. */
export function WattzunWorkflowReview(props: Props) {
  const key = `${props.user.uid}:${props.scopeId}:${JSON.stringify(props.proposal)}`;
  return <WorkflowReviewSession key={key} {...props} />;
}

function WorkflowReviewSession(props: Props) {
  const { proposal, scopeId } = props;
  const initial = resultForOperation(props.initialResult, proposal) ? props.initialResult : null;
  const [result, setResult] = useState<WattzunWorkflowResult | null>(initial);
  const [busy, setBusy] = useState(initial ? "" : "prepare");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [rejected, setRejected] = useState(false);
  const callbacks = useRef(props);
  const mounted = useRef(true);
  const activeRequest = useRef<AbortController | null>(null);
  const currentProposal = useRef(proposal);
  const submitted = useRef<WattzunWorkflowRequest | null>(null);
  const started = useRef(false);
  const externalResult = useRef(initial ? JSON.stringify(initial) : "");
  const completed = useRef(initial?.state === "complete");

  useLayoutEffect(() => { callbacks.current = props; });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRequest.current?.abort(); activeRequest.current = null; started.current = false; };
  }, []);

  const adoptExternalResult = useCallback((incoming: WattzunWorkflowResult) => {
    if (completed.current && incoming.state !== "complete") return;
    if (incoming.state === "complete") completed.current = true;
    activeRequest.current?.abort(); activeRequest.current = null;
    submitted.current = null;
    setResult(incoming); setBusy(""); setError(""); setUncertain(false); setRejected(false);
  }, []);
  useLayoutEffect(() => {
    if (!initial) return;
    const identity = JSON.stringify(initial);
    if (identity === externalResult.current) return;
    externalResult.current = identity;
    adoptExternalResult(initial);
  }, [adoptExternalResult, initial]);

  const request = useCallback(async (body: WattzunWorkflowRequest) => {
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45_000);
    // An earlier execution may already have succeeded even if this recovery
    // attempt fails before its request reaches the server.
    let sent = body.stage === "execute" && uncertain;
    try {
      const token = await callbacks.current.user.getIdToken();
      if (!mounted.current || activeRequest.current !== controller) return;
      if (controller.signal.aborted) throw new Error("The request took too long.");
      sent = true;
      const scopedFetch = createTradeBusinessFetch(scopeId, window.location.origin, fetch);
      const response = await scopedFetch("/api/wattzun/workflows", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body), cache: "no-store", signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!mounted.current || activeRequest.current !== controller) return;
      if (controller.signal.aborted) throw new Error("The request took too long.");
      if (!response.ok || !record(payload) || payload.ok !== true || !resultForOperation(payload.result, currentProposal.current)) {
        const definiteRejection = response.status >= 400 && response.status < 500 && response.status !== 408;
        if (body.stage === "execute" && definiteRejection && !uncertain) {
          setRejected(true); submitted.current = null; sent = false;
        }
        throw new Error(record(payload) && typeof payload.error === "string" ? payload.error : "TLink did not return a confirmed workflow result.");
      }
      if (payload.result.state === "complete") completed.current = true;
      setResult(payload.result); setUncertain(false); setRejected(false);
      callbacks.current.onResult(payload.result);
    } catch (cause) {
      if (!mounted.current || activeRequest.current !== controller) return;
      const message = cause instanceof Error ? cause.message : "The workflow could not be completed.";
      if (body.stage === "execute" && sent) {
        setUncertain(true);
        setError(`${message} The result is not confirmed. Retry the same review to recover its status safely.`);
      } else {
        if (body.stage === "execute") submitted.current = null;
        setError(controller.signal.aborted ? "The request took too long. Try preparing again." : message);
      }
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        if (mounted.current) setBusy("");
      }
    }
  }, [scopeId, uncertain]);

  const prepare = useCallback((operation: WattzunWorkflowOperation) => {
    if (activeRequest.current) return;
    currentProposal.current = operation;
    submitted.current = null;
    setResult(null); setError(""); setUncertain(false); setRejected(false); setBusy("prepare");
    void request({ stage: "prepare", portal: "trade", scopeId, requestId: crypto.randomUUID(), proposal: operation });
  }, [request, scopeId]);

  const execute = useCallback(() => {
    if (activeRequest.current || !result || result.state !== "review" || rejected) return;
    if (!submitted.current) submitted.current = {
      stage: "execute", portal: "trade", scopeId, requestId: crypto.randomUUID(), reviewId: result.reviewId, reviewed: true,
    };
    setBusy("execute"); setError("");
    void request(submitted.current);
  }, [rejected, request, result, scopeId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!initial) prepare(proposal);
  }, [initial, prepare, proposal]);

  const locked = Boolean(busy) || uncertain;
  const heading = result?.state === "review" ? result.heading
    : result?.state === "choose_job" ? "Choose the right job"
      : result?.state === "needs_details" ? "A few details to finish this"
        : result?.state === "complete" ? result.receipt.label : "Preparing your task";

  return <section className={styles.review} aria-label="Review Wattzun workflow" aria-busy={Boolean(busy)}>
    <h3>{heading}</h3>
    {busy === "prepare" && <p role="status">Checking the current job, permissions and details...</p>}
    {result?.state === "choose_job" && <>
      <p>{result.question}</p>
      <div className={styles.matches}>{result.choices.map(choice => <button type="button" key={choice.jobId} disabled={locked} onClick={() => {
        const operation = result.proposal;
        if (operation.kind !== "add_price_book_item") prepare({ ...operation, jobId: choice.jobId });
      }}><strong>{choice.customerName || choice.title || choice.workNumber}</strong>
        <span>{choice.address || "No saved address"}</span>
        <span>{[choice.workNumber, choice.title].filter(Boolean).join(" · ")}</span>
        {choice.completedAt ? <span>Completed {jobDate(choice.completedAt)}</span> : choice.scheduledAt ? <span>Scheduled {jobDate(choice.scheduledAt)}</span> : <span>No saved visit date</span>}
      </button>)}</div>
      {!result.choices.length && <p>Tell Wattzun the customer name, job number or address to narrow the search.</p>}
    </>}
    {result?.state === "needs_details" && <>
      <ul>{result.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>
      <p>Answer Wattzun by voice or in the message box to continue.</p>
    </>}
    {result?.state === "review" && <>
      <p>{result.summary}</p>
      {result.target && <div className={styles.job} aria-label="Selected job">
        <strong>{result.target.customerName || result.target.title || result.target.workNumber}</strong>
        <span>{result.target.address || "No saved address"}</span>
        <span>{[result.target.workNumber, result.target.title].filter(Boolean).join(" · ")}</span>
      </div>}
      <dl className={styles.details}>{result.lines.map((line, index) => <div key={index}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl>
      {result.preview && <div className={styles.message} aria-label="Message preview">
        {result.preview.subject && <strong>{result.preview.subject}</strong>}
        <span>{result.preview.body}</span>
      </div>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={Boolean(busy) || rejected} onClick={execute}>
          {busy === "execute" ? "Completing your task..." : uncertain ? "Retry the same review" : result.confirmationLabel}
        </button>
        {rejected && <button type="button" onClick={() => prepare(currentProposal.current)}>Prepare a fresh review</button>}
      </div>
      {uncertain && <p>Your submitted details stay fixed during recovery. A retry checks the same request.</p>}
      {!uncertain && !rejected && <p className={styles.note}>To change these details, tell Wattzun what to update before confirming.</p>}
    </>}
    {result?.state === "complete" && <>
      <p role={result.receipt.status === "failed" || result.receipt.status === "unknown" ? "alert" : "status"}>{result.receipt.message}</p>
      <dl className={styles.details}><div><dt>Recorded status</dt><dd>{result.receipt.status}</dd></div></dl>
      {props.onNavigate && <button type="button" onClick={() => callbacks.current.onNavigate?.(result.receipt.href)}>{result.receipt.label}</button>}
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!result && !busy && <button type="button" onClick={() => prepare(currentProposal.current)}>Try preparing again</button>}
    <div className={styles.actions}><button type="button" disabled={locked} onClick={() => callbacks.current.onCancel()}>{result?.state === "complete" ? "Close task" : "Cancel task"}</button></div>
    <p className={styles.note}>Your call can continue while you choose, review or open the saved result.</p>
  </section>;
}
