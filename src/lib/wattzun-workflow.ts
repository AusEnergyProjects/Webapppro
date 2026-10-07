import type { WattzunActionLine } from "./wattzun-actions";
import { PRICE_BOOK_ITEM_TYPES, PRICE_BOOK_UNITS } from "./trade-price-book.ts";

export type WattzunWorkflowProposal =
  | { kind: "add_price_book_item"; name: string; description: string; itemType: string | null; unitLabel: string | null; unitPrice: string | null; supplierCost: string | null; taxCode: "gst" | "none" | null }
  | { kind: "customer_message"; jobQuery: string; jobId: string; channel: "sms" | "email" | null; subject: string; body: string }
  | { kind: "invoice_reminder"; jobQuery: string; jobId: string; invoiceId: string; channel: "sms" | "email" | null; body: string }
  | { kind: "draft_job_quote"; jobQuery: string; jobId: string; mode: "append" | "replace"; description: string; lines: WattzunActionLine[] }
  | { kind: "fill_form"; jobQuery: string; jobId: string; formKind: "job_form" | "activity_form" | "work_pack"; formId: string; answers: Array<{ fieldKey: string; value: string | number | boolean }> }
  | { kind: "confirm_workflow"; reviewId: string };
export type WattzunWorkflowOperation = Exclude<WattzunWorkflowProposal, { kind: "confirm_workflow" }>;
export type WattzunWorkflowJobChoice = { jobId: string; workNumber: string; title: string; customerName: string; address: string; scheduledAt: string; completedAt: string };
export type WattzunWorkflowReview = {
  state: "review"; reviewId: string; expiresAt: string; kind: WattzunWorkflowOperation["kind"];
  heading: string; summary: string; confirmationLabel: string; lines: Array<{ label: string; value: string }>;
  preview?: { subject: string; body: string }; target?: WattzunWorkflowJobChoice; href?: string;
};
export type WattzunWorkflowReceipt = { kind: WattzunWorkflowOperation["kind"]; id: string; label: string; href: string; status: "saved" | "submitted" | "delivered" | "queued" | "failed" | "unknown"; message: string };
export type WattzunWorkflowResult = WattzunWorkflowReview
  | { state: "choose_job"; proposal: WattzunWorkflowOperation; question: string; choices: WattzunWorkflowJobChoice[] }
  | { state: "needs_details"; questions: string[] }
  | { state: "complete"; receipt: WattzunWorkflowReceipt };
export type WattzunWorkflowRequest =
  | { stage: "prepare"; portal: "trade"; scopeId: string; requestId: string; proposal: WattzunWorkflowOperation }
  | { stage: "execute"; portal: "trade"; scopeId: string; requestId: string; reviewId: string; reviewed: true };

