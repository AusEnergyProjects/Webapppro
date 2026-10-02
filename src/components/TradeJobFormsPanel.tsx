"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { businessFormPages, type BusinessFormField } from '@/lib/trade-business-form-design';
import { visibleTradeFormFields } from '@/lib/trade-form-library.mjs';
import { useFormTimeTracking, WorkTimeStatus } from "./TradeWorkTimeTracking";

type Field = BusinessFormField;
type Template = { key: string; version: number; name: string; jurisdiction: string; description: string; guidance: string; fieldCount: number };
type FormRecord = { id: string; templateKey: string; templateVersion: number; templateName: string; jurisdiction: string; template: { guidance: string; fields: Field[] }; answers: Record<string, string | boolean>; status: string; revision: number; ready: boolean; missing: string[]; completedAt: string };
type Result = { ok?: boolean; jobProgress?: { pending?: boolean }; protectedJob?: boolean; serviceCategory?: string; templates?: Template[]; forms?: FormRecord[]; error?: string };

export function TradeJobFormsPanel({ user, workOrderId, readOnly = false, onChanged }: { user: User; workOrderId: string; readOnly?: boolean; onChanged?: () => Promise<void> }) {
  const fetch = useTradeBusinessFetch();
  const [result, setResult] = useState<Result>({ templates: [], forms: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [libraryOpen, setLibraryOpen] = useState<boolean | null>(null);

  const request = useCallback(async (method: "GET" | "POST" | "PATCH" = "GET", body?: Record<string, unknown>) => {
    if (readOnly && method !== "GET") throw new Error("These field forms are view only.");
    const token = await user.getIdToken();
    const response = await fetch(method === "GET" ? `/api/trade-job-forms?workOrderId=${encodeURIComponent(workOrderId)}` : "/api/trade-job-forms", {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...body, workOrderId }) : undefined,
      cache: "no-store",
    });
    const next = await response.json().catch(() => ({})) as Result;
    if (!response.ok) throw new Error(next.error || "The field forms could not be loaded.");
    setResult(next);
    return next;
  }, [fetch, readOnly, user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => void request()
      .catch((error) => active && setStatus(error instanceof Error ? error.message : "The field forms could not be loaded."))
      .finally(() => active && setLoading(false)));
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [request]);

  async function acknowledgeSave(result: Result, success: string) {
    const acknowledgement = result.jobProgress?.pending ? `${success} Job status is waiting to sync.` : success;
    setStatus(acknowledgement);
    try { await onChanged?.(); }
    catch { setStatus(`${acknowledgement} The latest job details could not be refreshed. Reopen the job to check its status.`); }
  }

  async function start(template: Template) {
    if (readOnly) return;
    setBusy(`start:${template.key}`); setStatus("Adding the versioned form to this job...");
    try { const next = await request("POST", { templateKey: template.key, templateVersion: template.version }); await acknowledgeSave(next, "Field form added to this job."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The field form could not be added."); }
    finally { setBusy(""); }
  }

  async function save(formId: string, baseRevision: number, answers: Record<string, string | boolean>, complete: boolean) {
    if (readOnly) return false;
    setBusy(`save:${formId}`); setStatus(complete ? "Checking and completing the field form..." : "Saving the field form...");
    try { const next = await request("PATCH", { formId, baseRevision, answers, complete }); await acknowledgeSave(next, complete ? "Field form completed." : "Field form saved."); return true; }
    catch (error) { setStatus(error instanceof Error ? error.message : "The field form could not be saved."); return false; }
    finally { setBusy(""); }
  }

  if (loading) return <div className="crm-empty"><strong>Opening field forms</strong><span>Loading the forms available for this work type.</span></div>;
  const existingKeys = new Set((result.forms || []).map((form) => `${form.templateKey}:${form.templateVersion}`));

  return <div className="crm-job-forms">
    <header><div><span>Forms</span><h4>{readOnly ? "Saved job forms" : "Forms for this job"}</h4></div><small>These forms organise technical job evidence. They do not replace licences, permits, formal certificates, standards or scheme documents required for the actual work.</small></header>
    <section className="crm-active-forms"><header><strong>Job forms</strong><span>{(result.forms || []).filter((form) => form.status === "complete").length}/{(result.forms || []).length} complete</span></header>
      {(result.forms || []).length ? (result.forms || []).map((form) => <JobForm key={form.id} form={form} workOrderId={workOrderId} disabled={readOnly || busy === `save:${form.id}`} readOnly={readOnly} onSave={save} />) : <div className="crm-empty"><strong>No forms added yet</strong><span>{readOnly ? "There are no field forms to review." : "Choose one supporting form below. Your business forms are available alongside supporting templates."}</span></div>}
    </section>
    {!readOnly && <details className="crm-field-secondary" open={libraryOpen ?? !(result.forms || []).length} onToggle={event => setLibraryOpen(event.currentTarget.open)}>
      <summary>Add a form to this job</summary>
      <section className="crm-form-library"><div><strong>Available for this work type</strong><span>{(result.templates || []).length} supporting form{(result.templates || []).length === 1 ? "" : "s"}</span></div><div>{(result.templates || []).map((template) => {
      const added = existingKeys.has(`${template.key}:${template.version}`);
      return <article key={`${template.key}:${template.version}`}><div><span>{template.jurisdiction} | Version {template.version}</span><strong>{template.name}</strong><p>{template.description}</p><small>{template.fieldCount} fields</small></div><button type="button" disabled={added || busy === `start:${template.key}`} onClick={() => void start(template)}>{added ? "Added" : "Add to job"}</button></article>;
    })}</div></section>

    </details>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </div>;
}

function JobForm({ form, workOrderId, disabled, readOnly, onSave }: { form: FormRecord; workOrderId: string; disabled: boolean; readOnly: boolean; onSave: (id: string, revision: number, answers: Record<string, string | boolean>, complete: boolean) => Promise<boolean> }) {
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(form.answers || {});
  const [open, setOpen] = useState(form.status !== "complete");
  const [pageIndex, setPageIndex] = useState(0);
  const pages = businessFormPages(visibleTradeFormFields(form.template, answers));
  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
  const timing = useFormTimeTracking({ formKind: "job_form", formId: form.id, workOrderId, pageKey: page?.key || "form", pageTitle: page?.title || form.templateName,
    enabled: open && !readOnly && form.status !== "complete", activateOnOpen: false });
  function change(key: string, value: string | boolean) { setAnswers(current => { const next = { ...current, [key]: value }; const visible = new Set(visibleTradeFormFields(form.template, next).map((field: Field) => field.key)); return Object.fromEntries(Object.entries(next).filter(([key]) => visible.has(key))); }); }
  async function completeForm() { if (await onSave(form.id, form.revision, answers, true)) timing.markCompleted(); }
  function submit(event: FormEvent<HTMLFormElement>, complete: boolean) { event.preventDefault(); if (!readOnly) void onSave(form.id, form.revision, answers, complete); }
  return <details className={`crm-job-form status-${form.status}`} open={open} onToggle={event => setOpen(event.currentTarget.open)} {...timing.bind}>
    <summary><span><strong>{form.templateName}</strong><small>{form.jurisdiction} | Version {form.templateVersion}</small></span><b>{form.status === "complete" ? "Complete" : readOnly ? "View only" : form.ready ? "Ready to complete" : `${form.missing.length} required`}</b></summary>
    <div><p>{form.template.guidance}</p>{pages.length > 1 && <nav aria-label="Form pages">{pages.map((item, index) => <button type="button" key={item.key} aria-current={page === item ? 'step' : undefined} onClick={() => setPageIndex(index)}>{index + 1}. {item.title}</button>)}</nav>}<h5>{page?.title}</h5><form onSubmit={(event) => submit(event, false)}>{(page?.fields || []).map((field) => <label className={field.type === "textarea" ? "wide" : ""} key={field.key}>{field.type === "checkbox" ? <><input type="checkbox" required={field.required} checked={answers[field.key] === true} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.checked)} /><span>{field.label}{field.required ? " *" : ""}</span></> : <><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "textarea" ? <textarea rows={3} required={field.required} maxLength={field.maxLength || 1200} value={String(answers[field.key] || "")} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.value)} /> : field.type === "select" ? <select required={field.required} value={String(answers[field.key] || "")} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.value)}><option value="">Choose one</option>{(field.options || []).map((option) => <option key={option}>{option}</option>)}</select> : <input type={field.type === "date" ? "date" : "text"} required={field.required} maxLength={field.maxLength || 240} value={String(answers[field.key] || "")} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.value)} />}</>}</label>)}
      {!readOnly && form.status !== "complete" && <div className="crm-job-form-actions"><button disabled={disabled} formNoValidate>Save draft</button><button className="complete" type="button" disabled={disabled} onClick={(event) => { const parent = event.currentTarget.closest("form"); if (parent?.reportValidity()) void completeForm(); }}>Check and complete</button></div>}
    </form>{open && <WorkTimeStatus />}</div>
  </details>;
}
