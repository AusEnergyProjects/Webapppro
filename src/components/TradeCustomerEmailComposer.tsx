"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { User } from "firebase/auth";
import { TRADE_EMAIL_SETTINGS_HREF, type TradeEmailConnection } from "./TradeEmailSettings";
import styles from "./TradeEmailSettings.module.css";

type RecipientTarget = { customerId: string; enquiryId?: never; workOrderId?: never }
  | { enquiryId: string; customerId?: never; workOrderId?: never }
  | { workOrderId: string; customerId?: never; enquiryId?: never };
type Props = RecipientTarget & {
  user: User;
  recipient: string;
  recipientName?: string;
  label?: string;
  className?: string;
  initialSubject?: string;
};

export function TradeCustomerEmailComposer({ user, customerId, enquiryId, workOrderId, recipient, recipientName, label, className, initialSubject = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [connection, setConnection] = useState<TradeEmailConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"" | "accepted" | "uncertain">("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const subjectInput = useRef<HTMLInputElement>(null);
  const request = useRef({ signature: "", id: "" });
  const sending = useRef(false);
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    subjectInput.current?.focus();
    const controller = new AbortController();
    void user.getIdToken().then(async token => {
      const response = await fetch("/api/trade-email", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      const result = await response.json() as { ok?: boolean; connection?: TradeEmailConnection | null; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The business email connection could not be loaded.");
      if (!controller.signal.aborted) setConnection(result.connection || null);
    }).catch(reason => {
      if (!controller.signal.aborted) { setConnection(null); setError(reason instanceof Error ? reason.message : "The business email connection could not be loaded."); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, user]);

  function close() {
    if (sending.current) return;
    dialog.current?.close(); setOpen(false); trigger.current?.focus();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || loading || connection?.status !== "connected" || status === "accepted" || !subject.trim() || !body.trim()) return;
    const target = customerId ? { customerId } : enquiryId ? { enquiryId } : { workOrderId };
    const content = { ...target, subject: subject.trim(), body: body.trim() };
    const signature = JSON.stringify(content);
    if (request.current.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    sending.current = true; setBusy(true); setError("");
    let submitted = false;
    try {
      const token = await user.getIdToken();
      submitted = true;
      const response = await fetch("/api/trade-customer-email", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...content, requestId: request.current.id }),
      });
      const result = await response.json() as { ok?: boolean; status?: string; error?: string };
      if (result.status === "uncertain") { setStatus("uncertain"); return; }
      if (!response.ok || !result.ok) {
        if (result.status === "failed" || response.status < 500) submitted = false;
        throw new Error(result.error || "The email could not be sent. Please try again.");
      }
      if (result.status !== "accepted") throw new Error("The email result could not be confirmed.");
      setStatus("accepted");
    } catch (reason) {
      if (submitted) setStatus("uncertain");
      else setError(reason instanceof Error ? reason.message : "The email could not be sent.");
    } finally { sending.current = false; setBusy(false); }
  }

  const locked = busy || status === "uncertain" || status === "accepted";
  return <>
    <button ref={trigger} type="button" className={`${styles.emailButton}${className ? ` ${className}` : ""}`} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setPortalTarget(event.currentTarget.closest(".trade-portal-shell") || document.body); setError(""); setLoading(true); setOpen(true); }}>{label || recipient}</button>
    {open && portalTarget && createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={headingId} onKeyDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); close(); }}>
      <form onSubmit={event => void send(event)} aria-busy={busy || loading}>
        <header><div><h3 id={headingId}>Email {recipientName || "customer"}</h3><p>Send with your shared business address.</p></div><button type="button" className={styles.secondary} disabled={busy} onClick={close} aria-label="Close email">Close</button></header>
        <dl><dt>From</dt><dd>{loading ? "Loading business email..." : connection?.status === "connected" ? `${connection.displayName ? `${connection.displayName} · ` : ""}${connection.email}` : "Business email is not connected"}</dd><dt>To</dt><dd>{recipient}</dd></dl>
        {!loading && connection?.status !== "connected" && <p className={styles.notice} role="status">Ask the business owner to <a href={TRADE_EMAIL_SETTINGS_HREF}>connect email in Business settings</a> before sending.</p>}
        <label><span>Subject</span><input ref={subjectInput} required maxLength={200} value={subject} readOnly={locked} onChange={event => { setSubject(event.target.value); setStatus(""); setError(""); }} /></label>
        <label><span>Message</span><textarea required rows={7} maxLength={8000} value={body} readOnly={locked} onChange={event => { setBody(event.target.value); setStatus(""); setError(""); }} /></label>
        {status === "accepted" && <p className={styles.notice} role="status">Email accepted for sending. Replies will arrive in your business mailbox.</p>}
        {status === "uncertain" && <p className={styles.notice} role="status">The sending result is not confirmed. Check the connected mailbox before starting another email. Checking this request again keeps the same message reference.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <footer>{status === "accepted" ? <><button type="button" className={styles.secondary} onClick={() => { setSubject(initialSubject); setBody(""); setStatus(""); request.current = { signature: "", id: "" }; }}>New email</button><button type="button" className="btn" onClick={close}>Done</button></> : <><button type="button" className={styles.secondary} disabled={busy} onClick={close}>Close</button><button type="submit" className="btn" disabled={busy || loading || connection?.status !== "connected" || !subject.trim() || !body.trim()}>{busy ? "Checking..." : status === "uncertain" ? "Check send result" : "Send email"}</button></>}</footer>
      </form>
    </dialog>, portalTarget)}
  </>;
}
