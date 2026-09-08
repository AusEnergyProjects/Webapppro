"use client";

import { useEffect, useState } from "react";
import type { ActivityAnswer, ActivityCondition, ActivityDeclaration, ActivityField, ActivityForm, ActivityRecord, ActivityPhase } from "@/lib/trade-activity-forms";
import styles from "./CreditexActivityWorkPackGovernance.module.css";

type Api = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type Option = { activityTemplateId: string; title: string; programCode: string; activityCode: string };

function formattedChoices(field: ActivityField) {
  return field.options.map((value) => field.optionLabels?.[value] ? `${value} | ${field.optionLabels[value]}` : value).join("\n");
}

function parsedChoices(value: string) {
  const entries = value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("|");
    return separator < 0 ? { value: line, label: "" } : {
      value: line.slice(0, separator).trim(),
      label: line.slice(separator + 1).trim(),
    };
  }).filter((entry) => entry.value);
  const options = [...new Set(entries.map((entry) => entry.value))];
  const optionLabels = Object.fromEntries(entries.filter((entry) => entry.label).map((entry) => [entry.value, entry.label]));
  return { options, ...(Object.keys(optionLabels).length ? { optionLabels } : { optionLabels: undefined }) };
}

type DirectCondition = { fieldKey: string; operator: "equals" | "notEquals"; value: ActivityAnswer };

function conditionFieldKeys(condition: ActivityCondition | undefined): string[] {
  if (!condition) return [];
  if (condition.fieldKey) return [condition.fieldKey];
  return [...(condition.all || []), ...(condition.any || [])].flatMap(conditionFieldKeys);
}

function directCondition(condition: ActivityCondition | undefined): DirectCondition | null {
  if (!condition?.fieldKey || Object.keys(condition).length !== 2) return null;
  if (Object.prototype.hasOwnProperty.call(condition, "equals") && condition.equals !== undefined) {
    return { fieldKey: condition.fieldKey, operator: "equals", value: condition.equals };
  }
  if (Object.prototype.hasOwnProperty.call(condition, "notEquals") && condition.notEquals !== undefined) {
    return { fieldKey: condition.fieldKey, operator: "notEquals", value: condition.notEquals };
  }
  return null;
}

function conditionValue(field: ActivityField): ActivityAnswer {
  if (field.type === "boolean") return true;
  if (field.type === "number") return 0;
  if (field.type === "select") return field.options[0] || "";
  return "";
}

function makeCondition(fieldKey: string, operator: DirectCondition["operator"], value: ActivityAnswer): ActivityCondition {
  return operator === "equals" ? { fieldKey, equals: value } : { fieldKey, notEquals: value };
}

function fieldDependsOn(form: ActivityForm, fieldKey: string, targetKey: string, seen = new Set<string>()): boolean {
  if (fieldKey === targetKey) return true;
  if (seen.has(fieldKey)) return false;
  seen.add(fieldKey);
  const field = form.fields.find((item) => item.key === fieldKey);
  return conditionFieldKeys(field?.condition).some((dependency) => fieldDependsOn(form, dependency, targetKey, new Set(seen)));
}

function conditionFields(form: ActivityForm, targetKey: string, targetPhase: ActivityPhase) {
  return form.fields.filter((candidate) => candidate.key !== targetKey
    && !["photo", "document"].includes(candidate.type)
    && (targetPhase === "after" || candidate.phase === "before")
    && !fieldDependsOn(form, candidate.key, targetKey));
}

function fieldIsReferenced(form: ActivityForm, fieldKey: string) {
  return form.fields.some((item) => item.key !== fieldKey && conditionFieldKeys(item.condition).includes(fieldKey))
    || form.fields.some((item) => item.evidenceFor?.includes(fieldKey))
    || form.declarations.some((item) => conditionFieldKeys(item.condition).includes(fieldKey)
      || [...item.text.matchAll(/\{\{([^{}]+)\}\}/g)].some((match) => `binding.${match[1]}` === fieldKey));
}

function fieldMoveDestination(fields: readonly ActivityField[], index: number, offset: -1 | 1) {
  const current = fields[index];
  if (!current) return -1;
  for (let candidate = index + offset; candidate >= 0 && candidate < fields.length; candidate += offset) {
    if (fields[candidate].phase === current.phase && fields[candidate].section === current.section) return candidate;
  }
  return -1;
}

