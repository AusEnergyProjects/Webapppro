"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { FOLLOW_UP_FIELDS, followUpEditorText, followUpStoredText, renderFollowUp, type FollowUpSettings, type FollowUpTemplate } from "@/lib/trade-follow-ups";
import { TRADE_EMAIL_SETTINGS_HREF } from "./TradeEmailSettings";
import { TradeSmsAutomationPanel } from "./TradeSmsAutomationPanel";
import styles from "./TradeEmailTemplatesWorkspace.module.css";

type WorkspaceData = {
  ok: boolean;
  canManage: boolean;
  templates: FollowUpTemplate[];
  settings: FollowUpSettings;
  connection: { email: string; status: string } | null;
  history: Array<{ id: string; subject: string; status: string; createdAt: string; error?: string }>;
  error?: string;
};

const KIND_LABELS: Record<FollowUpTemplate["kind"], string> = {
  general: "General", quote: "Quote", invoice: "Invoice", appointment: "Before appointment", appointment_after: "After visit",
};
const SAMPLE_FIELDS: Record<string, string> = {
  customer_name: "Alex Smith", customer_first_name: "Alex", business_name: "Your business", job_number: "JOB-1042", job_title: "Home installation",
  site_address: "12 Example Street, Melbourne", invoice_number: "INV-1042", invoice_due_date: "28 September 2026",
  invoice_amount: "$1,250.00", appointment_date: "30 September 2026", appointment_time: "9:00 am",
};
function example(template: FollowUpTemplate) {
  return renderFollowUp({ subject: followUpStoredText(template.subject), body: followUpStoredText(template.body) }, SAMPLE_FIELDS);
}
function isKind(value: string): value is FollowUpTemplate["kind"] {
  return value === "general" || value === "quote" || value === "invoice" || value === "appointment" || value === "appointment_after";
}
type ReminderTiming = FollowUpSettings["invoiceTiming"];
function ReminderTimingFields({ value, eventLabel, disabled, onChange }: {
  value: ReminderTiming; eventLabel: string; disabled: boolean; onChange: (timing: ReminderTiming) => void;
}) {
  const maximum = value.unit === "hours" ? 1008 : value.unit === "days" ? 42 : 6;
  return <fieldset className={styles.timingFields} disabled={disabled}>
    <legend>Send reminder</legend>
    <div className={styles.timingRow}>
      <label className={`${styles.field} ${styles.timingAmount}`}><span className={styles.visuallyHidden}>Number of {value.unit}</span><input type="number" inputMode="numeric" min={1} max={maximum} step={1} required value={value.amount || ""} onChange={event => onChange({ ...value, amount: Number(event.target.value) })} /></label>
      <label className={styles.field}><span className={styles.visuallyHidden}>Time unit</span><select value={value.unit} onChange={event => { const unit = event.target.value; if (unit === "hours" || unit === "days" || unit === "weeks") onChange({ ...value, unit }); }}><option value="hours">hours</option><option value="days">days</option><option value="weeks">weeks</option></select></label>
      <label className={styles.field}><span className={styles.visuallyHidden}>Before or after</span><select value={value.direction} onChange={event => { const direction = event.target.value; if (direction === "before" || direction === "after") onChange({ ...value, direction }); }}><option value="before">before</option><option value="after">after</option></select></label>
      <span className={styles.timingEvent}>{eventLabel}</span>
    </div>
    <p className={styles.timingHint}>Up to 6 weeks before or after.</p>
  </fieldset>;
}

