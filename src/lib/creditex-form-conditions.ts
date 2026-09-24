import type { ActivityAnswer, ActivityCondition, ActivityField, ActivityForm, ActivityPhase } from "./trade-activity-form-types";
import { editorFormRoutingReason } from "./creditex-form-pages.ts";
import { activityFieldWorkerForm } from "./trade-activity-field-policy.ts";

export type DirectCondition = { fieldKey: string; operator: "equals" | "notEquals"; value: ActivityAnswer };
export function conditionFieldKeys(condition?: ActivityCondition): string[] {
  if (!condition) return [];
  return [...(condition.fieldKey ? [condition.fieldKey] : []), ...(condition.all || []).flatMap(conditionFieldKeys), ...(condition.any || []).flatMap(conditionFieldKeys)];
}
export function directCondition(condition?: ActivityCondition): DirectCondition | null {
  if (!condition?.fieldKey || Object.keys(condition).length !== 2) return null;
  if (condition.equals !== undefined) return { fieldKey: condition.fieldKey, operator: "equals", value: condition.equals };
  if (condition.notEquals !== undefined) return { fieldKey: condition.fieldKey, operator: "notEquals", value: condition.notEquals };
  return null;
}
export function conditionValue(field: ActivityField): ActivityAnswer {
  return field.type === "boolean" ? true : field.type === "number" ? 0 : field.type === "select" ? field.options[0] || "" : "";
}
export function makeCondition(fieldKey: string, operator: DirectCondition["operator"], value: ActivityAnswer): ActivityCondition {
  return operator === "equals" ? { fieldKey, equals: value } : { fieldKey, notEquals: value };
}
function dependsOn(form: ActivityForm, key: string, target: string, seen = new Set<string>()): boolean {
  if (key === target) return true;
  if (seen.has(key)) return false;
  seen.add(key);
  return conditionFieldKeys(form.fields.find((field) => field.key === key)?.condition).some((source) => dependsOn(form, source, target, seen));
}
export function conditionFields(form: ActivityForm, targetKey: string, phase: ActivityPhase): ActivityField[] {
  const target = form.fields.find((field) => field.key === targetKey);
  return form.fields.filter((source) => source.key !== targetKey && !["photo", "document"].includes(source.type)
    && (phase === "after" || source.phase === "before")
    && (!source.repeatGroup || source.repeatGroup === target?.repeatGroup)
    && !dependsOn(form, source.key, targetKey));
}
export function editorConditionLockReason(form: ActivityForm, targetKey: string): string {
  if (targetKey.startsWith("@declaration:")) {
    const item = form.declarations.find((declaration) => `@declaration:${declaration.key}` === targetKey);
    return !item ? "This signature is no longer available." : !item.key.startsWith("custom.") || item.sourceUrl || item.sourceTextSha256
      ? "This signature follows its required program rules." : "";
  }
  const field = form.fields.find((item) => item.key === targetKey);
  if (!field) return "This question is no longer available.";
  const identityPhoto = field.type === "photo" && /selfie/i.test(`${field.key} ${field.label} ${field.help}`)
    && /installer/i.test(`${field.key} ${field.label} ${field.help}`);
  if (field.sourceRequirementId || field.approvedProduct || identityPhoto || field.presentation === "derived" || field.presentation === "prefilled"
    || field.requiredValue !== undefined || /^job\.(?:assignee|trade|credential|credentialType)\./.test(field.autofill || "")
    || (form.activityTemplateId === "veu-6" && ["installed_product.indoor_heating_kw", "installed_product.indoor_cooling_kw"].includes(field.key))) {
    return "This question follows its required program or profile rules.";
  }
  const worker = activityFieldWorkerForm(form).fields.find((item) => item.key === field.key);
  return JSON.stringify(worker?.condition) !== JSON.stringify(field.condition) ? "TLink controls when this question appears." : "";
}
export function changeEditorCondition(form: ActivityForm, targetKey: string, condition?: ActivityCondition): ActivityForm {
  const reason = editorConditionLockReason(form, targetKey);
  if (reason) throw new Error(reason);
  const declaration = form.declarations.find((item) => `@declaration:${item.key}` === targetKey);
  const target = declaration || form.fields.find((item) => item.key === targetKey)!;
  const candidates = new Set(conditionFields(form, targetKey, target.phase).map((item) => item.key));
  if (conditionFieldKeys(condition).some((key) => !candidates.has(key))) throw new Error("Choose an earlier answer from the same repeated item, without creating a loop.");
  const next = declaration ? { ...form, declarations: form.declarations.map((item) => item === declaration ? { ...item, condition } : item) }
    : { ...form, fields: form.fields.map((item) => item.key === targetKey ? { ...item, condition } : item) };
  const routing = editorFormRoutingReason(next);
  if (routing) throw new Error(routing);
  return next;
}
export function conditionSummary(condition: ActivityCondition | undefined, form: ActivityForm): string {
  if (!condition) return "Always shown";
  if (condition.all) return `All: ${condition.all.map((item) => conditionSummary(item, form)).join("; ")}`;
  if (condition.any) return `Any: ${condition.any.map((item) => conditionSummary(item, form)).join("; ")}`;
  const source = form.fields.find((item) => item.key === condition.fieldKey);
  const value = condition.equals ?? condition.notEquals ?? condition.lessThanOrEqual;
  const answer = typeof value === "boolean" ? value ? "Yes" : "No" : source?.optionLabels?.[String(value)] || String(value);
  return `${source?.label || condition.fieldKey} ${condition.notEquals !== undefined ? "is not" : condition.lessThanOrEqual !== undefined ? "is at most" : "is"} ${answer}`;
}
