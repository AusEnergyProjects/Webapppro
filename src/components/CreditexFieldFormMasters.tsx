"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityAnswer, ActivityCondition, ActivityDeclaration, ActivityField, ActivityForm, ActivityRecord, ActivityPhase } from "@/lib/trade-activity-forms";
import type { ActivityMasterDraft, ActivityMasterDraftSummary } from "@/lib/trade-activity-master-drafts";
import { addEditorPage, addEditorPageQuestion, deleteEditorPage, editorFormPages, editorPageDeleteReason, editorPageRenameReason, editorQuestionDeleteReason, editorQuestionMoveReason, moveEditorQuestion, renameEditorPage, type EditorFormChange } from "@/lib/creditex-form-pages";
import { ACTIVITY_WIZARD_PAGE_FIELD_LIMIT } from "@/lib/trade-activity-form-flow";
import { CreditexFormPhonePreview } from "./CreditexFormPhonePreview";
import styles from "./CreditexActivityWorkPackGovernance.module.css";

type Api = (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type Option = { activityTemplateId: string; title: string; programCode: string; activityCode: string };

function isDraftSummary(value: unknown): value is ActivityMasterDraftSummary {
  return Boolean(value && typeof value === "object" && "id" in value && typeof value.id === "string"
    && "activityTemplateId" in value && typeof value.activityTemplateId === "string"
    && "variantId" in value && typeof value.variantId === "string" && "title" in value && typeof value.title === "string"
    && "revision" in value && typeof value.revision === "number" && "baseMasterVersion" in value && typeof value.baseMasterVersion === "number"
    && "status" in value && ["draft", "published", "discarded"].includes(String(value.status))
    && "createdAt" in value && typeof value.createdAt === "string" && "updatedAt" in value && typeof value.updatedAt === "string");
}

function isDraft(value: unknown): value is ActivityMasterDraft {
  return isDraftSummary(value) && "form" in value && Boolean(value.form && typeof value.form === "object" && "fields" in value.form && Array.isArray(value.form.fields))
    && "currentMasterVersion" in value && typeof value.currentMasterVersion === "number" && "baseIsCurrent" in value && typeof value.baseIsCurrent === "boolean";
}

const answerTypes: readonly { value: ActivityField["type"]; label: string }[] = [
  { value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "date", label: "Date" },
  { value: "select", label: "Choose from a list" }, { value: "boolean", label: "Yes / No" },
  { value: "photo", label: "Photo" }, { value: "document", label: "Upload document" },
];

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

export function CreditexFieldFormMasters({ api, actorMode, canAuthor = true, onManageAccess, onDirtyChange }: { api: Api; actorMode: "admin" | "creditex"; canAuthor?: boolean; onManageAccess?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [catalogue, setCatalogue] = useState<Option[]>([]);
  const [drafts, setDrafts] = useState<ActivityMasterDraftSummary[]>([]);
  const [draftCopy, setDraftCopy] = useState<ActivityMasterDraft | null>(null);
  const [draftConfirmation, setDraftConfirmation] = useState<"publish" | "discard" | null>(null);
  const [signingItem, setSigningItem] = useState("");
  const [removal, setRemoval] = useState<{ kind: "question" | "signature" | "page"; key: string } | null>(null);
  const [renamingPage, setRenamingPage] = useState("");
  const [pageName, setPageName] = useState("");
  const [search, setSearch] = useState("");
  const [program, setProgram] = useState("");
  const [selected, setSelected] = useState(""); const [form, setForm] = useState<ActivityForm | null>(null);
  const [expectedVersion, setExpectedVersion] = useState(0); const [question, setQuestion] = useState(0);
  const [busy, setBusy] = useState(true); const [dirty, setDirty] = useState(false); const [message, setMessage] = useState("");
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [reviewLink, setReviewLink] = useState("");
  const endpoint = "/api/trade-activity-forms";
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const requestCatalogue = useCallback(async (signal?: AbortSignal) => {
    const result = await api(`${endpoint}?view=masters&actorMode=${actorMode}`, { signal });
    if (!Array.isArray(result.catalogue)) throw new Error("Activity forms could not be read.");
    return { catalogue: result.catalogue, drafts: Array.isArray(result.drafts) ? result.drafts.filter(isDraftSummary) : [] };
  }, [api, actorMode]);
  async function loadCatalogue() {
    setBusy(true); setMessage("");
    try { const result = await requestCatalogue(); setCatalogue(result.catalogue); setDrafts(result.drafts); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Forms could not be loaded."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void requestCatalogue(controller.signal).then((items) => {
      if (!controller.signal.aborted) { setCatalogue(items.catalogue); setDrafts(items.drafts); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Forms could not be loaded.");
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [requestCatalogue]);
  async function load(templateId: string, variantId = "") {
    if (busy) return;
    if (dirty && !window.confirm("Discard unsaved master-form changes?")) return;
    setBusy(true); setMessage("");
    try { const result = await api(`${endpoint}?view=masters&actorMode=${actorMode}&activityTemplateId=${encodeURIComponent(templateId)}&variantId=${encodeURIComponent(variantId)}`);
      if (!result.form || typeof result.form !== "object" || !("fields" in result.form) || !Array.isArray(result.form.fields)) throw new Error("The activity form could not be read.");
      setForm(result.form as ActivityForm); setExpectedVersion(Number(result.expectedVersion)); setSelected(templateId); setQuestion(0); setSigningItem(""); setRemoval(null); setRenamingPage(""); setDirty(false); setDraftCopy(null); setDraftConfirmation(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The form could not be loaded."); }
    finally { setBusy(false); }
  }
  function backToCatalogue() {
    if (busy || (dirty && !window.confirm("Discard unsaved master-form changes?"))) return;
    setForm(null); setSelected(""); setQuestion(0); setSigningItem(""); setRemoval(null); setRenamingPage(""); setDirty(false); setMessage(""); setDraftCopy(null); setDraftConfirmation(null);
    setSearch(""); setProgram("");
  }
  async function save() {
    if (!form || !canAuthor || busy) return; setBusy(true); setMessage("");
    try { const result = await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_master", actorMode,
      activityTemplateId: form.activityTemplateId, variantId: form.variantId, expectedVersion, form }) });
      if (!result.form || typeof result.form !== "object") throw new Error("The master form was not saved.");
      const savedForm = result.form as ActivityForm;
      setQuestion(Math.max(0, savedForm.fields.findIndex((item) => item.key === form.fields[question]?.key)));
      setForm(savedForm); setExpectedVersion(Number(result.expectedVersion)); setDirty(false); setMessage("Saved. The new version is available immediately for new activity records.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The master form was not saved."); }
    finally { setBusy(false); }
  }
  function acceptDraft(value: unknown) {
    if (!isDraft(value)) throw new Error("The draft copy could not be read.");
    if (value.status !== "draft") throw new Error("This copy has already been published or discarded. Refresh forms to see the current drafts.");
    setQuestion(Math.max(0, value.form.fields.findIndex((item) => item.key === form?.fields[question]?.key)));
    setDraftCopy(value); setForm(value.form); setSelected(value.activityTemplateId); setExpectedVersion(value.baseMasterVersion);
    setDirty(false); setDraftConfirmation(null);
    setDrafts((current) => [...current.filter((item) => item.id !== value.id), value]);
  }
  async function openDraft(draftId: string) {
    if (busy || (dirty && !window.confirm("Discard unsaved changes before opening this saved draft?"))) return;
    setBusy(true); setMessage("");
    try { const result = await api(`${endpoint}?view=master_drafts&actorMode=${actorMode}&draftId=${encodeURIComponent(draftId)}`); acceptDraft(result.draft); setQuestion(0); setSigningItem(""); setRemoval(null); setRenamingPage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The draft could not be opened."); }
    finally { setBusy(false); }
  }
  async function duplicate(templateId: string) {
    if (busy || !canAuthor) return;
    if (dirty) { setMessage("Save your changes before creating a draft copy of the published form."); return; }
    setBusy(true); setMessage("");
    try {
      const source = form?.activityTemplateId === templateId && !draftCopy ? { form, expectedVersion }
        : await api(`${endpoint}?view=masters&actorMode=${actorMode}&activityTemplateId=${encodeURIComponent(templateId)}`);
      if (!source.form || typeof source.form !== "object" || !("variantId" in source.form)) throw new Error("The published form could not be read.");
      const result = await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_master_draft", actorMode, activityTemplateId: templateId, variantId: source.form.variantId, expectedVersion: source.expectedVersion }) });
      acceptDraft(result.draft); setQuestion(0); setSigningItem(""); setRemoval(null); setRenamingPage(""); setMessage("Draft copy saved. Edit and test it here; the published form stays available until you replace it.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The draft copy could not be created."); }
    finally { setBusy(false); }
  }
  async function saveDraft() {
    if (!draftCopy || !form || !canAuthor || busy) return;
    setBusy(true); setMessage("");
    try { const result = await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_master_draft", actorMode, draftId: draftCopy.id, expectedRevision: draftCopy.revision, form }) }); acceptDraft(result.draft); setMessage("Draft saved. The published form has not changed."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The draft could not be saved. Your edits are still here."); }
    finally { setBusy(false); }
  }
  async function finishDraft(action: "publish_master_draft" | "discard_master_draft") {
    if (!draftCopy || !canAuthor || busy || (action === "publish_master_draft" && dirty)) return;
    setBusy(true); setMessage("");
    try {
      const result = await api(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, actorMode, draftId: draftCopy.id, expectedRevision: draftCopy.revision }) });
      if (action === "publish_master_draft") {
        if (!result.form || typeof result.form !== "object" || !("fields" in result.form) || !Array.isArray(result.form.fields)) throw new Error("The published result could not be read. Refresh before trying again.");
        setForm(result.form as ActivityForm); setExpectedVersion(Number(result.expectedVersion)); setMessage("Published. New records use this version; retained signed records keep their original form.");
      } else { setForm(null); setSelected(""); setQuestion(0); setSigningItem(""); setRemoval(null); setRenamingPage(""); setMessage("Draft discarded. The published form has not changed."); }
      setDrafts((current) => current.filter((item) => item.id !== draftCopy.id)); setDraftCopy(null); setDirty(false); setDraftConfirmation(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The draft action could not be completed. Your copy is still available."); setDraftConfirmation(null); }
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
    if (!form || !canAuthor || busy) return;
    const current = form.fields[question];
    if (!current) return;
    const reason = editorQuestionDeleteReason(form, current.key);
    if (reason) { setMessage(reason); return; }
    setRemoval({ kind: "question", key: current.key }); setRenamingPage("");
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
    setForm({ ...form, declarations: [...form.declarations, declaration] }); selectSignature(declaration.key); setDirty(true);
  }
  function selectQuestion(index: number) { setQuestion(index); setSigningItem(""); setRemoval(null); setRenamingPage(""); }
  function selectSignature(key: string) { setSigningItem(key); setRemoval(null); setRenamingPage(""); }
  function editPage(change: () => EditorFormChange) {
    if (!canAuthor || busy) return;
    try {
      const next = change();
      setForm(next.form); selectQuestion(Math.max(0, next.form.fields.findIndex((item) => item.key === next.selectedFieldKey)));
      setDirty(true); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "This page could not be changed."); }
  }
  function confirmRemoval() {
    if (!form || !removal || !canAuthor || busy) return;
    if (removal.kind === "page") { editPage(() => deleteEditorPage(form, removal.key)); return; }
    if (removal.kind === "signature") {
      const declaration = form.declarations.find((item) => item.key === removal.key);
      if (!declaration?.key.startsWith("custom.") || declaration.sourceUrl || declaration.sourceTextSha256) return;
      setForm({ ...form, declarations: form.declarations.filter((item) => item.key !== removal.key) });
      if (signingItem === removal.key) setSigningItem("");
    } else {
      const reason = editorQuestionDeleteReason(form, removal.key);
      if (reason) { setMessage(reason); setRemoval(null); return; }
      const fields = form.fields.filter((item) => item.key !== removal.key);
      setForm({ ...form, fields }); setQuestion(Math.min(question, fields.length - 1));
    }
    setRemoval(null); setDirty(true); setMessage("");
  }
  function convertToSignature() {
    if (!form) return;
    const current = form.fields[question];
    if (!current?.key.startsWith("custom.") || form.fields.length <= 1 || current.sourceRequirementId || current.presentation || current.requiredValue !== undefined || fieldIsReferenced(form, current.key)) return;
    const declaration: ActivityDeclaration = { key: current.key, title: current.label === "New question" ? "New signature" : current.label,
      text: current.help || "Enter the wording the signer must read and agree to.", role: "customer", phase: current.phase, required: current.required,
      sourceUrl: "", sourceTextSha256: "", ...(current.condition ? { condition: current.condition } : {}) };
    setForm({ ...form, fields: form.fields.filter((item) => item.key !== current.key), declarations: [...form.declarations, declaration] });
    setQuestion(Math.max(0, question - 1)); selectSignature(declaration.key); setDirty(true);
  }
  function deleteDeclaration(index: number) {
    if (!form || !canAuthor || busy) return;
    const current = form.declarations[index];
    if (!current?.key.startsWith("custom.") || current.sourceUrl || current.sourceTextSha256) return;
    setRemoval({ kind: "signature", key: current.key }); setRenamingPage("");
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
  const questionDeleteReason = form && field ? editorQuestionDeleteReason(form, field.key) : "";
  const fieldConditionControlled = sourcePlacementControlled || field?.presentation === "derived" || field?.requiredValue !== undefined;
  const selectedFieldIsReferenced = Boolean(form && field && fieldIsReferenced(form, field.key));
  const earlierField = form ? fieldMoveDestination(form.fields, question, -1) : -1;
  const laterField = form ? fieldMoveDestination(form.fields, question, 1) : -1;
  const pages = form ? editorFormPages(form) : [];
  const selectedPage = !signingItem && field ? pages.find((page) => page.fieldKeys.includes(field.key)) : undefined;
  const selectedDeclaration = form?.declarations.find((item) => item.key === signingItem);
  const pageDeleteReason = form && selectedPage ? editorPageDeleteReason(form, selectedPage.key) : "";
  const pageRenameReason = form && selectedPage ? editorPageRenameReason(form, selectedPage.key) : "";
  const questionMoveReason = form && field && selectedPage ? editorQuestionMoveReason(form, field.key, selectedPage.key) : "";
  const removalPage = removal?.kind === "page" ? pages.find((page) => page.key === removal.key) : undefined;
  const removalLabel = removal?.kind === "question" ? form?.fields.find((item) => item.key === removal.key)?.label
    : removal?.kind === "signature" ? form?.declarations.find((item) => item.key === removal.key)?.title : removalPage?.section;
  const programs = [...new Set(catalogue.map((item) => item.programCode))].sort();
  const visibleCatalogue = catalogue.filter((item) => (!program || item.programCode === program)
    && `${item.programCode} ${item.activityCode} ${item.title}`.toLowerCase().includes(search.trim().toLowerCase()));
  const visibleDrafts = drafts.filter((item) => {
    const activity = catalogue.find((entry) => entry.activityTemplateId === item.activityTemplateId);
    return (!program || activity?.programCode === program) && `${activity?.programCode || ""} ${activity?.activityCode || ""} ${item.title}`.toLowerCase().includes(search.trim().toLowerCase());
  });
  const saveCurrent = draftCopy ? saveDraft : save;
  return <section className={`${styles.builderSection} ${styles.masterLibrary}`} aria-label="Activity form editor">
    {form && <button className={styles.masterBack} type="button" disabled={busy} onClick={backToCatalogue}>Back to all forms</button>}
    <header><div><h2>{form ? form.title : "Activity forms"}</h2><p>{canAuthor ? form ? draftCopy ? "Edit and save your draft while the published form stays available. Replace it when your team is ready." : "Changes appear in the phone as you type. Make a draft copy if you want to save work before publishing." : "Edit a published form, or duplicate it to work on a saved draft first." : "Choose a form to test its questions in the phone preview."}</p></div>
      {!form && <button type="button" disabled={busy} onClick={() => void loadCatalogue()}>{busy ? "Loading forms..." : "Refresh forms"}</button>}
      {canAuthor && <button type="button" disabled={busy} onClick={() => void reviewQueue()}>Submitted field records</button>}
      {onManageAccess && <button type="button" onClick={onManageAccess}>Set up form editors</button>}</header>
    {actorMode === "creditex" && !canAuthor ? <div className={styles.masterAccess} role="note"><strong>You can preview and test every form.</strong><p>Sign in with your named Creditex administrator, case manager or reviewer account to edit forms. Shared-mailbox and auditor accounts are read-only. {onManageAccess ? "Use Set up form editors to invite a named member of your team." : "Ask your Creditex administrator to invite you through Team access."} AEA owners can use <a href="/operations/control-centre#form-governance">Admin → Activity forms</a>.</p></div> : null}
    {message ? <p role="status">{message}</p> : null}
    {reviewLink ? <p><a href={reviewLink} target="_blank" rel="noreferrer">Open the signed field report and original evidence</a> (link expires in one hour)</p> : null}
    {!form && catalogue.length > 0 && <>
      <div className={styles.masterFilters}>
        <label><span>Find a form <small>(optional)</small></span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Activity number, service or program" /></label>
        <label>Program<select value={program} onChange={(event) => setProgram(event.target.value)}><option value="">All programs</option>{programs.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
      </div>
      <div className={styles.masterResultBar}><span role="status">{visibleCatalogue.length} of {catalogue.length} forms</span>{(search || program) && <button type="button" onClick={() => { setSearch(""); setProgram(""); }}>Clear filters</button>}</div>
      {visibleDrafts.length > 0 && <section className={styles.masterDraftList} aria-label="Saved draft copies"><h3>Saved drafts</h3><p>These copies are separate from the published forms.</p>{visibleDrafts.map((item) => <article key={item.id}><div><strong>{item.title}</strong><small>{catalogue.find((entry) => entry.activityTemplateId === item.activityTemplateId)?.programCode} · {item.variantId || "Default premises"} · Draft {item.revision} · {item.baseMasterVersion ? `Based on published version ${item.baseMasterVersion}` : "Based on built-in form"}</small></div><button type="button" disabled={busy} onClick={() => void openDraft(item.id)}>{canAuthor ? "Continue draft" : "Preview draft"}</button></article>)}</section>}
      <p className={styles.masterLibraryNote}>Program forms stay available for their activities. Edit a form to change its questions; completed records keep their original version.</p>
      <div className={styles.masterCatalogue} aria-label="All activity forms" aria-busy={busy}>
        {programs.map((code) => {
          const items = visibleCatalogue.filter((item) => item.programCode === code);
          return items.length > 0 ? <section className={styles.masterGroup} key={code} aria-labelledby={`master-program-${actorMode}-${code}`}>
            <header><h3 id={`master-program-${actorMode}-${code}`}>{code}</h3><span>{items.length} built-in program {items.length === 1 ? "form" : "forms"}</span></header>
            <ul>{items.map((item) => <li key={item.activityTemplateId} className={styles.masterRow}>
              <span className={styles.masterCode}>{item.activityCode}</span><strong>{item.title}</strong>
              <div className={styles.masterRowActions}><button type="button" disabled={busy} aria-label={`${canAuthor ? "Edit" : "Preview"} ${item.programCode} ${item.activityCode}: ${item.title}`} onClick={() => void load(item.activityTemplateId)}>{canAuthor ? "Edit" : "Preview"}</button>{canAuthor && <button type="button" disabled={busy} aria-label={`Duplicate ${item.programCode} ${item.activityCode}: ${item.title}`} onClick={() => void duplicate(item.activityTemplateId)}>Duplicate</button>}</div>
            </li>)}</ul>
          </section> : null;
        })}
        {!visibleCatalogue.length && <p className={styles.masterEmpty}>No forms match these filters. Clear the filters to see all forms.</p>}
      </div>
    </>}
    {!form && !busy && !catalogue.length && !message && <p>No activity forms are available.</p>}
    {form && field ? <div className={styles.masterEditingLayout}>
    <div className={styles.masterEditor}>
    <div className={styles.masterSaveBar}><span role="status">{draftCopy ? `Draft copy ${draftCopy.revision}${dirty ? " | Unsaved changes" : " | Saved"}` : canAuthor ? dirty ? "Unsaved changes" : "Published form" : "Read-only preview"} · {draftCopy ? draftCopy.baseMasterVersion ? `Published version ${draftCopy.baseMasterVersion}` : "Based on built-in form" : `Published version ${form.version}`}</span>{canAuthor && <div className={styles.masterRowActions}><button type="button" disabled={!dirty || busy} onClick={() => void saveCurrent()}>{busy ? "Saving..." : draftCopy ? "Save draft" : "Save and publish master"}</button>{draftCopy ? <><button type="button" disabled={busy || dirty || !draftCopy.baseIsCurrent} onClick={() => setDraftConfirmation("publish")}>Replace published form</button><button type="button" disabled={busy} onClick={() => setDraftConfirmation("discard")}>Discard draft</button></> : <button type="button" disabled={busy || dirty} onClick={() => void duplicate(form.activityTemplateId)}>Duplicate to draft</button>}</div>}</div>
    {draftCopy && <p className={styles.masterLibraryNote}>{dirty ? "Save your draft before replacing the published form." : "You can leave and return to this saved draft at any time."} {!draftCopy.baseIsCurrent && "The published form has changed since this copy was created. This copy cannot replace it; create a new copy of the current form."}</p>}
    {draftConfirmation && draftCopy && <div className={styles.masterAccess} role="alert"><strong>{draftConfirmation === "publish" ? draftCopy.baseMasterVersion ? `Replace published version ${draftCopy.baseMasterVersion} with this saved draft?` : "Replace the built-in form with this saved draft?" : "Discard this draft copy?"}</strong><p>{draftConfirmation === "publish" ? "New records will use the replacement. Signed and submitted records keep their original version." : "The published form stays unchanged. Any unsaved edits in this copy will be discarded."}</p><div className={styles.masterRowActions}><button type="button" disabled={busy || (draftConfirmation === "publish" && (dirty || !draftCopy.baseIsCurrent))} onClick={() => void finishDraft(draftConfirmation === "publish" ? "publish_master_draft" : "discard_master_draft")}>{draftConfirmation === "publish" ? "Confirm replacement" : "Confirm discard"}</button><button type="button" disabled={busy} onClick={() => setDraftConfirmation(null)}>Keep editing</button></div></div>}
    <section className={styles.masterPages} aria-label="Pages and sections">
      <header><div><h3>Pages and sections</h3><p>Group questions on a page, then check the phone preview.</p></div>{canAuthor && <button type="button" disabled={busy} onClick={() => editPage(() => addEditorPage(form, selectedPage?.key))}>Add page</button>}</header>
      <label>Page to {canAuthor ? "edit" : "preview"}<select value={selectedPage?.key || ""} onChange={(event) => { const page = pages.find((item) => item.key === event.target.value); if (page) selectQuestion(form.fields.findIndex((item) => item.key === page.fieldKeys[0])); }}>
        {!selectedPage && <option value="">Choose a question page</option>}{pages.map((page, index) => <option key={page.key} value={page.key}>{index + 1}. {page.section} · {page.phase === "before" ? "Before" : "After"} work · {page.fields.length} question{page.fields.length === 1 ? "" : "s"}{page.repeatGroup ? " · Repeated item" : ""}</option>)}
      </select></label>
      {selectedPage && <>
        <div className={styles.masterPageQuestions}>{selectedPage.fields.map((item, index) => <button key={item.key} type="button" aria-current={item.key === field.key ? "true" : undefined} onClick={() => selectQuestion(form.fields.findIndex((candidate) => candidate.key === item.key))}><span>{index + 1}</span><strong>{item.label}</strong><small>{item.required ? "Required" : "Optional"}</small></button>)}</div>
        {canAuthor && <div className={styles.masterRowActions}>
          <button type="button" disabled={busy || selectedPage.fields.length >= ACTIVITY_WIZARD_PAGE_FIELD_LIMIT} onClick={() => editPage(() => addEditorPageQuestion(form, selectedPage.key))}>Add question</button>
          <button type="button" disabled={busy || Boolean(pageRenameReason)} title={pageRenameReason || undefined} onClick={() => { setRenamingPage(selectedPage.key); setPageName(selectedPage.section); setRemoval(null); }}>Rename page</button>
          <button type="button" className={styles.masterDelete} disabled={busy || Boolean(pageDeleteReason)} onClick={() => { setRemoval({ kind: "page", key: selectedPage.key }); setRenamingPage(""); }}>Delete page</button>
        </div>}
        {canAuthor && (pageRenameReason || pageDeleteReason) && <small>{pageRenameReason} {pageDeleteReason}</small>}
        {renamingPage === selectedPage.key && <div className={styles.masterPageAction}><label>Page name<input value={pageName} maxLength={160} onChange={(event) => setPageName(event.target.value)} /></label><div className={styles.masterRowActions}><button type="button" disabled={busy || !pageName.trim()} onClick={() => editPage(() => renameEditorPage(form, selectedPage.key, pageName))}>Apply page name</button><button type="button" onClick={() => setRenamingPage("")}>Cancel rename</button></div></div>}
      </>}
      <small>Up to 8 questions per screen. Answers can hide questions; repeated items have their own pages. A new page starts with one question. Signatures follow the question pages.</small>
    </section>
    <label>Item to {canAuthor ? "edit" : "preview"}<select value={signingItem ? `signature:${signingItem}` : String(question)} onChange={(event) => { if (event.target.value.startsWith("signature:")) selectSignature(event.target.value.slice(10)); else selectQuestion(Number(event.target.value)); }}><optgroup label="Questions">{form.fields.map((item, index) => <option key={item.key} value={index}>{index + 1}. {item.section}: {item.label}</option>)}</optgroup><optgroup label="Signatures">{form.declarations.map((item) => <option key={item.key} value={`signature:${item.key}`}>Signature: {item.title}</option>)}</optgroup></select></label>
    {canAuthor && <div className={styles.masterRowActions}><button type="button" disabled={busy} onClick={addDeclaration}>Add signature</button>{signingItem ? <><button type="button" onClick={() => selectQuestion(question)}>Back to questions</button><button type="button" className={styles.masterDelete} disabled={busy || !selectedDeclaration?.key.startsWith("custom.") || Boolean(selectedDeclaration.sourceUrl || selectedDeclaration.sourceTextSha256)} onClick={() => deleteDeclaration(form.declarations.findIndex((item) => item.key === signingItem))}>Delete signature</button></> : <button type="button" className={styles.masterDelete} disabled={busy || Boolean(questionDeleteReason)} onClick={deleteField}>Delete question</button>}</div>}
    {canAuthor && !signingItem && questionDeleteReason && <p className={styles.masterLibraryNote}>{questionDeleteReason}</p>}
    {removal && removalLabel && <div className={styles.masterPageAction} role="alert"><strong>Delete {removal.kind} &quot;{removalLabel}&quot;?</strong><p>{removalPage ? `This removes the page and its ${removalPage.fields.length} question${removalPage.fields.length === 1 ? "" : "s"}.` : "This removes the selected item from this form."} Changes take effect when you {draftCopy ? "save and publish this draft" : "save and publish"}. Existing signed records keep their original form.</p>{removalPage && <ul>{removalPage.fields.map((item) => <li key={item.key}>{item.label}</li>)}</ul>}<div className={styles.masterRowActions}><button type="button" className={styles.masterDelete} disabled={busy} onClick={confirmRemoval}>{`Confirm delete ${removal.kind}`}</button><button type="button" onClick={() => setRemoval(null)}>{`Keep ${removal.kind}`}</button></div></div>}
    {form.variantOptions.length > 1 ? <label>Premises<select disabled={busy || Boolean(draftCopy)} value={form.variantId} onChange={(event) => void load(selected, event.target.value)}>{form.variantOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : null}
    <fieldset disabled={busy || !canAuthor}>
      <legend>{draftCopy ? "Draft form" : `Master version ${form.version}`}{dirty ? " | Unsaved changes" : ""}</legend>
      <small>{draftCopy ? "This copy does not change live jobs. After publication, new records and unsigned drafts use it; signed and submitted records keep their original version." : "New records and unsigned drafts use it when opened; signed and submitted records stay locked to what was agreed."}</small>
      <label>Form title<input value={form.title} maxLength={300} onChange={(event) => { setForm({ ...form, title: event.target.value }); setDirty(true); }} /></label>
      {!signingItem && <>
      {field.presentation === "derived" ? <p role="note"><strong>Filled automatically by TLink.</strong> The field app displays this as recorded job, customer, business, Team profile, document-delivery or signature data. The tradie is not asked to enter it.</p> : null}
      {field.presentation === "prefilled" ? <p role="note"><strong>Prefilled by TLink and editable in the field.</strong> The assigned worker or business profile supplies the starting value. The tradie can correct it when another licensed role holder performed that part of the work.</p> : null}
      {sourcePlacementControlled ? <p role="note"><strong>This evidence question is governed by its regulator requirement.</strong> Its wording, section, timing, evidence type, mandatory status and location rule stay linked to the requirement. Add an optional question if Creditex needs extra information.</p> : null}
      <div className="admin-form-grid"><label>Move to page<select disabled={!selectedPage || busy || Boolean(questionMoveReason)} title={questionMoveReason || undefined} value={selectedPage?.key || ""} onChange={(event) => editPage(() => moveEditorQuestion(form, field.key, event.target.value))}>
        {!selectedPage && <option value="">Recorded automatically</option>}{pages.filter((page) => page.phase === field.phase && page.repeatGroup === field.repeatGroup).map((page) => <option key={page.key} value={page.key} disabled={page.key !== selectedPage?.key && Boolean(editorQuestionMoveReason(form, field.key, page.key))}>{pages.indexOf(page) + 1}. {page.section}{page.fields.length >= ACTIVITY_WIZARD_PAGE_FIELD_LIMIT ? " (full)" : ""}</option>)}
      </select></label>
        <label>Question<input disabled={sourcePlacementControlled} value={field.label} onChange={(event) => updateField({ label: event.target.value })} /></label>
        <label>Answer type<select disabled={profilePlacementControlled || sourcePlacementControlled || selectedFieldIsReferenced} value={field.type} onChange={(event) => { if (event.target.value === "signature") { convertToSignature(); return; } const type = answerTypes.find((item) => item.value === event.target.value)?.value; if (!type) return;
          updateField({ type, options: type === "select" ? ["Yes", "No"] : [], optionLabels: undefined, requireLocation: type === "photo" ? field.requireLocation : undefined }); }}>{answerTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}<option value="signature" disabled={!field.key.startsWith("custom.") || form.fields.length <= 1 || Boolean(field.presentation) || field.requiredValue !== undefined}>Signature / declaration</option></select></label>
        <label>When<select disabled={profilePlacementControlled || sourcePlacementControlled || selectedFieldIsReferenced} value={field.phase} onChange={(event) => updateField({ phase: event.target.value === "before" ? "before" : "after" })}><option value="before">Before work</option><option value="after">After work</option></select></label>
      </div>
      <label>Instructions<textarea disabled={sourcePlacementControlled} value={field.help} onChange={(event) => updateField({ help: event.target.value })} /></label>
      {field.type === "select" ? <label>Stored code | label shown to the tradie, one per line<textarea disabled={profilePlacementControlled || selectedFieldIsReferenced} value={formattedChoices(field)} onChange={(event) => updateField(parsedChoices(event.target.value))} /></label> : null}
      <label><input type="checkbox" disabled={profilePlacementControlled || sourcePlacementControlled} checked={field.required} onChange={(event) => updateField({ required: event.target.checked })} />Required question</label>
      {field.type === "photo" ? <label><input type="checkbox" disabled={sourcePlacementControlled} checked={Boolean(field.requireLocation)} onChange={(event) => updateField({ requireLocation: event.target.checked })} />Require accurate GPS location with each captured photo</label> : null}
      <ConditionEditor form={form} targetKey={field.key} phase={field.phase} condition={field.condition} locked={fieldConditionControlled} label="When this question appears" onChange={(condition) => updateField({ condition })} />
      {field.type === "document" && <p role="note">This question uploads a document, including an already-signed copy. Use Add signature to have someone sign wording inside this form.</p>}
      <div className="admin-choice-row"><button type="button" disabled={question === 0} onClick={() => selectQuestion(question - 1)}>Previous question</button><button type="button" disabled={question >= form.fields.length - 1} onClick={() => selectQuestion(question + 1)}>Next question</button>
        <button type="button" disabled={fieldOrderControlled || earlierField < 0} onClick={() => moveField(-1)}>Move earlier in section</button>
        <button type="button" disabled={fieldOrderControlled || laterField < 0} onClick={() => moveField(1)}>Move later in section</button>
        </div>
      </>}
      <details open={Boolean(signingItem)}><summary>Signatures and declarations ({form.declarations.length})</summary><p>Choose who signs and the wording they must read. The field app records the actual signature against this version and its evidence.</p>{form.declarations.map((declaration, index) => {
        if (signingItem && declaration.key !== signingItem) return null;
        const prescribed = Boolean(declaration.sourceUrl || declaration.sourceTextSha256);
        const custom = declaration.key.startsWith("custom.");
        return <article key={declaration.key}>
          <strong>{declaration.title}{prescribed ? " | Prescribed wording" : ""}</strong>
          <label>Answer type<select value="signature" disabled><option value="signature">Signature / declaration</option></select></label>
          <button type="button" onClick={() => selectSignature(declaration.key)}>Preview this signature</button>
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
            {!signingItem && <button type="button" className={styles.masterDelete} disabled={!custom || prescribed} onClick={() => deleteDeclaration(index)}>Delete signature</button>}</div>
          {prescribed ? <small>This wording is fixed by the recorded source. Creditex-authored declarations without a prescribed source can be edited here.</small>
            : !custom ? <small>This default Creditex declaration can be rewritten. Its signer role, timing and required status remain governed.</small> : null}
        </article>;
      })}</details>
      <details><summary>Regulator sources and review notes</summary>{form.sources.map((source) => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}{form.reviewNotes.map((note, index) => <p key={index}>{note}</p>)}</details>
      <button type="button" disabled={!dirty} onClick={() => void saveCurrent()}>{busy ? "Saving..." : draftCopy ? "Save draft" : "Save and publish master"}</button>
    </fieldset></div>
    <CreditexFormPhonePreview key={`${form.activityTemplateId}:${form.variantId}:${draftCopy?.id || "published"}`} form={form} canEdit={canAuthor} selectedFieldKey={signingItem ? undefined : field.key} selectedDeclarationKey={signingItem || undefined} onSelectDeclaration={selectSignature} onSelectField={(key) => { const index = form.fields.findIndex((item) => item.key === key); if (index >= 0) selectQuestion(index); }} />
    </div> : null}
    {records.length ? <table><thead><tr><th>Field record</th><th>Activity</th><th>Submitted</th><th>Job</th><th>Report</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td>{record.recordNumber}</td><td>{record.form.title}</td><td>{record.submittedAt}</td><td>{record.workOrderId}</td><td><button type="button" disabled={busy} onClick={() => void viewReport(record.id)}>View report</button></td></tr>)}</tbody></table> : null}
  </section>;
}
