"use client";

import { useEffect, useState } from "react";
import type { ActivityField, ActivityForm, ActivityRecord } from "@/lib/trade-activity-forms";
import styles from "./CreditexActivityWorkPackGovernance.module.css";

type Api = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type Option = { activityTemplateId: string; title: string; programCode: string; activityCode: string };
export function CreditexFieldFormMasters({ api, actorMode, canAuthor = true }: { api: Api; actorMode: "admin" | "creditex"; canAuthor?: boolean }) {
  const [catalogue, setCatalogue] = useState<Option[]>([]);
  const [selected, setSelected] = useState(""); const [form, setForm] = useState<ActivityForm | null>(null);
  const [expectedVersion, setExpectedVersion] = useState(0); const [question, setQuestion] = useState(0);
  const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false); const [message, setMessage] = useState("");
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [reviewLink, setReviewLink] = useState("");
  const endpoint = "/api/trade-activity-forms";
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  async function loadCatalogue() {
    setBusy(true); setMessage("");
    try { const result = await api(`${endpoint}?view=masters&actorMode=${actorMode}`);
      if (!Array.isArray(result.catalogue)) throw new Error("Activity forms could not be read.");
      setCatalogue(result.catalogue); } catch (error) { setMessage(error instanceof Error ? error.message : "Forms could not be loaded."); }
    finally { setBusy(false); }
  }
  async function load(templateId: string, variantId = "") {
    if (dirty && !window.confirm("Discard unsaved master-form changes?")) return;
    setBusy(true); setMessage("");
    try { const result = await api(`${endpoint}?view=masters&actorMode=${actorMode}&activityTemplateId=${encodeURIComponent(templateId)}&variantId=${encodeURIComponent(variantId)}`);
      if (!result.form || typeof result.form !== "object" || !("fields" in result.form) || !Array.isArray(result.form.fields)) throw new Error("The activity form could not be read.");
      setForm(result.form as ActivityForm); setExpectedVersion(Number(result.expectedVersion)); setSelected(templateId); setQuestion(0); setDirty(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The form could not be loaded."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!form) return; setBusy(true); setMessage("");
    try { const result = await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_master", actorMode,
      activityTemplateId: form.activityTemplateId, variantId: form.variantId, expectedVersion, form }) });
      if (!result.form || typeof result.form !== "object") throw new Error("The master form was not saved.");
      setForm(result.form as ActivityForm); setExpectedVersion(Number(result.expectedVersion)); setDirty(false); setMessage("Saved. The new version is available immediately for new activity records.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The master form was not saved."); }
    finally { setBusy(false); }
  }
  async function reviewQueue() {
    setBusy(true); setMessage("");
    try { const result = await api(`${endpoint}?view=review_queue&actorMode=${actorMode}`);
      if (!Array.isArray(result.records)) throw new Error("Submitted field records could not be loaded.");
      setRecords(result.records); if (!result.records.length) setMessage("No submitted field records yet.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The review queue could not be loaded."); }
    finally { setBusy(false); }
  }
  function updateField(patch: Partial<ActivityField>) {
    setForm((current) => current ? { ...current, fields: current.fields.map((field, index) => index === question ? { ...field, ...patch } : field) } : current); setDirty(true);
  }
  async function viewReport(recordId: string) {
    setBusy(true); setMessage(""); setReviewLink("");
    try { const result = await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view_review_report", actorMode, recordId }) });
      if (typeof result.reportUrl !== "string") throw new Error("The review report could not be opened.");
      setReviewLink(result.reportUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The report could not be opened."); }
    finally { setBusy(false); }
  }
  const field = form?.fields[question];
  return <section className={styles.builderSection}>
    <header><div><h4>Active trade activity forms</h4><p>Trades complete these forms and send the signed field records to Creditex. Saving a master publishes its next version immediately. Existing signed records retain their original form.</p></div>
      <button type="button" disabled={busy || !canAuthor} onClick={() => void loadCatalogue()}>Open active form library</button>
      <button type="button" disabled={busy || !canAuthor} onClick={() => void reviewQueue()}>Submitted field records</button></header>
    {message ? <p role="status">{message}</p> : null}
    {reviewLink ? <p><a href={reviewLink} target="_blank" rel="noreferrer">Open the signed field report and original evidence</a> (link expires in one hour)</p> : null}
    {catalogue.length ? <label>Activity<select disabled={busy} value={selected} onChange={(event) => void load(event.target.value)}><option value="" disabled>Choose an activity</option>{catalogue.map((item) => <option key={item.activityTemplateId} value={item.activityTemplateId}>{item.programCode} {item.activityCode} | {item.title}</option>)}</select></label> : null}
    {form && field ? <fieldset disabled={busy || !canAuthor}>
      <legend>Master version {form.version}{dirty ? " | Unsaved changes" : ""}</legend>
      {form.variantOptions.length > 1 ? <label>Premises<select value={form.variantId} onChange={(event) => void load(selected, event.target.value)}>{form.variantOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : null}
      <label>Form title<input value={form.title} maxLength={300} onChange={(event) => { setForm({ ...form, title: event.target.value }); setDirty(true); }} /></label>
      <label>Question<select value={question} onChange={(event) => setQuestion(Number(event.target.value))}>{form.fields.map((item, index) => <option key={item.key} value={index}>{index + 1}. {item.section}: {item.label}</option>)}</select></label>
      <div className="admin-form-grid"><label>Section<input value={field.section} onChange={(event) => updateField({ section: event.target.value })} /></label>
        <label>Question<input value={field.label} onChange={(event) => updateField({ label: event.target.value })} /></label>
        <label>Answer type<select value={field.type} onChange={(event) => updateField({ type: event.target.value as ActivityField["type"], options: event.target.value === "select" ? ["Yes", "No"] : [] })}>{["text", "number", "date", "select", "boolean", "photo", "document"].map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>When<select value={field.phase} onChange={(event) => updateField({ phase: event.target.value === "before" ? "before" : "after" })}><option value="before">Before work</option><option value="after">After work</option></select></label>
      </div>
      <label>Instructions<textarea value={field.help} onChange={(event) => updateField({ help: event.target.value })} /></label>
      {field.type === "select" ? <label>Choices, one per line<textarea value={field.options.join("\n")} onChange={(event) => updateField({ options: event.target.value.split("\n") })} /></label> : null}
      <label><input type="checkbox" checked={field.required} onChange={(event) => updateField({ required: event.target.checked })} />Required question</label>
      {field.condition ? <p>Conditional question: {JSON.stringify(field.condition)}</p> : null}
      <div className="admin-choice-row"><button type="button" disabled={question === 0} onClick={() => setQuestion(question - 1)}>Previous question</button><button type="button" disabled={question >= form.fields.length - 1} onClick={() => setQuestion(question + 1)}>Next question</button>
        <button type="button" onClick={() => { setForm({ ...form, fields: [...form.fields, { key: `custom.${crypto.randomUUID()}`, label: "New question", section: field.section, type: "text", phase: field.phase, required: false, options: [], help: "" }] }); setQuestion(form.fields.length); setDirty(true); }}>Add question</button></div>
      <details><summary>Creditex declarations ({form.declarations.length})</summary>{form.declarations.map((declaration, index) => <label key={declaration.key}>{declaration.title}<textarea rows={8} value={declaration.text} onChange={(event) => { setForm({ ...form, declarations: form.declarations.map((item, i) => i === index ? { ...item, text: event.target.value } : item) }); setDirty(true); }} /></label>)}</details>
      <details><summary>Regulator sources and review notes</summary>{form.sources.map((source) => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}{form.reviewNotes.map((note, index) => <p key={index}>{note}</p>)}</details>
      <button type="button" disabled={!dirty} onClick={() => void save()}>{busy ? "Saving..." : "Save and publish master"}</button>
    </fieldset> : null}
    {records.length ? <table><thead><tr><th>Field record</th><th>Activity</th><th>Submitted</th><th>Job</th><th>Report</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.recordNumber}</td><td>{record.form.title}</td><td>{record.submittedAt}</td><td>{record.workOrderId}</td><td><button type="button" disabled={busy} onClick={() => void viewReport(record.id)}>View report</button></td></tr>)}</tbody></table> : null}
  </section>;
}