function ConditionEditor({ form, targetKey, phase, condition, locked, label, onChange }: {
  form: ActivityForm;
  targetKey: string;
  phase: ActivityPhase;
  condition: ActivityCondition | undefined;
  locked: boolean;
  label: string;
  onChange: (condition: ActivityCondition | undefined) => void;
}) {
  if (locked) return condition ? <p role="note">Routing is governed for this default item: {JSON.stringify(condition)}</p> : null;
  const direct = directCondition(condition);
  const advanced = Boolean(condition && !direct);
  const candidates = conditionFields(form, targetKey, phase);
  const source = direct ? form.fields.find((item) => item.key === direct.fieldKey) : undefined;
  if (advanced) return <div>
    <p role="note">This item uses an advanced condition: {JSON.stringify(condition)}</p>
    <button type="button" onClick={() => onChange(undefined)}>Replace with always show</button>
  </div>;
  const mode = direct?.operator || "always";
  const chooseMode = (next: string) => {
    if (next === "always") { onChange(undefined); return; }
    const first = source || candidates[0];
    if (first) onChange(makeCondition(first.key, next === "notEquals" ? "notEquals" : "equals", conditionValue(first)));
  };
  const chooseSource = (fieldKey: string) => {
    const next = form.fields.find((item) => item.key === fieldKey);
    if (next && mode !== "always") onChange(makeCondition(next.key, mode, conditionValue(next)));
  };
  const chooseValue = (value: ActivityAnswer) => {
    if (source && direct) onChange(makeCondition(source.key, direct.operator, value));
  };
  return <div>
    <label>{label}<select value={mode} onChange={(event) => chooseMode(event.target.value)}>
      <option value="always">Always show</option>
      <option value="equals" disabled={!candidates.length}>Show when an answer equals</option>
      <option value="notEquals" disabled={!candidates.length}>Show when an answer does not equal</option>
    </select></label>
    {direct ? <div className="admin-form-grid">
      <label>Depends on<select value={direct.fieldKey} onChange={(event) => chooseSource(event.target.value)}>{candidates.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.section}: {candidate.label}</option>)}</select></label>
      {source?.type === "boolean" ? <label>Answer<select value={String(direct.value)} onChange={(event) => chooseValue(event.target.value === "true")}><option value="true">Yes</option><option value="false">No</option></select></label>
        : source?.type === "select" ? <label>Answer<select value={String(direct.value)} onChange={(event) => chooseValue(event.target.value)}>{source.options.map((option) => <option key={option} value={option}>{source.optionLabels?.[option] || option}</option>)}</select></label>
          : <label>Answer<input type={source?.type === "number" ? "number" : "text"} value={String(direct.value)} placeholder={source?.type === "date" ? "YYYY-MM-DD" : "Expected answer"} onChange={(event) => chooseValue(source?.type === "number" ? Number(event.target.value) : event.target.value)} /></label>}
    </div> : null}
  </div>;
}

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
  function moveField(offset: -1 | 1) {
    if (!form) return;
    const current = form.fields[question]; const destination = fieldMoveDestination(form.fields, question, offset);
    if (!current || destination < 0 || current.sourceRequirementId
      || current.presentation === "derived" || current.requiredValue !== undefined) return;
    const fields = [...form.fields]; fields.splice(question, 1); fields.splice(destination, 0, current);
    setForm({ ...form, fields }); setQuestion(destination); setDirty(true);
  }
  function deleteField() {
    if (!form) return;
    const current = form.fields[question];
    if (!current || form.fields.length <= 1 || current.sourceRequirementId || current.presentation === "derived"
      || current.presentation === "prefilled" || current.requiredValue !== undefined) return;
    if (fieldIsReferenced(form, current.key)) {
      setMessage("This question is used by routing, evidence or a declaration. Remove that reference before deleting it.");
      return;
    }
    if (!window.confirm(`Delete “${current.label}” from this master form?`)) return;
    const fields = form.fields.filter((_, index) => index !== question);
    setForm({ ...form, fields }); setQuestion(Math.min(question, fields.length - 1)); setDirty(true); setMessage("");
  }
  function updateDeclaration(index: number, patch: Partial<ActivityDeclaration>) {
    setForm((current) => current ? { ...current, declarations: current.declarations.map((item, declarationIndex) => declarationIndex === index ? { ...item, ...patch } : item) } : current);
    setDirty(true);
  }
  function moveDeclaration(index: number, offset: -1 | 1) {
    if (!form) return;
    const destination = index + offset;
    if (destination < 0 || destination >= form.declarations.length) return;
    const declarations = [...form.declarations]; const [current] = declarations.splice(index, 1); declarations.splice(destination, 0, current);
    setForm({ ...form, declarations }); setDirty(true);
  }
  function addDeclaration() {
    if (!form) return;
    const declaration: ActivityDeclaration = { key: `custom.${crypto.randomUUID()}`, title: "New Creditex declaration",
      text: "Enter the declaration wording.", role: "customer", phase: "after", required: false, sourceUrl: "", sourceTextSha256: "" };
    setForm({ ...form, declarations: [...form.declarations, declaration] }); setDirty(true);
  }
  function deleteDeclaration(index: number) {
    if (!form) return;
    const current = form.declarations[index];
    if (!current?.key.startsWith("custom.") || !window.confirm(`Delete “${current.title}” from this master form?`)) return;
    setForm({ ...form, declarations: form.declarations.filter((_, declarationIndex) => declarationIndex !== index) }); setDirty(true);
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
  const sourcePlacementControlled = Boolean(field?.sourceRequirementId);
  const profilePlacementControlled = field?.presentation === "derived" || field?.presentation === "prefilled";
  const fieldOrderControlled = sourcePlacementControlled || field?.presentation === "derived" || field?.requiredValue !== undefined;
  const fieldDeletionControlled = fieldOrderControlled || field?.presentation === "prefilled";
  const fieldConditionControlled = sourcePlacementControlled || field?.presentation === "derived" || field?.requiredValue !== undefined;
  const selectedFieldIsReferenced = Boolean(form && field && fieldIsReferenced(form, field.key));
  const earlierField = form ? fieldMoveDestination(form.fields, question, -1) : -1;
  const laterField = form ? fieldMoveDestination(form.fields, question, 1) : -1;
  return <section className={styles.builderSection}>
    <header><div><h4>Active trade activity forms</h4><p>{actorMode === "admin" ? "Admin portal: Operations Control Centre → 13 Field forms → Active trade activity forms." : "Creditex portal: Compliance → Activity forms → Active trade activity forms."} Trades complete these forms and send the signed field records to Creditex. Saving publishes the next master immediately. New records and unsigned drafts use it when opened; signed and submitted records stay locked to what was agreed.</p></div>
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
      {field.presentation === "derived" ? <p role="note"><strong>Filled automatically by TLink.</strong> The field app displays this as recorded job, customer, business, Team profile, document-delivery or signature data. The tradie is not asked to enter it.</p> : null}
      {field.presentation === "prefilled" ? <p role="note"><strong>Prefilled by TLink and editable in the field.</strong> The assigned worker or business profile supplies the starting value. The tradie can correct it when another licensed role holder performed that part of the work.</p> : null}
      {sourcePlacementControlled ? <p role="note"><strong>This evidence question is governed by its regulator requirement.</strong> Its wording, section, timing, evidence type, mandatory status and location rule stay linked to the requirement. Add an optional question if Creditex needs extra information.</p> : null}
      <div className="admin-form-grid"><label>Section<input disabled={sourcePlacementControlled} value={field.section} onChange={(event) => updateField({ section: event.target.value })} /></label>
        <label>Question<input disabled={sourcePlacementControlled} value={field.label} onChange={(event) => updateField({ label: event.target.value })} /></label>
        <label>Answer type<select disabled={profilePlacementControlled || sourcePlacementControlled || selectedFieldIsReferenced} value={field.type} onChange={(event) => { const type = event.target.value as ActivityField["type"];
          updateField({ type, options: type === "select" ? ["Yes", "No"] : [], optionLabels: undefined, requireLocation: type === "photo" ? field.requireLocation : undefined }); }}>{["text", "number", "date", "select", "boolean", "photo", "document"].map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>When<select disabled={profilePlacementControlled || sourcePlacementControlled || selectedFieldIsReferenced} value={field.phase} onChange={(event) => updateField({ phase: event.target.value === "before" ? "before" : "after" })}><option value="before">Before work</option><option value="after">After work</option></select></label>
      </div>
      <label>Instructions<textarea disabled={sourcePlacementControlled} value={field.help} onChange={(event) => updateField({ help: event.target.value })} /></label>
      {field.type === "select" ? <label>Stored code | label shown to the tradie, one per line<textarea disabled={profilePlacementControlled || selectedFieldIsReferenced} value={formattedChoices(field)} onChange={(event) => updateField(parsedChoices(event.target.value))} /></label> : null}
      <label><input type="checkbox" disabled={profilePlacementControlled || sourcePlacementControlled} checked={field.required} onChange={(event) => updateField({ required: event.target.checked })} />Required question</label>
      {field.type === "photo" ? <label><input type="checkbox" disabled={sourcePlacementControlled} checked={Boolean(field.requireLocation)} onChange={(event) => updateField({ requireLocation: event.target.checked })} />Require accurate GPS location with each captured photo</label> : null}
      <ConditionEditor form={form} targetKey={field.key} phase={field.phase} condition={field.condition} locked={fieldConditionControlled} label="When this question appears" onChange={(condition) => updateField({ condition })} />
      <div className="admin-choice-row"><button type="button" disabled={question === 0} onClick={() => setQuestion(question - 1)}>Previous question</button><button type="button" disabled={question >= form.fields.length - 1} onClick={() => setQuestion(question + 1)}>Next question</button>
        <button type="button" disabled={fieldOrderControlled || earlierField < 0} onClick={() => moveField(-1)}>Move earlier in section</button>
        <button type="button" disabled={fieldOrderControlled || laterField < 0} onClick={() => moveField(1)}>Move later in section</button>
        <button type="button" onClick={() => { setForm({ ...form, fields: [...form.fields, { key: `custom.${crypto.randomUUID()}`, label: "New question", section: field.section, type: "text", phase: field.phase, required: false, options: [], help: "" }] }); setQuestion(form.fields.length); setDirty(true); }}>Add question</button>
        <button type="button" disabled={fieldDeletionControlled || selectedFieldIsReferenced || form.fields.length <= 1} onClick={deleteField}>Delete question</button></div>
      {selectedFieldIsReferenced && !fieldDeletionControlled ? <p role="note">This question is used by routing, evidence or a declaration. Remove that reference before deleting it.</p> : null}
      <details><summary>Creditex declarations ({form.declarations.length})</summary>{form.declarations.map((declaration, index) => {
        const prescribed = Boolean(declaration.sourceUrl || declaration.sourceTextSha256);
        const custom = declaration.key.startsWith("custom.");
        return <article key={declaration.key}>
          <strong>{declaration.title}{prescribed ? " | Prescribed wording" : ""}</strong>
          <label>Declaration title<input disabled={prescribed} value={declaration.title} maxLength={300} onChange={(event) => updateDeclaration(index, { title: event.target.value })} /></label>
          <label>Wording<textarea disabled={prescribed} rows={8} value={declaration.text} onChange={(event) => updateDeclaration(index, { text: event.target.value })} /></label>
          <div className="admin-form-grid">
            <label>Signer<select disabled={!custom} value={declaration.role} onChange={(event) => updateDeclaration(index, { role: event.target.value as ActivityDeclaration["role"] })}><option value="customer">Customer</option><option value="technician">Technician</option><option value="other">Other verified signer</option></select></label>
            <label>When<select disabled={!custom} value={declaration.phase} onChange={(event) => updateDeclaration(index, { phase: event.target.value === "before" ? "before" : "after" })}><option value="before">Before work</option><option value="after">After work</option></select></label>
          </div>
          <label><input type="checkbox" disabled={!custom} checked={declaration.required} onChange={(event) => updateDeclaration(index, { required: event.target.checked })} />Required signature</label>
          <ConditionEditor form={form} targetKey={`@declaration:${declaration.key}`} phase={declaration.phase} condition={declaration.condition} locked={!custom} label="When this declaration appears" onChange={(condition) => updateDeclaration(index, { condition })} />
          <div className="admin-choice-row"><button type="button" disabled={index === 0} onClick={() => moveDeclaration(index, -1)}>Move declaration earlier</button>
            <button type="button" disabled={index >= form.declarations.length - 1} onClick={() => moveDeclaration(index, 1)}>Move declaration later</button>
            <button type="button" disabled={!custom} onClick={() => deleteDeclaration(index)}>Delete declaration</button></div>
          {prescribed ? <small>This wording is fixed by the recorded source. Creditex-authored declarations without a prescribed source can be edited here.</small>
            : !custom ? <small>This default Creditex declaration can be rewritten. Its signer role, timing and required status remain governed.</small> : null}
        </article>;
      })}<button type="button" onClick={addDeclaration}>Add declaration</button></details>
      <details><summary>Regulator sources and review notes</summary>{form.sources.map((source) => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}{form.reviewNotes.map((note, index) => <p key={index}>{note}</p>)}</details>
      <button type="button" disabled={!dirty} onClick={() => void save()}>{busy ? "Saving..." : "Save and publish master"}</button>
    </fieldset> : null}
    {records.length ? <table><thead><tr><th>Field record</th><th>Activity</th><th>Submitted</th><th>Job</th><th>Report</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.recordNumber}</td><td>{record.form.title}</td><td>{record.submittedAt}</td><td>{record.workOrderId}</td><td><button type="button" disabled={busy} onClick={() => void viewReport(record.id)}>View report</button></td></tr>)}</tbody></table> : null}
  </section>;
}
