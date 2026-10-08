"use client";

import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { ActivityAnswers, ActivityDeclaration, ActivityForm } from "@/lib/trade-activity-form-types";
import type { CreditexActivityWorkPackSignatureStroke } from "@/lib/creditex-activity-work-pack";
import type { PiesaPresentation } from "@/lib/veu-electrical-assessment";
import { expandedActivityFields, activityOptionLabel, activityRepeatCount, activityRepeatItemLabel, fieldConditionMet, boundActivityDeclaration, mergeActivityAnswers } from "@/lib/trade-activity-form-flow";
import { WATTZUN_FORM_SAVED_EVENT, WATTZUN_FORM_FOCUS_EVENT, WATTZUN_FORM_CAPTURE_PREPARE_EVENT, WATTZUN_FORM_CAPTURE_EVENT,
  readWattzunFormSaved, readWattzunFormCaptureTarget, readWattzunFormCaptureRequest, respondWattzunFormCapture,
  dispatchWattzunFormRefreshed, dispatchWattzunFormNativeSaved, dispatchWattzunFormCaptureSaved } from "@/lib/wattzun-form-client";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import { TradeWorkPackSignaturePad } from "./TradeWorkPackSignaturePad";
import { WattzunFormAssistButton } from "./WattzunFormAssistButton";
import styles from "./TradeVeuElectricalAssessmentPanel.module.css";

const endpoint = "/api/trade-veu-electrical-assessments";
type Source = { url: string; path: string; sha256: string; label: string };
type Result = { ok: boolean; error?: string; record?: PiesaPresentation; records?: PiesaPresentation[]; canManage?: boolean; form?: ActivityForm; source?: Source };
const equal = (left: ActivityAnswers, right: ActivityAnswers) => JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
const blank = (value: ActivityAnswers[string]) => value === undefined || typeof value === "string" && !value.trim();
function draftWithKnownDetails(record: PiesaPresentation, draft: ActivityAnswers, base?: ActivityAnswers) {
  if (record.status !== "draft" || record.signatures.length || record.initialAttestation) return draft;
  const next = { ...draft };
  for (const [key, value] of Object.entries(record.prefillAnswers || {})) {
    if (blank(next[key]) && (!base || Object.hasOwn(base, key) === Object.hasOwn(draft, key) && base[key] === draft[key])) next[key] = value;
  }
  return next;
}

export function TradeVeuElectricalAssessmentPanel({ user, workOrderId, readOnly = false, refreshKey = 0 }: { user: User; workOrderId: string; readOnly?: boolean; refreshKey?: number }) {
  const business = useTradeBusiness();
  return <AssessmentPanel key={`${user.uid}:${business?.ownerUid || user.uid}:${business?.memberId || ""}:${workOrderId}`} user={user} workOrderId={workOrderId} readOnly={readOnly} refreshKey={refreshKey} />;
}