export function TradeEmailTemplatesWorkspace({ user }: { user: User }) {
  const fetch = useTradeBusinessFetch();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [tab, setTab] = useState<"sms" | "templates" | "reminders">("sms");
  const [draft, setDraft] = useState<FollowUpTemplate | null>(null);
  const [savedDraft, setSavedDraft] = useState<FollowUpTemplate | null>(null);
  const [settings, setSettings] = useState<FollowUpSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reload, setReload] = useState(0);
  const [insertTarget, setInsertTarget] = useState<"subject" | "body">("body");
  const actionPending = useRef(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const connected = data?.connection?.status === "connected";
  const canManage = Boolean(data?.canManage);
  const templateDirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const settingsDirty = settings !== null && JSON.stringify(settings) !== JSON.stringify(data?.settings);

  const load = useCallback(async (signal?: AbortSignal) => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-follow-ups", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
    const result = await response.json() as WorkspaceData;
    if (!response.ok || !result.ok) throw new Error(result.error || "Email templates could not be loaded.");
    return { ...result, templates: result.templates.map(template => ({ ...template, subject: followUpEditorText(template.subject), body: followUpEditorText(template.body) })) };
  }, [fetch, user]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setData(result); setSettings(result.settings);
      setDraft(result.templates[0] || null); setSavedDraft(result.templates[0] || null);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Email templates could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, reload]);

  function selectTemplate(template: FollowUpTemplate) {
    setDraft(template); setSavedDraft(template); setConfirmDelete(false); setNotice(""); setError("");
  }

  async function save(action: "save_template" | "delete_template" | "save_settings") {
    if (actionPending.current || !canManage) return;
    actionPending.current = true; setBusy(true); setError(""); setNotice("");
    let mutationSaved = false;
    try {
      const token = await user.getIdToken();
      const payload = action === "save_template" ? { action, template: draft && { ...draft, subject: followUpStoredText(draft.subject), body: followUpStoredText(draft.body) } }
        : action === "delete_template" ? { action, id: draft?.id } : { action, settings };
      const response = await fetch("/api/trade-follow-ups", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Your changes could not be saved.");
      mutationSaved = true;
      const refreshed = await load();
      setData(refreshed); setSettings(refreshed.settings);
      if (action !== "save_settings") {
        const selected = action === "save_template" ? refreshed.templates.find(item => item.id === draft?.id) : refreshed.templates[0];
        setDraft(selected || null); setSavedDraft(selected || null);
      }
      setConfirmDelete(false);
      setNotice(action === "save_template" ? "Template saved. It is ready in Follow up on your jobs."
        : action === "delete_template" ? "Template deleted." : "Reminder settings saved.");
    } catch (reason) {
      setError(mutationSaved ? "Changes saved, but the updated list could not be loaded. Refresh this page to see the latest settings."
        : reason instanceof Error ? reason.message : "Your changes could not be saved.");
    } finally { actionPending.current = false; setBusy(false); }
  }

  function insertField(key: string) {
    if (!draft || !key || !Object.hasOwn(FOLLOW_UP_FIELDS, key)) return;
    const input = insertTarget === "subject" ? subjectRef.current : bodyRef.current;
    const value = draft[insertTarget];
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const token = `[${FOLLOW_UP_FIELDS[key]}]`;
    const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
    if (nextValue.length > (insertTarget === "subject" ? 200 : 8000)) return;
    setDraft({ ...draft, [insertTarget]: nextValue });
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + token.length, start + token.length); });
  }

  const activeReminderTemplate = Boolean(draft && data && ((data.settings.invoiceEnabled && data.settings.invoiceTemplateId === draft.id)
    || (data.settings.appointmentEnabled && data.settings.appointmentTemplateId === draft.id)));

  function updateAppointmentTiming(appointmentTiming: ReminderTiming) {
    if (!settings) return;
    const defaultId = appointmentTiming.direction === "before" ? "appointment-reminder" : "appointment-follow-up";
    const directionChanged = appointmentTiming.direction !== settings.appointmentTiming.direction;
    const usingDefault = settings.appointmentTemplateId === "appointment-reminder" || settings.appointmentTemplateId === "appointment-follow-up";
    const replacementAvailable = data?.templates.some(template => template.id === defaultId);
    setSettings({ ...settings, appointmentTiming,
      appointmentTemplateId: directionChanged && usingDefault && replacementAvailable ? defaultId : settings.appointmentTemplateId });
  }

  return <section className={styles.workspace} aria-labelledby={headingId} aria-busy={loading || busy}>
    <header className={styles.heading}>
      <div><h2 id={headingId}>Follow-ups</h2><p>Automatic texts, email templates and reminders for your customers.</p></div>
      {tab !== "sms" && !loading && data && <span className={connected ? styles.connectionReady : styles.connectionPaused}>{connected ? data.connection?.email : "Email not connected"}</span>}
    </header>
    <nav className={styles.tabs} aria-label="Follow-up channels">
      <button type="button" aria-pressed={tab === "sms"} disabled={busy || templateDirty || settingsDirty} onClick={() => setTab("sms")}>Auto texts</button>
      <button type="button" aria-pressed={tab === "templates"} disabled={busy || settingsDirty} onClick={() => setTab("templates")}>Email templates</button>
      <button type="button" aria-pressed={tab === "reminders"} disabled={busy || templateDirty} onClick={() => setTab("reminders")}>Email reminders</button>
    </nav>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {loading ? <p className={styles.loading} role="status">Loading email templates...</p> : !data ? <button type="button" className={styles.secondary} onClick={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>Try again</button> : <>
      {tab !== "sms" && !connected && <p className={styles.notice}>You can prepare templates now. <a href={TRADE_EMAIL_SETTINGS_HREF}>Connect your business email</a> before sending.</p>}
      {!canManage && <p className={styles.subtle}>Your team can use these templates. The business owner manages templates and automatic reminders.</p>}
      {canManage && <div hidden={tab !== "sms"}><TradeSmsAutomationPanel user={user} /></div>}
      {tab === "sms" ? !canManage && <p className={styles.notice}>The business owner manages automatic customer texts.</p> : tab === "templates" ? <div className={styles.templateLayout}>
        <aside className={styles.templateSidebar} aria-label="Saved templates">
          <div className={styles.listHeading}><h3>Your templates</h3>{canManage && <button type="button" className={styles.secondary} disabled={busy || templateDirty} onClick={() => {
            setDraft({ id: `custom-${crypto.randomUUID()}`, name: "", kind: "general", subject: "", body: "" });
            setSavedDraft(null); setConfirmDelete(false); setError(""); setNotice("");
            requestAnimationFrame(() => nameRef.current?.focus());
          }}>New template</button>}</div>
          <div className={styles.templateList}>{data.templates.map(template => <button key={template.id} type="button" className={styles.templateItem} aria-pressed={draft?.id === template.id} disabled={busy || templateDirty} onClick={() => selectTemplate(template)}>
            <strong>{template.name}</strong><span>{KIND_LABELS[template.kind]}</span>
          </button>)}</div>
          {data.templates.length === 0 && <p className={styles.subtle}>Your saved templates will appear here.</p>}
          {templateDirty && <p className={styles.subtle}>Save or cancel your changes before choosing another template.</p>}
        </aside>
        {draft ? <form className={styles.editor} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save("save_template"); }}>
          <div className={styles.editorHeading}><h3>{savedDraft ? draft.name || "Edit template" : "New template"}</h3>{!canManage && <span className={styles.badge}>View only</span>}</div>
          <div className={styles.twoColumns}>
            <label className={styles.field}><span>Template name</span><input ref={nameRef} required maxLength={80} placeholder="e.g. Invoice reminder" value={draft.name} readOnly={!canManage || busy} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className={styles.field}><span>Use for</span><select value={draft.kind} disabled={!canManage || busy || activeReminderTemplate} onChange={event => { if (isKind(event.target.value)) setDraft({ ...draft, kind: event.target.value }); }}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <label className={styles.field}><span>Email subject</span><input ref={subjectRef} required maxLength={200} value={draft.subject} readOnly={!canManage || busy} onFocus={() => setInsertTarget("subject")} onChange={event => setDraft({ ...draft, subject: event.target.value })} /></label>
          <small>The job number is always included in the subject.</small>
          <label className={styles.field}><span>Message</span><textarea ref={bodyRef} required rows={8} maxLength={8000} value={draft.body} readOnly={!canManage || busy} onFocus={() => setInsertTarget("body")} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
          {canManage && <div className={styles.insertFields}><p>Insert into {insertTarget === "subject" ? "subject" : "message"}</p><div>{["customer_first_name", "appointment_date", "appointment_time", "invoice_amount", "invoice_due_date", "job_number"].map(key => <button key={key} type="button" disabled={busy} onClick={() => insertField(key)}>+ {FOLLOW_UP_FIELDS[key]}</button>)}</div><details><summary>More details</summary><div>{Object.keys(FOLLOW_UP_FIELDS).filter(key => !["customer_first_name", "appointment_date", "appointment_time", "invoice_amount", "invoice_due_date", "job_number"].includes(key)).map(key => <button key={key} type="button" disabled={busy} onClick={() => insertField(key)}>+ {FOLLOW_UP_FIELDS[key]}</button>)}</div></details><small>Choose a button to add the detail where you are typing. It fills in for each customer.</small></div>}
          <details open className={styles.preview}><summary>Preview with example details</summary><div><small>Example only</small><strong>{example(draft).subject || "Email subject"}</strong><p>{example(draft).body || "Your message will appear here."}</p></div></details>
          {canManage && <footer className={styles.editorFooter}>
            <div>{savedDraft && <button type="button" className={styles.danger} disabled={busy || activeReminderTemplate} onClick={() => setConfirmDelete(true)}>Delete template</button>}{activeReminderTemplate && <small>Used by an active reminder.</small>}</div>
            <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy || !templateDirty} onClick={() => { const original = savedDraft || data.templates[0] || null; setDraft(original); setSavedDraft(original); setConfirmDelete(false); }}>Cancel changes</button><button type="submit" className={styles.primary} disabled={busy || !templateDirty || !draft.name.trim() || !draft.subject.trim() || !draft.body.trim()}>{busy ? "Saving..." : "Save template"}</button></div>
          </footer>}
          {confirmDelete && <div className={styles.deleteConfirmation} role="group" aria-label="Confirm template deletion"><p>Delete “{draft.name}”? Previously sent emails stay in the job history.</p><div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmDelete(false)}>Keep template</button><button type="button" className={styles.danger} disabled={busy} onClick={() => void save("delete_template")}>Delete</button></div></div>}
        </form> : <div className={styles.empty}>Choose a template or create your own.</div>}
      </div> : settings && <form className={styles.reminders} onSubmit={event => { event.preventDefault(); void save("save_settings"); }}>
        <div><h3>Your business reminder settings</h3><p className={styles.subtle}>Set these once for all your jobs. Both options start off. Turn on only what suits your business.</p></div>
        <div className={styles.reminderCard}>
          <label className={styles.switchLabel}><span><strong>Invoice reminders <span className={styles.badge}>{settings.invoiceEnabled ? "Automatic" : "Manual"}</span></strong><small>Send one reminder if an invoice is still unpaid.</small></span><input type="checkbox" role="switch" checked={settings.invoiceEnabled} disabled={!canManage || busy || (!connected && !settings.invoiceEnabled)} onChange={event => setSettings({ ...settings, invoiceEnabled: event.target.checked })} /><span className={styles.switchTrack} aria-hidden="true" /></label>
          <div className={styles.reminderFields}>
            <ReminderTimingFields value={settings.invoiceTiming} eventLabel="the invoice due date" disabled={!canManage || busy} onChange={invoiceTiming => setSettings({ ...settings, invoiceTiming })} />
            <label className={`${styles.field} ${styles.reminderTemplate}`}><span>Email template</span><select required={settings.invoiceEnabled} value={settings.invoiceTemplateId} disabled={!canManage || busy} onChange={event => setSettings({ ...settings, invoiceTemplateId: event.target.value })}><option value="" disabled>Choose a template</option>{data.templates.filter(template => template.kind === "invoice").map(template => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
          </div>
        </div>
        <div className={styles.reminderCard}>
          <label className={styles.switchLabel}><span><strong>Appointment emails <span className={styles.badge}>{settings.appointmentEnabled ? "Automatic" : "Manual"}</span></strong><small>Send a message before or after the scheduled visit.</small></span><input type="checkbox" role="switch" checked={settings.appointmentEnabled} disabled={!canManage || busy || (!connected && !settings.appointmentEnabled)} onChange={event => setSettings({ ...settings, appointmentEnabled: event.target.checked })} /><span className={styles.switchTrack} aria-hidden="true" /></label>
          <div className={styles.reminderFields}>
            <ReminderTimingFields value={settings.appointmentTiming} eventLabel="the appointment" disabled={!canManage || busy} onChange={updateAppointmentTiming} />
            <label className={`${styles.field} ${styles.reminderTemplate}`}><span>Email template</span><select required={settings.appointmentEnabled} value={settings.appointmentTemplateId} disabled={!canManage || busy} onChange={event => setSettings({ ...settings, appointmentTemplateId: event.target.value })}><option value="" disabled>Choose a template</option>{data.templates.filter(template => template.kind === (settings.appointmentTiming.direction === "after" ? "appointment_after" : "appointment")).map(template => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
          </div>
        </div>
        <p className={styles.subtle}>Automatic reminders start when enabled. Past reminder times are skipped. Invoice timing uses 9 am on the due date in the job’s local time.</p>
        {canManage && <footer className={styles.actions}><button type="button" className={styles.secondary} disabled={busy || !settingsDirty} onClick={() => setSettings(data.settings)}>Cancel changes</button><button type="submit" className={styles.primary} disabled={busy || !settingsDirty || ((settings.invoiceEnabled || settings.appointmentEnabled) && !connected)}>{busy ? "Saving..." : "Save reminder settings"}</button></footer>}
      </form>}
    </>}
  </section>;
}
