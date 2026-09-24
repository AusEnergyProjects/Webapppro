import type { ActivityCondition, ActivityField, ActivityForm, ActivityPhase } from "./trade-activity-form-types";
import { activityFieldWorkerForm } from "./trade-activity-field-policy.ts";
import { ACTIVITY_WIZARD_PAGE_FIELD_LIMIT, activityBaseFieldKey, activityWizardPages } from "./trade-activity-form-flow.ts";

export type EditorFormPage = {
  key: string; fieldKeys: string[]; fields: ActivityField[];
  section: string; phase: ActivityPhase; repeatGroup?: string;
};
export type EditorFormChange = { form: ActivityForm; selectedFieldKey: string };

export function editorFormPages(form: ActivityForm): EditorFormPage[] {
  const worker = activityFieldWorkerForm(form);
  const potential = { ...worker, fields: worker.fields.map((field) => ({ ...field, condition: undefined })) };
  return activityWizardPages(potential, {}).flatMap((page) => page.kind === "fields" ? [{
    key: page.fields[0].baseKey, fieldKeys: page.fields.map((field) => field.baseKey), fields: page.fields,
    section: page.section, phase: page.phase, ...(page.fields[0].repeatGroup ? { repeatGroup: page.fields[0].repeatGroup } : {}),
  }] : []);
}

function pageFor(form: ActivityForm, key: string) {
  return editorFormPages(form).find((page) => page.key === key);
}
function requirePage(form: ActivityForm, key: string) {
  const page = pageFor(form, key);
  if (!page) throw new Error("This page is no longer available. Select a current page.");
  return page;
}
function protectedField(field: ActivityField) {
  // Match the installer identity evidence retained by applyDefaultActivityFormPolicy,
  // including legacy selfie keys, without importing the entire form catalogue.
  const selfie = field.key === "evidence.tlink-installer-id-selfie"
    || (field.type === "photo" && /selfie/i.test(`${field.key} ${field.label} ${field.help}`)
      && /installer/i.test(`${field.key} ${field.label} ${field.help}`)
      && /\b(?:id|identity|badge|accreditation|licen[cs]e)\b/i.test(`${field.key} ${field.label} ${field.help}`));
  return Boolean(field.sourceRequirementId || field.approvedProduct || selfie || field.presentation === "derived"
    || field.presentation === "prefilled" || /^job\.(?:assignee|trade|credential|credentialType)\./.test(field.autofill || "")
    || field.requiredValue !== undefined);
}
function conditionKeys(condition?: ActivityCondition): string[] {
  return condition ? [...(condition.fieldKey ? [condition.fieldKey] : []),
    ...(condition.all || []).flatMap(conditionKeys), ...(condition.any || []).flatMap(conditionKeys)] : [];
}
function deletionReason(form: ActivityForm, keys: ReadonlySet<string>) {
  const deleting = form.fields.filter((field) => keys.has(field.key));
  if (deleting.some(protectedField)) return "This item contains governed evidence or profile information and cannot be deleted.";
  const surviving = form.fields.filter((field) => !keys.has(field.key));
  if (!surviving.length) return "Keep at least one question in the form.";
  const referenced = (key: string) => keys.has(activityBaseFieldKey(key));
  if (surviving.some((field) => conditionKeys(field.condition).some(referenced)
    || field.evidenceFor?.some(referenced) || (field.approvedProduct?.brandFieldKey && referenced(field.approvedProduct.brandFieldKey)))
    || form.declarations.some((item) => conditionKeys(item.condition).some(referenced)
      || [...item.text.matchAll(/\{\{([^{}]+)\}\}/g)].some((match) => referenced(`binding.${match[1]}`)))) {
    return "Another question, evidence item or signature uses this item. Remove that reference before deleting it.";
  }
  return "";
}
export function editorQuestionDeleteReason(form: ActivityForm, key: string) {
  return form.fields.some((field) => field.key === key) ? deletionReason(form, new Set([key])) : "This question is no longer available.";
}
export function editorPageDeleteReason(form: ActivityForm, key: string) {
  const page = pageFor(form, key);
  return page ? deletionReason(form, new Set(page.fieldKeys)) : "This page is no longer available.";
}
export function editorPageRenameReason(form: ActivityForm, key: string) {
  const page = pageFor(form, key);
  if (!page) return "This page is no longer available.";
  return form.fields.some((field) => page.fieldKeys.includes(field.key) && protectedField(field))
    ? "This page contains governed evidence or profile information. Its section name is fixed." : "";
}

