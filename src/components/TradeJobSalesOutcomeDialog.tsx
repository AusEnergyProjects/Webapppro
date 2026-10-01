"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import styles from "./InstallerCrmJobRegister.module.css";

type SalesJob = { id: string; workNumber: string; title: string; revision: number; pipelineStage: string };

export function TradeJobSalesOutcomeDialog({ user, job, onClose, onSaved }: {
  user: User; job: SalesJob; onClose: () => void; onSaved: (reopened: boolean) => void;
}) {
  const fetch = useTradeBusinessFetch();
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reopening = job.pipelineStage === "lost";
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    if (element && !element.open) element.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  function close() { if (!pending.current) onClose(); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/trade-crm", {
        method: "PATCH", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: reopening ? "reopen_lost_job" : "mark_job_lost", workOrderId: job.id,
          expectedRevision: job.revision, ...(reopening ? {} : { reason: reason.trim() }) }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The opportunity could not be updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The opportunity could not be updated.");
      pending.current = false; setBusy(false); return;
    }
    // The server acknowledged the write. Refresh/navigation cannot turn it into a failed save.
    pending.current = false; setBusy(false); onSaved(reopening);
  }

  return <dialog ref={dialog} className={styles.paymentDialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={save} aria-busy={busy}>
      <header><div><small>{job.workNumber}</small><h3 id={titleId}>{reopening ? "Reopen opportunity" : "Mark as lost"}</h3></div></header>
      <p><strong>{job.title}</strong></p>
      <p id={descriptionId}>{reopening
        ? "Return this opportunity to your active records for a fresh customer decision. Previous quotes and history stay available. Old quote links and cancelled follow-ups stay closed."
        : "Move this unwon opportunity to Lost archive, keeping its quotes, files and history. It leaves your active workload and queued follow-ups stop. You can reopen it if the customer returns."}</p>
      {!reopening && <label>Reason (optional)<input value={reason} maxLength={500} disabled={busy}
        placeholder="For example, no response or chose another business" onChange={event => setReason(event.target.value)} /></label>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={close}>Cancel</button>
        <button type="submit" disabled={busy}>{busy ? "Saving..." : reopening ? "Reopen opportunity" : "Mark as lost"}</button></footer>
    </form>
  </dialog>;
}
