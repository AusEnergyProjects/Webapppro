import { readWattzunWorkReference, type WattzunWorkReference } from "./wattzun-work-context.ts";
import { isWattzunWorkflowResult, type WattzunWorkflowReceipt } from "./wattzun-workflow.ts";
import { readWattzunFormGuideStep, readWattzunFormProductSearch, type WattzunFormGuideStep, type WattzunFormProductSearch } from "./wattzun-form-step.ts";

export type WattzunFormGuideInput = {
  sessionId: string;
  stage: "start" | "continue" | "resume";
  authorization: "ordinary_form_answers";
  sourceSha256?: string;
  questionKey?: string;
  skippedFieldKeys: string[];
  pendingRequestId?: string;
  paused?: boolean;
  productSearch?: WattzunFormProductSearch;
};
export type WattzunFormGuideControl = { kind: "form_guide_control"; command: "skip" | "repeat" | "pause" | "resume" | "complete"; fieldKey: string };
export type WattzunFormGuideQuestion = {
  kind: "question" | "capture" | "manual";
  fieldKey: string; label: string; type: string;
  options: Array<{ value: string; label: string }>;
  reason?: string;
  capture?: { minimumCount: number; maximumCount: number; savedCount: number; allowedContentTypes: string[]; gpsRequired: boolean; captureTimeRequired: boolean; metadataRequired: boolean; originalRequired: boolean };
  step?: WattzunFormGuideStep;
};
export type WattzunFormGuideProgress = {
  sessionId: string;
  reference: Extract<WattzunWorkReference, { kind: "trade_form" }>;
  requestedReference: Extract<WattzunWorkReference, { kind: "trade_form" }>;
  recordId: string; revision: number; sourceSha256: string;
  state: "question" | "capture" | "manual" | "review" | "paused" | "ready_to_complete" | "complete";
  next: WattzunFormGuideQuestion | null;
  counts: { visible: number; answered: number; unanswered: number; evidenceMissing: number; manualMissing: number; skipped: number };
  skippedFieldKeys: string[];
  completion: { ready: boolean; missing: string[]; status: string };
  receipt?: WattzunWorkflowReceipt;
  productSearch?: WattzunFormProductSearch;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9:_-]{1,180}$/;