function hasCycle(graph: Map<string, Set<string>>) {
  const active = new Set<string>(), complete = new Set<string>();
  function visit(key: string): boolean {
    if (active.has(key)) return true;
    if (complete.has(key)) return false;
    active.add(key);
    if ([...(graph.get(key) || [])].some(visit)) return true;
    active.delete(key); complete.add(key); return false;
  }
  return [...graph.keys()].some(visit);
}
function routingReason(form: ActivityForm) {
  const fields = new Map(form.fields.map((field) => [field.key, field]));
  const sections = new Map<string, Set<string>>(), units = new Map<string, Set<string>>();
  const section = (field: ActivityField) => JSON.stringify([field.phase, field.section]);
  const unit = (field: ActivityField) => JSON.stringify([field.phase, field.section, field.repeatGroup ? ["repeat", field.repeatGroup] : ["field", field.key]]);
  const edge = (graph: Map<string, Set<string>>, from: string, to: string) => { if (!graph.has(from)) graph.set(from, new Set()); graph.get(from)!.add(to); };
  for (const field of form.fields) for (const key of conditionKeys(field.condition)) {
    const dependency = fields.get(key);
    if (!dependency || dependency.phase !== field.phase) continue;
    if (section(field) !== section(dependency)) edge(sections, section(field), section(dependency));
    else if (unit(field) !== unit(dependency)) edge(units, unit(field), unit(dependency));
  }
  return hasCycle(sections) || hasCycle(units) ? "This change would make pages depend on each other in a loop. Keep dependent questions together or change their conditions first." : "";
}
function changed(form: ActivityForm, fields: ActivityField[], selectedFieldKey: string): EditorFormChange {
  const next = { ...form, fields };
  const reason = routingReason(next);
  if (reason) throw new Error(reason);
  return { form: next, selectedFieldKey };
}
function sectionTitle(form: ActivityForm, phase: ActivityPhase, title: string, ownKeys: readonly string[] = []) {
  const value = title.trim();
  if (!value || value.length > 160) throw new Error("Enter a page name between 1 and 160 characters.");
  if (form.fields.some((field) => field.phase === phase && !ownKeys.includes(field.key) && field.section.trim().toLowerCase() === value.toLowerCase())) {
    throw new Error("Another page in this stage already uses that name. Choose a unique page name.");
  }
  return value;
}
function newQuestion(section: string, phase: ActivityPhase, repeatGroup?: string): ActivityField {
  return { key: `custom.${crypto.randomUUID()}`, section, phase, label: "New question", type: "text", required: false, options: [], help: "",
    ...(repeatGroup ? { repeatGroup } : {}) };
}
function pageEndIndex(form: ActivityForm, page: EditorFormPage) {
  return Math.max(...form.fields.map((field, index) => page.fieldKeys.includes(field.key) ? index : -1)) + 1;
}
export function addEditorPage(form: ActivityForm, afterPageKey?: string, sectionName?: string): EditorFormChange {
  const pages = editorFormPages(form);
  const after = afterPageKey ? requirePage(form, afterPageKey) : pages.at(-1);
  const phase = after?.phase || form.fields.at(-1)?.phase || "before";
  let number = 1;
  while (form.fields.some((field) => field.phase === phase && field.section.trim().toLowerCase() === `new page ${number}`)) number++;
  const section = sectionTitle(form, phase, sectionName ?? `New page ${number}`);
  const field = newQuestion(section, phase);
  // One section may span several eight-question screens. Insert after its full
  // source block so the server's section ordering preserves the new page.
  const index = Math.max(-1, ...form.fields.map((item, position) => item.phase === phase && (!after || item.section === after.section) ? position : -1)) + 1;
  const fields = [...form.fields]; fields.splice(index, 0, field);
  return changed(form, fields, field.key);
}
export function addEditorPageQuestion(form: ActivityForm, pageKey: string): EditorFormChange {
  const page = requirePage(form, pageKey);
  if (page.fieldKeys.length >= ACTIVITY_WIZARD_PAGE_FIELD_LIMIT) throw new Error("This page already has 8 questions. Add a new page instead.");
  const field = newQuestion(page.section, page.phase, page.repeatGroup);
  const fields = [...form.fields]; fields.splice(pageEndIndex(form, page), 0, field);
  return changed(form, fields, field.key);
}
export function editorQuestionMoveReason(form: ActivityForm, fieldKey: string, pageKey: string) {
  const field = form.fields.find((item) => item.key === fieldKey), page = pageFor(form, pageKey);
  if (!field || !page) return "Select an available question and destination page.";
  if (protectedField(field) || !editorFormPages(form).some((item) => item.fieldKeys.includes(fieldKey))) return "Governed evidence and profile questions cannot move between pages.";
  if (page.fieldKeys.includes(fieldKey)) return "";
  if (field.phase !== page.phase) return "Move the question to a page in the same before-work or after-work stage.";
  if ((field.repeatGroup || "") !== (page.repeatGroup || "")) return "Move the question to a page for the same repeated item.";
  if (editorFormPages(form).filter((item) => item.phase === page.phase && item.section === page.section
    && (!page.repeatGroup || item.repeatGroup === page.repeatGroup)).length > 1) {
    return "This destination spans an 8-question page boundary. Give the destination page its own section name first so saving cannot regroup its questions.";
  }
  if (page.fieldKeys.length >= ACTIVITY_WIZARD_PAGE_FIELD_LIMIT) return "The destination page already has 8 questions.";
  const remaining = form.fields.filter((item) => item.key !== fieldKey);
  const index = pageEndIndex({ ...form, fields: remaining }, page);
  remaining.splice(index, 0, { ...field, section: page.section });
  const next = { ...form, fields: remaining };
  const destination = editorFormPages(next).find((item) => item.fieldKeys.includes(fieldKey));
  if (!destination || !page.fieldKeys.every((key) => destination.fieldKeys.includes(key))) {
    return "This move would regroup questions across the 8-question page boundary. Give the destination page its own section name first.";
  }
  return routingReason(next);
}
export function moveEditorQuestion(form: ActivityForm, fieldKey: string, pageKey: string): EditorFormChange {
  const reason = editorQuestionMoveReason(form, fieldKey, pageKey);
  if (reason) throw new Error(reason);
  const page = requirePage(form, pageKey);
  if (page.fieldKeys.includes(fieldKey)) return { form, selectedFieldKey: fieldKey };
  const field = form.fields.find((item) => item.key === fieldKey)!;
  const fields = form.fields.filter((item) => item.key !== fieldKey);
  fields.splice(pageEndIndex({ ...form, fields }, page), 0, { ...field, section: page.section });
  return changed(form, fields, fieldKey);
}
export function renameEditorPage(form: ActivityForm, pageKey: string, title: string): EditorFormChange {
  const reason = editorPageRenameReason(form, pageKey);
  if (reason) throw new Error(reason);
  const page = requirePage(form, pageKey);
  if (title.trim() === page.section) return { form, selectedFieldKey: page.key };
  const section = sectionTitle(form, page.phase, title, page.fieldKeys);
  return changed(form, form.fields.map((field) => page.fieldKeys.includes(field.key) ? { ...field, section } : field), page.key);
}
export function deleteEditorPage(form: ActivityForm, pageKey: string): EditorFormChange {
  const reason = editorPageDeleteReason(form, pageKey);
  if (reason) throw new Error(reason);
  const page = requirePage(form, pageKey), pages = editorFormPages(form), index = pages.findIndex((item) => item.key === pageKey);
  const fields = form.fields.filter((field) => !page.fieldKeys.includes(field.key));
  const selected = pages[index + 1]?.key || pages[index - 1]?.key || fields[0].key;
  return changed(form, fields, selected);
}
