"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { User } from "firebase/auth";
import { FOLLOW_UP_FIELDS, type FollowUpTemplate } from "@/lib/trade-follow-ups";
import { TRADE_EMAIL_SETTINGS_HREF } from "./TradeEmailSettings";
import styles from "./TradeEmailTemplatesWorkspace.module.css";

type FollowUpData = {
  ok: boolean;
  templates: FollowUpTemplate[];
  connection: { email: string; status: string } | null;
  history: Array<{ id: string; subject: string; status: string; createdAt: string; error?: string }>;
  error?: string;
};
type Preview = { ok: boolean; recipient: string; recipientName: string; subject: string; body: string; contextHash: string; missing: string[]; error?: string };

export function TradeFollowUpDialog({ user, workOrderId, onClose }: { user: User; workOrderId: string; onClose: () => void }) {
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [data, setData] = useState<FollowUpData | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"" | "accepted" | "uncertain">("");
  const [reload, setReload] = useState(0);
  const [previewReload, setPreviewReload] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const templateSelect = useRef<HTMLSelectElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const sending = useRef(false);
  const request = useRef({ signature: "", id: "" });
  const headingId = useId();
  const introId = useId();

  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPortalTarget(restoreFocus.current?.closest(".trade-portal-shell") || document.querySelector(".trade-portal-shell") || document.body);
    return () => { if (restoreFocus.current?.isConnected) restoreFocus.current.focus(); };
  }, []);

  useEffect(() => {
    if (!portalTarget) return;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    templateSelect.current?.focus();
    return () => { element?.close(); };
  }, [portalTarget]);

  useEffect(() => {
    const controller = new AbortController();
    void user.getIdToken().then(async token => {
      const response = await fetch(`/api/trade-follow-ups?workOrderId=${encodeURIComponent(workOrderId)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
      });
      const result = await response.json() as FollowUpData;
      if (!response.ok || !result.ok) throw new Error(result.error || "Follow-up templates could not be loaded.");
      if (!controller.signal.aborted) setData(result);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Follow-up templates could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, workOrderId, reload]);

  useEffect(() => {
    if (data) templateSelect.current?.focus();
  }, [data]);

  useEffect(() => {
    if (!templateId) return;
    const controller = new AbortController();
    request.current = { signature: "", id: "" };
    void user.getIdToken().then(async token => {
      const response = await fetch("/api/trade-follow-ups", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", workOrderId, templateId }), signal: controller.signal,
      });
      const result = await response.json() as Preview;
      if (!response.ok || !result.ok) throw new Error(result.error || "This follow-up could not be prepared.");
      if (!controller.signal.aborted) { setPreview(result); setSubject(result.subject); setBody(result.body); }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "This follow-up could not be prepared.");
    }).finally(() => { if (!controller.signal.aborted) setPreviewing(false); });
    return () => controller.abort();
  }, [templateId, user, workOrderId, previewReload]);

  function close() {
    if (sending.current) return;
    dialog.current?.close(); onClose();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !preview || preview.missing.length || !preview.recipient || loading || previewing || data?.connection?.status !== "connected" || status === "accepted" || !subject.trim() || !body.trim()) return;
    const content = { workOrderId, templateId, subject: subject.trim(), body: body.trim(), contextHash: preview.contextHash };
    const signature = JSON.stringify(content);
    if (request.current.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    sending.current = true; setBusy(true); setError("");
    let submitted = false;
    try {
      const token = await user.getIdToken();
      submitted = true;
      const response = await fetch("/api/trade-follow-ups", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", ...content, requestId: request.current.id }),
      });
      const result = await response.json() as { ok?: boolean; status?: "accepted" | "uncertain" | "failed"; error?: string };
      if (result.status === "uncertain") { setStatus("uncertain"); return; }
      if (!response.ok || !result.ok) {
        if (result.status === "failed" || response.status < 500) submitted = false;
        throw new Error(result.error || "The email could not be sent.");
      }
      if (result.status !== "accepted") throw new Error("The sending result could not be confirmed.");
      setStatus("accepted");
    } catch (reason) {
      if (submitted) setStatus("uncertain");
      else setError(reason instanceof Error ? reason.message : "The email could not be sent.");
    } finally { sending.current = false; setBusy(false); }
  }

  const locked = busy || status === "uncertain" || status === "accepted";
  const connected = data?.connection?.status === "connected";
  const canSend = !loading && !previewing && connected && preview && preview.recipient && !preview.missing.length && subject.trim() && body.trim();
  if (!portalTarget) return null;
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={headingId} aria-describedby={introId} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <form onSubmit={event => void send(event)} aria-busy={busy || loading || previewing}>
      <header className={styles.dialogHeader}><div><h2 id={headingId}>Follow up</h2><p id={introId}>Choose a template, check the details, then send.</p></div><button type="button" className={styles.secondary} disabled={busy} onClick={close} aria-label="Close follow-up">Close</button></header>
      {loading ? <p role="status" className={styles.loading}>Loading your templates...</p> : data ? <>
        {!connected && <p className={styles.notice}>Your business email is not connected. <a href={TRADE_EMAIL_SETTINGS_HREF}>Connect email in Business settings</a> before sending.</p>}
        <label className={styles.field}><span>Email template</span><select ref={templateSelect} value={templateId} disabled={locked} onChange={event => { setTemplateId(event.target.value); setPreview(null); setSubject(""); setBody(""); setPreviewing(Boolean(event.target.value)); setError(""); setStatus(""); }}><option value="">Choose a follow-up...</option>{data.templates.map(template => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
        {data.templates.length === 0 && <p className={styles.notice}>Create a template in <a href="/direct-trade/dashboard?workspace=email-templates">Email templates</a> to get started.</p>}
        {previewing && <p role="status" className={styles.loading}>Filling in customer and job details...</p>}
        {preview && <>
          <dl className={styles.addresses}><dt>From</dt><dd>{connected ? data.connection?.email : "Business email not connected"}</dd><dt>To</dt><dd>{preview.recipient ? <>{preview.recipientName && <strong>{preview.recipientName}<br /></strong>}{preview.recipient}</> : "No authorised customer email available"}</dd></dl>
          {preview.missing.length > 0 && <p className={styles.notice} role="status">This template needs: {preview.missing.map(field => FOLLOW_UP_FIELDS[field] || field).join(", ")}. Update the job details or choose another template before sending.</p>}
          <label className={styles.field}><span>Subject</span><input required maxLength={200} value={subject} readOnly={locked} onChange={event => { setSubject(event.target.value); setError(""); }} /></label>
          <label className={styles.field}><span>Message</span><textarea required rows={8} maxLength={8000} value={body} readOnly={locked} onChange={event => { setBody(event.target.value); setError(""); }} /></label>
          {status === "" && <p className={styles.subtle}>Changes here apply to this email only. Your saved template stays the same.</p>}
        </>}
        {!templateId && data.history.length > 0 && <details className={styles.history}><summary>Recent follow-ups</summary><ul>{data.history.slice(0, 5).map(item => <li key={item.id}><strong>{item.subject}</strong><span>{item.status === "accepted" ? "Accepted for sending" : item.status === "uncertain" ? "Sending result unconfirmed" : item.status === "failed" ? "Not sent" : item.status} · {new Date(item.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span>{item.error && <span>{item.error}</span>}</li>)}</ul></details>}
      </> : <button type="button" className={styles.secondary} onClick={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>Try again</button>}
      {status === "accepted" && <p className={styles.notice} role="status">Email accepted for sending. Replies will arrive in your business mailbox.</p>}
      {status === "uncertain" && <p className={styles.notice} role="status">The sending result is not confirmed. Check the connected mailbox before starting another email. Checking the result uses the same message reference.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {data && templateId && !preview && !previewing && error && <button type="button" className={styles.secondary} onClick={() => { setPreviewing(true); setError(""); setPreviewReload(value => value + 1); }}>Try preparing this email again</button>}
      <footer className={styles.dialogFooter}>{status === "accepted" ? <button type="button" className={styles.primary} onClick={close}>Done</button> : <><button type="button" className={styles.secondary} disabled={busy} onClick={close}>Cancel</button><button type="submit" className={styles.primary} disabled={busy || !canSend}>{busy ? (status === "uncertain" ? "Checking..." : "Sending...") : status === "uncertain" ? "Check sending status" : "Send email"}</button></>}</footer>
    </form>
  </dialog>, portalTarget);
}
