"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { normaliseTradeQuoteLineGroup } from "@/lib/trade-quote";
import { tradeQuoteDocumentDisplayTotals } from "@/lib/trade-quote-document-totals.mjs";
import {
  clearTradeRebateEstimateDraft,
  loadTradeRebateEstimateDraft,
  type TradeRebateEstimateDraft,
} from "@/lib/trade-rebate-draft";

type QuoteLine = { id?: string; priceBookItemId?: string; jobPacketId?: string; jobPacketLineId?: string; lineType: string; description: string; quantity: string; unitPrice: string; taxCode: string; sectionHeading: string; totalCents?: number };
type SavedLine = { id: string; priceBookItemId: string; jobPacketId: string; jobPacketLineId: string; lineType: string; description: string; quantityMilli: number; unitPriceCents: number; taxCode: string; sectionHeading: string; totalCents: number };
type PriceBookItem = { id: string; itemCode: string; name: string; description: string; itemType: string; lineType: string; unitLabel: string; sellPriceCentsExGst: number; taxCode: string };
type JobPacket = { id: string; packetCode: string; name: string; revision: number; suggestedCrewSize: number; taskCount: number; formCount: number; activeCrewCount: number; crewReady: boolean; unavailableItemCount: number; canApply: boolean; summary: { sellCentsExGst: number; estimatedDurationMinutes: number }; lines: Array<{ id: string; priceBookItemId: string; name: string; lineType: string; quantityMilli: number; sellPriceCentsExGst: number; taxCode: string }> };
type QuoteChoice = { id?: string; clientKey: string; kind: "package" | "addon" | "choose_one"; groupKey: string; name: string; summary: string; recommended: boolean; subtotalCents?: number; taxCents?: number; totalCents?: number; lines: QuoteLine[] };
type SavedChoice = Omit<QuoteChoice, "lines"> & { id: string; items: SavedLine[]; subtotalCents: number; taxCents: number; totalCents: number };
type QuoteVersion = { id: string; versionNumber: number; status: string; customerEmail: string; subtotalCents: number; taxCents: number; totalCents: number; terms: string; customerMessage: string; validUntil: string; consentStatement: string; issuedAt: string; items: SavedLine[]; choices: SavedChoice[]; internalSummary?: { costCentsExGst: number; sellCentsExGst: number; marginCentsExGst: number }; acceptance: null | { decision: string; actorEmail: string; actorType: string; signerName: string; decidedAt: string; consentStatement: string; selectionSummary: string; selectedTotalCents: number } };
type QuoteDelivery = { id: string; channel: string; provider: string; status: string; recipientPreview: string; attempts: number; providerStatus: string; sentAt: string; deliveredAt: string; createdAt: string; lastError: string };
type Quote = { id: string; quoteNumber: string; currentVersionNumber: number; status: string; versions: QuoteVersion[];
  link: null | { id: string; status: string; expiresAt: string; tokenIssue: number; shareUrl: string; pdfUrl: string; recipientPreview: string };
  timeline: Array<{ type: string; actorType: string; summary: string; occurredAt: string }>;
  questions: Array<{ id: string; question: string; answer: string; status: string; askedAt: string; answeredAt: string }>;
  deliveries: QuoteDelivery[] };