const string = (maxLength: number) => ({ type: "string", maxLength });
const nullable = (maxLength: number) => ({ type: ["string", "null"], maxLength });
const channel = { type: ["string", "null"], enum: ["sms", "email", null] };
const tax = { type: ["string", "null"], enum: ["gst", "none", null] };
function schema(kind: WattzunWorkflowProposal["kind"], fields: Record<string, object>) {
  return { type: "object", additionalProperties: false, required: ["kind", ...Object.keys(fields)], properties: { kind: { type: "string", enum: [kind] }, ...fields } };
}
export const WATTZUN_WORKFLOW_PROPOSAL_SCHEMAS = [
  schema("add_price_book_item", { name: string(160), description: string(1000), itemType: { type: ["string", "null"], enum: [...PRICE_BOOK_ITEM_TYPES, null] }, unitLabel: { type: ["string", "null"], enum: [...PRICE_BOOK_UNITS.map(([value]) => value), null] }, unitPrice: nullable(20), supplierCost: nullable(20), taxCode: tax }),
  schema("customer_message", { jobQuery: string(300), jobId: string(180), channel, subject: string(180), body: string(2000) }),
  schema("invoice_reminder", { jobQuery: string(300), jobId: string(180), invoiceId: string(180), channel, body: string(1000) }),
  schema("draft_job_quote", { jobQuery: string(300), jobId: string(180), mode: { type: "string", enum: ["append", "replace"] }, description: string(1000), lines: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false, required: ["lineType", "description", "quantity", "unitPrice", "taxCode"], properties: { lineType: { type: "string", enum: ["product", "labour"] }, description: string(160), quantity: nullable(20), unitPrice: nullable(20), taxCode: tax } } } }),
  schema("confirm_workflow", { reviewId: string(180) }),
  schema("fill_form", { jobQuery: string(300), jobId: string(180), formKind: { type: "string", enum: ["job_form", "activity_form", "work_pack"] }, formId: string(180), answers: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["fieldKey", "value"], properties: { fieldKey: string(240), value: { anyOf: [string(2000), { type: "number" }, { type: "boolean" }] } } } } }),
];
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value); }
function decimal(value: unknown): value is string | null { return value === null || typeof value === "string" && /^(?:\d{1,9})(?:\.\d{1,3})?$/.test(value); }
function nullableText(value: unknown, max: number): value is string | null { return value === null || text(value, max); }
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
export function isWattzunWorkflowProposal(value: unknown): value is WattzunWorkflowProposal {
  if (!record(value)) return false;
  if (value.kind === "confirm_workflow") return exact(value, ["kind", "reviewId"]) && text(value.reviewId, 180) && /^[A-Za-z0-9:_-]{16,180}$/.test(value.reviewId);
  if (value.kind === "add_price_book_item") return exact(value, ["kind", "name", "description", "itemType", "unitLabel", "unitPrice", "supplierCost", "taxCode"]) && text(value.name, 160) && text(value.description, 1000) && nullableText(value.itemType, 30) && nullableText(value.unitLabel, 30) && decimal(value.unitPrice) && decimal(value.supplierCost) && (value.taxCode === null || value.taxCode === "gst" || value.taxCode === "none");
  if (!text(value.jobQuery, 300) || !text(value.jobId, 180) || value.jobId && !/^[A-Za-z0-9:_-]{1,180}$/.test(value.jobId)) return false;
  if (value.kind === "fill_form") return exact(value, ["kind", "jobQuery", "jobId", "formKind", "formId", "answers"])
    && Boolean(value.jobId) && (value.formKind === "job_form" || value.formKind === "activity_form" || value.formKind === "work_pack")
    && text(value.formId, 180) && /^[A-Za-z0-9:_-]{1,180}$/.test(value.formId)
    && Array.isArray(value.answers) && value.answers.length > 0 && value.answers.length <= 20
    && value.answers.every(answer => record(answer) && exact(answer, ["fieldKey", "value"]) && text(answer.fieldKey, 240)
      && /^[A-Za-z0-9:_./\[\]-]{1,240}$/.test(answer.fieldKey) && !answer.fieldKey.split(/[.:/\[\]]/).some(part => ["__proto__", "constructor", "prototype"].includes(part))
      && (text(answer.value, 2000) || typeof answer.value === "boolean" || typeof answer.value === "number" && Number.isFinite(answer.value)))
    && new Set(value.answers.map(answer => answer.fieldKey)).size === value.answers.length;
  if (value.kind === "customer_message") return exact(value, ["kind", "jobQuery", "jobId", "channel", "subject", "body"]) && (value.channel === null || value.channel === "sms" || value.channel === "email") && text(value.subject, 180) && text(value.body, 2000);
  if (value.kind === "invoice_reminder") return exact(value, ["kind", "jobQuery", "jobId", "invoiceId", "channel", "body"]) && text(value.invoiceId, 180) && (value.channel === null || value.channel === "sms" || value.channel === "email") && text(value.body, 1000);
  if (value.kind === "draft_job_quote") return exact(value, ["kind", "jobQuery", "jobId", "mode", "description", "lines"]) && (value.mode === "append" || value.mode === "replace") && text(value.description, 1000) && Array.isArray(value.lines) && value.lines.length <= 10 && value.lines.every(line => record(line) && exact(line, ["lineType", "description", "quantity", "unitPrice", "taxCode"]) && (line.lineType === "product" || line.lineType === "labour") && text(line.description, 160) && decimal(line.quantity) && decimal(line.unitPrice) && (line.taxCode === null || line.taxCode === "gst" || line.taxCode === "none"));
  return false;
}
export function parseWattzunWorkflowProposal(value: unknown): WattzunWorkflowProposal {
  if (!isWattzunWorkflowProposal(value)) throw new Error("The workflow request could not be read. Ask Wattzun to prepare it again.");
  return value;
}
export function isWattzunWorkflowJobChoice(value: unknown): value is WattzunWorkflowJobChoice {
  return record(value) && exact(value, ["jobId", "workNumber", "title", "customerName", "address", "scheduledAt", "completedAt"]) && text(value.jobId, 180) && /^[A-Za-z0-9:_-]{1,180}$/.test(value.jobId) && text(value.workNumber, 100) && text(value.title, 300) && text(value.customerName, 180) && text(value.address, 400) && text(value.scheduledAt, 50) && text(value.completedAt, 50);
}
const kinds = ["add_price_book_item", "customer_message", "invoice_reminder", "draft_job_quote", "fill_form"];
function safeHref(value: unknown): value is string { return text(value, 2000) && /^\/direct-trade\/(?:dashboard|team)\?(?!.*(?:[\r\n\\]|\/\/))/.test(value); }
export function isWattzunWorkflowResult(value: unknown): value is WattzunWorkflowResult {
  if (!record(value)) return false;
  if (value.state === "needs_details") return exact(value, ["state", "questions"]) && Array.isArray(value.questions) && value.questions.length > 0 && value.questions.length <= 5 && value.questions.every(q => text(q, 500) && q.trim());
  if (value.state === "choose_job") return exact(value, ["state", "proposal", "question", "choices"]) && isWattzunWorkflowProposal(value.proposal) && value.proposal.kind !== "confirm_workflow" && text(value.question, 1000) && Array.isArray(value.choices) && value.choices.length <= 5 && value.choices.every(isWattzunWorkflowJobChoice);
  if (value.state === "review") return Object.keys(value).every(k => ["state", "reviewId", "expiresAt", "kind", "heading", "summary", "confirmationLabel", "lines", "preview", "target", "href"].includes(k)) && text(value.reviewId, 180) && /^[A-Za-z0-9:_-]{16,180}$/.test(value.reviewId) && text(value.expiresAt, 50) && kinds.includes(String(value.kind)) && text(value.heading, 180) && text(value.summary, 1500) && text(value.confirmationLabel, 100) && Array.isArray(value.lines) && value.lines.length <= 40 && value.lines.every(l => record(l) && exact(l, ["label", "value"]) && text(l.label, 180) && text(l.value, 2000)) && (value.preview === undefined || record(value.preview) && exact(value.preview, ["subject", "body"]) && text(value.preview.subject, 180) && text(value.preview.body, 4000)) && (value.target === undefined || isWattzunWorkflowJobChoice(value.target)) && (value.href === undefined || safeHref(value.href));
  if (value.state === "complete") return exact(value, ["state", "receipt"]) && record(value.receipt) && exact(value.receipt, ["kind", "id", "label", "href", "status", "message"]) && kinds.includes(String(value.receipt.kind)) && text(value.receipt.id, 180) && text(value.receipt.label, 180) && safeHref(value.receipt.href) && ["saved", "submitted", "delivered", "queued", "failed", "unknown"].includes(String(value.receipt.status)) && text(value.receipt.message, 1500);
  return false;
}
