"use client";

import type { QuoteProductDocumentSummary } from "@/lib/trade-quote-product-documents";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import "./TradeRebateDocumentActions.css";
import type { User } from "firebase/auth";
import {
  calculateTradeQuoteLine,
  consolidateTradeQuotePercentDiscountLines,
  moveTradeQuoteLine,
  normaliseTradeQuoteLineGroup,
  overallTradeQuoteDiscountKind,
  percentInputToQuantity,
  persistedOverallDiscountUnitPrice,
  quantityToPercentInput,
  dollarsToCents,
  quantityToMilli,
  tradeQuoteChoiceValidationIssue,
  tradeQuoteLineValidationIssues,
  OVERALL_FIXED_DISCOUNT_SECTION,
  OVERALL_PERCENT_DISCOUNT_SECTION,
  type TradeQuoteChoiceValidationIssue,
  type TradeQuoteLineValidationField,
  type TradeQuoteLineValidationIssue,
} from "@/lib/trade-quote";
import { tradeQuoteDocumentDisplayTotals } from "@/lib/trade-quote-document-totals.mjs";
import { canApplyMapQuoteIntent, mapQuoteKind, mapQuoteLine, mapQuoteMeasuredContext, mapQuoteSetItemPricing, mapQuoteSystemPanels, mapQuoteUnitMatches, MAP_QUOTE_UNITS, type MapQuoteIntent } from "@/lib/trade-map-quote";
import { TradeQuoteLivePreview } from "./TradeQuoteLivePreview";
import { TradeSolarEquipmentList } from "./TradeSolarEquipmentPicker";
import { normaliseQuoteEquipment, type QuoteEquipment } from "@/lib/trade-quote-equipment";
import { solarQuotePackages } from "@/lib/trade-solar-quote-packages";
import previewStyles from "./TradeQuoteLivePreview.module.css";
import {
  clearTradeRebateEstimateDraft,
  loadTradeRebateEstimateDraft,
  type TradeRebateEstimateDraft,
} from "@/lib/trade-rebate-draft";

export type QuoteLine = { id?: string; priceBookItemId?: string; jobPacketId?: string; jobPacketLineId?: string; lineType: string; description: string; quantity: string; unitPrice: string; taxCode: string; sectionHeading: string; totalCents?: number };
type SavedLine = { id: string; priceBookItemId: string; jobPacketId: string; jobPacketLineId: string; lineType: string; description: string; quantityMilli: number; unitPriceCents: number; taxCode: string; sectionHeading: string; totalCents: number };
type PriceBookItem = { id: string; itemCode: string; name: string; description: string; itemType: string; lineType: string; unitLabel: string; unitCostCentsExGst: number; sellPriceCentsExGst: number; taxCode: string };
type JobPacket = { id: string; packetCode: string; name: string; revision: number; suggestedCrewSize: number; taskCount: number; formCount: number; activeCrewCount: number; crewReady: boolean; unavailableItemCount: number; canApply: boolean; summary: { sellCentsExGst: number; estimatedDurationMinutes: number }; lines: Array<{ id: string; priceBookItemId: string; name: string; lineType: string; quantityMilli: number; sellPriceCentsExGst: number; taxCode: string }> };
export type QuoteChoice = { id?: string; clientKey: string; kind: "package" | "addon" | "choose_one"; groupKey: string; name: string; summary: string; recommended: boolean; subtotalCents?: number; taxCents?: number; totalCents?: number; lines: QuoteLine[] };
type SavedChoice = Omit<QuoteChoice, "lines"> & { id: string; items: SavedLine[]; subtotalCents: number; taxCents: number; totalCents: number };
export type QuoteRoofImage = { dataUrl: string } | { versionId: string; sha256: string };
type QuoteVersion = { productDocuments?: QuoteProductDocumentSummary[]; equipment?: QuoteEquipment; designId?: string; roofImage?: { contentType: "image/png"; width: number; height: number; sha256: string } | null; id: string; versionNumber: number; status: string; customerEmail: string; subtotalCents: number; taxCents: number; totalCents: number; terms: string; customerMessage: string; validUntil: string; consentStatement: string; issuedAt: string; items: SavedLine[]; choices: SavedChoice[]; internalSummary?: { costCentsExGst: number; sellCentsExGst: number; marginCentsExGst: number }; acceptance: null | { decision: string; actorEmail: string; actorType: string; signerName: string; decidedAt: string; consentStatement: string; selectionSummary: string; selectedTotalCents: number } };
type QuoteDelivery = { id: string; channel: string; status: string; recipientPreview: string; sentAt: string; deliveredAt: string; createdAt: string; nextAttemptAt?: string; presentation?: { key: "sending" | "accepted" | "delivered" | "attention"; label: string; canRetry: boolean } };
type QuoteDeliveryStatus = Pick<QuoteDelivery, "id" | "status" | "presentation"> & { attempts?: number; nextAttemptAt?: string; updatedAt?: string };
type Quote = { id: string; quoteNumber: string; currentVersionNumber: number; status: string; versions: QuoteVersion[];
  editableDraft: null | { id: string; versionNumber: number; updatedAt: string };
  link: null | { id: string; status: string; expiresAt: string; tokenIssue: number; shareUrl: string; pdfUrl: string; recipientPreview: string };
  timeline: Array<{ type: string; actorType: string; summary: string; occurredAt: string }>;
  questions: Array<{ id: string; question: string; answer: string; status: string; askedAt: string; answeredAt: string }>;
  deliveries: QuoteDelivery[] };
export type QuoteJob = { customerId: string; customerNumber: string; customerName: string; workNumber: string; title: string; siteLabel: string; siteSummary: string; enquiryReference: string; enquiryServices: string[]; enquiryBrief: string; publicLead: boolean };
export type QuoteBusiness = { businessName: string; quoteEmailSubjectTemplate: string; quoteEmailIntro: string; quoteDefaultTerms: string; brandThemeKey: string; brandBorderStyle: string; hasLogo: boolean };
type QuoteResult = { ok?: boolean; revoked?: boolean; authorisedEmails?: string[]; priceBookItems?: PriceBookItem[]; jobPackets?: JobPacket[]; quote?: Quote | null; job?: QuoteJob; business?: QuoteBusiness; delivery?: QuoteDeliveryStatus | null; draftVersionId?: string; draftVersionNumber?: number; access?: { canManageQuotes?: boolean; canSendQuotes?: boolean; canManageCustomers?: boolean; canViewPriceBook?: boolean; canApplyDiscounts?: boolean }; error?: string; errorCode?: string; requestId?: string };
type AcceptedQuotePhoto = { id: string; label: string; contentType: string; sizeBytes: number; serviceCategories: string[]; privacyStatus: string; acceptedAt: string; contentUrl: string };
type AcceptedQuotePhotoResult = { ok?: boolean; acceptedPhotos?: AcceptedQuotePhoto[]; error?: string };
type QuotePreviewLine = { description: string; sectionHeading: string; quantityMilli: number; unitPriceCents: number; taxCode: string; subtotalCents: number; taxCents: number; totalCents: number };
type QuotePreviewGroup = { lines: QuotePreviewLine[]; subtotalCents: number; taxCents: number; totalCents: number };
type QuoteDeliveryPreview = { quoteNumber: string; versionNumber: number | null; subject: string; attachmentName: string; identityKnown: boolean };
type QuoteSendPreview = {
  expectedUpdatedAt: string;
  base: QuotePreviewGroup;
  choices: Array<{
    selectionId: string;
    clientKey: string;
    kind: QuoteChoice["kind"];
    groupKey: string;
    name: string;
    summary: string;
    recommended: boolean;
    totals: QuotePreviewGroup;
  }>;
  displayTotals: ReturnType<typeof tradeQuoteDocumentDisplayTotals>;
  delivery: QuoteDeliveryPreview;
};
type QuoteSendOutcome = { kind: "idle" | "sending" | "success" | "attention" | "error"; message: string };
type DraggedQuoteLine = { scopeKey: string; index: number };
type QuoteEditorValidationIssue = (TradeQuoteLineValidationIssue & { kind: "line"; scopeKey: string }) |
  (TradeQuoteChoiceValidationIssue & { kind: "choice"; lineIndex: -1 });

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const blankLine = (): QuoteLine => ({ lineType: "product", description: "", quantity: "1", unitPrice: "0.00", taxCode: "gst", sectionHeading: "Included work" });
const appendBeforeFinalPercent = (lines: QuoteLine[], line: QuoteLine) => {
  const percentIndex = lines.findIndex((candidate) => overallTradeQuoteDiscountKind(candidate) === "percent");
  return percentIndex < 0 ? [...lines, line] : [...lines.slice(0, percentIndex), line, ...lines.slice(percentIndex)];
};
const editLine = (line: SavedLine, activeIds: Set<string>): QuoteLine => {
  return { ...line, priceBookItemId: activeIds.has(line.priceBookItemId) ? line.priceBookItemId : "",
    quantity: (line.quantityMilli / 1000).toString(), unitPrice: persistedOverallDiscountUnitPrice(line) };
};
const choiceKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
type QuoteDraft = { equipment: QuoteEquipment; designId: string; roofImage: QuoteRoofImage | null; lines: QuoteLine[]; choices: QuoteChoice[]; customerEmail: string; terms: string; customerMessage: string; validUntil: string };

function draftFingerprint(draft: QuoteDraft, saveAsBusinessDefault = false) {
  const lineValues = (line: QuoteLine) => ({ priceBookItemId: line.priceBookItemId || "", jobPacketId: line.jobPacketId || "", jobPacketLineId: line.jobPacketLineId || "",
    lineType: line.lineType, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, taxCode: line.taxCode, sectionHeading: line.sectionHeading });
  return JSON.stringify({ customerEmail: draft.customerEmail, terms: draft.terms, customerMessage: draft.customerMessage, validUntil: draft.validUntil,
    roofImage: draft.roofImage, designId: draft.designId, equipment: draft.equipment, lines: draft.lines.map(lineValues), choices: draft.choices.map((choice) => ({
    kind: choice.kind, groupKey: choice.groupKey, name: choice.name, summary: choice.summary, recommended: choice.recommended, lines: choice.lines.map(lineValues),
  })), saveAsBusinessDefault });
}

function resultDraft(result: QuoteResult): QuoteDraft {
  const current = result.quote?.editableDraft
    ? result.quote.versions.find((version) => version.id === result.quote?.editableDraft?.id)
    : result.quote?.versions.find((version) => version.versionNumber === result.quote?.currentVersionNumber);
  const activeIds = new Set((result.priceBookItems || []).map((item) => item.id));
  const currentLines = current ? consolidateTradeQuotePercentDiscountLines(current.items.map((line) => editLine(line, activeIds))) : [];
  return {
    lines: currentLines.length ? currentLines : [blankLine()],
    choices: current?.choices.map((choice) => ({ ...choice, lines: choice.items.map((line) => editLine(line, activeIds)) })) || [],
    customerEmail: current?.customerEmail || result.authorisedEmails?.[0] || "",
    terms: current ? current.terms : result.business?.quoteDefaultTerms || "",
    customerMessage: current ? current.customerMessage || "" : result.business?.quoteEmailIntro || "",
    validUntil: current?.validUntil || "",
    equipment: normaliseQuoteEquipment(current?.equipment),
    designId: current?.designId || "",
    roofImage: current?.roofImage ? { versionId: current.id, sha256: current.roofImage.sha256 } : null,
  };
}