type QuoteJob = { customerId: string; customerNumber: string; customerName: string; workNumber: string; title: string; siteLabel: string; siteSummary: string };
type QuoteBusiness = { businessName: string; quoteEmailSubjectTemplate: string; quoteEmailIntro: string; quoteDefaultTerms: string; brandThemeKey: string; brandBorderStyle: string; hasLogo: boolean; hasBanner: boolean };
type QuoteResult = { ok?: boolean; authorisedEmails?: string[]; priceBookItems?: PriceBookItem[]; jobPackets?: JobPacket[]; quote?: Quote | null; job?: QuoteJob; business?: QuoteBusiness; error?: string };
type QuotePreviewLine = { description: string; sectionHeading: string; quantityMilli: number; unitPriceCents: number; taxCode: string; subtotalCents: number; taxCents: number; totalCents: number };
type QuotePreviewGroup = { lines: QuotePreviewLine[]; subtotalCents: number; taxCents: number; totalCents: number };
type QuoteDeliveryPreview = { quoteNumber: string; versionNumber: number | null; subject: string; attachmentName: string; identityKnown: boolean };
type QuoteSendPreview = {
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

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const blankLine = (): QuoteLine => ({ lineType: "product", description: "", quantity: "1", unitPrice: "0.00", taxCode: "gst", sectionHeading: "Included work" });
const editLine = (line: SavedLine, activeIds: Set<string>): QuoteLine => ({ ...line, priceBookItemId: activeIds.has(line.priceBookItemId) ? line.priceBookItemId : "", quantity: (line.quantityMilli / 1000).toString(), unitPrice: (line.unitPriceCents / 100).toFixed(2) });
const choiceKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

function deliveryStatusCopy(delivery: QuoteDelivery) {
  if (delivery.status === "delivered") {
    return {
      label: "Delivery confirmed",
      detail: "An authenticated email provider event confirmed delivery.",
    };
  }
  if (delivery.status === "sent") {
    return {
      label: "Provider reports sent",
      detail: "The email provider reports sending the message. Inbox placement is not confirmed.",
    };
  }
  if (delivery.status === "provider_accepted") {
    return {
      label: "Accepted by email provider",
      detail: "The provider accepted the email and PDF for delivery. Inbox delivery is not yet confirmed.",
    };
  }
  if (delivery.status === "sending" || delivery.status === "queued") {
    return {
      label: "Submitting to email provider",
      detail: "TLink is preparing this exact quote for the email provider.",
    };
  }
  if (delivery.status === "bounced") {
    return {
      label: "Email bounced",
      detail: "The authenticated email provider reported that the recipient did not accept the message.",
    };
  }
  if (delivery.status === "opted_out") {
    return {
      label: "Email delivery stopped",
      detail: "The recipient or email provider stopped further quote delivery to this address.",
    };
  }
  if (delivery.status === "failed") {
    return {
      label: "Email submission failed",
      detail: "The provider did not accept this attempt. Review the address and retry when ready.",
    };
  }
  return {
    label: delivery.status.replaceAll("_", " "),
    detail: "The latest delivery state is shown exactly as recorded.",
  };
}

function nextQuoteIdentity(quote: Quote | null, job: QuoteJob | null) {
  if (!quote) {
    if (!job?.workNumber) return null;
    const quoteNumber = cleanDeliveryText(`Q-${job.workNumber.replace(/^JOB-/, "")}`, 120);
    return quoteNumber ? { quoteNumber, versionNumber: 1 } : null;
  }
  const current = quote.versions.find((version) => version.versionNumber === quote.currentVersionNumber);
  const quoteNumber = cleanDeliveryText(quote.quoteNumber, 120);
  if (!quoteNumber || !current) return null;
  return {
    quoteNumber,
    versionNumber: current.status === "draft" ? quote.currentVersionNumber : quote.currentVersionNumber + 1,
  };
}

function previewGroup(lines: QuoteLine[], allowEmpty = false): QuotePreviewGroup {
  const calculated = normaliseTradeQuoteLineGroup(lines, (value) => String(value || "").trim().slice(0, 500), allowEmpty);
  return { ...calculated, lines: calculated.lines.map((line, index) => ({ ...line, sectionHeading: lines[index]?.sectionHeading || "Included work" })) };
}

function previewError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (["INVALID_LINES", "INVALID_QUANTITY", "INVALID_DECIMAL", "INVALID_MONEY", "INVALID_TAX", "INVALID_TOTAL"].includes(code)) return "Complete every quote item with a description, valid quantity, price and GST choice before previewing.";
  return error instanceof Error ? error.message : "The quote could not be previewed.";
}

function packetLines(packet: JobPacket, sectionHeading: string): QuoteLine[] {
  return packet.lines.map((line) => ({ priceBookItemId: line.priceBookItemId, jobPacketId: packet.id, jobPacketLineId: line.id,
    lineType: line.lineType, description: line.name, quantity: (line.quantityMilli / 1000).toString(),
    unitPrice: (line.sellPriceCentsExGst / 100).toFixed(2), taxCode: line.taxCode, sectionHeading }));
}

