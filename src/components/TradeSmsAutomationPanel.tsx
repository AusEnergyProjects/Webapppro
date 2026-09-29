"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import { SMS_AUTOMATION_FIELDS, SMS_AUTOMATION_LABELS, smsAutomationPreview, type SmsAutomationKind, type SmsAutomationRule } from "@/lib/trade-sms-automation";
import { SMS_PRICE_LABEL } from "@/lib/trade-sms-billing";
import styles from "./TradeSmsAutomationPanel.module.css";

type Settings = { ok?: boolean; error?: string; canManage?: boolean; urlsEnabled: boolean; rules: SmsAutomationRule[]; summary: { sent: number; blocked: number; unknown: number } };
const fieldKeys = Object.keys(SMS_AUTOMATION_FIELDS);
function editorText(body: string) { return body.replace(/\{([^{}]+)\}/g, (token, key: string) => Object.hasOwn(SMS_AUTOMATION_FIELDS, key) ? `[${SMS_AUTOMATION_FIELDS[key]}]` : token); }
function storedText(body: string) { return body.replace(/\[([^\[\]]+)\]/g, (token, label: string) => { const key = fieldKeys.find(key => SMS_AUTOMATION_FIELDS[key] === label); return key ? `{${key}}` : token; }); }

export function TradeSmsAutomationPanel({ user, getAuthHeaders, onSaved }: {
  user?: User; getAuthHeaders?: () => Promise<Record<string, string>>; onSaved?: () => void;
}) {
  const fetch = useTradeBusinessFetch();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rules, setRules] = useState<SmsAutomationRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [timeUnits, setTimeUnits] = useState<Partial<Record<SmsAutomationKind, "hours" | "days">>>({});
  const pending = useRef(false);
  const inputs = useRef<Partial<Record<SmsAutomationKind, HTMLTextAreaElement | null>>>({});
  const authHeaders = useCallback(async () => {
    if (getAuthHeaders) return getAuthHeaders();
    if (user) return { Authorization: `Bearer ${await user.getIdToken()}` };
    throw new Error("Sign in to manage automatic texts.");
  }, [getAuthHeaders, user]);
  const request = useCallback(async (payload?: SmsAutomationRule[], signal?: AbortSignal) => {
    const response = await fetch("/api/trade-sms/automations", { method: payload ? "POST" : "GET", headers: { ...await authHeaders(), ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify({ rules: payload }) : undefined, cache: "no-store", signal });
    const data = await response.json() as Settings;
    if (!response.ok || !data.ok) throw new Error(data.error || "Automatic texts could not be loaded.");
    return data;
  }, [authHeaders, fetch]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setLoading(true); setSettings(null); setRules([]); setError(""); setNotice("");
      const data = await request(undefined, controller.signal);
      if (!controller.signal.aborted) { setSettings(data); setRules(data.rules); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Automatic texts could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, reload]);
  function change(kind: SmsAutomationKind, update: Partial<SmsAutomationRule>) {
    setRules(current => current.map(rule => rule.kind === kind ? { ...rule, ...update } : rule)); setNotice("");
  }
  function insert(kind: SmsAutomationKind, key: string) {
    const input = inputs.current[kind], rule = rules.find(item => item.kind === kind);
    if (!rule) return;
    const body = editorText(rule.body), start = input?.selectionStart ?? body.length, end = input?.selectionEnd ?? body.length;
    const token = `[${SMS_AUTOMATION_FIELDS[key]}]`, next = storedText(body.slice(0, start) + token + body.slice(end));
    if (next.length > 480) { setError("Keep the message within 480 characters, including inserted details."); return; }
    change(kind, { body: next });
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + token.length, start + token.length); });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    let saved = false;
    try {
      const result = await request(rules); saved = true;
      const next = Array.isArray(result.rules) ? result : await request();
      setSettings(next); setRules(next.rules); setNotice("Automatic text settings saved."); onSaved?.();
    } catch (reason) {
      setError(saved ? "Settings saved. Refresh to load their latest state." : reason instanceof Error ? reason.message : "Settings could not be saved.");
    } finally { pending.current = false; setBusy(false); }
  }
  const dirty = settings && JSON.stringify(rules) !== JSON.stringify(settings.rules);
  return <section className={styles.panel} aria-label="Automatic customer texts" aria-busy={loading || busy}>
    <header className={styles.heading}><div><span className={styles.eyebrow}>Follow up automatically</span><h3>Timely texts. Less admin.</h3><p>Set your messages once. TLink takes care of eligible appointments.</p></div><span className={styles.price}>{SMS_PRICE_LABEL}</span></header>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    {loading ? <p role="status">Loading automatic texts...</p> : !settings ? <button type="button" className={styles.secondary} onClick={() => setReload(value => value + 1)}>Try again</button> : <form onSubmit={event => void save(event)}>
      <p className={styles.explanation}>Each option starts off. Service texts need recorded customer permission. Feedback and review requests need separate marketing permission. Customers can reply STOP at any time.</p>
      {settings.urlsEnabled === false && <p className={styles.notice} role="status">SMS links are awaiting provider approval. You can prepare review requests now, but cannot enable them yet. Reminders and follow-ups without links remain available.</p>}
      <div className={styles.cards}>{rules.map(rule => {
        const preview = smsAutomationPreview(rule);
        const unit = timeUnits[rule.kind] || (rule.delayHours % 24 === 0 ? "days" : "hours");
        const amount = unit === "days" ? rule.delayHours / 24 : rule.delayHours;
        return <article className={styles.card} key={rule.kind}>
          <label className={styles.switch}><span><strong>{SMS_AUTOMATION_LABELS[rule.kind]}</strong><small>{rule.kind === "appointment_reminder" ? "Help customers be ready for your visit." : rule.kind === "appointment_follow_up" ? "Check everything is working after a completed visit." : "Invite honest feedback after a completed visit."}</small></span><input type="checkbox" role="switch" checked={rule.enabled} disabled={busy || (settings.urlsEnabled === false && rule.kind === "review_request" && !rule.enabled)} onChange={event => change(rule.kind, { enabled: event.target.checked })} /><span className={styles.track} aria-hidden="true" /></label>
          <div className={styles.timing}><label><span>Send</span><input aria-label={`${SMS_AUTOMATION_LABELS[rule.kind]} delay`} type="number" inputMode="numeric" required min={1} max={unit === "days" ? 42 : 1008} value={amount || ""} disabled={busy} onChange={event => change(rule.kind, { delayHours: Number(event.target.value) * (unit === "days" ? 24 : 1) })} /></label><label><span>Timing</span><select aria-label={`${SMS_AUTOMATION_LABELS[rule.kind]} time unit`} value={unit} disabled={busy} onChange={event => { const next = event.target.value === "days" ? "days" : "hours"; setTimeUnits(current => ({ ...current, [rule.kind]: next })); change(rule.kind, { delayHours: next === "days" ? Math.min(Math.max(amount, 1), 42) * 24 : Math.min(Math.max(amount, 1), 1008) }); }}><option value="hours">hours</option><option value="days">days</option></select></label><span>{rule.kind === "appointment_reminder" ? "before the appointment" : "after the visit"}</span></div>
          {rule.kind === "review_request" && <label className={styles.field}><span>Your feedback or Google review link</span><input type="url" required={rule.enabled} maxLength={1000} placeholder="https://" value={rule.reviewUrl} disabled={busy} onChange={event => change(rule.kind, { reviewUrl: event.target.value })} /></label>}
          <label className={styles.field}><span>Message</span><textarea ref={element => { inputs.current[rule.kind] = element; }} required rows={4} value={editorText(rule.body)} disabled={busy} onChange={event => change(rule.kind, { body: storedText(event.target.value) })} /></label>
          <div className={styles.inserts} aria-label={`Insert details into ${SMS_AUTOMATION_LABELS[rule.kind]}`}>{fieldKeys.filter(key => key !== "review_url" || rule.kind === "review_request").map(key => <button type="button" key={key} disabled={busy} onClick={() => insert(rule.kind, key)}>+ {SMS_AUTOMATION_FIELDS[key]}</button>)}</div>
          <details className={styles.preview}><summary>Preview text <span>{preview.segments} SMS · ${(preview.costMicro / 1_000_000).toFixed(3)} incl. GST</span></summary><p>{preview.formattedBody}</p><small>Example estimate includes business name, job number and STOP instructions. Actual customer details can change the segment count.</small>{preview.missing.length > 0 && <small>Still needed: {preview.missing.join(", ")}.</small>}</details>
        </article>;
      })}</div>
      <footer className={styles.footer}><p>New send times apply when enabled or timing changes. Cancelled visits are skipped. Texts are skipped if permission, number or credit is unavailable.</p><div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy || !dirty} onClick={() => { setRules(settings.rules); setError(""); setNotice(""); }}>Cancel changes</button><button type="submit" className={styles.primary} disabled={busy || !dirty}>{busy ? "Saving..." : "Save automatic texts"}</button></div></footer>
      <div className={styles.summary} aria-label="Automatic text activity"><span><strong>{settings.summary.sent}</strong> submitted</span><span><strong>{settings.summary.blocked}</strong> stopped</span><span><strong>{settings.summary.unknown}</strong> unconfirmed</span><small>Delivery status appears in each customer conversation. Unconfirmed sends are never automatically repeated.</small></div>
    </form>}
  </section>;
}
