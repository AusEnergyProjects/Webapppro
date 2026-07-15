"use client";

import { useCallback, useEffect, useState } from "react";

type Role = "owner" | "admin" | "reviewer" | "support";
type Field = { key: string; label: string; type: string; required: boolean; maxLength?: number; options?: string[] };
type Template = { id: string; templateKey: string; version: number; name: string; jurisdiction: string; categories: string[]; description: string; guidance: string; fields: Field[]; sourceNotes: string; status: string; publishedAt: string; updatedAt: string };
type Api = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;

const categoryOptions = [["assessment", "Assessment"], ["solar", "Solar"], ["battery", "Battery"], ["heating-cooling", "Heating and cooling"], ["hot-water", "Hot water"], ["insulation-draughts", "Insulation and draughts"], ["ev-charging", "EV charging"], ["other", "Other"]];
const empty = { templateKey: "", version: 1, name: "", jurisdiction: "AU", categories: [] as string[], description: "", guidance: "", sourceNotes: "", fields: [{ key: "work_date", label: "Work date", type: "date", required: true }] as Field[] };

export function AdminFormTemplates({ api, role }: { api: Api; role: Role }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draft, setDraft] = useState(empty);
  const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  const canManage = role === "owner" || role === "admin";
  const load = useCallback(async () => {
    const result = await api("/api/admin/form-templates");
    setTemplates((result.templates || []) as Template[]);
  }, [api]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load().catch((error) => setStatus(error instanceof Error ? error.message : "Form governance could not be loaded.")));
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  function updateField(index: number, patch: Partial<Field>) { setDraft((current) => ({ ...current, fields: current.fields.map((field, position) => position === index ? { ...field, ...patch } : field) })); }
  function toggleCategory(value: string) { setDraft((current) => ({ ...current, categories: current.categories.includes(value) ? current.categories.filter((item) => item !== value) : [...current.categories, value] })); }
  function clone(template: Template) { setDraft({ templateKey: template.templateKey, version: template.version + 1, name: template.name, jurisdiction: template.jurisdiction, categories: [...template.categories], description: template.description, guidance: template.guidance, sourceNotes: "", fields: template.fields.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })) }); window.scrollTo({ top: 0, behavior: "smooth" }); }

  async function save(publishNow: boolean) {
    setBusy(true); setStatus(publishNow ? "Validating and publishing the new form version..." : "Saving the draft form version...");
    try {
      const result = await api("/api/admin/form-templates", { method: "POST", body: JSON.stringify({ ...draft, publishNow }) });
      setTemplates((result.templates || []) as Template[]); setDraft(empty);
      setStatus(publishNow ? "The form version is published and available for matching jobs." : "Draft saved. It remains hidden from installer accounts.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The form version could not be saved."); }
    finally { setBusy(false); }
  }

  async function action(template: Template, next: "publish" | "withdraw") {
    setBusy(true); setStatus(`${next === "publish" ? "Publishing" : "Withdrawing"} the form version...`);
    try { const result = await api("/api/admin/form-templates", { method: "PATCH", body: JSON.stringify({ id: template.id, action: next }) }); setTemplates((result.templates || []) as Template[]); setStatus("Form availability updated and recorded in the audit history."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The form version could not be updated."); }
    finally { setBusy(false); }
  }

  return <>
    <header className="admin-page-heading"><span>Field compliance</span><h1>Form library governance</h1><p>Publish short, versioned technical forms to the right work types. Existing completed records keep their original snapshot when the library changes.</p></header>
    {status && <div className="admin-banner" role="status">{status}</div>}
    {canManage && <form className="admin-card admin-form-template-builder" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
      <header><div><span>New governed version</span><h2>Build a field-friendly form</h2></div><small>Published versions are immutable. Clone a version to improve it.</small></header>
      <div className="admin-form-grid">
        <label>Template key<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.templateKey} onChange={(event) => setDraft({ ...draft, templateKey: event.target.value.toLowerCase() })} placeholder="battery-commissioning" /></label>
        <label>Version<input required type="number" min="1" max="1000" value={draft.version} onChange={(event) => setDraft({ ...draft, version: Number(event.target.value) })} /></label>
        <label>Name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Battery commissioning record" /></label>
        <label>Jurisdiction<select value={draft.jurisdiction} onChange={(event) => setDraft({ ...draft, jurisdiction: event.target.value })}>{["AU", "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="wide">Purpose<textarea required rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What this supporting record captures" /></label>
        <label className="wide">Technician guidance<textarea required rows={2} value={draft.guidance} onChange={(event) => setDraft({ ...draft, guidance: event.target.value })} placeholder="Plain language instructions and limitations" /></label>
        <fieldset className="wide"><legend>Work categories</legend><div className="admin-choice-row">{categoryOptions.map(([value, label]) => <label key={value}><input type="checkbox" checked={draft.categories.includes(value)} onChange={() => toggleCategory(value)} />{label}</label>)}</div></fieldset>
        <label className="wide">Governance notes<textarea rows={2} value={draft.sourceNotes} onChange={(event) => setDraft({ ...draft, sourceNotes: event.target.value })} placeholder="Standards, regulator guidance or internal reviewer and review date. Required to publish." /></label>
      </div>
      <section className="admin-template-fields"><header><strong>Fields</strong><button type="button" onClick={() => setDraft((current) => ({ ...current, fields: [...current.fields, { key: "", label: "", type: "text", required: false }] }))}>Add field</button></header>{draft.fields.map((field, index) => <article key={index}>
        <label>Field key<input required value={field.key} onChange={(event) => updateField(index, { key: event.target.value.toLowerCase().replaceAll(" ", "_") })} /></label>
        <label>Label<input required value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} /></label>
        <label>Type<select value={field.type} onChange={(event) => updateField(index, { type: event.target.value })}>{["text", "textarea", "checkbox", "date", "select"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="admin-inline-check"><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} />Required</label>
        {field.type === "select" && <label>Options<input required value={(field.options || []).join(", ")} onChange={(event) => updateField(index, { options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Serviceable, Attention required" /></label>}
        <button type="button" disabled={draft.fields.length === 1} onClick={() => setDraft((current) => ({ ...current, fields: current.fields.filter((_, position) => position !== index) }))}>Remove</button>
      </article>)}</section>
      <footer><button disabled={busy}>Save draft</button><button className="primary" type="button" disabled={busy} onClick={(event) => { const form = event.currentTarget.closest("form"); if (form?.reportValidity()) void save(true); }}>Validate and publish</button></footer>
    </form>}
    <section className="admin-card admin-template-register"><header><div><span>Version register</span><h2>Published, draft and withdrawn forms</h2></div><strong>{templates.length} governed version{templates.length === 1 ? "" : "s"}</strong></header>
      {templates.length ? templates.map((template) => <article key={template.id}><div><span>{template.jurisdiction} | Version {template.version}</span><h3>{template.name}</h3><p>{template.description}</p><small>{template.categories.join(", ")} | {template.fields.length} fields</small></div><div><b className={`admin-status status-${template.status}`}>{template.status}</b>{canManage && <button type="button" onClick={() => clone(template)}>Clone next version</button>}{canManage && template.status === "draft" && <button type="button" disabled={busy} onClick={() => void action(template, "publish")}>Publish</button>}{canManage && template.status === "published" && <button type="button" disabled={busy} onClick={() => void action(template, "withdraw")}>Withdraw</button>}</div></article>) : <div className="admin-empty"><strong>No governed forms yet</strong><p>The built-in national forms remain available. Create a governed version when operations needs a reviewed update or jurisdiction-specific workflow.</p></div>}
    </section>
  </>;
}