const key = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 600 && !/[\u0000-\u001f\u007f]/.test(value) && !/(?:^|[.[\]])(?:__proto__|constructor|prototype)(?:$|[.[\]])/.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(key) && new Set(value).size === value.length;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
export const WATTZUN_FORM_GUIDE_CONTROL_SCHEMA = {
  type: "object", additionalProperties: false, required: ["kind", "command", "fieldKey"],
  properties: { kind: { type: "string", enum: ["form_guide_control"] }, command: { type: "string", enum: ["skip", "repeat", "pause", "resume", "complete"] }, fieldKey: { type: "string", maxLength: 600 } },
};
export function readWattzunFormGuideInput(value: unknown): WattzunFormGuideInput | null {
  if (!record(value) || Object.keys(value).some(item => !["sessionId", "stage", "authorization", "sourceSha256", "questionKey", "skippedFieldKeys", "pendingRequestId", "paused", "productSearch"].includes(item))
    || typeof value.sessionId !== "string" || !UUID.test(value.sessionId) || (value.stage !== "start" && value.stage !== "continue" && value.stage !== "resume")
    || value.authorization !== "ordinary_form_answers" || !keys(value.skippedFieldKeys)
    || value.sourceSha256 !== undefined && (typeof value.sourceSha256 !== "string" || !SHA.test(value.sourceSha256))
    || value.questionKey !== undefined && value.questionKey !== "" && !key(value.questionKey)
    || value.pendingRequestId !== undefined && (typeof value.pendingRequestId !== "string" || !/^[A-Za-z0-9_-]{16,180}$/.test(value.pendingRequestId))
    || value.paused !== undefined && typeof value.paused !== "boolean"
    || value.productSearch !== undefined && !readWattzunFormProductSearch(value.productSearch)
    || value.stage === "continue" && (value.sourceSha256 === undefined || typeof value.questionKey !== "string")) return null;
  const productSearch = readWattzunFormProductSearch(value.productSearch);
  return { sessionId: value.sessionId, stage: value.stage, authorization: value.authorization, skippedFieldKeys: [...value.skippedFieldKeys], ...(productSearch ? { productSearch } : {}),
    ...(typeof value.sourceSha256 === "string" ? { sourceSha256: value.sourceSha256 } : {}), ...(typeof value.questionKey === "string" ? { questionKey: value.questionKey } : {}),
    ...(typeof value.pendingRequestId === "string" ? { pendingRequestId: value.pendingRequestId } : {}), ...(typeof value.paused === "boolean" ? { paused: value.paused } : {}) };
}
export function readWattzunFormGuideControl(value: unknown): WattzunFormGuideControl | null {
  if (!record(value) || Object.keys(value).length !== 3 || value.kind !== "form_guide_control" || (value.command !== "skip" && value.command !== "repeat" && value.command !== "pause" && value.command !== "resume" && value.command !== "complete")
    || !(value.fieldKey === "" || key(value.fieldKey)) || ["skip", "repeat"].includes(String(value.command)) && !key(value.fieldKey)) return null;
  return { kind: value.kind, command: value.command, fieldKey: value.fieldKey };
}
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function question(value: unknown): WattzunFormGuideQuestion | null {
  if (!record(value) || (value.kind !== "question" && value.kind !== "capture" && value.kind !== "manual") || !key(value.fieldKey) || !text(value.label, 500) || !text(value.type, 60)
    || value.reason !== undefined && !text(value.reason, 1000) || !Array.isArray(value.options) || value.options.length > 100) return null;
  const options: WattzunFormGuideQuestion["options"] = [];
  for (const option of value.options) {
    if (!record(option) || !text(option.value, 2000) || !text(option.label, 240)) return null;
    options.push({ value: option.value, label: option.label });
  }
  let capture: WattzunFormGuideQuestion["capture"];
  if (value.kind === "capture") {
    const item = value.capture;
    if (!record(item) || !count(item.minimumCount) || !count(item.maximumCount) || !count(item.savedCount) || item.maximumCount < item.minimumCount
      || typeof item.gpsRequired !== "boolean" || typeof item.captureTimeRequired !== "boolean" || typeof item.metadataRequired !== "boolean" || typeof item.originalRequired !== "boolean"
      || !Array.isArray(item.allowedContentTypes) || item.allowedContentTypes.length > 100 || !item.allowedContentTypes.every(type => text(type, 120))) return null;
    capture = { minimumCount: item.minimumCount, maximumCount: item.maximumCount, savedCount: item.savedCount, allowedContentTypes: [...item.allowedContentTypes], gpsRequired: item.gpsRequired, captureTimeRequired: item.captureTimeRequired, metadataRequired: item.metadataRequired, originalRequired: item.originalRequired };
  } else if (value.capture !== undefined) return null;
  const step = readWattzunFormGuideStep(value.step);
  if (value.step !== undefined && (!step || value.kind !== "question" || step.kind !== value.type)) return null;
  return { kind: value.kind, fieldKey: value.fieldKey, label: value.label, type: value.type, options, ...(typeof value.reason === "string" ? { reason: value.reason } : {}), ...(capture ? { capture } : {}), ...(step ? { step } : {}) };
}
export function readWattzunFormGuideProgress(value: unknown): WattzunFormGuideProgress | null {
  if (!record(value) || typeof value.sessionId !== "string" || !UUID.test(value.sessionId) || typeof value.recordId !== "string" || !ID.test(value.recordId)
    || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.sourceSha256 !== "string" || !SHA.test(value.sourceSha256)
    || (value.state !== "question" && value.state !== "capture" && value.state !== "manual" && value.state !== "review" && value.state !== "paused" && value.state !== "ready_to_complete" && value.state !== "complete") || !keys(value.skippedFieldKeys)
    || !record(value.counts)
    || !record(value.completion) || typeof value.completion.ready !== "boolean" || !text(value.completion.status, 100) || !Array.isArray(value.completion.missing) || value.completion.missing.length > 1000 || !value.completion.missing.every(item => text(item, 1000))) return null;
  const reference = readWattzunWorkReference(value.reference, "trade"), requestedReference = readWattzunWorkReference(value.requestedReference, "trade");
  if (reference?.kind !== "trade_form" || requestedReference?.kind !== "trade_form" || reference.formKind !== requestedReference.formKind || reference.jobId !== requestedReference.jobId || reference.recordId !== value.recordId
    || reference.formKind !== "work_pack" && reference.recordId !== requestedReference.recordId) return null;
  const counts = value.counts;
  if (!count(counts.visible) || !count(counts.answered) || !count(counts.unanswered) || !count(counts.evidenceMissing) || !count(counts.manualMissing) || !count(counts.skipped)
    || counts.visible !== counts.answered + counts.unanswered || counts.skipped !== value.skippedFieldKeys.length) return null;
  const next = value.next === null ? null : question(value.next);
  if (value.next !== null && next === null || ["question", "capture", "manual"].includes(value.state) && next?.kind !== value.state
    || ["review", "paused", "ready_to_complete", "complete"].includes(value.state) && next !== null
    || next?.kind === "capture" && (!["work_pack", "veu_electrical"].includes(reference.formKind) || next.type !== "photo")
    || value.state === "ready_to_complete" && !value.completion.ready) return null;
  let receipt: WattzunWorkflowReceipt | undefined;
  if (value.receipt !== undefined) {
    const result = { state: "complete", receipt: value.receipt };
    if (!isWattzunWorkflowResult(result) || result.state !== "complete" || !["fill_form", "complete_form", "form_step"].includes(result.receipt.kind) || result.receipt.id !== reference.recordId) return null;
    const item = result.receipt;
    if (item.href !== `/direct-trade/${item.href.startsWith("/direct-trade/dashboard?") ? "dashboard" : "team"}?workspace=work&jobId=${encodeURIComponent(reference.jobId)}&jobTab=files`) return null;
    receipt = { kind: item.kind, id: item.id, label: item.label, href: item.href, status: item.status, message: item.message };
  }
  if (value.state === "complete" && (!receipt || receipt.kind !== "complete_form" || receipt.status !== "submitted"
    || value.completion.status !== (["job_form", "veu_electrical"].includes(reference.formKind) ? "complete" : reference.formKind === "activity_form" ? "submitted_for_creditex_review" : "completed"))) return null;
  const productSearch = readWattzunFormProductSearch(value.productSearch);
  if (value.productSearch !== undefined && !productSearch) return null;
  return { sessionId: value.sessionId, reference, requestedReference, recordId: value.recordId, revision: value.revision, sourceSha256: value.sourceSha256, state: value.state, next, ...(productSearch ? { productSearch } : {}),
    counts: { visible: counts.visible, answered: counts.answered, unanswered: counts.unanswered, evidenceMissing: counts.evidenceMissing, manualMissing: counts.manualMissing, skipped: counts.skipped },
    skippedFieldKeys: [...value.skippedFieldKeys], completion: { ready: value.completion.ready, missing: [...value.completion.missing], status: value.completion.status }, ...(receipt ? { receipt } : {}) };
}

