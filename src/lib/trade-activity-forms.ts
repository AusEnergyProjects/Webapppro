import { createHash } from "node:crypto";
import { activityBaseFieldKey, activityRepeatCount, expandedActivityFields, fieldConditionMet } from "./trade-activity-form-flow.ts";

export type * from './trade-activity-form-types';
import type { ActivityAnswers, ActivityCondition, ActivityDeclaration, ActivityForm, ActivityPhase, ActivityRecord, ActivityStroke } from './trade-activity-form-types';

export function activityCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(activityCanonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${activityCanonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function activityHash(value: unknown) { return createHash("sha256").update(typeof value === "string" || value instanceof Uint8Array ? value : activityCanonical(value)).digest("hex"); }

export function activityConditionMet(condition: ActivityCondition | undefined, answers: ActivityAnswers): boolean {
  return fieldConditionMet(condition, answers);
}

export function normaliseActivityAnswers(form: ActivityForm, raw: unknown): ActivityAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_ACTIVITY_ANSWERS");
  const fields = new Map(form.fields.map((field) => [field.key, field]));
  const answers: ActivityAnswers = {};
  for (const [key, value] of Object.entries(raw)) if (key.startsWith("$repeat.")) {
    if (!form.fields.some((field) => field.repeatGroup === key.slice(8)) || typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20) throw new Error("INVALID_ACTIVITY_REPEAT");
    answers[key] = value;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("$repeat.")) continue;
    const baseKey = activityBaseFieldKey(key);
    const field = fields.get(baseKey);
    if (!field || (baseKey !== key && !field.repeatGroup) || ["photo", "document"].includes(field.type)) throw new Error("INVALID_ACTIVITY_FIELD");
    if (baseKey !== key && Number(key.match(/\[(\d+)\]$/)?.[1]) >= activityRepeatCount(form, answers, field.repeatGroup!)) throw new Error("INVALID_ACTIVITY_REPEAT");
    if (value === "" || value === null || value === undefined) continue;
    if (field.type === "boolean") {
      if (typeof value !== "boolean") throw new Error("INVALID_ACTIVITY_ANSWER");
      answers[key] = value;
    } else if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error("INVALID_ACTIVITY_ANSWER");
      answers[key] = value;
    } else {
      if (typeof value !== "string" || value.length > 10_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("INVALID_ACTIVITY_ANSWER");
      const clean = value.trim();
      if (field.type === "select" && !field.options.includes(clean)) throw new Error("INVALID_ACTIVITY_OPTION");
      if (field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || !Number.isFinite(Date.parse(clean)) || new Date(clean).toISOString().slice(0, 10) !== clean)) throw new Error("INVALID_ACTIVITY_DATE");
      if (clean) answers[key] = clean;
    }
  }
  return answers;
}

export function activityDeclarationText(declaration: ActivityDeclaration, answers: ActivityAnswers) {
  return declaration.text.replace(/\{\{([^{}]+)\}\}/g, (token, key: string) => {
    const value = answers[`binding.${key}`];
    return value === undefined || value === "" ? token : String(value);
  });
}

export function activitySigningScope(record: Pick<ActivityRecord, "id" | "formSha256" | "form" | "answers" | "evidence"> & Partial<Pick<ActivityRecord, "signatures">>, phase: ActivityPhase) {
  const fields = record.form.fields.filter((field) => phase === "after" || field.phase === "before");
  const keys = new Set(fields.map((field) => field.key));
  const addConditionKeys = (condition: ActivityCondition | undefined) => {
    if (!condition) return;
    if (condition.fieldKey) keys.add(condition.fieldKey);
    for (const child of [...(condition.all || []), ...(condition.any || [])]) addConditionKeys(child);
  };
  for (const field of fields) addConditionKeys(field.condition);
  for (const declaration of record.form.declarations.filter((item) => phase === "after" || item.phase === "before")) addConditionKeys(declaration.condition);
  const groups = new Set(fields.map((field) => field.repeatGroup).filter(Boolean));
  return activityHash({ recordId: record.id, formSha256: record.formSha256, phase,
    answers: Object.fromEntries(Object.entries(record.answers).filter(([key]) => keys.has(activityBaseFieldKey(key)) || (key.startsWith("$repeat.") && groups.has(key.slice(8))))),
    evidence: record.evidence.filter((item) => keys.has(activityBaseFieldKey(item.fieldKey))).map((item) => ({ id: item.id, sha256: item.sha256,
      fieldKey: item.fieldKey, capturedAt: item.capturedAt, latitude: item.latitude, longitude: item.longitude, accuracy: item.accuracy,
      locationObservedAt: item.locationObservedAt || "", locationMocked: item.locationMocked ?? null, previewSha256: item.previewSha256 || "" })),
    beforeSignatures: phase === "after" ? (record.signatures || []).filter((item) => item.phase === "before")
      .map((item) => ({ id: item.id, declarationSha256: item.declarationSha256, scopeSha256: item.scopeSha256, signedAt: item.signedAt, signerName: item.signerName })) : [],
  });
}

