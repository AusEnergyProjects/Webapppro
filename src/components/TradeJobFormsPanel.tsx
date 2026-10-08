"use client";

import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import { TradeJobFormLibrary } from "./TradeJobFormLibrary";
import type { TradeJobFormLibraryOption } from "@/lib/trade-job-form-library";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { businessFormPages, type BusinessFormField } from '@/lib/trade-business-form-design';
import { visibleTradeFormFields } from '@/lib/trade-form-library.mjs';
import { useFormTimeTracking, WorkTimeStatus } from "./TradeWorkTimeTracking";
import { WattzunFormAssistButton } from "./WattzunFormAssistButton";
import { WATTZUN_FORM_SAVED_EVENT, readWattzunFormSaved, dispatchWattzunFormNativeSaved } from "@/lib/wattzun-form-client";

type Field = BusinessFormField;
const sameAnswers = (left: Record<string, string | boolean>, right: Record<string, string | boolean>) => Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => right[key] === value);
type Template = { key: string; version: number; name: string; jurisdiction: string; description: string; guidance: string; fieldCount: number };
type FormRecord = { id: string; templateKey: string; templateVersion: number; templateName: string; jurisdiction: string; template: { guidance: string; fields: Field[] }; answers: Record<string, string | boolean>; status: string; revision: number; ready: boolean; missing: string[]; completedAt: string };
type Result = { ok?: boolean; jobProgress?: { pending?: boolean }; protectedJob?: boolean; serviceCategory?: string; templates?: Template[]; forms?: FormRecord[]; error?: string };