/** Narration comes from current saved schema/progress, never invented provider state. */
export function wattzunFormGuideNarration(guide: WattzunFormGuideProgress): string {
  if (guide.state === "complete") return guide.receipt?.message ?? "The form's completed record is available.";
  if (guide.state === "paused") return "I've paused the form questions. Your saved answers are kept. Tell me when you'd like to continue.";
  if (guide.state === "ready_to_complete") return "All required items are satisfied. Would you like me to complete this form now?";
  if (guide.next?.kind === "question") {
    const step = guide.next.step;
    if (step?.kind === "reference_document") return `Have you personally ${step.mode === "confirmed" ? "read and understood" : "read"} ${step.title}, reviewed its acknowledgement on screen, and do you confirm it?`;
    if (step?.kind === "official_product") return step.choices.length
      ? `I found ${step.choices.length} matching ${step.choices.length === 1 ? "product" : "products"}${step.truncated ? " in this first set" : ""}: ${step.choices.map((item, index) => `${index + 1}, ${item.label}`).join("; ")}. Which exact product did you install?`
      : "What brand and model should I look up in the approved product register?";
    if (step?.kind === "scenario") return `Which approved scenario applies? ${step.scenarioCodes.join(", ")}.`;
    if (step?.kind === "calculator") return "The saved inputs can be sent to the governed calculator. Its result will still need independent Creditex review. Would you like me to run it?";
    if (step?.kind === "prepare_signing") return "The required answers and evidence are saved. Would you like me to prepare this exact record for its required signatures?";
    const options = guide.next.options.length > 0 && guide.next.options.length <= 6 ? ` The options are ${guide.next.options.map(item => item.label).join(", ")}.` : "";
    return `${guide.next.label}${/[?.!]$/.test(guide.next.label) ? "" : "?"}${options}`;
  }
  if (guide.next?.kind === "capture") return `Next, ${guide.next.label}. Use the camera button to capture the required photo${guide.next.capture && guide.next.capture.minimumCount > 1 ? "s" : ""}. I'll continue after the upload is saved.`;
  if (guide.next?.kind === "manual") return guide.next.type === "signature" ? "Please review and sign the required form on screen. I'll continue once the signature is saved."
    : guide.next.type === "declaration" ? "Please review and confirm the declaration on screen. I'll continue once it is saved."
      : `${guide.next.label}. ${guide.next.reason ?? "This needs its existing form control."} You can say skip to continue with the remaining questions.`;
  return guide.completion.missing.length ? `The answers are saved. Before completion, ${guide.completion.missing[0]}. You can return to a skipped question or open that form control.` : "The saved form is ready for its remaining review.";
}