export function activityMissing(record: Pick<ActivityRecord, "form" | "formSha256" | "id" | "answers" | "evidence" | "signatures">, phase?: ActivityPhase, includeSignatures = true) {
  const missing: { key: string; label: string; kind: "answer" | "evidence" | "signature" }[] = [];
  for (const field of expandedActivityFields(record.form, record.answers)) {
    if ((phase && field.phase !== phase) || !field.required) continue;
    if (field.type === "photo" || field.type === "document") {
      if (!record.evidence.some((item) => item.fieldKey === field.key)) missing.push({ key: field.key, label: field.label, kind: "evidence" });
    } else if (record.answers[field.key] === undefined || record.answers[field.key] === ""
      || (field.requiredValue !== undefined && record.answers[field.key] !== field.requiredValue)) {
      missing.push({ key: field.key, label: field.label, kind: "answer" });
    }
  }
  if (includeSignatures) for (const declaration of record.form.declarations) {
    if ((phase && declaration.phase !== phase) || !declaration.required || !activityConditionMet(declaration.condition, record.answers)) continue;
    const text = activityDeclarationText(declaration, record.answers);
    const hash = activitySigningScope(record, declaration.phase);
    if (/\{\{/.test(text) || !record.signatures.some((signature) => signature.declarationKey === declaration.key
      && signature.declarationSha256 === activityHash(text) && signature.scopeSha256 === hash)) {
      missing.push({ key: declaration.key, label: declaration.title, kind: "signature" });
    }
  }
  return missing;
}

export function validateActivityStrokes(raw: unknown): ActivityStroke[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 32) throw new Error("ACTIVITY_SIGNATURE_REQUIRED");
  let points = 0; let distance = 0;
  const result = raw.map((stroke: unknown) => {
    if (!stroke || typeof stroke !== "object" || !("points" in stroke) || !Array.isArray(stroke.points) || stroke.points.length < 2) throw new Error("INVALID_ACTIVITY_SIGNATURE");
    const clean = stroke.points.map((point: unknown) => {
      if (!point || typeof point !== "object" || !("x" in point) || !("y" in point)
        || typeof point.x !== "number" || typeof point.y !== "number"
        || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) throw new Error("INVALID_ACTIVITY_SIGNATURE");
      return { x: point.x, y: point.y };
    });
    points += clean.length;
    for (let index = 1; index < clean.length; index++) distance += Math.hypot(clean[index].x - clean[index - 1].x, clean[index].y - clean[index - 1].y);
    return { points: clean };
  });
  if (points > 1_024 || points < 3 || distance < 0.1) throw new Error("INVALID_ACTIVITY_SIGNATURE");
  return result;
}

export function assertActivityEditable(record: ActivityRecord, expectedRevision: unknown) {
  if (record.status !== "draft") throw new Error("ACTIVITY_ALREADY_SUBMITTED");
  if (expectedRevision !== record.revision) throw new Error("ACTIVITY_REVISION_CONFLICT");
}

export function assertActivitySignedScopeUnchanged(previous: ActivityRecord, next: ActivityRecord) {
  for (const phase of ["before", "after"] as const) {
    if (previous.signatures.some((signature) => signature.phase === phase)
      && activitySigningScope(previous, phase) !== activitySigningScope(next, phase)) throw new Error("ACTIVITY_SIGNED_SCOPE_LOCKED");
  }
}