function appendMapQuoteIntent(lines: QuoteLine[], intent: MapQuoteIntent) {
  const withoutBlank = lines.filter((line) => !(line.lineType === "product" && !line.id && !line.priceBookItemId && !line.jobPacketId
    && !line.description.trim() && line.quantity === "1" && line.unitPrice === "0.00" && line.sectionHeading === "Included work"));
  return appendBeforeFinalPercent(withoutBlank, mapQuoteLine(intent.measurement));
}

function cleanDeliveryText(value: unknown, maximum = 2_000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function subjectPreview(template: string, values: { businessName: string; customerName: string; quoteNumber: string; workTitle: string }) {
  const normalised = {
    businessName: cleanDeliveryText(values.businessName, 240),
    customerName: cleanDeliveryText(values.customerName, 240),
    quoteNumber: cleanDeliveryText(values.quoteNumber, 120),
    workTitle: cleanDeliveryText(values.workTitle, 300),
  };
  const replacements: Record<string, string> = {
    business_name: normalised.businessName,
    quote_number: normalised.quoteNumber,
    customer_name: normalised.customerName,
    work_title: normalised.workTitle,
  };
  let subject = cleanDeliveryText(template, 240);
  for (const [key, value] of Object.entries(replacements)) {
    subject = subject.replaceAll(`{${key}}`, cleanDeliveryText(value, 120));
  }
  subject = cleanDeliveryText(subject, 180);
  if (!subject) subject = `${normalised.businessName} sent quote ${normalised.quoteNumber}`;
  if (!subject.toLocaleLowerCase("en-AU").includes(normalised.businessName.toLocaleLowerCase("en-AU"))) {
    subject = `${normalised.businessName}: ${subject}`.slice(0, 180);
  }
  if (!subject.includes(normalised.quoteNumber)) subject = `${subject} | ${normalised.quoteNumber}`.slice(0, 180);
  return subject;
}

function quotePdfFilename(quoteNumber: string, versionNumber: number) {
  const number = quoteNumber
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "quote";
  return `${number}-v${Math.max(1, Number(versionNumber) || 1)}.pdf`;
}

function nextQuoteIdentity(quote: Quote | null, job: QuoteJob | null) {
  if (!quote) {
    if (!job?.workNumber) return null;
    const quoteNumber = cleanDeliveryText(`Q-${job.workNumber.replace(/^JOB-/, "")}`, 120);
    return quoteNumber ? { quoteNumber, versionNumber: 1 } : null;
  }
  const current = quote.editableDraft
    ? quote.versions.find((version) => version.id === quote.editableDraft?.id)
    : quote.versions.find((version) => version.versionNumber === quote.currentVersionNumber);
  const quoteNumber = cleanDeliveryText(quote.quoteNumber, 120);
  if (!quoteNumber || !current) return null;
  return {
    quoteNumber,
    versionNumber: current.status === "draft" ? current.versionNumber : quote.currentVersionNumber + 1,
  };
}

function previewGroup(lines: QuoteLine[], allowEmpty = false): QuotePreviewGroup {
  const calculated = normaliseTradeQuoteLineGroup(lines, (value) => String(value || "").trim().slice(0, 500), allowEmpty);
  return { ...calculated, lines: calculated.lines.map((line, index) => ({ ...line, sectionHeading: lines[index]?.sectionHeading || "Included work" })) };
}

function previewError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (["INVALID_LINES", "INVALID_QUANTITY", "INVALID_DECIMAL", "INVALID_MONEY", "INVALID_TAX", "INVALID_TOTAL"].includes(code)) return "Fix the highlighted quote field before previewing.";
  return error instanceof Error ? error.message : "The quote could not be previewed.";
}

function quoteDeliveryMessage(delivery: QuoteDeliveryStatus | null | undefined, prefix: string) {
  const label = cleanDeliveryText(delivery?.presentation?.label, 120);
  if (delivery?.presentation?.key === "sending") return `${prefix} ${label || "Email is sending automatically"}.`;
  if (delivery?.presentation?.key === "accepted") return `${prefix} ${label || "Email accepted for delivery"}.`;
  if (delivery?.presentation?.key === "delivered") return `${prefix} ${label || "Email delivered"}.`;
  if (delivery?.presentation?.key === "attention") return `${prefix} ${label || "Email delivery needs attention"}. Use Retry email below when available.`;
  return `${prefix} The server did not return an email delivery status. Check the delivery record before resending.`;
}

function quoteDeliveryOutcome(delivery: QuoteDeliveryStatus | null | undefined, prefix: string): QuoteSendOutcome {
  const key = delivery?.presentation?.key;
  return {
    kind: key === "sending" ? "sending" : key && key !== "attention" ? "success" : "attention",
    message: quoteDeliveryMessage(delivery, prefix),
  };
}

function liveQuoteSummary(lines: QuoteLine[], priceBookItems: PriceBookItem[]) {
  const validationIssue = tradeQuoteLineValidationIssues(lines, (value) => String(value || "").trim().slice(0, 500), true)[0] || null;
  if (validationIssue) {
    return { subtotalCents: 0, taxCents: 0, totalCents: 0, costCentsExGst: 0, marginCentsExGst: 0,
      error: validationIssue.message, validationIssue };
  }
  try {
    const totals = previewGroup(lines, true);
    const priceById = new Map(priceBookItems.map((item) => [item.id, item]));
    const costCentsExGst = lines.reduce((sum, line) => {
      const item = line.priceBookItemId ? priceById.get(line.priceBookItemId) : null;
      const quantity = Number(line.quantity);
      return item && Number.isFinite(quantity) && quantity > 0
        ? sum + Math.round(item.unitCostCentsExGst * quantity)
        : sum;
    }, 0);
    return { ...totals, costCentsExGst, marginCentsExGst: totals.subtotalCents - costCentsExGst, error: "", validationIssue: null };
  } catch (error) {
    return { subtotalCents: 0, taxCents: 0, totalCents: 0, costCentsExGst: 0, marginCentsExGst: 0,
      error: previewError(error), validationIssue: null };
  }
}

function firstQuoteEditorValidationIssue(lines: QuoteLine[], choices: QuoteChoice[], priceBookItems: PriceBookItem[]): QuoteEditorValidationIssue | null {
  for (const scope of [{ key: "base", lines }, ...choices.map((choice) => ({ key: choice.clientKey, lines: choice.lines }))]) {
    const lineIndex = scope.lines.findIndex((line) => {
      const kind = mapQuoteKind(line.sectionHeading), item = priceBookItems.find((candidate) => candidate.id === line.priceBookItemId);
      return kind && item && !mapQuoteUnitMatches(kind, item.unitLabel, line.sectionHeading);
    });
    if (lineIndex >= 0) return { kind: "line", scopeKey: scope.key, lineIndex, field: "lineType", code: "MAP_QUOTE_UNIT_MISMATCH",
      message: "Choose a price book rate with the same unit as the map quantity, or enter a custom rate." };
  }
  const cleanChoiceText = (value: unknown, maximum = 500) => String(value || "").trim().slice(0, maximum);
  const choiceIssue = tradeQuoteChoiceValidationIssue(choices, cleanChoiceText);
  if (choiceIssue) return { ...choiceIssue, kind: "choice", lineIndex: -1 };
  const baseIssue = tradeQuoteLineValidationIssues(
    lines,
    (value) => String(value || "").trim().slice(0, 500),
    choices.length > 0,
  )[0];
  if (baseIssue) return { ...baseIssue, kind: "line", scopeKey: "base" };
  for (const choice of choices) {
    const label = `${choice.name.trim() || "Customer choice"} item`;
    const choiceIssue = tradeQuoteLineValidationIssues(
      choice.lines,
      (value) => String(value || "").trim().slice(0, 500),
      false,
      label,
    )[0];
    if (choiceIssue) return { ...choiceIssue, kind: "line", scopeKey: choice.clientKey };
  }
  return null;
}

function liveOverallDiscountCents(lines: QuoteLine[]) {
  try {
    const totals = previewGroup(lines, true);
    const positiveOnly = previewGroup(lines.filter((line) => !overallTradeQuoteDiscountKind(line))
      .map((line) => Number(line.unitPrice) < 0 ? { ...line, unitPrice: "0" } : line), true);
    return Math.max(0, positiveOnly.totalCents - totals.totalCents);
  } catch { return 0; }
}

function packetLines(packet: JobPacket, sectionHeading: string): QuoteLine[] {
  return packet.lines.map((line) => ({ priceBookItemId: line.priceBookItemId, jobPacketId: packet.id, jobPacketLineId: line.id,
    lineType: line.lineType, description: line.name, quantity: (line.quantityMilli / 1000).toString(),
    unitPrice: (line.sellPriceCentsExGst / 100).toFixed(2), taxCode: line.taxCode, sectionHeading }));
}