export function TradeQuotePanel({ user, workOrderId, available, onOpenPriceBook, onOpenCustomer, onChanged }: { user: User; workOrderId: string; available: boolean; onOpenPriceBook: () => void; onOpenCustomer?: (customerId: string) => void; onChanged?: () => void | Promise<void> }) {
  const [quote, setQuote] = useState<Quote | null>(null); const [emails, setEmails] = useState<string[]>([]);
  const [priceBookItems, setPriceBookItems] = useState<PriceBookItem[]>([]); const [jobPackets, setJobPackets] = useState<JobPacket[]>([]);
  const [lines, setLines] = useState<QuoteLine[]>([blankLine()]); const [choices, setChoices] = useState<QuoteChoice[]>([]); const [packetId, setPacketId] = useState("");
  const [jobSummary, setJobSummary] = useState<QuoteJob | null>(null); const [business, setBusiness] = useState<QuoteBusiness | null>(null);
  const [customerEmail, setCustomerEmail] = useState(""); const [terms, setTerms] = useState(""); const [customerMessage, setCustomerMessage] = useState(""); const [validUntil, setValidUntil] = useState("");
  const [saveAsBusinessDefault, setSaveAsBusinessDefault] = useState(false); const [addingRecipient, setAddingRecipient] = useState(false);
  const [recipientFirstName, setRecipientFirstName] = useState(""); const [recipientLastName, setRecipientLastName] = useState(""); const [recipientEmail, setRecipientEmail] = useState("");
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false); const [answer, setAnswer] = useState(""); const [answeringId, setAnsweringId] = useState("");
  const [sendPreview, setSendPreview] = useState<QuoteSendPreview | null>(null); const [sendConsent, setSendConsent] = useState(false);
  const [rebateDraft, setRebateDraft] = useState<TradeRebateEstimateDraft | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previewDialogRef = useRef<HTMLElement | null>(null);

  const request = useCallback(async (init: RequestInit = {}) => {
    const token = await user.getIdToken(); const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api/trade-quotes${init.method ? "" : `?workOrderId=${encodeURIComponent(workOrderId)}`}`, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as QuoteResult;
    if (!response.ok || result.ok === false) throw new Error(result.error || "The quote could not be loaded.");
    return result;
  }, [user, workOrderId]);

  const applyResult = useCallback((result: QuoteResult) => {
    setQuote(result.quote || null); if (result.authorisedEmails) setEmails(result.authorisedEmails);
    if (result.job) setJobSummary(result.job); if (result.business) setBusiness(result.business);
    const activeItems = result.priceBookItems || []; if (result.priceBookItems) setPriceBookItems(result.priceBookItems); if (result.jobPackets) setJobPackets(result.jobPackets);
    const current = result.quote?.versions.find((version) => version.versionNumber === result.quote?.currentVersionNumber);
    if (current) {
      const activeIds = new Set(activeItems.map((item) => item.id)); setLines(current.items.map((line) => editLine(line, activeIds)));
      setChoices(current.choices.map((choice) => ({ ...choice, lines: choice.items.map((line) => editLine(line, activeIds)) })));
      setCustomerEmail(current.customerEmail); setTerms(current.terms); setCustomerMessage(current.customerMessage || ""); setValidUntil(current.validUntil);
    } else {
      if (result.authorisedEmails?.length) setCustomerEmail((value) => value || result.authorisedEmails?.[0] || "");
      if (result.business) {
        setTerms((value) => value || result.business?.quoteDefaultTerms || "");
        setCustomerMessage((value) => value || result.business?.quoteEmailIntro || "");
      }
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    const frame = window.requestAnimationFrame(() => void request().then(applyResult).catch((error) => setMessage(error.message)));
    return () => window.cancelAnimationFrame(frame);
  }, [applyResult, available, request]);

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
    const focusableElements = () => dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute("aria-hidden") !== "true")
      : [];
    const focusFrame = window.requestAnimationFrame(() => {
      const first = focusableElements()[0];
      (first || dialog)?.focus({ preventScroll: true });
    });
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dialog?.getAttribute("aria-busy") !== "true") setSendPreview(null);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", containFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", containFocus);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [sendPreview]);

  function addSavedLine(itemId: string, targetChoiceKey = "") {
    const item = priceBookItems.find((candidate) => candidate.id === itemId); if (!item) return;
    const line: QuoteLine = { priceBookItemId: item.id, lineType: item.lineType, description: item.description || item.name, quantity: "1", unitPrice: (item.sellPriceCentsExGst / 100).toFixed(2), taxCode: item.taxCode, sectionHeading: "Included work" };
    if (targetChoiceKey) setChoices((current) => current.map((choice) => choice.clientKey === targetChoiceKey ? { ...choice, lines: [...choice.lines.filter((row) => row.description), line] } : choice));
    else setLines((current) => current.length === 1 && !current[0].description ? [line] : [...current, line]);
  }

  function applyRebateDiscount() {
    if (!rebateDraft) return;
    const line: QuoteLine = {
      lineType: "adjustment",
      description: `Rebate discount - ${rebateDraft.activityTitle} (${rebateDraft.quantity} ${rebateDraft.unit} estimate)`,
      quantity: "1",
      unitPrice: `-${rebateDraft.customerDiscountDollars}`,
      taxCode: "gst",
      sectionHeading: "Rebate and discounts",
    };
    setLines((current) => (
      current.length === 1 && !current[0].description ? [line] : [...current, line]
    ));
    clearTradeRebateEstimateDraft(window.sessionStorage, user.uid);
    setRebateDraft(null);
    setMessage("Rebate discount added. Check the amount and GST before saving the quote.");
  }

  function applyPacket(asPackages: boolean) {
    const packet = jobPackets.find((candidate) => candidate.id === packetId); if (!packet?.canApply) return;
    if (!asPackages) {
      setLines((current) => [...current.filter((line) => line.description && line.jobPacketId !== packet.id), ...packetLines(packet, "Included work")]);
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

  function addChooseOne() {
    const groupKey = choiceKey("choice");
    setChoices((current) => [...current,
      { clientKey: `${groupKey}-a`, kind: "choose_one", groupKey, name: "Option A", summary: "First available approach.", recommended: true, lines: [blankLine()] },
      { clientKey: `${groupKey}-b`, kind: "choose_one", groupKey, name: "Option B", summary: "Alternative approach.", recommended: false, lines: [blankLine()] },
    ]);
  }

  function updateBaseLine(index: number, field: keyof QuoteLine, value: string) { setLines((current) => current.map((line, position) => position === index ? { ...line, [field]: value } : line)); }
  function updateChoice(key: string, patch: Partial<QuoteChoice>) {
    setChoices((current) => current.map((choice) => {
      if (choice.clientKey === key) return { ...choice, ...patch };
      if (patch.recommended && choice.kind !== "addon" && choice.kind === current.find((item) => item.clientKey === key)?.kind && choice.groupKey === current.find((item) => item.clientKey === key)?.groupKey) return { ...choice, recommended: false };
      return choice;
    }));
  }
  function updateChoiceLine(key: string, index: number, field: keyof QuoteLine, value: string) { setChoices((current) => current.map((choice) => choice.clientKey === key ? { ...choice, lines: choice.lines.map((line, position) => position === index ? { ...line, [field]: value } : line) } : choice)); }

  async function saveDraft() {
    setBusy("save_draft"); setMessage("");
    try {
      const result = await request({ method: "POST", body: JSON.stringify({ action: "save_draft", workOrderId, lines, choices, customerEmail, terms, customerMessage, validUntil, saveAsBusinessDefault }) });
      applyResult({ ...result, authorisedEmails: emails, priceBookItems, jobPackets }); await onChanged?.();
      setSaveAsBusinessDefault(false);
      setMessage(saveAsBusinessDefault ? "Draft and business quote defaults saved." : "Draft saved with server-calculated totals and internal margin controls.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The quote could not be updated."); }
    finally { setBusy(""); }
  }
  function openSendPreview() {
    setMessage("");
    try {
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
      setSendConsent(false); setSendPreview({ base, choices: previewChoices, displayTotals, delivery });
    } catch (error) { setMessage(previewError(error)); }
  }
  async function sendPreviewedQuote() {
    if (!sendPreview || !sendConsent) return;
    setBusy("preview_send"); setMessage("");
    let draftSaved = false; let quoteIssued = false;
    try {
      const saved = await request({ method: "POST", body: JSON.stringify({ action: "save_draft", workOrderId, lines, choices, customerEmail, terms, customerMessage, validUntil, saveAsBusinessDefault }) });
      draftSaved = true; applyResult({ ...saved, authorisedEmails: emails, priceBookItems, jobPackets });
      setSaveAsBusinessDefault(false);
      const issued = await request({ method: "POST", body: JSON.stringify({ action: "issue_quote", workOrderId }) });
      quoteIssued = true; applyResult({ ...issued, authorisedEmails: emails, priceBookItems, jobPackets });
      const sent = await request({ method: "POST", body: JSON.stringify({ action: "send_quote", workOrderId, channel: "email", consentConfirmed: true }) });
      applyResult({ ...sent, authorisedEmails: emails, priceBookItems, jobPackets }); setSendPreview(null); setSendConsent(false);
      setMessage("Quote saved and issued. The email provider accepted it for delivery; inbox delivery is not yet confirmed."); await onChanged?.();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The quote could not be sent.";
      if (quoteIssued) {
        setSendPreview(null); setSendConsent(false); setMessage(`Quote issued, but the email was not accepted for delivery. ${reason} Use Email quote below to retry.`); await onChanged?.();
      } else if (draftSaved) setMessage(`Draft saved, but the quote was not issued or submitted for delivery. ${reason}`);
      else setMessage(reason);
    } finally { setBusy(""); }
  }
  async function addQuoteRecipient() {
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
  async function linkAction(action: "replace_link" | "revoke_link" | "send_quote" | "answer_question", extra: Record<string, unknown> = {}) {
    setBusy(action); setMessage("");
    try { const result = await request({ method: "POST", body: JSON.stringify({ action, workOrderId, consentConfirmed: deliveryConfirmed, ...extra }) }); applyResult({ ...result, authorisedEmails: emails, priceBookItems, jobPackets });
      setMessage(action === "send_quote" ? "The email provider accepted this quote for delivery. Inbox delivery is not yet confirmed." : action === "replace_link" ? "A new secure link replaced the old one." : action === "revoke_link" ? "The secure link is revoked." : "Response added to the quote timeline.");
      if (action === "answer_question") { setAnswer(""); setAnsweringId(""); } await onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The quote link could not be updated."); } finally { setBusy(""); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(quote?.link?.shareUrl || ""); setMessage("Secure quote link copied."); }
    catch { setMessage("Copy was blocked by this browser. Select the link and copy it manually."); }
  }

  function lineEditor(line: QuoteLine, index: number, onChange: (field: keyof QuoteLine, value: string) => void, onRemove: () => void, canRemove: boolean) {
    const linked = Boolean(line.priceBookItemId);
    return <div className="trade-quote-line" key={`${index}:${line.id || "new"}`}>
      <label className="trade-quote-field"><span>Type</span><select aria-label={`Line ${index + 1} type`} value={line.lineType} disabled={linked} onChange={(event) => onChange("lineType", event.target.value)}><option value="product">Product</option><option value="labour">Labour</option><option value="adjustment">Adjustment</option></select></label>
      <label className="trade-quote-description"><span>Description and section</span><input aria-label={`Line ${index + 1} description`} value={line.description} maxLength={500} readOnly={linked} onChange={(event) => onChange("description", event.target.value)} placeholder="Description" /><input className="trade-quote-section-input" aria-label={`Line ${index + 1} section heading`} value={line.sectionHeading} maxLength={120} onChange={(event) => onChange("sectionHeading", event.target.value)} placeholder="Customer section heading" />{line.priceBookItemId && <small>{line.jobPacketId ? "Common job item" : "Saved item"}, description, type, price and GST come from the current price book. Change the quantity or customer section here.</small>}</label>
      <label className="trade-quote-field"><span>Quantity</span><input aria-label={`Line ${index + 1} quantity`} value={line.quantity} inputMode="decimal" onChange={(event) => onChange("quantity", event.target.value)} /></label>
      <label className="trade-quote-field"><span>Unit price</span><input aria-label={`Line ${index + 1} unit price`} value={line.unitPrice} inputMode="decimal" readOnly={linked} onChange={(event) => onChange("unitPrice", event.target.value)} /></label>
      <label className="trade-quote-field"><span>Tax</span><select aria-label={`Line ${index + 1} tax`} value={line.taxCode} disabled={linked} onChange={(event) => onChange("taxCode", event.target.value)}><option value="gst">GST 10%</option><option value="none">No GST</option></select></label>
      <button type="button" disabled={!canRemove} onClick={onRemove}>Remove</button>
    </div>;
  }

  if (!available) return <section className="trade-quote-panel unavailable"><strong>Direct quote unavailable</strong><p>Link an authoritative direct customer and service site before creating a customer-acceptance quote. Protected marketplace jobs remain in the platform quote workflow.</p></section>;
  const current = quote?.versions.find((version) => version.versionNumber === quote.currentVersionNumber); const draftMode = !current || current.status === "draft";
  const latestDelivery = quote?.deliveries?.[0] || null;
  const latestDeliveryStatus = latestDelivery ? deliveryStatusCopy(latestDelivery) : null;
  const openQuestions = quote?.questions?.filter((item) => item.status === "open") || [];
  return <section className="trade-quote-panel">
    <header><div><span>Clear customer quote</span><h4>{quote?.quoteNumber || "New quote"}{current ? ` | Version ${current.versionNumber}` : ""}</h4><p>Keep a simple quote fast, or build clear choices without retyping standard work. Issued versions are immutable.</p></div>{current && <strong className={`quote-status ${current.status}`}>{current.status.replaceAll("_", " ")}</strong>}</header>
    {(quote?.questions?.length || 0) > 0 && <section className={`trade-quote-questions ${openQuestions.length ? "needs-attention" : ""}`} id="quote-questions"><span>{openQuestions.length ? `${openQuestions.length} customer ${openQuestions.length === 1 ? "question needs" : "questions need"} a reply` : "Customer questions"}</span><h5>{openQuestions.length ? "Reply before the job moves on" : "Questions and replies"}</h5>{quote?.questions?.map((item) => <article key={item.id}><div><strong>{item.question}</strong><small>Asked {new Date(item.askedAt).toLocaleString("en-AU")}</small>{item.answer && <p>{item.answer}</p>}</div>{item.status === "open" && (answeringId === item.id ? <div><textarea aria-label="Quote question response" rows={3} maxLength={1000} value={answer} onChange={(event) => setAnswer(event.target.value)} /><button type="button" disabled={answer.trim().length < 2 || Boolean(busy)} onClick={() => void linkAction("answer_question", { questionId: item.id, answer })}>Send response</button></div> : <button type="button" onClick={() => setAnsweringId(item.id)}>Answer</button>)}</article>)}</section>}
    {rebateDraft && <section className="trade-rebate-document-offer"><div><span>REBATE ESTIMATE READY</span><strong>{rebateDraft.quantity} {rebateDraft.unit} | ${rebateDraft.customerDiscountDollars} customer discount</strong><small>{rebateDraft.activityTitle}</small></div><button type="button" onClick={applyRebateDiscount}>Add discount to this quote</button></section>}
    <div className="trade-quote-price-book"><label><span>Add a saved item</span><select aria-label="Add a saved price-book item" value="" disabled={!priceBookItems.length} onChange={(event) => addSavedLine(event.target.value)}><option value="">{priceBookItems.length ? "Choose a saved item" : "No saved items yet"}</option>{priceBookItems.map((item) => <option key={item.id} value={item.id}>{item.name} | {money(item.sellPriceCentsExGst)} ex GST / {item.unitLabel}</option>)}</select></label>{priceBookItems.length ? <small>Select an item once, then adjust only its quantity. Current description, type, price and GST are checked again when the draft is saved.</small> : <div><small>Save your common labour, materials and call-outs once, then reuse them here.</small><button type="button" onClick={onOpenPriceBook}>Open Price book</button></div>}</div>
    {jobPackets.length > 0 && <div className="trade-quote-packets"><label><span>Start from a common job</span><select value={packetId} onChange={(event) => setPacketId(event.target.value)}><option value="">Choose saved common work</option>{jobPackets.map((packet) => <option key={packet.id} value={packet.id} disabled={!packet.canApply}>{packet.name} | {packet.lines.length} items | {money(packet.summary.sellCentsExGst)} ex GST{packet.canApply ? "" : " | needs attention"}</option>)}</select></label><div className="trade-quote-packet-actions"><button type="button" disabled={!packetId} onClick={() => applyPacket(false)}>Use standard job</button><button type="button" disabled={!packetId} onClick={() => applyPacket(true)}>Build Good, Better, Best</button></div><small>One common job can stay simple or become three customer choices. Edit only what differs.</small></div>}
    {lines.length > 0 && <section className="trade-quote-base"><header><div><strong>Quote items</strong><span>{choices.length ? "These items are included before any customer choices." : "The fastest path for straightforward work."}</span></div></header><div className="trade-quote-lines"><div className="trade-quote-line headings" aria-hidden="true"><span>Type</span><span>Description and section</span><span>Quantity</span><span>Unit price</span><span>Tax</span><span></span></div>{lines.map((line, index) => lineEditor(line, index, (field, value) => updateBaseLine(index, field, value), () => setLines((currentLines) => currentLines.filter((_, position) => position !== index)), lines.length > 1 || choices.length > 0))}</div></section>}
    <div className="trade-quote-builder-actions"><button className="quote-add-line" type="button" onClick={() => setLines((current) => [...current, blankLine()])}>Add included line</button><button type="button" onClick={addAddon}>Add optional extra</button><button type="button" onClick={addChooseOne}>Add choose-one pair</button></div>
    {choices.length > 0 && <section className="trade-quote-choice-builder"><header><div><span>Customer choices</span><h5>Make the decision easy</h5><p>Packages use one clear selection. Optional extras are independent. Choose-one pairs require one answer.</p></div><button type="button" onClick={() => setChoices([])}>Remove all choices</button></header><div className="trade-quote-choice-grid">{choices.map((choice) => <article key={choice.clientKey} className={choice.recommended ? "recommended" : ""}><header><div><span>{choice.kind === "package" ? "Package" : choice.kind === "addon" ? "Optional extra" : "Choose one"}</span><input aria-label="Customer choice name" value={choice.name} maxLength={120} onChange={(event) => updateChoice(choice.clientKey, { name: event.target.value })} /></div><button type="button" onClick={() => setChoices((currentChoices) => currentChoices.filter((item) => item.clientKey !== choice.clientKey))}>Remove</button></header><textarea aria-label={`${choice.name} summary`} value={choice.summary} maxLength={500} rows={2} onChange={(event) => updateChoice(choice.clientKey, { summary: event.target.value })} /><label className="trade-quote-recommended"><input type="checkbox" checked={choice.recommended} onChange={(event) => updateChoice(choice.clientKey, { recommended: event.target.checked })} /><span>Show as recommended</span></label><label className="trade-quote-choice-add"><span>Quick add saved item</span><select value="" onChange={(event) => addSavedLine(event.target.value, choice.clientKey)}><option value="">Choose price-book item</option>{priceBookItems.map((item) => <option key={item.id} value={item.id}>{item.name} | {money(item.sellPriceCentsExGst)} ex GST</option>)}</select></label><div className="trade-quote-choice-lines">{choice.lines.map((line, index) => lineEditor(line, index, (field, value) => updateChoiceLine(choice.clientKey, index, field, value), () => updateChoice(choice.clientKey, { lines: choice.lines.filter((_, position) => position !== index) }), choice.lines.length > 1))}</div><button className="quote-add-line" type="button" onClick={() => updateChoice(choice.clientKey, { lines: [...choice.lines, blankLine()] })}>Add line to this choice</button>{choice.totalCents != null && <strong className="trade-quote-choice-total">{money(choice.totalCents)} incl GST</strong>}</article>)}</div></section>}
    <div className="trade-quote-settings">
      <div className="trade-quote-recipient wide"><label><span>Send quote to</span><select value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)}><option value="">Choose authorised contact</option>{emails.map((email) => <option key={email}>{email}</option>)}</select><small>The secure link needs no customer account. Every added address becomes an authorised contact on this customer record.</small></label><div className="trade-quote-recipient-actions"><button type="button" onClick={() => setAddingRecipient((value) => !value)}>{addingRecipient ? "Cancel new email" : "Add another email"}</button>{jobSummary?.customerId && onOpenCustomer && <button type="button" onClick={() => onOpenCustomer(jobSummary.customerId)}>Open customer details</button>}</div></div>
      {addingRecipient && <section className="trade-quote-add-recipient wide" aria-label="Add quote recipient"><header><div><span>New authorised contact</span><strong>Add a different quote email</strong></div><small>This saves the recipient to the customer so it can be checked and reused.</small></header><div><label><span>First name</span><input value={recipientFirstName} maxLength={80} autoComplete="given-name" onChange={(event) => setRecipientFirstName(event.target.value)} /></label><label><span>Last name</span><input value={recipientLastName} maxLength={80} autoComplete="family-name" onChange={(event) => setRecipientLastName(event.target.value)} /></label><label><span>Email</span><input type="email" value={recipientEmail} maxLength={180} autoComplete="email" onChange={(event) => setRecipientEmail(event.target.value)} /></label><button type="button" disabled={busy === "add_quote_recipient"} onClick={() => void addQuoteRecipient()}>{busy === "add_quote_recipient" ? "Adding..." : "Add and use email"}</button></div></section>}
      <label><span>Valid until</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
      <label className="wide"><span>Customer email introduction</span><textarea rows={3} maxLength={1200} value={customerMessage} onChange={(event) => setCustomerMessage(event.target.value)} placeholder="A short, personal introduction that appears in the email and quote." /></label>
      <label className="wide"><span>Recorded terms</span><textarea rows={4} maxLength={4000} value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Scope assumptions, exclusions and completion terms" /></label>
      <label className="trade-quote-save-default wide"><input type="checkbox" checked={saveAsBusinessDefault} onChange={(event) => setSaveAsBusinessDefault(event.target.checked)} /><span>Use this introduction and these terms as the editable default for future quotes.</span></label>
    </div>
    {current && <><div className="trade-quote-totals"><div><span>Subtotal</span><strong>{money(current.subtotalCents)}</strong></div><div><span>GST</span><strong>{money(current.taxCents)}</strong></div><div><span>Total</span><strong>{money(current.totalCents)}</strong></div></div>{current.internalSummary && <aside className="trade-quote-internal" aria-label="Internal commercial summary"><div><span>Internal only</span><strong>All saved scope</strong></div><dl><div><dt>Cost ex GST</dt><dd>{money(current.internalSummary.costCentsExGst)}</dd></div><div><dt>Sell ex GST</dt><dd>{money(current.internalSummary.sellCentsExGst)}</dd></div><div><dt>Margin ex GST</dt><dd>{money(current.internalSummary.marginCentsExGst)}</dd></div></dl><small>Customers never receive supplier cost, markup or margin.</small></aside>}</>}
    <div className="trade-quote-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void saveDraft()}>{busy === "save_draft" ? "Saving..." : draftMode ? "Save draft" : "Save as next draft"}</button><button ref={previewTriggerRef} className="primary" type="button" disabled={Boolean(busy)} onClick={openSendPreview}>{draftMode ? "Preview and send" : "Preview and send next version"}</button></div>
    {quote?.link && <section className="trade-quote-share"><header><div><span>Effortless customer review</span><h5>One secure quote link and matching PDF</h5><p>The customer can review, ask, sign, accept or decline without creating an account. The PDF is generated from this exact issued version.</p></div><strong>{quote.link.status}</strong></header>{latestDelivery && latestDeliveryStatus && <aside className="trade-quote-internal" aria-label="Email delivery status"><div><span>Email delivery</span><strong>{latestDeliveryStatus.label}</strong></div><small>{latestDeliveryStatus.detail}{latestDelivery.recipientPreview ? ` Recipient ${latestDelivery.recipientPreview}.` : ""}{latestDelivery.createdAt ? ` Submitted ${new Date(latestDelivery.createdAt).toLocaleString("en-AU")}.` : ""}</small></aside>}{quote.link.shareUrl ? <><div className="trade-quote-share-link"><input aria-label="Secure quote link" readOnly value={quote.link.shareUrl} /><button type="button" onClick={() => void copyLink()}>Copy link</button><a href={quote.link.shareUrl} target="_blank" rel="noreferrer">Preview</a></div><small>Expires {new Date(quote.link.expiresAt).toLocaleDateString("en-AU")} | Current issue {quote.link.tokenIssue}</small><label className="trade-quote-delivery-confirm"><input type="checkbox" checked={deliveryConfirmed} onChange={(event) => setDeliveryConfirmed(event.target.checked)} /><span>I confirm {quote.link.recipientPreview || "this customer"} asked to receive this current quote by email.</span></label><div className="trade-quote-share-actions"><button type="button" disabled={Boolean(busy) || !deliveryConfirmed} onClick={() => void linkAction("send_quote")}>{busy === "send_quote" ? "Submitting..." : "Email quote"}</button>{quote.link.pdfUrl && <a href={quote.link.pdfUrl} target="_blank" rel="noreferrer">Download issued PDF</a>}<button type="button" disabled={Boolean(busy)} onClick={() => void linkAction("replace_link")}>Replace link</button><button type="button" disabled={Boolean(busy)} onClick={() => void linkAction("revoke_link")}>Revoke link</button></div><small>SMS stays unavailable until the approved Australian sender gate is active.</small></> : <div className="trade-quote-share-actions"><button type="button" disabled={Boolean(busy) || quote.link.status === "accepted" || quote.link.status === "declined"} onClick={() => void linkAction("replace_link")}>Create replacement link</button></div>}</section>}
    {(quote?.timeline?.length || 0) > 0 && <details className="trade-quote-timeline"><summary>Quote activity ({quote?.timeline?.length || 0})</summary>{quote?.timeline?.map((event, index) => <article key={`${event.occurredAt}:${index}`}><strong>{event.type.replaceAll("_", " ")}</strong><span>{event.summary}</span><small>{new Date(event.occurredAt).toLocaleString("en-AU")}</small></article>)}</details>}
    {quote && quote.versions.length > 0 && <details className="trade-quote-history"><summary>Quote history ({quote.versions.length})</summary>{quote.versions.map((version) => <article key={version.id}><div><strong>Version {version.versionNumber} | {version.status.replaceAll("_", " ")}</strong><span>{version.choices.length ? `${version.choices.length} customer choices` : money(version.totalCents)}{version.issuedAt ? ` | Issued ${new Date(version.issuedAt).toLocaleDateString("en-AU")}` : " | Draft"}</span></div>{version.acceptance && <small>{version.acceptance.decision.replaceAll("_", " ")} by {version.acceptance.actorType === "secure_link_holder" ? version.acceptance.signerName : `verified account ${version.acceptance.actorEmail}`} on {new Date(version.acceptance.decidedAt).toLocaleString("en-AU")}{version.acceptance.selectionSummary ? ` | ${version.acceptance.selectionSummary} | ${money(version.acceptance.selectedTotalCents)}` : ""}</small>}</article>)}</details>}
    {message && <p className="trade-import-status" role="status">{message}</p>}
    {sendPreview && <div className="crm-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setSendPreview(null); }}>
      <section ref={previewDialogRef} className="crm-invoice-preview-dialog crm-quote-preview-dialog" role="dialog" aria-modal="true" aria-busy={Boolean(busy)} aria-labelledby="quote-send-preview-title" tabIndex={-1}>
        <header><div><span>{sendPreview.delivery.identityKnown ? "Exact customer delivery" : "Pre-save customer delivery preview"}</span><strong id="quote-send-preview-title">{sendPreview.delivery.subject}</strong><small>{sendPreview.delivery.identityKnown ? `To ${customerEmail} | Issues ${sendPreview.delivery.quoteNumber} version ${sendPreview.delivery.versionNumber} | PDF attachment ${sendPreview.delivery.attachmentName}` : `To ${customerEmail} | Quote number, version and PDF filename will be confirmed by the server when this draft is saved.`}</small></div><button type="button" disabled={Boolean(busy)} onClick={() => setSendPreview(null)}>Close</button></header>
        <div className="trade-quote-send-preview" data-theme={business?.brandThemeKey || "emerald_navy"} data-border={business?.brandBorderStyle || "soft"}>
          <section className="trade-quote-email-preview"><span>Email preview</span><article><strong>{business?.businessName || "Your trade business"}</strong><h5>{sendPreview.delivery.subject}</h5><p>Hello {jobSummary?.customerName || "customer"},</p><p>{customerMessage || business?.quoteEmailIntro || "Thank you for the opportunity to quote for your project."}</p><p>The email includes a secure review button where the customer can ask a question, choose options, sign, accept or decline.</p><button type="button" disabled>Review quote securely</button><small>{validUntil ? `Quote valid until ${new Date(`${validUntil}T00:00:00`).toLocaleDateString("en-AU")}` : "Secure link expires 30 days after issue"}</small></article></section>
          <section className="trade-quote-pdf-attachment"><span>PDF attachment preview</span><header><div><b>PDF</b><p><strong>{sendPreview.delivery.attachmentName}</strong><small>{sendPreview.delivery.identityKnown ? `Server-generated from ${sendPreview.delivery.quoteNumber} version ${sendPreview.delivery.versionNumber} after issue` : "Pre-save document preview. The server assigns the final quote identity before issue."}</small></p></div><em>Submitted as attachment</em></header><article className="trade-quote-document-sheet"><header><div><small>Quote from</small><strong>{business?.businessName || "Your trade business"}</strong><span>{sendPreview.delivery.identityKnown ? `${sendPreview.delivery.quoteNumber} | Version ${sendPreview.delivery.versionNumber}` : "Quote identity pending server save"}</span></div><div><small>Prepared for</small><strong>{jobSummary?.customerName || "Customer"}</strong><span>{jobSummary?.siteSummary || ""}</span></div></header>
            <section><span>Included work</span><div className="trade-quote-preview-lines">{sendPreview.base.lines.length ? sendPreview.base.lines.map((line, index) => <article key={`${line.description}:${index}`}><div><strong>{line.description}</strong><small>{line.sectionHeading} | {(line.quantityMilli / 1000).toLocaleString("en-AU")} x {money(line.unitPriceCents)}{line.taxCode === "gst" ? " plus GST" : " no GST"}</small></div><b>{money(line.totalCents)}</b></article>) : <p>No work is included before the customer chooses an option.</p>}</div></section>
            {sendPreview.choices.length > 0 && <section><span>Customer choices</span><div className="trade-quote-preview-choices">{sendPreview.choices.map((choice) => <article key={choice.clientKey}><div><strong>{choice.name}{choice.recommended ? " | Recommended" : ""}</strong><small>{choice.summary || (choice.kind === "addon" ? "Optional extra" : "Customer choice")}</small></div><b>{choice.kind === "addon" ? `Adds ${money(choice.totals.totalCents)}` : `${money(sendPreview.base.totalCents + choice.totals.totalCents)} total`}</b></article>)}</div></section>}
            <dl><div><dt>Subtotal</dt><dd>{money(sendPreview.displayTotals.subtotalCents)}</dd></div><div><dt>GST</dt><dd>{money(sendPreview.displayTotals.taxCents)}</dd></div><div className="total"><dt>{sendPreview.displayTotals.label}</dt><dd>{money(sendPreview.displayTotals.totalCents)}</dd></div></dl>
            <section className="trade-quote-preview-terms"><span>Recorded terms</span><p>{terms}</p></section>
          </article></section>
          <label className="trade-quote-delivery-confirm"><input type="checkbox" checked={sendConsent} disabled={Boolean(busy)} onChange={(event) => setSendConsent(event.target.checked)} /><span>I confirm this customer asked to receive this quote at {customerEmail}.</span></label>
        </div>
        <footer><button type="button" disabled={Boolean(busy)} onClick={() => setSendPreview(null)}>Go back and edit</button><button type="button" className="btn" disabled={Boolean(busy) || !sendConsent} onClick={() => void sendPreviewedQuote()}>{busy === "preview_send" ? "Saving and submitting..." : "Confirm and submit email"}</button></footer>
      </section>
    </div>}
  </section>;
}
