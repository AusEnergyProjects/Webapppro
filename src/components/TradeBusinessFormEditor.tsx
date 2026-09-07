"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type Field = { key: string; label: string; type: string; required: boolean; options?: string[] };
type Template = { id: string; version: number; updatedAt: string; name: string; description: string; guidance: string; categories: string[]; jurisdiction: string; fields: Field[] };
type Library = { canManage: boolean; templates: Template[] };
const newField = (): Field => ({ key: `question_${crypto.randomUUID().replaceAll("-", "_")}`, label: "", type: "select", required: false, options: ["Yes", "No"] });

export function TradeBusinessFormEditor({ user, serviceCategory, onSaved }: { user: User; serviceCategory: string; onSaved: () => Promise<void> }) {
  const [library, setLibrary] = useState<Library>({ canManage: false, templates: [] });
  const [draft, setDraft] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const request = useCallback(async (body?: object): Promise<Library> => {
    const response = await fetch("/api/trade-form-templates", { method: body ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not open your form library.");
    return result;
  }, [user]);
  useEffect(() => {
    let active = true;
    void request().then((result) => { if (active) setLibrary(result); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not open the form library."); });
    return () => { active = false; };
  }, [request]);
  useEffect(() => {
    if (!draft && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, busy]);
  async function save() {
    if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      setLibrary(await request({ ...draft, id: draft.id || undefined, expectedVersion: draft.version, expectedUpdatedAt: draft.updatedAt, description: draft.description || draft.name }));
      setDraft(null); await onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The form was not saved."); }
    finally { setBusy(false); }
  }
  if (!library.canManage) return error ? <p role="status">{error}</p> : null;
  function updateField(index: number, patch: Partial<Field>) {
    setDraft((current) => current ? { ...current, fields: current.fields.map((field, i) => i === index ? { ...field, ...patch } : field) } : current);
  }
  return <section className="admin-form-template-builder">
    <header><div><strong>Your business forms</strong><p>Reusable additional questions for your team. Mandatory activity forms stay controlled by Creditex and Australian Energy Assessments.</p></div></header>
    {error ? <p role="alert">{error}</p> : null}
    {!draft ? <div className="admin-choice-row"><button type="button" onClick={() => setDraft({ id: "", version: 1, updatedAt: "", name: "", description: "", guidance: "", categories: [serviceCategory], jurisdiction: "AU", fields: [newField()] })}>Create business form</button>{library.templates.map((template) => <button key={template.id} type="button" onClick={() => setDraft(structuredClone(template))}>Edit {template.name}</button>)}</div> : <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy}><legend>Business form questions</legend><div className="admin-form-grid"><label>Form name<input required maxLength={140} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Instructions<textarea required maxLength={1200} value={draft.guidance} onChange={(event) => setDraft({ ...draft, guidance: event.target.value })} /></label></div>
      <section className="admin-template-fields">{draft.fields.map((field, index) => <article key={field.key}>
        <label>Question {index + 1}<input required maxLength={180} value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} /></label>
        <label>Answer<select value={field.type} onChange={(event) => updateField(index, { type: event.target.value, options: event.target.value === "select" ? field.options || ["Yes", "No"] : undefined })}><option value="select">Select an answer</option><option value="checkbox">Confirm a check</option><option value="text">Short text</option><option value="textarea">Notes</option><option value="date">Date</option></select></label>
        {field.type === "select" ? <label>Answers, one per line<textarea required value={(field.options || []).join("\n")} onChange={(event) => updateField(index, { options: event.target.value.split("\n") })} /></label> : null}
        <label><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} />Required</label>
        <button type="button" disabled={busy || draft.fields.length === 1} onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}>Remove</button>
      </article>)}</section>
      <footer><button type="button" disabled={busy || draft.fields.length >= 30} onClick={() => setDraft({ ...draft, fields: [...draft.fields, newField()] })}>Add question</button><button type="submit" disabled={busy}>Save and make available</button><button type="button" disabled={busy} onClick={() => { if (window.confirm("Discard this form's unsaved changes?")) setDraft(null); }}>Cancel</button></footer></fieldset>
    </form>}
  </section>;
}