export function TradeQuotePanel({ user, workOrderId, available, readOnly = false, canSend = true, onOpenPriceBook, onOpenCustomer, onScheduleJob, onChanged, mapQuoteIntent, onDraftDirtyChange, onBusyChange, showLivePreview = true }: { user: User; workOrderId: string; available: boolean; readOnly?: boolean; canSend?: boolean; onOpenPriceBook?: () => void; onOpenCustomer?: (customerId: string) => void; onScheduleJob?: () => void; onChanged?: () => void | Promise<void>; mapQuoteIntent?: MapQuoteIntent; onDraftDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; showLivePreview?: boolean }) {
  const [quote, setQuote] = useState<Quote | null>(null); const [emails, setEmails] = useState<string[]>([]);
  const [priceBookItems, setPriceBookItems] = useState<PriceBookItem[]>([]); const [jobPackets, setJobPackets] = useState<JobPacket[]>([]);
  const [lines, setLines] = useState<QuoteLine[]>([blankLine()]); const [choices, setChoices] = useState<QuoteChoice[]>([]); const [packetId, setPacketId] = useState("");
  const [jobSummary, setJobSummary] = useState<QuoteJob | null>(null); const [business, setBusiness] = useState<QuoteBusiness | null>(null);
  const [customerEmail, setCustomerEmail] = useState(""); const [terms, setTerms] = useState(""); const [customerMessage, setCustomerMessage] = useState(""); const [validUntil, setValidUntil] = useState("");
  const [equipment, setEquipment] = useState<QuoteEquipment>({ common: [], choices: [] });
  const [designId, setDesignId] = useState("");
  const [roofImage, setRoofImage] = useState<QuoteRoofImage | null>(null);
  const [saveAsBusinessDefault, setSaveAsBusinessDefault] = useState(false); const [addingRecipient, setAddingRecipient] = useState(false);
  const [recipientFirstName, setRecipientFirstName] = useState(""); const [recipientLastName, setRecipientLastName] = useState(""); const [recipientEmail, setRecipientEmail] = useState("");
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false); const [answer, setAnswer] = useState(""); const [answeringId, setAnsweringId] = useState("");
  const [sendPreview, setSendPreview] = useState<QuoteSendPreview | null>(null); const [sendConsent, setSendConsent] = useState(false);
  const [sendOutcome, setSendOutcome] = useState<QuoteSendOutcome>({ kind: "idle", message: "" });
  const [draggedQuoteLine, setDraggedQuoteLine] = useState<DraggedQuoteLine | null>(null);
  const [dragTargetQuoteLine, setDragTargetQuoteLine] = useState<DraggedQuoteLine | null>(null);
  const [pendingIssueVersionId, setPendingIssueVersionId] = useState("");
  const [rebateDraft, setRebateDraft] = useState<TradeRebateEstimateDraft | null>(null);
  const [canApplyDiscounts, setCanApplyDiscounts] = useState(false);
  const [serverCanManageQuotes, setServerCanManageQuotes] = useState(false);
  const [serverCanSendQuotes, setServerCanSendQuotes] = useState(false);
  const [serverCanManageCustomers, setServerCanManageCustomers] = useState(false);
  const [acceptedPhotos, setAcceptedPhotos] = useState<AcceptedQuotePhoto[]>([]);
  const [acceptedPhotoUrls, setAcceptedPhotoUrls] = useState<Record<string, string>>({});
  const [acceptedPhotoBusy, setAcceptedPhotoBusy] = useState(false);
  const [acceptedPhotoMessage, setAcceptedPhotoMessage] = useState("");
  const [acceptedPhotoPreview, setAcceptedPhotoPreview] = useState<null | { photo: AcceptedQuotePhoto; url: string; status: "loading" | "ready" | "error" }>(null);
  const [draftBaseline, setDraftBaseline] = useState<string | null>(null);
  const initialMapIntent = useRef(mapQuoteIntent);
  const consumedMapIntent = useRef("");
  const loadedIdentity = useRef("");
  const canEditQuote = !readOnly && serverCanManageQuotes;
  const canSendQuote = canEditQuote && canSend && serverCanSendQuotes;
  const liveSummary = useMemo(() => liveQuoteSummary(lines, priceBookItems), [lines, priceBookItems]);
  const liveDiscountCents = useMemo(() => liveOverallDiscountCents(lines), [lines]);
  const quoteValidationIssue = useMemo(() => firstQuoteEditorValidationIssue(lines, choices, priceBookItems), [choices, lines, priceBookItems]);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previewDialogRef = useRef<HTMLDialogElement | null>(null);
  const acceptedPhotoDialogRef = useRef<HTMLDivElement | null>(null);
  const acceptedPhotoCloseRef = useRef<HTMLButtonElement | null>(null);
  const acceptedPhotoOpenerRef = useRef<HTMLElement | null>(null);
  const fingerprint = draftFingerprint({ lines, choices, customerEmail, terms, customerMessage, validUntil, roofImage, equipment, designId }, saveAsBusinessDefault);
  const draftDirty = draftBaseline !== null && fingerprint !== draftBaseline || Boolean(recipientFirstName || recipientLastName || recipientEmail || answer);
  useEffect(() => { onDraftDirtyChange?.(draftDirty); }, [draftDirty, onDraftDirtyChange]);
  useEffect(() => { onBusyChange?.(Boolean(busy)); }, [busy, onBusyChange]);

  const request = useCallback(async (init: RequestInit = {}) => {
    const token = await user.getIdToken(); const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api/trade-quotes${init.method ? "" : `?workOrderId=${encodeURIComponent(workOrderId)}`}`, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as QuoteResult;
    if (!response.ok || result.ok === false) {
      const reference = cleanDeliveryText(result.requestId, 100);
      throw new Error(`${result.error || "The quote could not be loaded."}${reference ? ` Reference ${reference}.` : ""}`);
    }
    return result;
  }, [user, workOrderId]);

  const applyResult = useCallback((result: QuoteResult, mode: "metadata" | "load" | "saved" = "metadata") => {
    if (result.access) {
      setCanApplyDiscounts(result.access.canApplyDiscounts === true);
      setServerCanManageQuotes(result.access.canManageQuotes === true);
      setServerCanSendQuotes(result.access.canSendQuotes === true);
      setServerCanManageCustomers(result.access.canManageCustomers === true);
    }
    if (result.revoked) {
      setQuote((current) => current ? {
        ...current,
        link: current.link ? {
          ...current.link,
          status: "revoked",
          shareUrl: "",
          pdfUrl: "",
        } : null,
      } : current);
    } else if (result.quote !== undefined) setQuote(result.quote || null);
    if (result.authorisedEmails) setEmails(result.authorisedEmails);
    if (result.job) setJobSummary(result.job); if (result.business) setBusiness(result.business);
    if (result.priceBookItems) setPriceBookItems(result.priceBookItems); if (result.jobPackets) setJobPackets(result.jobPackets);
    if (mode === "metadata" || (mode === "saved" && !result.quote)) return;
    const draft = resultDraft(result);
    setDraftBaseline(draftFingerprint(draft));
    setSaveAsBusinessDefault(false);
    const intent = initialMapIntent.current;
    if (mode === "load" && intent && canApplyMapQuoteIntent(intent, { ownerUid: user.uid, workOrderId,
      canManage: !readOnly && result.access?.canManageQuotes === true, consumedId: consumedMapIntent.current })) {
      const sameDesign = intent.measurement.kind === "solar" && Boolean(intent.measurement.designId) && draft.designId === intent.measurement.designId;
      const existingSystem = [...draft.lines, ...draft.choices.flatMap((choice) => choice.lines)].some((line) => mapQuoteSystemPanels(line.sectionHeading) !== null);
      if (sameDesign && existingSystem) {
        const heading = mapQuoteLine(intent.measurement).sectionHeading;
        const updateCount = (line: QuoteLine) => mapQuoteSystemPanels(line.sectionHeading) === null ? line : { ...line, sectionHeading: heading };
        draft.lines = draft.lines.map(updateCount);
        draft.choices = draft.choices.map((choice) => ({ ...choice, lines: choice.lines.map(updateCount) }));
      } else draft.lines = appendMapQuoteIntent(draft.lines, intent);
      if (intent.measurement.roofImage) draft.roofImage = intent.measurement.roofImage;
      if (intent.measurement.equipment) draft.equipment = sameDesign && draft.choices.length
        ? { ...draft.equipment, common: [...intent.measurement.equipment.filter((item) => item.kind === "panel"), ...draft.equipment.common.filter((item) => item.kind !== "panel")] }
        : { common: intent.measurement.equipment, choices: draft.equipment.choices };
      if (intent.measurement.designId) draft.designId = intent.measurement.designId;
      consumedMapIntent.current = intent.id;
    }
    setRoofImage(draft.roofImage); setEquipment(draft.equipment); setDesignId(draft.designId);
    setLines(draft.lines); setChoices(draft.choices); setCustomerEmail(draft.customerEmail);
    setTerms(draft.terms); setCustomerMessage(draft.customerMessage); setValidUntil(draft.validUntil);
  }, [readOnly, user.uid, workOrderId]);

  useEffect(() => {
    const identity = `${user.uid}:${workOrderId}`;
    if (!available || loadedIdentity.current === identity) return;
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      setBusy("load");
      void request({ signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return;
        applyResult(result, "load"); loadedIdentity.current = identity;
      }).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); })
        .finally(() => { if (!controller.signal.aborted) setBusy(""); });
    });
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [applyResult, available, request, user.uid, workOrderId]);

  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    const objectUrls = new Set<string>();
    let current = true;
    const load = async () => {
      try {
        await Promise.resolve();
        if (!current) return;
        setAcceptedPhotos([]);
        setAcceptedPhotoUrls({});
        setAcceptedPhotoMessage("");
        setAcceptedPhotoPreview(null);
        setAcceptedPhotoBusy(true);
        const token = await user.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };
        const listResponse = await fetch(`/api/trade-job-quote-photos?workOrderId=${encodeURIComponent(workOrderId)}`, {
          headers,
          cache: "no-store",
          signal: controller.signal,
        });
        if (!listResponse.ok) {
          if (listResponse.status === 403 || listResponse.status === 404) return;
          throw new Error("Customer-shared photos could not be opened.");
        }
        const listed = await listResponse.json().catch(() => ({})) as AcceptedQuotePhotoResult;
        if (!listed.ok || !Array.isArray(listed.acceptedPhotos)) throw new Error("Customer-shared photos could not be opened.");
        const photos = listed.acceptedPhotos.filter((photo) => photo.contentType.startsWith("image/") && photo.contentUrl);
        if (!current) return;
        const results = await Promise.allSettled(photos.map(async (photo) => {
          const contentUrl = new URL(photo.contentUrl, window.location.origin);
          if (contentUrl.origin !== window.location.origin || contentUrl.pathname !== "/api/trade-job-quote-photos") {
            throw new Error("INVALID_PHOTO_URL");
          }
          const response = await fetch(`${contentUrl.pathname}${contentUrl.search}`, { headers, cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("PHOTO_UNAVAILABLE");
          const blob = await response.blob();
          if (!blob.type.startsWith("image/")) throw new Error("INVALID_PHOTO_TYPE");
          if (!current) return null;
          const url = URL.createObjectURL(blob);
          objectUrls.add(url);
          return { id: photo.id, url };
        }));
        if (!current) return;
        const urls: Record<string, string> = {};
        let failed = 0;
        for (const result of results) {
          if (result.status === "fulfilled" && result.value) urls[result.value.id] = result.value.url;
          else failed += 1;
        }
        setAcceptedPhotos(photos);
        setAcceptedPhotoUrls(urls);
        if (failed) setAcceptedPhotoMessage(`${photos.length - failed} of ${photos.length} customer-shared photos opened.`);
      } catch (error) {
        if (current && !(error instanceof DOMException && error.name === "AbortError")) {
          setAcceptedPhotoMessage("Customer-shared photos could not be opened.");
        }
      } finally {
        if (current) setAcceptedPhotoBusy(false);
      }
    };
    void load();
    return () => {
      current = false;
      controller.abort();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [available, user, workOrderId]);

  useEffect(() => {
    if (!available) return;
    const frame = window.requestAnimationFrame(() => {
      setRebateDraft(loadTradeRebateEstimateDraft(window.sessionStorage, user.uid));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [available, user.uid]);

  useEffect(() => {
    if (!sendPreview) return;
    const dialog = previewDialogRef.current;
    const returnFocus = previewTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [sendPreview]);

  useEffect(() => {
    if (!acceptedPhotoPreview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => acceptedPhotoCloseRef.current?.focus({ preventScroll: true }));
    const closeOnKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        setAcceptedPhotoPreview(null);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = acceptedPhotoDialogRef.current;
      const close = acceptedPhotoCloseRef.current;
      if (!dialog || !close) return;
      if (!dialog.contains(document.activeElement) || document.activeElement === close) {
        event.preventDefault();
        close.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", closeOnKeyboard);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnKeyboard);
      document.body.style.overflow = previousOverflow;
      if (acceptedPhotoOpenerRef.current?.isConnected) acceptedPhotoOpenerRef.current.focus({ preventScroll: true });
    };
  }, [acceptedPhotoPreview]);

  function applyRebateDiscount() {
    if (!rebateDraft || !canApplyDiscounts || busy) return;
    const line: QuoteLine = {
      lineType: "adjustment",
      description: `Rebate discount - ${rebateDraft.activityTitle} (${rebateDraft.quantity} ${rebateDraft.unit} estimate)`,
      quantity: "1",
      unitPrice: `-${rebateDraft.customerDiscountDollars}`,
      taxCode: "gst",
      sectionHeading: "Rebate and discounts",
    };
    setLines((current) => (
      current.length === 1 && !current[0].description ? [line] : appendBeforeFinalPercent(current, line)
    ));
    clearTradeRebateEstimateDraft(window.sessionStorage, user.uid);
    setRebateDraft(null);
    setMessage("Rebate discount added. Check the amount and GST before saving the quote.");
  }

  function applyPacket(asPackages: boolean) {
    const packet = jobPackets.find((candidate) => candidate.id === packetId); if (!packet?.canApply) return;
    if (!asPackages) {
      setLines((current) => packetLines(packet, "Included work").reduce(
        (next, line) => appendBeforeFinalPercent(next, line),
        current.filter((line) => line.description && line.jobPacketId !== packet.id),
      ));
      setMessage(`${packet.name} added as one standard scope.`); return;
    }
    const groupKey = choiceKey("package");
    setLines([]);
    setChoices([[
      "good", "Essential", "The clear essentials for a reliable result.", false,
    ], ["better", "Recommended", "The best balance of value, performance and future readiness.", true],
    ["best", "Complete", "The most complete scope with fewer compromises.", false]].map(([key, name, summary, recommended]) => ({
      clientKey: `${key}-${groupKey}`, kind: "package" as const, groupKey, name: String(name), summary: String(summary), recommended: Boolean(recommended), lines: packetLines(packet, String(name)),
    })));
    setMessage(`${packet.name} became three ready customer choices. Edit only what differs.`);
  }

  function addAddon() {
    const key = choiceKey("addon"); setChoices((current) => [...current, { clientKey: key, kind: "addon", groupKey: key, name: "Optional extra", summary: "Useful if the customer wants it now.", recommended: false, lines: [blankLine()] }]);
  }

  function buildSolarPackages(count: 2 | 3) {
    try {
      const next = solarQuotePackages(lines, equipment, count, choiceKey("solar"));
      setLines(next.lines); setChoices((current) => [...current, ...next.choices]); setEquipment(next.equipment);
      setMessage("Packages added. Enter one complete system price for each option, then check its equipment.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Check the solar system before adding packages."); }
  }

  function addChooseOne() {
    const groupKey = choiceKey("choice");
    setChoices((current) => [...current,
      { clientKey: `${groupKey}-a`, kind: "choose_one", groupKey, name: "Option A", summary: "First available approach.", recommended: true, lines: [blankLine()] },
      { clientKey: `${groupKey}-b`, kind: "choose_one", groupKey, name: "Option B", summary: "Alternative approach.", recommended: false, lines: [blankLine()] },
    ]);
  }

  function addFinalPercentDiscount() {
    if (!canEditQuote || !canApplyDiscounts) return;
    setLines((current) => current.some((line) => overallTradeQuoteDiscountKind(line) === "percent") ? current : [...current, {
      lineType: "adjustment", description: "Final discount", quantity: "percent:10", unitPrice: "0.00",
      taxCode: "gst", sectionHeading: OVERALL_PERCENT_DISCOUNT_SECTION,
    }]);
    setMessage("Final percentage discount added. It is calculated after included rebates and dollar discounts.");
  }

  function addFixedDiscount() {
    if (!canEditQuote || !canApplyDiscounts) return;
    setLines((current) => appendBeforeFinalPercent(current, {
      lineType: "adjustment", description: "Discount", quantity: "1", unitPrice: "100.00",
      taxCode: "gst", sectionHeading: OVERALL_FIXED_DISCOUNT_SECTION,
    }));
    setMessage("Dollar discount added as a separate line. Enter its label and amount including GST.");
  }

  function updateBaseLine(index: number, field: keyof QuoteLine, value: string) { setLines((current) => current.map((line, position) => position === index ? { ...line, [field]: value } : line)); }
  function replaceBaseLine(index: number, replacement: QuoteLine) { setLines((current) => current.map((line, position) => position === index ? replacement : line)); }
  function moveQuoteLine(scopeKey: string, fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (scopeKey === "base") {
      setLines((current) => moveTradeQuoteLine(current, fromIndex, toIndex));
    } else {
      setChoices((current) => current.map((choice) => choice.clientKey === scopeKey
        ? { ...choice, lines: moveTradeQuoteLine(choice.lines, fromIndex, toIndex) }
        : choice));
    }
    setMessage(`Quote line moved to position ${toIndex + 1}.`);
  }
  function updateChoice(key: string, patch: Partial<QuoteChoice>) {
    setChoices((current) => current.map((choice) => {
      if (choice.clientKey === key) return { ...choice, ...patch };
      if (patch.recommended && choice.kind !== "addon" && choice.kind === current.find((item) => item.clientKey === key)?.kind && choice.groupKey === current.find((item) => item.clientKey === key)?.groupKey) return { ...choice, recommended: false };
      return choice;
    }));
  }
  function updateChoiceLine(key: string, index: number, field: keyof QuoteLine, value: string) { setChoices((current) => current.map((choice) => choice.clientKey === key ? { ...choice, lines: choice.lines.map((line, position) => position === index ? { ...line, [field]: value } : line) } : choice)); }
  function replaceChoiceLine(key: string, index: number, replacement: QuoteLine) { setChoices((current) => current.map((choice) => choice.clientKey === key ? { ...choice, lines: choice.lines.map((line, position) => position === index ? replacement : line) } : choice)); }

  async function attachRoofImage(file: File | undefined) {
    if (!file || !canEditQuote || busy) return;
    if (file.type !== "image/png" || file.size > 4_000_000) { setMessage("Choose a PNG map image smaller than 4 MB."); return; }
    setBusy("roof_image"); setMessage("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read this image."));
        reader.onerror = () => reject(new Error("Could not read this image."));
        reader.readAsDataURL(file);
      });
      setRoofImage({ dataUrl });
      setMessage("Roof layout added. Check it in the customer preview, then save your quote.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not attach this image."); }
    finally { setBusy(""); }
  }
  async function saveDraft() {
    if (!canEditQuote || busy) return;
    if (quoteValidationIssue) { setMessage(quoteValidationIssue.message); return; }
    setBusy("save_draft"); setMessage("");
    try {
      const result = await request({ method: "POST", body: JSON.stringify({ action: "save_draft", workOrderId, lines, choices, customerEmail, terms, customerMessage, validUntil, saveAsBusinessDefault, equipment: { ...equipment, choices: equipment.choices.filter((group) => choices.some((choice) => choice.clientKey === group.choiceKey)) }, designId, roofImage: roofImage && "dataUrl" in roofImage ? roofImage : roofImage ? undefined : null }) });
      applyResult({ ...result, authorisedEmails: emails, priceBookItems, jobPackets }, "saved"); await onChanged?.();
      setSaveAsBusinessDefault(false);
      setMessage(saveAsBusinessDefault ? "Draft and business quote defaults saved." : "Draft saved with server-calculated totals and internal margin controls.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The quote could not be updated."); }
    finally { setBusy(""); }
  }
  async function openSendPreview() {
    if (!canSendQuote || busy) return;
    setMessage(""); setSendOutcome({ kind: "idle", message: "" });
    try {
      if (quoteValidationIssue) {
        const targetKey = `${quoteValidationIssue.scopeKey}:${quoteValidationIssue.lineIndex}:${quoteValidationIssue.field}`;
        const target = Array.from(document.querySelectorAll<HTMLElement>("[data-quote-validation-target]"))
          .find((element) => element.dataset.quoteValidationTarget === targetKey);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
        throw new Error(quoteValidationIssue.message);
      }
      if (!customerEmail) throw new Error("Choose the authorised customer email before previewing and sending.");
      if (!terms.trim()) throw new Error("Record the quote scope, exclusions and completion terms before previewing and sending.");
      if (validUntil && validUntil < new Date().toISOString().slice(0, 10)) throw new Error("The quote expiry date must not be in the past.");
      const base = previewGroup(lines, choices.length > 0);
      const previewChoices = choices.map((choice) => ({
        selectionId: choice.id || choice.clientKey,
        clientKey: choice.clientKey,
        kind: choice.kind,
        groupKey: choice.groupKey,
        name: choice.name,
        summary: choice.summary,
        recommended: choice.recommended,
        totals: previewGroup(choice.lines),
      }));
      if (!base.lines.length && !previewChoices.length) throw new Error("Add at least one quote item before previewing and sending.");
      const displayTotals = tradeQuoteDocumentDisplayTotals({
        subtotalCents: base.subtotalCents,
        taxCents: base.taxCents,
        totalCents: base.totalCents,
        choices: previewChoices.map((choice) => ({
          id: choice.selectionId,
          kind: choice.kind,
          groupKey: choice.groupKey,
          recommended: choice.recommended,
          subtotalCents: choice.totals.subtotalCents,
          taxCents: choice.totals.taxCents,
          totalCents: choice.totals.totalCents,
        })),
      });
      const identity = nextQuoteIdentity(quote, jobSummary);
      const quoteNumber = identity?.quoteNumber || "new quote";
      const businessName = business ? business.businessName : "Your trade business";
      const delivery: QuoteDeliveryPreview = {
        quoteNumber,
        versionNumber: identity?.versionNumber ?? null,
        subject: subjectPreview(business?.quoteEmailSubjectTemplate || "{business_name} sent quote {quote_number}", {
          businessName,
          customerName: jobSummary?.customerName || "customer",
          quoteNumber,
          workTitle: jobSummary?.title || "quoted work",
        }),
        attachmentName: identity ? quotePdfFilename(identity.quoteNumber, identity.versionNumber) : "Assigned after server save",
        identityKnown: Boolean(identity && business && jobSummary),
      };
      setBusy("preview_save");
      const saved = await request({ method: "POST", body: JSON.stringify({ action: "save_draft", workOrderId, lines, choices, customerEmail, terms, customerMessage, validUntil, saveAsBusinessDefault, equipment: { ...equipment, choices: equipment.choices.filter((group) => choices.some((choice) => choice.clientKey === group.choiceKey)) }, designId, roofImage: roofImage && "dataUrl" in roofImage ? roofImage : roofImage ? undefined : null }) });
      if (!saved.draftVersionId) throw new Error("The saved quote version could not be verified. Refresh before sending.");
      applyResult({ ...saved, authorisedEmails: emails, priceBookItems, jobPackets }, "saved");
      setSaveAsBusinessDefault(false); setPendingIssueVersionId(saved.draftVersionId);
      await onChanged?.();
      const expectedUpdatedAt = saved.quote?.editableDraft?.updatedAt;
      if (!expectedUpdatedAt) throw new Error("The saved quote revision could not be verified. Refresh before sending.");
      setSendConsent(false); setSendPreview({ base, choices: previewChoices, displayTotals, delivery, expectedUpdatedAt });
    } catch (error) { setMessage(previewError(error)); } finally { setBusy(""); }
  }
  async function sendPreviewedQuote() {
    if (!canSendQuote || !sendPreview || !sendConsent || busy) return;
    setBusy("preview_send"); setMessage("");
    setSendOutcome({ kind: "sending", message: "Submitting this reviewed quote and its email..." });
    try {
      if (!pendingIssueVersionId) throw new Error("Reopen the quote preview before sending.");
      const issued = await request({ method: "POST", body: JSON.stringify({ action: "issue_quote", workOrderId, quoteVersionId: pendingIssueVersionId, expectedUpdatedAt: sendPreview.expectedUpdatedAt, consentConfirmed: true }) });
      const outcome = quoteDeliveryOutcome(issued.delivery, "Quote saved and issued.");
      applyResult({ ...issued, authorisedEmails: emails, priceBookItems, jobPackets }, "saved"); setPendingIssueVersionId("");
      setSendOutcome(outcome); setMessage(outcome.message); await onChanged?.();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The quote could not be sent.";
      const outcome = pendingIssueVersionId
        ? `The exact saved quote is retained. Submit again to safely confirm its issue and email status. ${reason}`
        : reason;
      setSendOutcome({ kind: "error", message: outcome }); setMessage(outcome);
    } finally { setBusy(""); }
  }
  async function addQuoteRecipient() {
    if (!canEditQuote || !serverCanManageCustomers || busy) return;
    if (!recipientFirstName.trim() && !recipientLastName.trim()) { setMessage("Add the quote recipient's name."); return; }
    if (!recipientEmail.trim()) { setMessage("Add the quote recipient's email address."); return; }
    setBusy("add_quote_recipient"); setMessage("");
    try {
      const result = await request({ method: "POST", body: JSON.stringify({ action: "add_quote_recipient", workOrderId, firstName: recipientFirstName, lastName: recipientLastName, email: recipientEmail }) });
      const nextEmails = result.authorisedEmails || emails; setEmails(nextEmails);
      const normalisedEmail = recipientEmail.trim().toLowerCase(); setCustomerEmail(normalisedEmail);
      setRecipientFirstName(""); setRecipientLastName(""); setRecipientEmail(""); setAddingRecipient(false);
      setMessage("Quote recipient added to the customer record and selected.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The quote recipient could not be added."); }
    finally { setBusy(""); }
  }
  async function linkAction(action: "replace_link" | "revoke_link" | "send_quote" | "retry_quote_delivery" | "answer_question", extra: Record<string, unknown> = {}) {
    if (busy) return;
    if (action === "send_quote" || action === "retry_quote_delivery" || action === "answer_question" ? !canSendQuote : !canEditQuote) return;
    setBusy(action); setMessage("");
    try { const result = await request({ method: "POST", body: JSON.stringify({ action, workOrderId, consentConfirmed: deliveryConfirmed, ...extra }) }); applyResult({ ...result, authorisedEmails: emails, priceBookItems, jobPackets });
      setMessage(action === "send_quote" ? quoteDeliveryMessage(result.delivery, "Quote email submitted.") : action === "retry_quote_delivery" ? quoteDeliveryMessage(result.delivery, "Quote email retry submitted.") : action === "replace_link" ? "A new secure link replaced the old one." : action === "revoke_link" ? "The secure link is revoked." : "Response added to the quote timeline.");
      if (action === "answer_question") { setAnswer(""); setAnsweringId(""); } await onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The quote link could not be updated."); } finally { setBusy(""); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(quote?.link?.shareUrl || ""); setMessage("Secure quote link copied."); }
    catch { setMessage("Copy was blocked by this browser. Select the link and copy it manually."); }
  }

  function lineEditor(
    line: QuoteLine,
    index: number,
    scopeKey: string,
    onChange: (field: keyof QuoteLine, value: string) => void,
    onReplace: (replacement: QuoteLine) => void,
    onRemove: () => void,
    canRemove: boolean,
    lineCount: number,
    onMove: (fromIndex: number, toIndex: number) => void,
  ) {
    const linked = Boolean(line.priceBookItemId);
    const mapKind = mapQuoteKind(line.sectionHeading);
    const solar = mapKind === "solar";
    const measuredContext = mapQuoteMeasuredContext(line.sectionHeading);
    const itemPricing = measuredContext?.itemPricing === true;
    const systemPanels = mapQuoteSystemPanels(line.sectionHeading);
    const legacySolar = solar && systemPanels === null;
    const mapUnit = mapKind && !solar ? itemPricing ? "items" : MAP_QUOTE_UNITS[mapKind] : "";
    const solarSection = legacySolar ? `Solar system (${line.quantity} ${line.quantity === "1" ? "panel" : "panels"})` : line.sectionHeading;
    const compatibleItems = mapKind ? priceBookItems.filter((item) => (legacySolar && item.id === line.priceBookItemId) || mapQuoteUnitMatches(mapKind, item.unitLabel, solarSection)) : priceBookItems;
    // Keep historical quantities and cost links until the user chooses custom pricing or a system item.
    const displayedPrice = legacySolar ? (calculateTradeQuoteLine(quantityToMilli(line.quantity), dollarsToCents(line.unitPrice, line.lineType === "adjustment"), line.taxCode === "gst" ? "gst" : "none").subtotalCents / 100).toFixed(2) : line.unitPrice;
    const systemLine = (): QuoteLine => ({ ...line, quantity: "1", unitPrice: displayedPrice, sectionHeading: solarSection });
    const overallDiscount = overallTradeQuoteDiscountKind(line);
    const discountLocked = !canApplyDiscounts && Number(line.unitPrice) < 0;
    const lineIssue = quoteValidationIssue?.kind === "line" && quoteValidationIssue.scopeKey === scopeKey && quoteValidationIssue.lineIndex === index
      ? quoteValidationIssue
      : null;
    const validationErrorId = `quote-line-error-${scopeKey.replace(/[^A-Za-z0-9_-]/g, "-")}-${index + 1}`;
    const validationAttributes = (field: TradeQuoteLineValidationField) => lineIssue?.field === field ? {
      "aria-describedby": validationErrorId,
      "aria-invalid": true as const,
      "data-quote-validation-target": `${scopeKey}:${index}:${field}`,
    } : {};
    const changeLine = (field: keyof QuoteLine, value: string) => {
      if (!canApplyDiscounts && field === "unitPrice" && /^\s*-/.test(value)) return;
      if (discountLocked && ["lineType", "quantity", "unitPrice", "taxCode"].includes(field)) return;
      onChange(field, value);
    };
    const selectPriceBookItem = (itemId: string) => {
      if (!itemId) {
        onReplace({ ...(solar ? systemLine() : line), priceBookItemId: "", jobPacketId: "", jobPacketLineId: "" });
        return;
      }
      if (legacySolar && itemId === line.priceBookItemId) return;
      const item = compatibleItems.find((candidate) => candidate.id === itemId);
      if (!item) return;
      onReplace({
        ...(solar ? systemLine() : line),
        priceBookItemId: item.id,
        jobPacketId: "",
        jobPacketLineId: "",
        lineType: item.lineType,
        description: item.description || item.name,
        quantity: solar ? "1" : mapKind ? line.quantity : "1",
        unitPrice: (item.sellPriceCentsExGst / 100).toFixed(2),
        taxCode: item.taxCode,
      });
    };
    const isDragTarget = dragTargetQuoteLine?.scopeKey === scopeKey && dragTargetQuoteLine.index === index;
    const rowDragProps = {
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (draggedQuoteLine?.scopeKey !== scopeKey) return;
        event.preventDefault(); event.dataTransfer.dropEffect = "move";
        setDragTargetQuoteLine({ scopeKey, index });
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (draggedQuoteLine?.scopeKey === scopeKey) onMove(draggedQuoteLine.index, index);
        setDraggedQuoteLine(null); setDragTargetQuoteLine(null);
      },
    };
    const orderControls = <div className="trade-quote-order-controls" aria-label={`Reorder ${line.description || `quote line ${index + 1}`}`}>
      <button type="button" className="trade-quote-drag-handle" draggable={!busy} disabled={Boolean(busy)} aria-label={`Drag ${line.description || `quote line ${index + 1}`}`} title="Drag to reorder" onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `${scopeKey}:${index}`);
        setDraggedQuoteLine({ scopeKey, index }); setDragTargetQuoteLine({ scopeKey, index });
      }} onDragEnd={() => { setDraggedQuoteLine(null); setDragTargetQuoteLine(null); }}>Drag</button>
      <button type="button" disabled={Boolean(busy) || index === 0} aria-label={`Move ${line.description || `quote line ${index + 1}`} up`} title="Move up" onClick={() => onMove(index, index - 1)}>Up</button>
      <button type="button" disabled={Boolean(busy) || index === lineCount - 1} aria-label={`Move ${line.description || `quote line ${index + 1}`} down`} title="Move down" onClick={() => onMove(index, index + 1)}>Down</button>
    </div>;
    if (overallDiscount) return <div {...rowDragProps} className={`trade-quote-overall-discount${lineIssue ? " invalid" : ""}${isDragTarget ? " drag-target" : ""}`} key={`${index}:${line.id || "overall-discount"}`}>
      {orderControls}
      <div><span>{overallDiscount === "percent" ? "Percentage discount" : "Dollar discount"}</span><small>{overallDiscount === "percent" ? "Applied to the positive included scope. GST reduces in the same proportion." : "Customer discount including GST. GST is reduced in the same proportion as the included scope."}</small></div>
      <label><span>Label / details</span><input {...validationAttributes("description")} aria-label="Overall discount label or details" value={line.description} maxLength={500} readOnly={!canApplyDiscounts} onChange={(event) => onChange("description", event.target.value)} placeholder={overallDiscount === "percent" ? "Xmas sale" : "STC x 10 or refer a friend"} /></label>
      <label><span>{overallDiscount === "percent" ? "Percent off" : "Dollars off incl GST"}</span><input {...validationAttributes(overallDiscount === "percent" ? "quantity" : "unitPrice")} aria-label={overallDiscount === "percent" ? "Overall discount percent" : "Overall discount dollars"} value={overallDiscount === "percent" ? quantityToPercentInput(line.quantity) : line.unitPrice.startsWith("-") ? line.unitPrice.slice(1) : line.unitPrice} inputMode="decimal" readOnly={!canApplyDiscounts} onChange={(event) => {
        const value = event.target.value;
        const quantity = overallDiscount === "percent" ? percentInputToQuantity(value) : null;
        if (overallDiscount === "percent" && quantity === null) return;
        onChange(overallDiscount === "percent" ? "quantity" : "unitPrice", overallDiscount === "percent" ? quantity || "" : value);
      }} /></label>
      {canApplyDiscounts && <button type="button" onClick={onRemove}>Remove</button>}
      {lineIssue && <p id={validationErrorId} className="trade-quote-line-error" role="alert">{lineIssue.message}</p>}
    </div>;
    return <div {...rowDragProps} className={`trade-quote-line${lineIssue ? " invalid" : ""}${isDragTarget ? " drag-target" : ""}`} key={`${index}:${line.id || "new"}`}>
      {orderControls}
      <label className="trade-quote-field trade-quote-price-book-field"><span>{solar ? "System pricing" : "Price book item"}</span><select {...validationAttributes("lineType")} aria-label={`Line ${index + 1} price book item`} value={line.priceBookItemId || ""} disabled={discountLocked} onChange={(event) => selectPriceBookItem(event.target.value)}><option value="">{solar ? "Enter system price" : "Custom line"}</option>{compatibleItems.map((item) => <option key={item.id} value={item.id}>{item.name} | {legacySolar && item.id === line.priceBookItemId ? "Existing saved price" : `${money(item.sellPriceCentsExGst)}${mapUnit ? ` / ${itemPricing ? item.unitLabel : mapUnit}` : ""} ex GST`}</option>)}</select>{mapKind && !solar && <small>{itemPricing ? "Choose a roll, pack or item price, then enter how many to charge." : `Rates per ${mapUnit}. You can change the quantity to charge.`}</small>}{linked && <small>{solar ? "Select Enter system price to set a custom total. Custom pricing has no saved item cost." : "Current price book details are checked again when saved."}</small>}</label>
      <label className="trade-quote-description"><span>Description and section</span><input {...validationAttributes("description")} aria-label={`Line ${index + 1} description`} value={line.description} maxLength={500} readOnly={linked} onChange={(event) => onChange("description", event.target.value)} placeholder="Description" /><input className="trade-quote-section-input" aria-label={`Line ${index + 1} section heading`} value={line.sectionHeading} maxLength={120} readOnly={Boolean(mapKind)} onChange={(event) => onChange("sectionHeading", event.target.value)} placeholder="Customer section heading" />{line.priceBookItemId && !solar && <small>{line.jobPacketId ? "Common job item" : "Saved item"}, description, price and GST come from the current price book. Change the quantity{mapKind ? " here" : " or customer section here"}.</small>}</label>
      {!solar && <div className="trade-quote-field"><label><span>Quantity{mapUnit ? ` (${mapUnit})` : ""}</span><input {...validationAttributes("quantity")} aria-label={`Line ${index + 1} quantity${mapUnit ? ` (${mapUnit})` : ""}`} value={line.quantity} inputMode="decimal" readOnly={discountLocked} onChange={(event) => changeLine("quantity", event.target.value)} /></label>{measuredContext && <small>Measured: {measuredContext.quantity} {MAP_QUOTE_UNITS[measuredContext.kind]}</small>}{mapKind && <button type="button" disabled={discountLocked} onClick={() => {
        try { onReplace(mapQuoteSetItemPricing(line, !itemPricing)); }
        catch (error) { setMessage(error instanceof Error ? error.message : "Enter a valid quantity before changing pricing."); }
      }}>{itemPricing ? `Use ${MAP_QUOTE_UNITS[mapKind]} pricing` : "Use roll or pack pricing"}</button>}</div>}
      <label className="trade-quote-field"><span>{solar ? "System price (ex GST)" : `Unit price${mapUnit ? ` / ${mapUnit}` : ""}`}</span><input {...validationAttributes("unitPrice")} aria-label={`Line ${index + 1} ${solar ? "system price" : `unit price${mapUnit ? ` per ${mapUnit}` : ""}`}`} value={displayedPrice} inputMode="decimal" placeholder={solar ? "Price for the whole system" : mapKind ? `Price per ${mapUnit}` : undefined} readOnly={linked || discountLocked} onChange={(event) => {
        if (legacySolar && !linked && !discountLocked) onReplace({ ...systemLine(), unitPrice: event.target.value });
        else changeLine("unitPrice", event.target.value);
      }} />{solar ? <small>{systemPanels ?? line.quantity} panels in the design. One price for the whole system.</small> : mapKind && !line.unitPrice.trim() && <small>Enter a rate or select a matching price book item.</small>}{discountLocked && <small>Discount amount is read-only for your access.</small>}</label>
      <label className="trade-quote-field"><span>Tax</span><select {...validationAttributes("taxCode")} aria-label={`Line ${index + 1} tax`} value={line.taxCode} disabled={linked || discountLocked} onChange={(event) => changeLine("taxCode", event.target.value)}><option value="gst">GST 10%</option><option value="none">No GST</option></select></label>
      <button type="button" disabled={!canRemove} onClick={onRemove}>Remove</button>
      {lineIssue && <p id={validationErrorId} className="trade-quote-line-error" role="alert">{lineIssue.message}</p>}
    </div>;
  }

  function choiceEditor(choice: QuoteChoice) {
    const choiceIssue = quoteValidationIssue?.kind === "choice" && quoteValidationIssue.scopeKey === choice.clientKey
      ? quoteValidationIssue
      : null;
    const validationErrorId = `quote-choice-error-${choice.clientKey.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    const validationAttributes = (field: "name" | "recommended" | "remove" | "addLine") => choiceIssue?.field === field ? {
      "aria-describedby": validationErrorId,
      "aria-invalid": true as const,
      "data-quote-validation-target": `${choice.clientKey}:-1:${field}`,
    } : {};
    return <article key={choice.clientKey} className={`${choice.recommended ? "recommended" : ""}${choiceIssue ? " invalid" : ""}`.trim()}>
      <header><div><span>{choice.kind === "package" ? "Package" : choice.kind === "addon" ? "Optional extra" : "Choose one"}</span><input {...validationAttributes("name")} aria-label="Customer choice name" value={choice.name} maxLength={120} onChange={(event) => updateChoice(choice.clientKey, { name: event.target.value })} /></div><button {...validationAttributes("remove")} type="button" onClick={() => setChoices((currentChoices) => currentChoices.filter((item) => item.clientKey !== choice.clientKey))}>Remove</button></header>
      <textarea aria-label={`${choice.name || "Customer choice"} summary`} value={choice.summary} maxLength={500} rows={2} onChange={(event) => updateChoice(choice.clientKey, { summary: event.target.value })} />
      <label className="trade-quote-recommended"><input {...validationAttributes("recommended")} type="checkbox" checked={choice.recommended} onChange={(event) => updateChoice(choice.clientKey, { recommended: event.target.checked })} /><span>Show as recommended</span></label>
      <div className="trade-quote-choice-lines">{choice.lines.map((line, index) => lineEditor(line, index, choice.clientKey, (field, value) => updateChoiceLine(choice.clientKey, index, field, value), (replacement) => replaceChoiceLine(choice.clientKey, index, replacement), () => updateChoice(choice.clientKey, { lines: choice.lines.filter((_, position) => position !== index) }), choice.lines.length > 1, choice.lines.length, (fromIndex, toIndex) => moveQuoteLine(choice.clientKey, fromIndex, toIndex)))}</div>
      {(choice.lines.some((line) => mapQuoteKind(line.sectionHeading) === "solar") || equipment.choices.some((group) => group.choiceKey === choice.clientKey)) && <details className={previewStyles.equipmentEditor}><summary>Equipment in this option</summary><p>Common equipment below is included in every option. Add only the equipment that differs here.</p><TradeSolarEquipmentList user={user} value={equipment.choices.find((group) => group.choiceKey === choice.clientKey)?.items || []} busy={Boolean(busy)} onChange={(items) => setEquipment((current) => ({ ...current, choices: [...current.choices.filter((group) => group.choiceKey !== choice.clientKey), { choiceKey: choice.clientKey, items }] }))} /></details>}
      <button {...validationAttributes("addLine")} className="quote-add-line" type="button" onClick={() => updateChoice(choice.clientKey, { lines: [...choice.lines, blankLine()] })}>Add line to this choice</button>
      {choiceIssue && <p id={validationErrorId} className="trade-quote-choice-error" role="alert">{choiceIssue.message}</p>}
      {choice.totalCents != null && <strong className="trade-quote-choice-total">{money(choice.totalCents)} incl GST</strong>}
    </article>;
  }

  if (!available) return <section className="trade-quote-panel unavailable"><strong>Direct quote unavailable</strong><p>Link an authoritative direct customer and service site before creating a customer-acceptance quote. Protected marketplace jobs remain in the platform quote workflow.</p></section>;
  const current = quote?.editableDraft
    ? quote.versions.find((version) => version.id === quote.editableDraft?.id)
    : quote?.versions.find((version) => version.versionNumber === quote.currentVersionNumber);
  const draftMode = !current || current.status === "draft";
  const latestDelivery = quote?.deliveries?.[0] || null;
  const openQuestions = quote?.questions?.filter((item) => item.status === "open") || [];
  const finalPercentIndex = lines.findIndex((line) => overallTradeQuoteDiscountKind(line) === "percent");
  const finalPercentLine = finalPercentIndex >= 0 ? lines[finalPercentIndex] : null;
  const reorderableBaseLineCount = lines.length - (finalPercentLine ? 1 : 0);
  const finalPercentIssue = quoteValidationIssue?.kind === "line" && quoteValidationIssue.scopeKey === "base"
    && quoteValidationIssue.lineIndex === finalPercentIndex ? quoteValidationIssue : null;
  const finalPercentErrorId = "quote-final-percent-error";
  return <section className="trade-quote-panel">
    <header><div><span>Prepare quote</span><h4>{quote?.quoteNumber || "New quote"}{current ? ` | Version ${current.versionNumber}` : ""}</h4><p>Add your items and prices, then check the customer preview.</p></div>{current && <strong className={`quote-status ${current.status}`}>{current.status.replaceAll("_", " ")}</strong>}</header>
    {busy === "load" && <p role="status">Loading the authorised quote...</p>}
    <div className={showLivePreview ? previewStyles.composer : undefined} style={showLivePreview ? undefined : { display: "contents" }}><div className={showLivePreview ? previewStyles.editor : undefined} style={showLivePreview ? undefined : { display: "contents" }}>
    {jobSummary?.enquiryReference && <section className="trade-quote-enquiry-brief" aria-label="Customer enquiry brief">
      <header><div><span>Customer enquiry</span><h5>{jobSummary.title}</h5></div><strong>{jobSummary.enquiryReference}</strong></header>
      {jobSummary.enquiryServices.length > 0 && <div className="trade-quote-enquiry-services">{jobSummary.enquiryServices.map((service) => <span key={service}>{service}</span>)}</div>}
      {jobSummary.enquiryBrief && <p>{jobSummary.enquiryBrief}</p>}
      <small>Only contact details and quote preparation information shared with matched trades are shown. The customer&apos;s full private plan is not included.</small>
    </section>}
    {(acceptedPhotoBusy || acceptedPhotos.length > 0 || acceptedPhotoMessage) && <section className="trade-quote-enquiry-brief trade-quote-accepted-photos" aria-label="Customer-shared quote photos">
      <header><div><span>Customer-shared quote photos</span><h5>Open a photo without leaving this quote</h5></div>{acceptedPhotos.length > 0 && <strong>{acceptedPhotos.length} photo{acceptedPhotos.length === 1 ? "" : "s"}</strong>}</header>
      {acceptedPhotoBusy && <p role="status">Opening customer-shared photos...</p>}
      {acceptedPhotos.length > 0 && <div className="dashboard-enquiry-thumbnails">
        {acceptedPhotos.map((photo) => {
          const url = acceptedPhotoUrls[photo.id] || "";
          return <article key={photo.id}>
            {url ? <button type="button" className="dashboard-enquiry-photo-button" aria-label={`View full image: ${photo.label || "Customer-shared quote photo"}`} onClick={(event) => {
              acceptedPhotoOpenerRef.current = event.currentTarget;
              setAcceptedPhotoPreview({ photo, url, status: "loading" });
            }}>
              {/* Authenticated image bytes stay in this short-lived object URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={photo.label || "Customer-shared quote photo"} />
              <span aria-hidden="true">View full image</span>
            </button> : <div className="dashboard-enquiry-thumbnail-unavailable">Preview unavailable.</div>}
            <div><span>Customer-shared quoting photo</span><strong>{photo.label || "Quote preparation photo"}</strong><small>{Math.max(1, Math.round(photo.sizeBytes / 1024))} KB</small></div>
          </article>;
        })}
      </div>}
      {acceptedPhotoMessage && <p className="dashboard-enquiry-evidence-error" role="status">{acceptedPhotoMessage}</p>}
      <small>Only photos the customer selected for this accepted enquiry are shown. The customer&apos;s full private plan is not included.</small>
    </section>}
    {(quote?.questions?.length || 0) > 0 && <section className={`trade-quote-questions ${openQuestions.length ? "needs-attention" : ""}`} id="quote-questions"><span>{openQuestions.length ? `${openQuestions.length} customer ${openQuestions.length === 1 ? "question needs" : "questions need"} a reply` : "Customer questions"}</span><h5>{openQuestions.length ? "Reply before the job moves on" : "Questions and replies"}</h5>{quote?.questions?.map((item) => <article key={item.id}><div><strong>{item.question}</strong><small>Asked {new Date(item.askedAt).toLocaleString("en-AU")}</small>{item.answer && <p>{item.answer}</p>}</div>{canSendQuote && item.status === "open" && (answeringId === item.id ? <div><textarea aria-label="Quote question response" disabled={Boolean(busy)} rows={3} maxLength={1000} value={answer} onChange={(event) => setAnswer(event.target.value)} /><button type="button" disabled={answer.trim().length < 2 || Boolean(busy)} onClick={() => void linkAction("answer_question", { questionId: item.id, answer })}>Send response</button></div> : <button type="button" disabled={Boolean(busy)} onClick={() => setAnsweringId(item.id)}>Answer</button>)}</article>)}</section>}
    {canEditQuote && canApplyDiscounts && rebateDraft && <section className="trade-rebate-document-offer"><div><span>REBATE ESTIMATE READY</span><strong>{rebateDraft.quantity} {rebateDraft.unit} | ${rebateDraft.customerDiscountDollars} customer discount</strong><small>{rebateDraft.activityTitle}</small></div><button type="button" disabled={Boolean(busy)} onClick={applyRebateDiscount}>Add discount to this quote</button></section>}
    <fieldset disabled={!canEditQuote || Boolean(busy)} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
    {jobPackets.length > 0 && <div className="trade-quote-packets"><label><span>Start from a common job</span><select value={packetId} onChange={(event) => setPacketId(event.target.value)}><option value="">Choose saved common work</option>{jobPackets.map((packet) => <option key={packet.id} value={packet.id} disabled={!packet.canApply}>{packet.name} | {packet.lines.length} items | {money(packet.summary.sellCentsExGst)} ex GST{packet.canApply ? "" : " | needs attention"}</option>)}</select></label><div className="trade-quote-packet-actions"><button type="button" disabled={!packetId} onClick={() => applyPacket(false)}>Use standard job</button><button type="button" disabled={!packetId} onClick={() => applyPacket(true)}>Build Good, Better, Best</button></div><small>One common job can stay simple or become three customer choices. Edit only what differs.</small></div>}
    {reorderableBaseLineCount > 0 && <section className="trade-quote-base"><header><div><strong>Quote items</strong><span>{choices.length ? "These items are included before any customer choices." : "Choose a saved price-book item on any row, or leave it as Custom line."}</span></div></header><div className="trade-quote-lines"><div className="trade-quote-line headings" aria-hidden="true"><span>Order</span><span>Price book item</span><span>Description and section</span><span>Quantity</span><span>Unit price</span><span>Tax</span><span></span></div>{lines.map((line, index) => overallTradeQuoteDiscountKind(line) === "percent" ? null : lineEditor(line, index, "base", (field, value) => updateBaseLine(index, field, value), (replacement) => replaceBaseLine(index, replacement), () => setLines((currentLines) => currentLines.filter((_, position) => position !== index)), reorderableBaseLineCount > 1 || choices.length > 0, reorderableBaseLineCount, (fromIndex, toIndex) => moveQuoteLine("base", fromIndex, toIndex)))}</div></section>}
    <div className="trade-quote-builder-actions"><button className="quote-add-line" type="button" onClick={() => setLines((current) => appendBeforeFinalPercent(current, blankLine()))}>Add included line</button><details className="trade-quote-more"><summary>Extras and discounts</summary><div><button type="button" onClick={addAddon}>Add optional extra</button><button type="button" onClick={addChooseOne}>Add choose-one pair</button>{onOpenPriceBook && <button type="button" onClick={onOpenPriceBook}>Manage price book</button>}{canApplyDiscounts && <button className="quote-discount-action" type="button" onClick={addFixedDiscount}>+ Dollar discount</button>}{canApplyDiscounts && !finalPercentLine && <button type="button" onClick={addFinalPercentDiscount}>Add final percentage discount</button>}</div></details></div>
    {lines.filter((line) => mapQuoteKind(line.sectionHeading) === "solar").length === 1 && <details className={previewStyles.equipmentEditor}><summary>Offer system options</summary><p>Keep one system, or let the customer choose a package. Each option has one complete system price.</p><div className={previewStyles.packageButtons}><button type="button" onClick={() => buildSolarPackages(2)}>Solar or Solar + battery</button><button type="button" onClick={() => buildSolarPackages(3)}>Include hot water option</button></div></details>}
    {choices.length > 0 && <section className="trade-quote-choice-builder"><header><div><span>Customer choices</span><h5>Make the decision easy</h5><p>Packages use one clear selection. Optional extras are independent. Choose-one pairs require one answer.</p></div><button type="button" onClick={() => setChoices([])}>Remove all choices</button></header><div className="trade-quote-choice-grid">{choices.map(choiceEditor)}</div></section>}
    <div className="trade-quote-settings">
      <div className="trade-quote-recipient wide"><label><span>Send quote to</span><select value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)}><option value="">Choose authorised contact</option>{emails.map((email) => <option key={email}>{email}</option>)}</select><small>{jobSummary?.publicLead ? "This address is projected from the customer's current release for this exact lead and is checked again before issue and send." : "The secure link needs no customer account. Every added address becomes an authorised contact on this customer record."}</small></label><div className="trade-quote-recipient-actions">{serverCanManageCustomers && !jobSummary?.publicLead && <button type="button" onClick={() => setAddingRecipient((value) => !value)}>{addingRecipient ? "Cancel new email" : "Add another email"}</button>}{jobSummary?.customerId && !jobSummary.publicLead && onOpenCustomer && <button type="button" onClick={() => onOpenCustomer(jobSummary.customerId)}>Open customer details</button>}</div></div>
      {addingRecipient && <section className="trade-quote-add-recipient wide" aria-label="Add quote recipient"><header><div><span>New authorised contact</span><strong>Add a different quote email</strong></div><small>This saves the recipient to the customer so it can be checked and reused.</small></header><div><label><span>First name</span><input value={recipientFirstName} maxLength={80} autoComplete="given-name" onChange={(event) => setRecipientFirstName(event.target.value)} /></label><label><span>Last name</span><input value={recipientLastName} maxLength={80} autoComplete="family-name" onChange={(event) => setRecipientLastName(event.target.value)} /></label><label><span>Email</span><input type="email" value={recipientEmail} maxLength={180} autoComplete="email" onChange={(event) => setRecipientEmail(event.target.value)} /></label><button type="button" disabled={busy === "add_quote_recipient"} onClick={() => void addQuoteRecipient()}>{busy === "add_quote_recipient" ? "Adding..." : "Add and use email"}</button></div></section>}
      <label><span>Valid until</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
      <details className="trade-quote-more trade-quote-message-settings wide"><summary>Message and terms</summary><div>
      <label className="wide"><span>Customer email introduction</span><textarea rows={3} maxLength={1200} value={customerMessage} onChange={(event) => setCustomerMessage(event.target.value)} placeholder="A short, personal introduction that appears in the email and quote." /></label>
      <label className="wide"><span>Recorded terms</span><textarea rows={4} maxLength={4000} value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Scope assumptions, exclusions and completion terms" /></label>
      <label className="trade-quote-save-default wide"><input type="checkbox" checked={saveAsBusinessDefault} onChange={(event) => setSaveAsBusinessDefault(event.target.checked)} /><span>Use this introduction and these terms as the editable default for future quotes.</span></label>
      </div></details>
    </div>
    {finalPercentLine && <section className={`trade-quote-final-percent${finalPercentIssue ? " invalid" : ""}`} aria-label="Final percentage discount on included items">
      <div><span>Final percentage discount</span><strong>{finalPercentLine ? "Applied after rebates and dollar discounts" : "No final percentage discount"}</strong><small>This applies once to the net included items. Customer choices and optional extras are unchanged.</small></div>
      <>
        <label><span>Label / details</span><input aria-label="Final percentage discount label" aria-invalid={finalPercentIssue?.field === "description" || undefined} aria-describedby={finalPercentIssue?.field === "description" ? finalPercentErrorId : undefined} data-quote-validation-target={`base:${finalPercentIndex}:description`} value={finalPercentLine.description} maxLength={500} readOnly={!canApplyDiscounts} onChange={(event) => updateBaseLine(finalPercentIndex, "description", event.target.value)} /></label>
        <label><span>Percent off</span><input aria-label="Final percentage discount percent" aria-invalid={finalPercentIssue?.field === "quantity" || undefined} aria-describedby={finalPercentIssue?.field === "quantity" ? finalPercentErrorId : undefined} data-quote-validation-target={`base:${finalPercentIndex}:quantity`} value={quantityToPercentInput(finalPercentLine.quantity)} inputMode="decimal" readOnly={!canApplyDiscounts} onChange={(event) => { const quantity = percentInputToQuantity(event.target.value); if (quantity !== null) updateBaseLine(finalPercentIndex, "quantity", quantity || ""); }} /></label>
        {canApplyDiscounts && <button type="button" onClick={() => setLines((current) => current.filter((_, index) => index !== finalPercentIndex))}>Remove</button>}
      </>
      {finalPercentIssue && <p id={finalPercentErrorId} className="trade-quote-line-error" role="alert">{finalPercentIssue.message}</p>}
    </section>}
    {quoteValidationIssue && <p className="trade-quote-validation-summary" role="alert"><strong>Fix before preview</strong><span>{quoteValidationIssue.message}</span></p>}
    <div className="trade-quote-totals"><div><span>Subtotal</span><small>Subtotal ex GST</small><strong aria-live="polite">{liveSummary.error ? "Fix highlighted item" : money(liveSummary.subtotalCents)}</strong></div><div><span>GST</span><strong>{liveSummary.error ? "Fix highlighted item" : money(liveSummary.taxCents)}</strong></div><div><span>Discount incl GST</span><strong>{liveSummary.error ? "Fix highlighted item" : money(liveDiscountCents)}</strong></div><div><span>Total</span><small>Total incl GST</small><strong>{liveSummary.error ? "Fix highlighted item" : money(liveSummary.totalCents)}</strong></div></div>
    {(current?.internalSummary || priceBookItems.length > 0) && <aside className="trade-quote-internal" aria-label="Internal commercial summary"><div><span>Internal only</span><strong>Live editable scope</strong></div><dl><div><dt>Cost ex GST</dt><dd>{liveSummary.error ? "Fix highlighted item" : money(liveSummary.costCentsExGst)}</dd></div><div><dt>Sell ex GST</dt><dd>{liveSummary.error ? "Fix highlighted item" : money(liveSummary.subtotalCents)}</dd></div><div><dt>Margin ex GST</dt><dd>{liveSummary.error ? "Fix highlighted item" : money(liveSummary.marginCentsExGst)}</dd></div></dl><small>Customers never receive supplier cost, markup or margin.</small></aside>}
    </fieldset>
    {!canEditQuote && jobSummary?.customerId && !jobSummary.publicLead && onOpenCustomer && <div className="trade-quote-actions"><button type="button" onClick={() => onOpenCustomer(jobSummary.customerId)}>Open customer details</button></div>}
    {!canEditQuote && <p className="trade-import-status" role="status">View only. You can open the customer context, issued PDF and quote history, but you cannot change this quote.</p>}
    {(equipment.common.length > 0 || choices.some((choice) => choice.lines.some((line) => mapQuoteKind(line.sectionHeading) === "solar")) || lines.some((line) => mapQuoteKind(line.sectionHeading) === "solar")) && <details className={previewStyles.equipmentEditor}><summary>{choices.length ? "Equipment included in every option" : "Selected equipment"}{equipment.common.length ? ` (${equipment.common.length})` : ""}</summary><p>Details appear on the customer quote and PDF. Equipment does not change your system price.</p><TradeSolarEquipmentList user={user} value={equipment.common} busy={Boolean(busy) || !canEditQuote} onChange={(common) => setEquipment((current) => ({ ...current, common }))} /></details>}
    <section className={previewStyles.roofAttachment} aria-label="Quote roof layout"><div><strong>Roof layout</strong><p>{roofImage ? "Included in this quote and its PDF." : "Add a map image to show the proposed layout."}</p></div>{canEditQuote && <div><label className={previewStyles.uploadButton}>{roofImage ? "Replace image" : "Add map image"}<input type="file" accept="image/png" aria-label={roofImage ? "Replace roof layout image" : "Add roof layout image"} disabled={Boolean(busy)} onChange={(event) => { void attachRoofImage(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>{roofImage && <button type="button" disabled={Boolean(busy)} onClick={() => setRoofImage(null)}>Remove</button>}</div>}</section>
    {canEditQuote && <div className="trade-quote-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void saveDraft()}>{busy === "save_draft" ? "Saving..." : draftMode ? "Save draft" : "Save as next draft"}</button>{canSendQuote && <button ref={previewTriggerRef} className="primary" type="button" disabled={Boolean(busy)} onClick={openSendPreview}>{draftMode ? "Preview and send" : "Preview and send next version"}</button>}</div>}
    {quote?.link && <section className="trade-quote-share"><header><div><span>Effortless customer review</span><h5>One secure quote link and matching PDF</h5><p>The customer can review, ask, sign, accept or decline without creating an account. The PDF is generated from this exact issued version.</p></div><strong>{quote.link.status}</strong></header>{latestDelivery?.presentation && <aside className="trade-quote-internal" aria-label="Email delivery status"><div><span>Email delivery</span><strong>{latestDelivery.presentation.label}</strong></div><small>{latestDelivery.recipientPreview ? `Recipient ${latestDelivery.recipientPreview}.` : ""}</small>{canSendQuote && latestDelivery.presentation.canRetry && <button type="button" disabled={Boolean(busy) || !deliveryConfirmed} onClick={() => void linkAction("retry_quote_delivery", { deliveryId: latestDelivery.id })}>{busy === "retry_quote_delivery" ? "Retrying..." : "Retry email"}</button>}</aside>}{quote.link.shareUrl ? <><div className="trade-quote-share-link"><input aria-label="Secure quote link" readOnly value={quote.link.shareUrl} /><button type="button" onClick={() => void copyLink()}>Copy link</button><a href={quote.link.shareUrl} target="_blank" rel="noreferrer">Preview</a></div><small>Expires {new Date(quote.link.expiresAt).toLocaleDateString("en-AU")} | Current issue {quote.link.tokenIssue}</small>{canSendQuote && <label className="trade-quote-delivery-confirm"><input type="checkbox" checked={deliveryConfirmed} onChange={(event) => setDeliveryConfirmed(event.target.checked)} /><span>I confirm {quote.link.recipientPreview || "this customer"} asked to receive this current quote by email.</span></label>}<div className="trade-quote-share-actions">{canSendQuote && <button type="button" disabled={Boolean(busy) || !deliveryConfirmed} onClick={() => void linkAction("send_quote")}>{busy === "send_quote" ? "Submitting..." : "Email quote"}</button>}{quote.link.pdfUrl && <a href={quote.link.pdfUrl} target="_blank" rel="noreferrer">Download issued PDF</a>}{canEditQuote && <button type="button" disabled={Boolean(busy)} onClick={() => void linkAction("replace_link")}>Replace link</button>}{canEditQuote && <button type="button" disabled={Boolean(busy)} onClick={() => void linkAction("revoke_link")}>Revoke link</button>}</div>{canSendQuote && <small>SMS stays unavailable until the approved Australian sender gate is active.</small>}</> : canEditQuote ? <div className="trade-quote-share-actions"><button type="button" disabled={Boolean(busy) || quote.link.status === "accepted" || quote.link.status === "declined"} onClick={() => void linkAction("replace_link")}>Create replacement link</button></div> : null}</section>}
    {(quote?.timeline?.length || 0) > 0 && <details className="trade-quote-timeline"><summary>Quote activity ({quote?.timeline?.length || 0})</summary>{quote?.timeline?.map((event, index) => <article key={`${event.occurredAt}:${index}`}><strong>{event.type.replaceAll("_", " ")}</strong><span>{event.summary}</span><small>{new Date(event.occurredAt).toLocaleString("en-AU")}</small></article>)}</details>}
    {quote && quote.versions.length > 0 && <details className="trade-quote-history"><summary>Quote history ({quote.versions.length})</summary>{quote.versions.map((version) => <article key={version.id}><div><strong>Version {version.versionNumber} | {version.status.replaceAll("_", " ")}</strong><span>{version.choices.length ? `${version.choices.length} customer choices` : money(version.totalCents)}{version.issuedAt ? ` | Issued ${new Date(version.issuedAt).toLocaleDateString("en-AU")}` : " | Draft"}</span></div>{version.acceptance && <small>{version.acceptance.decision.replaceAll("_", " ")} by {version.acceptance.actorType === "secure_link_holder" ? version.acceptance.signerName : `verified account ${version.acceptance.actorEmail}`} on {new Date(version.acceptance.decidedAt).toLocaleString("en-AU")}{version.acceptance.selectionSummary ? ` | ${version.acceptance.selectionSummary} | ${money(version.acceptance.selectedTotalCents)}` : ""}</small>}</article>)}</details>}
    {message && <p className="trade-import-status" role="status">{message}</p>}
    </div>{showLivePreview && <TradeQuoteLivePreview user={user} workOrderId={workOrderId} lines={lines} choices={choices} business={business} job={jobSummary} identity={nextQuoteIdentity(quote, jobSummary)} customerMessage={customerMessage} terms={terms} validUntil={validUntil} validationMessage={quoteValidationIssue?.message || ""} roofImage={roofImage} equipment={equipment} productDocuments={current?.productDocuments} pdfVersionId={current?.id} pdfUpdatedAt={quote?.editableDraft?.updatedAt} draftDirty={draftDirty} />}</div>
    {acceptedPhotoPreview && <div className="dashboard-photo-lightbox-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setAcceptedPhotoPreview(null); }}>
      <div ref={acceptedPhotoDialogRef} className="dashboard-photo-lightbox-dialog" role="dialog" aria-modal="true" aria-labelledby="trade-quote-photo-title" aria-describedby="trade-quote-photo-help" tabIndex={-1}>
        <header><div><span>Customer-shared quoting photo</span><h2 id="trade-quote-photo-title">{acceptedPhotoPreview.photo.label || "Quote preparation photo"}</h2></div><button ref={acceptedPhotoCloseRef} type="button" aria-label="Close full image" onClick={() => setAcceptedPhotoPreview(null)}><span aria-hidden="true">X</span></button></header>
        <div className={`dashboard-photo-lightbox-stage ${acceptedPhotoPreview.status}`} aria-busy={acceptedPhotoPreview.status === "loading"} onMouseDown={(event) => { if (event.currentTarget === event.target) setAcceptedPhotoPreview(null); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={acceptedPhotoPreview.url} alt={acceptedPhotoPreview.photo.label || "Customer-shared quote photo"} onLoad={() => setAcceptedPhotoPreview((current) => current ? { ...current, status: "ready" } : current)} onError={() => setAcceptedPhotoPreview((current) => current ? { ...current, status: "error" } : current)} />
          {acceptedPhotoPreview.status === "loading" && <p role="status">Opening the full image...</p>}
          {acceptedPhotoPreview.status === "error" && <p role="alert">The full image could not be displayed.</p>}
        </div>
        <p id="trade-quote-photo-help">Select X, press Escape or click outside the image to close.</p>
      </div>
    </div>}
    {canSendQuote && sendPreview && <dialog ref={previewDialogRef} className={previewStyles.sendDialog} aria-busy={Boolean(busy)} aria-labelledby="quote-send-preview-title" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) setSendPreview(null); }}>
      <header className={previewStyles.sendHeader}><div><h3 id="quote-send-preview-title">Review your quote</h3><p>To <strong>{customerEmail}</strong></p></div><button type="button" disabled={Boolean(busy)} onClick={() => setSendPreview(null)}>Close</button></header>
      <div className={previewStyles.sendBody}>
        <TradeQuoteLivePreview user={user} workOrderId={workOrderId} lines={lines} choices={choices} business={business} job={jobSummary} identity={nextQuoteIdentity(quote, jobSummary)} customerMessage={customerMessage} terms={terms} validUntil={validUntil} validationMessage={quoteValidationIssue?.message || ""} roofImage={roofImage} equipment={equipment} productDocuments={current?.productDocuments} pdfVersionId={pendingIssueVersionId || current?.id} pdfUpdatedAt={sendPreview.expectedUpdatedAt} draftDirty={false} review />
        <details className={previewStyles.emailDetails}><summary>Email details</summary><p><strong>Subject</strong> {sendPreview.delivery.subject}</p><p><strong>Quote PDF</strong> {sendPreview.delivery.attachmentName}</p><p>The PDF is attached when it fits your email connection: up to 18 MB with Google or TLink email, or 2 MB with Microsoft. Larger PDFs are available from the secure review link.</p></details>
      </div>
      <footer className={previewStyles.sendFooter}>
        <label className={previewStyles.sendConsent}><input type="checkbox" checked={sendConsent} disabled={Boolean(busy) || sendOutcome.kind === "success" || sendOutcome.kind === "attention"} onChange={(event) => setSendConsent(event.target.checked)} /><span>The customer asked to receive this quote by email.</span></label>
        {sendOutcome.message && <p className={previewStyles.sendStatus} role={sendOutcome.kind === "error" || sendOutcome.kind === "attention" ? "alert" : "status"} aria-live="polite">{sendOutcome.message}</p>}
        {jobSummary?.publicLead && (sendOutcome.kind === "success" || sendOutcome.kind === "attention" || (sendOutcome.kind === "sending" && !busy)) && <p className={previewStyles.sendStatus}>This job can be scheduled after the customer accepts the quote.</p>}
        <div className={previewStyles.sendActions}>{sendOutcome.kind === "success" || sendOutcome.kind === "attention" || (sendOutcome.kind === "sending" && !busy)
          ? <><button type="button" onClick={() => setSendPreview(null)}>Done</button>{onScheduleJob && !jobSummary?.publicLead && <button type="button" className={previewStyles.sendPrimary} onClick={() => { setSendPreview(null); onScheduleJob(); }}>Schedule job</button>}</>
          : <><small>{sendConsent ? "Ready to send" : "Tick the box above to enable sending."}</small><button type="button" disabled={Boolean(busy)} onClick={() => setSendPreview(null)}>Back to editing</button><button type="button" className={previewStyles.sendPrimary} disabled={Boolean(busy) || !sendConsent} onClick={() => void sendPreviewedQuote()}>{busy === "preview_send" ? "Sending..." : sendOutcome.kind === "error" ? "Try again safely" : "Email quote"}</button></>}</div>
      </footer>
    </dialog>}
  </section>;
}