export function TradeJobFormsPanel({ user, workOrderId, readOnly = false, libraryOpen: controlledLibraryOpen, onLibraryOpenChange, onChanged }: { user: User; workOrderId: string; readOnly?: boolean; libraryOpen?: boolean; onLibraryOpenChange?: (open: boolean) => void; onChanged?: () => Promise<void> }) {
  const fetch = useTradeBusinessFetch();
  const [result, setResult] = useState<Result>({ templates: [], forms: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [libraryRevision, setLibraryRevision] = useState(0);
  const attachmentInFlight = useRef(false);
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

  async function attach(option: TradeJobFormLibraryOption, revision?: number) {
    if (readOnly || attachmentInFlight.current || option.added || option.unavailableReason) return;
    attachmentInFlight.current = true; setBusy(`start:${option.id}`); setStatus(`Adding ${option.name}...`);
    let attached = false;
    try {
      const selection = option.selection;
      if (selection.kind === "business") {
        const next = await request("POST", { templateKey: selection.templateKey, templateVersion: selection.templateVersion });
        attached = true; await acknowledgeSave(next, `${option.name} added to this job.`);
      } else {
        const token = await user.getIdToken();
        async function mutate(endpoint: string, body: Record<string, unknown>) {
          const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, workOrderId }), cache: "no-store" });
          const next = await response.json() as { ok?: boolean; error?: string };
          if (!response.ok || !next.ok) throw new Error(next.error || "This form could not be added.");
          return next;
        }
        if (selection.kind === "piesa") {
          await mutate("/api/trade-veu-electrical-assessments", { action: "start" }); attached = true;
        } else {
          if (!Number.isSafeInteger(revision)) throw new Error("Refresh the form library before adding this form.");
          await mutate("/api/field/job-activities", selection.kind === "rental"
            ? { kind: "rental", moduleKey: selection.moduleKey, expectedRevision: revision }
            : { kind: "program", programTemplateId: selection.programTemplateId, activityTemplateId: selection.activityTemplateId, variantId: selection.variantId, expectedRevision: revision });
          attached = true;
          if (selection.kind === "creditex") {
            const response = await fetch(`/api/trade-activity-forms?workOrderId=${encodeURIComponent(workOrderId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
            const list = await response.json() as { records?: Array<{ intentId: string; activityTemplateId: string }>; error?: string };
            if (!response.ok) throw new Error(list.error || "The activity form could not be opened.");
            const record = list.records?.find(item => item.activityTemplateId === selection.activityTemplateId);
            if (!record?.intentId) throw new Error("The saved activity could not be found. Refresh the job to continue.");
            await mutate("/api/trade-activity-forms", { action: "open", intentId: record.intentId, variantId: selection.variantId });
          }
        }
        await acknowledgeSave({}, `${option.name} added to this job.`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The form could not be added.";
      setStatus(attached ? `The activity is saved on this job, but its form needs attention: ${detail}` : detail);
      if (attached) { try { await onChanged?.(); } catch { /* The saved attachment remains visible on reopening. */ } }
    } finally { attachmentInFlight.current = false; setBusy(""); setLibraryRevision(value => value + 1); }
  }

  async function save(formId: string, baseRevision: number, answers: Record<string, string | boolean>, complete: boolean) {
    if (readOnly) return null;
    setBusy(`save:${formId}`); setStatus(complete ? "Checking and completing the field form..." : "Saving the field form...");
    try { const next = await request("PATCH", { formId, baseRevision, answers, complete }); await acknowledgeSave(next, complete ? "Field form completed." : "Field form saved."); return next.forms?.find(form => form.id === formId) ?? null; }
    catch (error) { setStatus(error instanceof Error ? error.message : "The field form could not be saved."); return null; }
    finally { setBusy(""); }
  }

  const reloadForm = useCallback(async (formId: string) => (await request()).forms?.find(form => form.id === formId) ?? null, [request]);

  if (loading) return <div className="crm-empty"><strong>Opening field forms</strong><span>Loading the forms available for this work type.</span></div>;
  const showLibrary = controlledLibraryOpen ?? libraryOpen ?? !(result.forms || []).length;

  return <div className="crm-job-forms">
    <header><div><span>Forms</span><h4>{readOnly ? "Saved job forms" : "Forms for this job"}</h4></div><small>Rental assessments and Creditex records open in their own sections on this job.</small></header>
    <section className="crm-active-forms"><header><strong>Business forms</strong><span>{(result.forms || []).filter((form) => form.status === "complete").length}/{(result.forms || []).length} complete</span></header>
      {(result.forms || []).length ? (result.forms || []).map((form) => <JobForm key={form.id} userUid={user.uid} onReload={reloadForm} form={form} workOrderId={workOrderId} disabled={readOnly || busy === `save:${form.id}`} readOnly={readOnly} onSave={save} />) : <div className="crm-empty"><strong>No business forms added yet</strong><span>{readOnly ? "There are no field forms to review." : "Search the form library to add a rental assessment, Creditex form or published business form."}</span></div>}
    </section>
    {!readOnly && <details className="crm-field-secondary" open={showLibrary} onToggle={event => { setLibraryOpen(event.currentTarget.open); onLibraryOpenChange?.(event.currentTarget.open); }}>
      <summary>Add a form to this job</summary>
      {showLibrary && <TradeJobFormLibrary user={user} workOrderId={workOrderId} serviceCategory={result.serviceCategory || "other"} selectedIds={[]} disabled={Boolean(busy)} refreshKey={libraryRevision} onSelect={attach} />}

    </details>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </div>;
}

function JobForm({ form, userUid, workOrderId, disabled, readOnly, onSave, onReload }: { form: FormRecord; userUid: string; workOrderId: string; disabled: boolean; readOnly: boolean; onSave: (id: string, revision: number, answers: Record<string, string | boolean>, complete: boolean) => Promise<FormRecord | null>; onReload: (formId: string) => Promise<FormRecord | null> }) {
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(form.answers || {});
  const business = useTradeBusiness();
  const scopeId = business?.ownerUid;
  const saved = useRef(form);
  const answerRef = useRef(answers);
  const [assistantUpdate, setAssistantUpdate] = useState("");
  const busyRef = useRef(disabled);
  useEffect(() => { busyRef.current = disabled; }, [disabled]);
  const reloadAnswers = useCallback(async () => {
    const before = answerRef.current;
    if (busyRef.current || !sameAnswers(before, saved.current.answers)) { setAssistantUpdate("Wattzun saved new answers. Your unsaved edits are kept. Load the saved answers when you are ready."); return; }
    try {
      const next = await onReload(form.id);
      if (!next) throw new Error("The saved form could not be found.");
      if (answerRef.current !== before || busyRef.current) { setAssistantUpdate("Wattzun saved new answers. Your unsaved edits are kept. Load the saved answers when you are ready."); return; }
      saved.current = next; answerRef.current = next.answers; setAnswers(next.answers); setAssistantUpdate("");
    } catch (error) { setAssistantUpdate(error instanceof Error ? error.message : "The saved answers could not be loaded."); }
  }, [onReload, form.id]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = event instanceof CustomEvent ? readWattzunFormSaved(event.detail) : null;
      if (detail?.portal === "trade" && detail.scopeId === scopeId && detail.formKind === "job_form" && detail.formId === form.id && detail.jobId === workOrderId) void reloadAnswers();
    };
    window.addEventListener(WATTZUN_FORM_SAVED_EVENT, refresh);
    return () => window.removeEventListener(WATTZUN_FORM_SAVED_EVENT, refresh);
  }, [scopeId, form.id, workOrderId, reloadAnswers]);
  async function saveAnswers(complete: boolean) {
    const current = answerRef.current;
    const next = await onSave(form.id, saved.current.revision, current, complete);
    if (!next) return false;
    saved.current = next;
    if (answerRef.current === current) { answerRef.current = next.answers; setAnswers(next.answers); }
    if (scopeId) dispatchWattzunFormNativeSaved({ portal: "trade", scopeId, formKind: "job_form", formId: next.id, oldFormId: form.id, jobId: workOrderId });
    setAssistantUpdate(""); return true;
  }
  async function loadAssistantAnswers() {
    if (busyRef.current) return;
    if (!sameAnswers(answerRef.current, saved.current.answers) && !window.confirm("Load the saved answers and replace your unsaved edits in this form?")) return;
    const before = answerRef.current;
    try { const next = await onReload(form.id); if (answerRef.current !== before || busyRef.current) { setAssistantUpdate("Your newer edits are kept. Load the saved answers when you are ready."); return; } if (next) { saved.current = next; answerRef.current = next.answers; setAnswers(next.answers); setAssistantUpdate(""); } }
    catch (error) { setAssistantUpdate(error instanceof Error ? error.message : "The saved answers could not be loaded."); }
  }
  const [open, setOpen] = useState(form.status !== "complete");
  const [pageIndex, setPageIndex] = useState(0);
  const pages = businessFormPages(visibleTradeFormFields(form.template, answers));
  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))];
  const timing = useFormTimeTracking({ formKind: "job_form", formId: form.id, workOrderId, pageKey: page?.key || "form", pageTitle: page?.title || form.templateName,
    enabled: open && !readOnly && form.status !== "complete", activateOnOpen: false });
  function change(key: string, value: string | boolean) { setAnswers(current => { const next = { ...current, [key]: value }; const visible = new Set(visibleTradeFormFields(form.template, next).map((field: Field) => field.key)); const cleaned = Object.fromEntries(Object.entries(next).filter(([key]) => visible.has(key))); answerRef.current = cleaned; return cleaned; }); }
  async function completeForm() { if (await saveAnswers(true)) timing.markCompleted(); }
  function submit(event: FormEvent<HTMLFormElement>, complete: boolean) { event.preventDefault(); if (!readOnly) void saveAnswers(complete); }
  return <details className={`crm-job-form status-${form.status}`} open={open} onToggle={event => setOpen(event.currentTarget.open)} {...timing.bind}>
    <summary><span><strong>{form.templateName}</strong><small>{form.jurisdiction} | Version {form.templateVersion}</small></span><b>{form.status === "complete" ? "Complete" : readOnly ? "View only" : form.ready ? "Ready to complete" : `${form.missing.length} required`}</b></summary>
    <div><p>{form.template.guidance}</p>{assistantUpdate && <p role="status">{assistantUpdate} <button type="button" disabled={disabled} onClick={() => { void loadAssistantAnswers(); }}>Load saved answers</button></p>}{pages.length > 1 && <nav aria-label="Form pages">{pages.map((item, index) => <button type="button" key={item.key} aria-current={page === item ? 'step' : undefined} onClick={() => setPageIndex(index)}>{index + 1}. {item.title}</button>)}</nav>}<h5>{page?.title}</h5><form onSubmit={(event) => submit(event, false)}>{(page?.fields || []).map((field) => <label className={field.type === "textarea" ? "wide" : ""} key={field.key}>{field.type === "checkbox" ? <><input type="checkbox" required={field.required} checked={answers[field.key] === true} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.checked)} /><span>{field.label}{field.required ? " *" : ""}</span></> : <><span>{field.label}{field.required ? " *" : ""}</span>{field.type === "textarea" ? <textarea rows={3} required={field.required} maxLength={field.maxLength || 1200} value={String(answers[field.key] || "")} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.value)} /> : field.type === "select" ? <select required={field.required} value={String(answers[field.key] || "")} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.value)}><option value="">Choose one</option>{(field.options || []).map((option) => <option key={option}>{option}</option>)}</select> : <input type={field.type === "date" ? "date" : "text"} required={field.required} maxLength={field.maxLength || 240} value={String(answers[field.key] || "")} disabled={disabled || form.status === "complete"} onChange={(event) => change(field.key, event.target.value)} />}</>}</label>)}
      {!readOnly && form.status !== "complete" && <div className="crm-job-form-actions"><WattzunFormAssistButton userUid={userUid} formKind="job_form" jobId={workOrderId} disabled={disabled} beforeOpen={async () => sameAnswers(answerRef.current, saved.current.answers) || await saveAnswers(false) ? form.id : null} /><button disabled={disabled} formNoValidate>Save draft</button><button className="complete" type="button" disabled={disabled} onClick={(event) => { const parent = event.currentTarget.closest("form"); if (parent?.reportValidity()) void completeForm(); }}>Check and complete</button></div>}
    </form>{open && <WorkTimeStatus />}</div>
  </details>;
}