function AssessmentPanel({ user, workOrderId, readOnly, refreshKey }: { user: User; workOrderId: string; readOnly: boolean; refreshKey: number }) {
  const fetch = useTradeBusinessFetch(), business = useTradeBusiness(), scopeId = business?.ownerUid || user.uid;
  const [records, setRecords] = useState<PiesaPresentation[]>([]), [record, setRecord] = useState<PiesaPresentation | null>(null);
  const [draft, setDraft] = useState<ActivityAnswers>({}), [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState("load"), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const [ink, setInk] = useState<Record<string, readonly CreditexActivityWorkPackSignatureStroke[]>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const current = useRef({ record, draft, busy, ink });
  useLayoutEffect(() => { current.current = { record, draft, busy, ink }; }, [record, draft, busy, ink]);
  const mounted = useRef(true), sequence = useRef(0), container = useRef<HTMLDivElement>(null);
  const fileInputs = useRef(new Map<string, HTMLInputElement>());
  const lastMutation = useRef({ identity: "", requestId: "" });
  function mutationId(identity: string) {
    if (lastMutation.current.identity !== identity) lastMutation.current = { identity, requestId: crypto.randomUUID() };
    return lastMutation.current.requestId;
  }
  const request = useCallback(async (suffix: string, init?: RequestInit): Promise<Result> => {
    const headers = new Headers(init?.headers); headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
    const response = await fetch(`${endpoint}${suffix}`, { ...init, headers, cache: "no-store" });
    const result = await response.json() as Result;
    if (!response.ok || result.ok !== true) throw new Error(result.error || "The electrical assessment could not be loaded or saved.");
    return result;
  }, [fetch, user]);
  const adopt = useCallback((next: PiesaPresentation, native = false) => {
    const previous = current.current.record;
    if (next.workOrderId !== workOrderId) throw new Error("This assessment does not belong to the selected job.");
    const merged = previous?.id === next.id ? mergeActivityAnswers(previous.answers, current.current.draft, next.answers) : { merged: next.answers, conflicts: [] };
    const withDetails = !native && !readOnly && canManage
      ? draftWithKnownDetails(next, merged.merged, previous?.id === next.id ? previous.answers : undefined) : merged.merged;
    setRecord(next); setDraft(withDetails); setRecords(items => [next, ...items.filter(item => item.id !== next.id)]);
    setInk({}); setAccepted({});
    if (merged.conflicts.length) setError("Some answers changed elsewhere. Your unsaved answers are still here; review them before saving.");
    if (previous) {
      const detail = { portal: "trade" as const, scopeId, formKind: "veu_electrical" as const, jobId: workOrderId, formId: next.id, oldFormId: previous.id };
      dispatchWattzunFormRefreshed(detail);
      if (native) dispatchWattzunFormNativeSaved(detail);
    }
  }, [scopeId, workOrderId, readOnly, canManage]);
  useEffect(() => {
    mounted.current = true; const id = ++sequence.current;
    void request(`?workOrderId=${encodeURIComponent(workOrderId)}`).then(result => {
      if (!mounted.current || id !== sequence.current) return;
      if (!Array.isArray(result.records)) throw new Error("The assessment list could not be read.");
      setRecords(result.records); setCanManage(result.canManage === true);
      if (result.records[0]) {
        const next = result.records[0];
        setRecord(next); setDraft(!readOnly && result.canManage === true ? draftWithKnownDetails(next, next.answers) : next.answers);
      }
    }).catch(failure => { if (mounted.current && id === sequence.current) setError(failure instanceof Error ? failure.message : "The assessments could not be loaded."); })
      .finally(() => { if (mounted.current && id === sequence.current) setBusy(""); });
    return () => { mounted.current = false; sequence.current = id + 1; };
  }, [request, workOrderId, readOnly]);
  useEffect(() => {
    if (!refreshKey || current.current.record || current.current.busy) return;
    let active = true;
    void request(`?workOrderId=${encodeURIComponent(workOrderId)}`).then(result => {
      if (!active || current.current.record || current.current.busy) return;
      setRecords(result.records || []); setCanManage(result.canManage === true);
      const next = result.records?.[0];
      if (next) { setRecord(next); setDraft(!readOnly && result.canManage === true ? draftWithKnownDetails(next, next.answers) : next.answers); }
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "The added assessment could not be loaded."); });
    return () => { active = false; };
  }, [request, workOrderId, readOnly, refreshKey, busy]);
  const writable = !readOnly && canManage && record?.status === "draft";
  const fields = useMemo(() => record ? expandedActivityFields(record.form, draft) : [], [record, draft]);
  const sections = [...new Set(fields.map(field => field.section))];
  const declarations = record?.form.declarations.filter(item => fieldConditionMet(item.condition, draft, record.form)) || [];
  const dirty = record ? !equal(draft, record.answers) : false;
  const edit = (key: string, value: string | number | boolean) => { setDraft(previous => ({ ...previous, [key]: value })); setNotice(""); };
  async function mutate(action: string, body: object, method = "POST"): Promise<PiesaPresentation> {
    if (readOnly || !canManage || current.current.busy) throw new Error("Wait for the current assessment action to finish.");
    const id = sequence.current; current.current.busy = action; setBusy(action); setError(""); setNotice("");
    const payload = body;
    const actual = ["start", "retry_delivery"].includes(action) ? payload : { ...payload, requestId: mutationId(JSON.stringify({ method, payload })) };
    try {
      const result = await request("", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(actual) });
      if (!result.record || result.record.workOrderId !== workOrderId) throw new Error("The assessment's saved result could not be verified.");
      if (!mounted.current || id !== sequence.current) throw new Error("The selected job changed while saving.");
      // A successful explicit native save supersedes this device's sent answers.
      current.current.draft = result.record.answers; adopt(result.record, true); setNotice(action === "complete" ? "Assessment completed. Its final PDF is ready." : "Saved.");
      return result.record;
    } finally { if (mounted.current && id === sequence.current) { current.current.busy = ""; setBusy(""); } }
  }
  const run = (task: () => Promise<unknown>) => { void task().catch(failure => { if (mounted.current) setError(failure instanceof Error ? failure.message : "This assessment action failed. Check its current saved state before retrying."); }); };
  async function download(path: string, name: string) {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store" });
    if (!response.ok) { const result = await response.json() as Result; throw new Error(result.error || "This assessment file could not be opened."); }
    if (!mounted.current) return;
    const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  async function save(): Promise<string> {
    const selected = current.current.record;
    if (!selected) throw new Error("Start an assessment on this job first.");
    if (!equal(current.current.draft, selected.answers)) {
      await mutate("save", { recordId: selected.id, baseRevision: selected.revision, answers: current.current.draft }, "PATCH");
    }
    return selected.id;
  }
  async function reload() {
    const selected = current.current.record; if (!selected || current.current.busy) return;
    const id = sequence.current; setBusy("refresh");
    try { const result = await request(`?recordId=${encodeURIComponent(selected.id)}`); if (mounted.current && id === sequence.current && result.record) adopt(result.record); }
    catch (failure) { if (mounted.current && id === sequence.current) setError(failure instanceof Error ? failure.message : "Refresh failed."); }
    finally { if (mounted.current && id === sequence.current) setBusy(""); }
  }
  function focus(key: string) {
    const index = sections.findIndex(section => fields.some(field => field.section === section && field.key === key));
    if (index < 0 && !declarations.some(item => item.key === key)) return false;
    setOpen(true); setPage(index < 0 ? sections.length : index);
    requestAnimationFrame(() => container.current?.querySelector<HTMLElement>(`[data-assessment-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "center" }));
    return true;
  }
  useEffect(() => {
    const saved = (event: Event) => { const detail = event instanceof CustomEvent ? readWattzunFormSaved(event.detail) : null;
      if (detail?.formKind === "veu_electrical" && detail.scopeId === scopeId && detail.jobId === workOrderId && detail.formId === current.current.record?.id) void reload(); };
    const focusQuestion = (event: Event) => { const target = event instanceof CustomEvent ? readWattzunFormCaptureTarget(event.detail) : null;
      if (target?.formKind === "veu_electrical" && target.scopeId === scopeId && target.jobId === workOrderId && target.formId === record?.id && writable && !busy && !dirty && focus(target.fieldKey)) event.preventDefault(); };
    const prepare = (event: Event) => { const value = event instanceof CustomEvent ? readWattzunFormCaptureRequest(event.detail) : null;
      if (!value || value.target.formKind !== "veu_electrical" || value.target.scopeId !== scopeId || value.target.jobId !== workOrderId || value.target.formId !== record?.id) return;
      const field = fields.find(item => item.key === value.target.fieldKey);
      if (!writable || busy || dirty || Object.values(ink).some(strokes => strokes.length) || field?.type !== "photo") { respondWattzunFormCapture(value, { status: "unavailable", message: "Save your current changes and open this assessment's photo question first." }); return; }
      focus(field.key); requestAnimationFrame(() => respondWattzunFormCapture(value, { status: "ready", target: value.target })); };
    const capture = (event: Event) => { const target = event instanceof CustomEvent ? readWattzunFormCaptureTarget(event.detail) : null;
      if (target?.formKind === "veu_electrical" && target.scopeId === scopeId && target.jobId === workOrderId && target.formId === record?.id && writable && !busy && !dirty) fileInputs.current.get(target.fieldKey)?.click(); };
    window.addEventListener(WATTZUN_FORM_SAVED_EVENT, saved); window.addEventListener(WATTZUN_FORM_FOCUS_EVENT, focusQuestion);
    window.addEventListener(WATTZUN_FORM_CAPTURE_PREPARE_EVENT, prepare); window.addEventListener(WATTZUN_FORM_CAPTURE_EVENT, capture);
    return () => { window.removeEventListener(WATTZUN_FORM_SAVED_EVENT, saved); window.removeEventListener(WATTZUN_FORM_FOCUS_EVENT, focusQuestion); window.removeEventListener(WATTZUN_FORM_CAPTURE_PREPARE_EVENT, prepare); window.removeEventListener(WATTZUN_FORM_CAPTURE_EVENT, capture); };
  });
  async function upload(key: string, file: File) {
    const selected = current.current.record; if (!selected || !writable || current.current.busy) return;
    if (!equal(current.current.draft, selected.answers)) throw new Error("Save your answers before attaching evidence.");
    const id = sequence.current; current.current.busy = "upload"; setBusy("upload"); setError("");
    try { const data = new FormData(); data.set("action", "upload"); data.set("recordId", selected.id); data.set("baseRevision", String(selected.revision)); data.set("fieldKey", key); data.set("file", file);
      data.set("requestId", mutationId(JSON.stringify({ id: selected.id, revision: selected.revision, key, fileName: file.name, type: file.type, size: file.size, modified: file.lastModified })));
      const result = await request("", { method: "POST", body: data }); if (!result.record) throw new Error("The saved evidence could not be verified.");
      if (mounted.current && id === sequence.current) { adopt(result.record, true); setNotice("Evidence saved."); if (fields.find(field => field.key === key)?.type === "photo") dispatchWattzunFormCaptureSaved({ portal: "trade", scopeId, formKind: "veu_electrical", formId: result.record.id, oldFormId: selected.id, jobId: workOrderId, fieldKey: key }); }
    } finally { if (mounted.current && id === sequence.current) { current.current.busy = ""; setBusy(""); } }
  }
  async function sign(declaration: ActivityDeclaration) {
    if (!record || dirty || !accepted[declaration.key]) throw new Error("Save your answers, read the declaration and confirm it before signing.");
    const signerField = declaration.key === "property_owner" ? "owner_name" : "rectification_electrician_name";
    const strokes = (ink[declaration.key] || []).map(stroke => ({ points: stroke.points.map(point => ({ x: point.x, y: point.y, ...(point.pressure === null ? {} : { pressure: point.pressure }), capturedAtMs: point.capturedAtOffsetMs })) }));
    if (!strokes.length) throw new Error("The named signer must draw their signature in the box.");
    await mutate("sign", { action: "sign", recordId: record.id, baseRevision: record.revision, declarationKey: declaration.key, signerName: String(draft[signerField] || ""), strokes, scopeSha256: record.signingScopes[declaration.phase], accepted: true });
  }
  return <section className={styles.panel} aria-label="VEU electrical safety assessment" ref={container}>
    <header><div><span>JOB SAFETY · PIESA</span><h3>Pre-installation electrical safety assessment (Insulation)</h3><p>Official Victorian form for ceiling insulation work. Keep the assessment, attachments and signed PDF with this job.</p></div><a href="/forms/veu-pre-installation-electrical-safety-assessment-march-2026.pdf" target="_blank" rel="noreferrer">Official source form</a></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status">{notice}</p>}
    {busy === "load" ? <p role="status">Loading assessments...</p> : <>
      <div className={styles.toolbar}>{records.length > 1 && <label>Assessment<select disabled={Boolean(busy)} value={record?.id || ""} onChange={event => { if (dirty && !window.confirm("Discard these unsaved answers and open the selected assessment?")) return; const next = records.find(item => item.id === event.target.value); if (next) { current.current.draft = next.answers; adopt(next); setPage(0); } }}>{records.map(item => <option key={item.id} value={item.id}>{item.recordNumber} · {item.status === "complete" ? "Complete" : "Draft"}</option>)}</select></label>}
        {!record && !readOnly && canManage && <button type="button" disabled={Boolean(busy)} onClick={() => run(async () => { const next = await mutate("start", { action: "start", workOrderId }); setRecord(next); setOpen(true); setPage(0); })}>Start assessment</button>}
        {record && <><strong>{record.recordNumber} · {record.status === "complete" ? "Complete" : "Draft"}</strong><button type="button" disabled={Boolean(busy)} onClick={() => setOpen(value => !value)}>{open ? "Close assessment" : "Open assessment"}</button><button type="button" disabled={Boolean(busy)} onClick={() => void reload()}>Refresh</button></>}
      </div>{!record && <p>No electrical safety assessment has been started on this job.</p>}
      {record && open && <><div className={styles.toolbar}><label>Section<select aria-label="Assessment section" value={Math.min(page, sections.length)} onChange={event => setPage(Number(event.target.value))}>{sections.map((section, index) => <option key={section} value={index}>{section}</option>)}<option value={sections.length}>Signatures and completion</option></select></label>{writable && <><button type="button" disabled={Boolean(busy) || !dirty} onClick={() => run(save)}>{busy === "save" ? "Saving..." : "Save answers"}</button><WattzunFormAssistButton userUid={user.uid} formKind="veu_electrical" jobId={workOrderId} disabled={Boolean(busy)} beforeOpen={save} /></>}</div>
        {page < sections.length ? <fieldset className={styles.questions} disabled={Boolean(busy) || !writable}><legend>{sections[page]}</legend>
          {sections[page] === record.form.fields.find(field => field.key === "initial_rec_name")?.section && record.businessContactSuggestion
            && (record.businessContactSuggestion.name || record.businessContactSuggestion.phone) && <div className={styles.question}>
              <p>Your business contact: {record.businessContactSuggestion.name}{record.businessContactSuggestion.phone ? ` · ${record.businessContactSuggestion.phone}` : ""}. Use these editable details only if this business is the Registered Electrical Contractor for this assessment. Enter its actual REC registration number.</p>
              <button type="button" disabled={!writable || Boolean(busy) || !blank(draft.initial_rec_name) && !blank(draft.initial_rec_phone)} onClick={() => setDraft(previous => ({ ...previous,
                ...(blank(previous.initial_rec_name) && record.businessContactSuggestion?.name ? { initial_rec_name: record.businessContactSuggestion.name } : {}),
                ...(blank(previous.initial_rec_phone) && record.businessContactSuggestion?.phone ? { initial_rec_phone: record.businessContactSuggestion.phone } : {}),
              }))}>Use business contact details</button>
            </div>}
          {fields.filter(field => field.section === sections[page]).map(field => <div key={field.key} className={styles.question} data-assessment-key={field.key}>
          <label htmlFor={`piesa-${record.id}-${field.key}`}>{field.label}{field.required && <span> *</span>}{field.repeatGroup && <small> {activityRepeatItemLabel(field.repeatGroup)} {field.repeatIndex + 1}</small>}</label>
          {field.help && <p>{field.help}</p>}
          {field.key === "initial_correct" ? <><p>{draft.initial_correct === true ? "Initial assessment attestation saved." : "Review the initial assessment and confirm this declaration on screen."}</p><button type="button" disabled={dirty || draft.initial_correct === true} onClick={() => run(() => mutate("attest_initial", { action: "attest_initial", recordId: record.id, baseRevision: record.revision, scopeSha256: record.signingScopes.before, accepted: true }))}>Confirm initial assessment declaration</button></>
            : field.type === "boolean" ? <select id={`piesa-${record.id}-${field.key}`} value={draft[field.key] === true ? "yes" : draft[field.key] === false ? "no" : ""} onChange={event => { if (event.target.value) edit(field.key, event.target.value === "yes"); }}><option value="">Choose an answer</option><option value="yes">Yes</option><option value="no">No</option></select>
              : field.type === "select" ? <select id={`piesa-${record.id}-${field.key}`} value={String(draft[field.key] ?? "")} onChange={event => edit(field.key, event.target.value)}><option value="">Choose an answer</option>{field.options.map(option => <option key={option} value={option}>{activityOptionLabel(option, field.optionLabels?.[option])}</option>)}</select>
                : field.type === "photo" || field.type === "document" ? <><input id={`piesa-${record.id}-${field.key}`} ref={node => { if (node) fileInputs.current.set(field.key, node); else fileInputs.current.delete(field.key); }} type="file" accept={field.type === "photo" ? "image/jpeg,image/png,image/webp" : "application/pdf,image/jpeg,image/png,image/webp"} capture={field.type === "photo" ? "environment" : undefined} disabled={dirty || !writable || Boolean(busy)} onChange={event => { const file = event.target.files?.[0]; if (file) run(() => upload(field.key, file)); event.target.value = ""; }} />{record.evidence.filter(item => item.fieldKey === field.key).map(item => <p key={item.id}><button type="button" onClick={() => run(() => download(`${endpoint}?recordId=${encodeURIComponent(record.id)}&view=evidence&evidenceId=${encodeURIComponent(item.id)}`, item.fileName))}>{item.fileName}</button> · Saved</p>)}</>
                  : <input id={`piesa-${record.id}-${field.key}`} type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} value={String(draft[field.key] ?? "")} onChange={event => edit(field.key, field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} />}
          {field.repeatGroup && field.repeatIndex === activityRepeatCount(record.form, draft, field.repeatGroup) - 1 && fields.filter(item => item.repeatGroup === field.repeatGroup && item.repeatIndex === field.repeatIndex).at(-1)?.key === field.key && <button type="button" disabled={activityRepeatCount(record.form, draft, field.repeatGroup) >= 20} onClick={() => edit(`$repeat.${field.repeatGroup}`, activityRepeatCount(record.form, draft, field.repeatGroup!) + 1)}>Add another {activityRepeatItemLabel(field.repeatGroup)}</button>}
        </div>)}</fieldset> : <div className={styles.questions}>
          {declarations.map(declaration => { const signature = record.signatures.find(item => item.declarationKey === declaration.key); const signerName = String(draft[declaration.key === "property_owner" ? "owner_name" : "rectification_electrician_name"] || ""); return <section className={styles.declaration} key={declaration.key} data-assessment-key={declaration.key}><h4>{declaration.title}</h4><p>{boundActivityDeclaration(declaration, draft)}</p>{signature ? <p>Signed by {signature.signerName} · {new Date(signature.signedAt).toLocaleString("en-AU")}</p> : <><label><input type="checkbox" checked={accepted[declaration.key] || false} disabled={!writable || Boolean(busy) || dirty} onChange={event => setAccepted(value => ({ ...value, [declaration.key]: event.target.checked }))} /> I am the named signer and have read and agree to this declaration.</label><TradeWorkPackSignaturePad label={declaration.title} signerName={signerName} signerCapacity={declaration.role === "customer" ? "Property owner or representative" : "Licensed electrician"} value={ink[declaration.key] || []} disabled={!writable || Boolean(busy) || dirty || !accepted[declaration.key]} onChange={strokes => setInk(value => ({ ...value, [declaration.key]: strokes }))} /><button type="button" disabled={!writable || Boolean(busy) || dirty || !accepted[declaration.key] || !ink[declaration.key]?.length || !signerName} onClick={() => run(() => sign(declaration))}>Save {declaration.role === "customer" ? "owner" : "electrician"} signature</button></>}</section>; })}
          {dirty && <p>Save your answers before signing or completing the assessment.</p>}
          {record.status === "draft" && <><h4>{record.ready ? "Ready to complete" : "Still required"}</h4>{record.missing.length > 0 && <ul>{record.missing.map(item => <li key={`${item.kind}:${item.key}`}><button type="button" onClick={() => focus(item.key)}>{item.label}</button></li>)}</ul>}<button type="button" disabled={!writable || Boolean(busy) || dirty || !record.ready} onClick={() => run(() => mutate("complete", { action: "complete", recordId: record.id, baseRevision: record.revision }))}>Complete assessment and prepare PDF</button></>}
          {record.status === "complete" && <><button type="button" onClick={() => run(() => download(record.reportUrl, `${record.recordNumber}.pdf`))}>Download completed assessment PDF</button><p>Completed {new Date(record.completedAt).toLocaleString("en-AU")}</p>{record.delivery.map(item => <p key={item.role}>{item.role === "customer" ? "Customer copy" : "Business copy"}: {item.status.replaceAll("_", " ")} {item.message}</p>)}{!readOnly && canManage && record.delivery.some(item => ["failed", "blocked"].includes(item.status)) && <button type="button" disabled={Boolean(busy)} onClick={() => run(() => mutate("retry_delivery", { action: "retry_delivery", recordId: record.id }))}>Retry report delivery</button>}</>}
        </div>}
        {readOnly && record.evidence.length > 0 && <section aria-label="Saved assessment attachments"><h4>Saved attachments</h4>{record.evidence.map(item => <p key={item.id}><button type="button" onClick={() => run(() => download(`${endpoint}?recordId=${encodeURIComponent(record.id)}&view=evidence&evidenceId=${encodeURIComponent(item.id)}`, item.fileName))}>{item.fileName}</button></p>)}</section>}
        <nav className={styles.toolbar} aria-label="Assessment sections"><button type="button" disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>Previous section</button><span>Section {Math.min(page, sections.length) + 1} of {sections.length + 1}</span><button type="button" disabled={page >= sections.length} onClick={() => setPage(value => Math.min(sections.length, value + 1))}>Next section</button></nav>
      </>}
    </>}
  </section>;
}

export function VeuElectricalFormLibrary({ user }: { user: User }) {
  const fetch = useTradeBusinessFetch(); const [form, setForm] = useState<ActivityForm | null>(null), [source, setSource] = useState<Source | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; void (async () => { const response = await fetch(`${endpoint}?catalogue=1`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store" }); const result = await response.json() as Result; if (!response.ok || !result.ok || !result.form || !result.source) throw new Error(result.error || "The official assessment could not be loaded."); if (active) { setForm(result.form); setSource(result.source); } })().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "The form could not be loaded."); }); return () => { active = false; }; }, [fetch, user]);
  return <section className={styles.panel} aria-label="Electrical safety form library"><h2>Job safety forms</h2><p>Find the insulation electrical safety assessment (PIESA) here. Add and complete it from the job&apos;s Files tab.</p>{error && <p role="alert">{error}</p>}{!form && !error && <p role="status">Loading safety forms...</p>}{form && source && <article><span>VICTORIA · OFFICIAL FORM</span><h3>Pre-installation electrical safety assessment (Insulation)</h3><p>PIESA: record the property assessment, hazards, required rectification and actual signatures. Completed assessments generate a final PDF for the customer and your business.</p><p>Source: {source.label} · Form version {form.version}</p><a href={source.path} target="_blank" rel="noreferrer">View official source PDF</a><details><summary>View assessment questions</summary>{[...new Set(form.fields.map(field => field.section))].map(section => <section key={section}><h4>{section}</h4><ul>{form.fields.filter(field => field.section === section).map(field => <li key={field.key}>{field.label}{field.condition ? " (when applicable)" : ""}</li>)}</ul></section>)}{form.declarations.map(item => <section key={item.key}><h4>{item.title}</h4><p>{item.text}</p></section>)}</details><p>Open the job, choose Files, then find Pre-installation electrical safety assessment (Insulation) and choose Start assessment.</p></article>}</section>;
}
