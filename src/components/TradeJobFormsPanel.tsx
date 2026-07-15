"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type Field = { key: string; label: string; type: string; required: boolean; maxLength?: number; options?: string[] };
type Template = { key: string; version: number; name: string; jurisdiction: string; description: string; guidance: string; fieldCount: number };
type FormRecord = { id: string; templateKey: string; templateVersion: number; templateName: string; jurisdiction: string; template: { guidance: string; fields: Field[] }; answers: Record<string, string | boolean>; status: string; revision: number; ready: boolean; missing: string[]; completedAt: string };
type Result = { ok?: boolean; protectedJob?: boolean; templates?: Template[]; forms?: FormRecord[]; error?: string };

export function TradeJobFormsPanel({ user, workOrderId }: { user: User; workOrderId: string }) {
  const [result, setResult] = useState<Result>({ templates: [], forms: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const request = useCallback(async (method: "GET" | "POST" | "PATCH" = "GET", body?: Record<string, unknown>) => {
    const token = await user.getIdToken();
    const response = await fetch(method === "GET" ? `/api/trade-job-forms?workOrderId=${encodeURIComponent(workOrderId)}` : "/api/trade-job-forms", {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...body, workOrderId }) : undefined, cache: "no-store",
    });
    const next = await response.json().catch(() => ({})) as Result;
    if (!response.ok) throw new Error(next.error || "The field forms could not be loaded.");
    setResult(next);
  }, [user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => void request().catch((error) => active && setStatus(error instanceof Error ? error.message : "The field forms could not be loaded."))
      .finally(() => active && setLoading(false)));
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [request]);

  async function start(template: Template) {
    setBusy(`start:${template.key}`); setStatus("Adding the versioned form to this job...");
    try { await request("POST", { templateKey: template.key, templateVersion: template.version }); setStatus("Field form added to this job."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The field form could not be added."); }
    finally { setBusy(""); }
  }

  async function save(formId: string, baseRevision: number, answers: Record<string, string | boolean>, complete: boolean) {
    setBusy(`save:${formId}`); setStatus(complete ? "Checking and completing the field form..." : "Saving the field form...");
    try { await request("PATCH", { formId, baseRevision, answers, complete }); setStatus(complete ? "Field form completed." : "Field form saved."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The field form could not be saved."); }
    finally { setBusy(""); }
  }

  if (loading) return <div className="crm-empty"><strong>Opening field forms</strong><span>Loading the forms available for this work type.</span></div>;
  const existingKeys = new Set((result.forms || []).map((form) => `${form.templateKey}:${form.templateVersion}`));

  return <div className="crm-job-forms">
    <header><div><span>Versioned field records</span><h4>Complete the right form without paperwork hunting</h4></div><small>These forms organise technical job evidence. They do not replace licences, permits, formal certificates, standards or scheme documents required for the actual work.</small></header>
    <section className="crm-form-library"><div><strong>Available for this work type</strong><span>{(result.templates || []).length} supporting form{(result.templates || []).length === 1 ? "" : "s"}</span></div><div>{(result.templates || []).map((template) => {
      const added = existingKeys.has(`${template.key}:${template.version}`);
      return <article key={`${template.key}:${template.version}`}><div><span>{template.jurisdiction} | Version {template.version}</span><strong>{template.name}</strong><p>{template.description}</p><small>{template.fieldCount} fields</small></div><button type="button" disabled={added || busy === `start:${template.key}`} onClick={() => void start(template)}>{added ? "Added" : "Add to job"}</button></article>;
    })}</div></section>
    <section className="crm-active-forms"><header><strong>Job forms</strong><span>{(result.forms || []).filter((form) => form.status === "complete").length}/{(result.forms || []).length} complete</span></header>
      {(result.forms || []).length ? (result.forms || []).map((form) => <JobForm key={form.id} form={form} disabled={busy === `save:${form.id}`} onSave={save} />) : <div className="crm-empty"><strong>No forms added yet</strong><span>Choose one supporting form above. The shortest useful form is usually the best place to start.</span></div>}
    </section>
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </div>;
}

function JobForm({ form, disabled, onSave }: { form: FormRecord; disabled: boolean; onSave: (id: string, revision: number, answers: Record<string, string | boolean>, complete: boolean) => Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(form.answers || {});
  function change(key: string, value: string | boolean) { setAnswers((current) => ({ ...current, [key]: value })); }
  function submit(event: FormEvent<HTMLFormElement>, complete: boolean) { event.preventDefault(); void onSave(form.id, form.revision, answers, complete); }
  return <details className={`crm-job-form status-${form.status}`} open={form.status !== "complete"}>
    <summary><span><strong>{form.templateName}</strong><small>{form.jurisdiction} | Version {form.templateVersion}</small></span><b>{form.status === "complete" ? "Complete" : form.ready ? "Ready to complete" : `${form.missing.length} required`}</b></summary>
    <div><p>{form.template.guidance}</p><form onSubmit={(event) => submit(event, false)}>{form.template.fields.map((field) => <label className={field.type === "textarea" ? "wide" : ""} key={field.key}>{field.type === "checkbox" ? <><input type="checkbox" required={field.required} checked={answers[field.key] === true} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.checked)} /><span>{field.label}{field.required ? " *" : ""}</span></> : <><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "textarea" ? <textarea rows={3} required={field.required} maxLength={field.maxLength || 1200} value={String(answers[field.key] || "")} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.value)} /> : field.type === "select" ? <select required={field.required} value={String(answers[field.key] || "")} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.value)}><option value="">Choose one</option>{(field.options || []).map((option) => <option key={option}>{option}</option>)}</select> : <input type={field.type === "date" ? "date" : "text"} required={field.required} maxLength={field.maxLength || 240} value={String(answers[field.key] || "")} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.value)} />}</>}</label>)}
      {form.status !== "complete" && <div className="crm-job-form-actions"><button disabled={disabled}>Save draft</button><button className="complete" type="button" disabled={disabled} onClick={(event) => { const parent = event.currentTarget.closest("form"); if (parent?.reportValidity()) void onSave(form.id, form.revision, answers, true); }}>Check and complete</button></div>}
    </form></div>
  </details>;
}
