"use client";

import { useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import type { TradeHubQuestion } from "@/lib/customer-quote-hub";
import { parseTradeHubAssistDraft, type TradeHubAssistDraft, type TradeHubAssistItem } from "@/lib/trade-customer-hub-assist";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import styles from "./TradeCustomerHubAssist.module.css";

export function TradeCustomerHubAssist({ workOrderId, questions, onOpenQuestion }: {
  workOrderId: string; questions: TradeHubQuestion[]; onOpenQuestion?: (id: string) => void;
}) {
  const request = useTradeBusinessFetch(), business = useTradeBusiness();
  const identity = `${firebaseAuth.currentUser?.uid || ""}:${business?.ownerUid || ""}:${workOrderId}`;
  const snapshot = JSON.stringify([identity, questions]);
  const [result, setResult] = useState<{ snapshot: string; draft: TradeHubAssistDraft } | null>(null);
  const [operation, setOperation] = useState<{ snapshot: string; busy: boolean; message: string } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pending.current?.abort(); pending.current = null; };
  }, [snapshot]);
  const busy = operation?.snapshot === snapshot && operation.busy;
  const draft = result?.snapshot === snapshot ? result.draft : null;
  const current = () => active.current && identity === `${firebaseAuth.currentUser?.uid || ""}:${business?.ownerUid || ""}:${workOrderId}` && Boolean(firebaseAuth.currentUser?.emailVerified);

  async function generate() {
    if (pending.current || !current() || !business?.ownerUid) return;
    const controller = new AbortController(); pending.current = controller;
    setResult(null); setOperation({ snapshot, busy: true, message: "" });
    try {
      const token = await firebaseAuth.currentUser?.getIdToken();
      if (!token || !current() || controller.signal.aborted) return;
      const response = await request("/api/trade-customer-hub/assist", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workOrderId, requestId: crypto.randomUUID() }), cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json();
      if (!current() || controller.signal.aborted) return;
      if (!response.ok || !body || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
        throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "The brief could not be generated. Try again later.");
      }
      if (!("brief" in body) || !("draftScope" in body) || !("sourceHash" in body) || typeof body.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(body.sourceHash)) throw new Error("The brief was incomplete. Try again later.");
      const next = parseTradeHubAssistDraft({ brief: body.brief, draftScope: body.draftScope }, ["job", ...questions.map(question => question.id)]);
      setResult({ snapshot, draft: next }); setOperation({ snapshot, busy: false, message: "" });
    } catch (error) {
      if (current() && !controller.signal.aborted) setOperation({ snapshot, busy: false, message: error instanceof Error && !error.message.startsWith("WORKFLOW_AI_") ? error.message : "The brief was incomplete. Try again later." });
    } finally { if (pending.current === controller) pending.current = null; }
  }

  async function copyScope() {
    if (!draft || !current()) return;
    try {
      await navigator.clipboard.writeText(draft.draftScope.map(item => item.text).join("\n"));
      if (current()) setOperation({ snapshot, busy: false, message: "Draft scope copied. Review it before using it in your quote." });
    } catch { if (current()) setOperation({ snapshot, busy: false, message: "Copy is unavailable. Select the draft text to copy it." }); }
  }

  function list(items: TradeHubAssistItem[]) {
    return <ul className={styles.items}>{items.map((item, index) => <li key={index}><p>{item.text}</p><div className={styles.sources}>{item.sourceIds.map(id => id === "job"
      ? <span key={id}>Job details</span>
      : <button key={id} type="button" disabled={!onOpenQuestion} onClick={() => { if (current()) onOpenQuestion?.(id); }} aria-label={`Open source question: ${questions.find(question => question.id === id)?.prompt || "Shared question"}`}>Question {questions.findIndex(question => question.id === id) + 1}</button>)}</div></li>)}</ul>;
  }

  return <details className={styles.panel}>
    <summary>AI brief and draft scope</summary>
    <p className={styles.help}>Use the saved job and shared answers to prepare a draft for your review. Uploaded files are not read. Nothing is sent or added to your quote.</p>
    <button className={styles.action} type="button" disabled={Boolean(busy)} onClick={() => void generate()}>{busy ? "Preparing brief…" : draft ? "Generate again" : "Generate brief"}</button>
    {operation?.snapshot === snapshot && operation.message && <p role="status" className={styles.help}>{operation.message}</p>}
    {draft && <div className={styles.result}><section><h4>Job brief</h4>{list(draft.brief)}</section><section><h4>Draft scope to review</h4>{list(draft.draftScope)}<button className={styles.action} type="button" onClick={() => void copyScope()}>Copy draft scope</button></section></div>}
  </details>;
}
