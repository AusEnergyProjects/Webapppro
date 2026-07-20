"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { normaliseTradeQuoteLineGroup } from "@/lib/trade-quote";

type QuoteLine = { id?: string; priceBookItemId?: string; jobPacketId?: string; jobPacketLineId?: string; lineType: string; description: string; quantity: string; unitPrice: string; taxCode: string; sectionHeading: string; totalCents?: number };
type SavedLine = { id: string; priceBookItemId: string; jobPacketId: string; jobPacketLineId: string; lineType: string; description: string; quantityMilli: number; unitPriceCents: number; taxCode: string; sectionHeading: string; totalCents: number };
type PriceBookItem = { id: string; itemCode: string; name: string; description: string; itemType: string; lineType: string; unitLabel: string; sellPriceCentsExGst: number; taxCode: string };
type JobPacket = { id: string; packetCode: string; name: string; revision: number; suggestedCrewSize: number; taskCount: number; formCount: number; activeCrewCount: number; crewReady: boolean; unavailableItemCount: number; canApply: boolean; summary: { sellCentsExGst: number; estimatedDurationMinutes: number }; lines: Array<{ id: string; priceBookItemId: string; name: string; lineType: string; quantityMilli: number; sellPriceCentsExGst: number; taxCode: string }> };
type QuoteChoice = { id?: string; clientKey: string; kind: "package" | "addon" | "choose_one"; groupKey: string; name: string; summary: string; recommended: boolean; subtotalCents?: number; taxCents?: number; totalCents?: number; lines: QuoteLine[] };
type SavedChoice = Omit<QuoteChoice, "lines"> & { id: string; items: SavedLine[]; subtotalCents: number; taxCents: number; totalCents: number };
type QuoteVersion = { id: string; versionNumber: number; status: string; customerEmail: string; subtotalCents: number; taxCents: number; totalCents: number; terms: string; validUntil: string; consentStatement: string; issuedAt: string; items: SavedLine[]; choices: SavedChoice[]; internalSummary?: { costCentsExGst: number; sellCentsExGst: number; marginCentsExGst: number }; acceptance: null | { decision: string; actorEmail: string; actorType: string; signerName: string; decidedAt: string; consentStatement: string; selectionSummary: string; selectedTotalCents: number } };
type Quote = { id: string; quoteNumber: string; currentVersionNumber: number; status: string; versions: QuoteVersion[];
  link: null | { id: string; status: string; expiresAt: string; tokenIssue: number; shareUrl: string; recipientPreview: string };
  timeline: Array<{ type: string; actorType: string; summary: string; occurredAt: string }>;
  questions: Array<{ id: string; question: string; answer: string; status: string; askedAt: string; answeredAt: string }>;
  deliveries: Array<{ id: string; channel: string; provider: string; status: string; recipientPreview: string; attempts: number; sentAt: string; deliveredAt: string; lastError: string }> };
type QuoteResult = { ok?: boolean; authorisedEmails?: string[]; priceBookItems?: PriceBookItem[]; jobPackets?: JobPacket[]; quote?: Quote | null; error?: string };
type QuotePreviewLine = { description: string; sectionHeading: string; quantityMilli: number; unitPriceCents: number; taxCode: string; subtotalCents: number; taxCents: number; totalCents: number };
type QuotePreviewGroup = { lines: QuotePreviewLine[]; subtotalCents: number; taxCents: number; totalCents: number };
type QuoteSendPreview = { base: QuotePreviewGroup; choices: Array<{ clientKey: string; kind: QuoteChoice["kind"]; name: string; summary: string; recommended: boolean; totals: QuotePreviewGroup }> };

const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const blankLine = (): QuoteLine => ({ lineType: "product", description: "", quantity: "1", unitPrice: "0.00", taxCode: "gst", sectionHeading: "Included work" });
const editLine = (line: SavedLine, activeIds: Set<string>): QuoteLine => ({ ...line, priceBookItemId: activeIds.has(line.priceBookItemId) ? line.priceBookItemId : "", quantity: (line.quantityMilli / 1000).toString(), unitPrice: (line.unitPriceCents / 100).toFixed(2) });
const choiceKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

export function TradeQuotePanel({ user, workOrderId, available, onOpenPriceBook, onChanged }: { user: User; workOrderId: string; available: boolean; onOpenPriceBook: () => void; onChanged?: () => void | Promise<void> }) {
  const [quote, setQuote] = useState<Quote | null>(null); const [emails, setEmails] = useState<string[]>([]);
  const [priceBookItems, setPriceBookItems] = useState<PriceBookItem[]>([]); const [jobPackets, setJobPackets] = useState<JobPacket[]>([]);
  const [lines, setLines] = useState<QuoteLine[]>([blankLine()]); const [choices, setChoices] = useState<QuoteChoice[]>([]); const [packetId, setPacketId] = useState("");
  const [customerEmail, setCustomerEmail] = useState(""); const [terms, setTerms] = useState(""); const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false); const [answer, setAnswer] = useState(""); const [answeringId, setAnsweringId] = useState("");
  const [sendPreview, setSendPreview] = useState<QuoteSendPreview | null>(null); const [sendConsent, setSendConsent] = useState(false);

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
    const activeItems = result.priceBookItems || []; if (result.priceBookItems) setPriceBookItems(result.priceBookItems); if (result.jobPackets) setJobPackets(result.jobPackets);
    const current = result.quote?.versions.find((version) => version.versionNumber === result.quote?.currentVersionNumber);
    if (current) {
      const activeIds = new Set(activeItems.map((item) => item.id)); setLines(current.items.map((line) => editLine(line, activeIds)));
      setChoices(current.choices.map((choice) => ({ ...choice, lines: choice.items.map((line) => editLine(line, activeIds)) })));
      setCustomerEmail(current.customerEmail); setTerms(current.terms); setValidUntil(current.validUntil);
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    const frame = window.requestAnimationFrame(() => void request().then(applyResult).catch((error) => setMessage(error.message)));
    return () => window.cancelAnimationFrame(frame);
  }, [applyResult, available, request]);

  useEffect(() => {
    if (!sendPreview) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setSendPreview(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [busy, sendPreview]);

  function addSavedLine(itemId: string, targetChoiceKey = "") {
    const item = priceBookItems.find((candidate) => candidate.id === itemId); if (!item) return;
    const line: QuoteLine = { priceBookItemId: item.id, lineType: item.lineType, description: item.description || item.name, quantity: "1", unitPrice: (item.sellPriceCentsExGst / 100).toFixed(2), taxCode: item.taxCode, sectionHeading: "Included work" };
    if (targetChoiceKey) setChoices((current) => current.map((choice) => choice.clientKey === targetChoiceKey ? { ...choice, lines: [...choice.lines.filter((row) => row.description), line] } : choice));
    else setLines((current) => current.length === 1 && !current[0].description ? [line] : [...current, line]);
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
      const result = await request({ method: "POST", body: JSON.stringify({ action: "save_draft", workOrderId, lines, choices, customerEmail, terms, validUntil }) });
      applyResult({ ...result, authorisedEmails: emails, priceBookItems, jobPackets }); await onChanged?.();
      setMessage("Draft saved with server-calculated totals and internal margin controls.");
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
      const previewChoices = choices.map((choice) => ({ clientKey: choice.clientKey, kind: choice.kind, name: choice.name,
        summary: choice.summary, recommended: choice.recommended, totals: previewGroup(choice.lines) }));
      if (!base.lines.length && !previewChoices.length) throw new Error("Add at least one quote item before previewing and sending.");
      setSendConsent(false); setSendPreview({ base, choices: previewChoices });
    } catch (error) { setMessage(previewError(error)); }
  }
  async function sendPreviewedQuote() {
    if (!sendPreview || !sendConsent) return;
    setBusy("preview_send"); setMessage("");
    let draftSaved = false; let quoteIssued = false;
    try {
      const saved = await request({ method: "POST", body: JSON.stringify({ action: "save_draft", workOrderId, lines, choices, customerEmail, terms, validUntil }) });
      draftSaved = true; applyResult({ ...saved, authorisedEmails: emails, priceBookItems, jobPackets });
      const issued = await request({ method: "POST", body: JSON.stringify({ action: "issue_quote", workOrderId }) });
      quoteIssued = true; applyResult({ ...issued, authorisedEmails: emails, priceBookItems, jobPackets });
      const sent = await request({ method: "POST", body: JSON.stringify({ action: "send_quote", workOrderId, channel: "email", consentConfirmed: true }) });
      applyResult({ ...sent, authorisedEmails: emails, priceBookItems, jobPackets }); setSendPreview(null); setSendConsent(false);
      setMessage("Quote saved, issued and emailed to the customer."); await onChanged?.();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The quote could not be sent.";
      if (quoteIssued) {
        setSendPreview(null); setSendConsent(false); setMessage(`Quote issued, but the email was not sent. ${reason} Use Email quote below to retry.`); await onChanged?.();
      } else if (draftSaved) setMessage(`Draft saved, but the quote was not issued or emailed. ${reason}`);
      else setMessage(reason);
    } finally { setBusy(""); }
  }
  async function linkAction(action: "replace_link" | "revoke_link" | "send_quote" | "answer_question", extra: Record<string, unknown> = {}) {
    setBusy(action); setMessage("");
    try { const result = await request({ method: "POST", body: JSON.stringify({ action, workOrderId, consentConfirmed: deliveryConfirmed, ...extra }) }); applyResult({ ...result, authorisedEmails: emails, priceBookItems, jobPackets });
      setMessage(action === "send_quote" ? "Quote email sent once through the consent-aware delivery channel." : action === "replace_link" ? "A new secure link replaced the old one." : action === "revoke_link" ? "The secure link is revoked." : "Response added to the quote timeline.");
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
  const openQuestions = quote?.questions?.filter((item) => item.status === "open") || [];
  return <section className="trade-quote-panel">
    <header><div><span>Clear customer quote</span><h4>{quote?.quoteNumber || "New quote"}{current ? ` | Version ${current.versionNumber}` : ""}</h4><p>Keep a simple quote fast, or build clear choices without retyping standard work. Issued versions are immutable.</p></div>{current && <strong className={`quote-status ${current.status}`}>{current.status.replaceAll("_", " ")}</strong>}</header>
    {(quote?.questions?.length || 0) > 0 && <section className={`trade-quote-questions ${openQuestions.length ? "needs-attention" : ""}`} id="quote-questions"><span>{openQuestions.length ? `${openQuestions.length} customer ${openQuestions.length === 1 ? "question needs" : "questions need"} a reply` : "Customer questions"}</span><h5>{openQuestions.length ? "Reply before the job moves on" : "Questions and replies"}</h5>{quote?.questions?.map((item) => <article key={item.id}><div><strong>{item.question}</strong><small>Asked {new Date(item.askedAt).toLocaleString("en-AU")}</small>{item.answer && <p>{item.answer}</p>}</div>{item.status === "open" && (answeringId === item.id ? <div><textarea aria-label="Quote question response" rows={3} maxLength={1000} value={answer} onChange={(event) => setAnswer(event.target.value)} /><button type="button" disabled={answer.trim().length < 2 || Boolean(busy)} onClick={() => void linkAction("answer_question", { questionId: item.id, answer })}>Send response</button></div> : <button type="button" onClick={() => setAnsweringId(item.id)}>Answer</button>)}</article>)}</section>}
    <div className="trade-quote-price-book"><label><span>Add a saved item</span><select aria-label="Add a saved price-book item" value="" disabled={!priceBookItems.length} onChange={(event) => addSavedLine(event.target.value)}><option value="">{priceBookItems.length ? "Choose a saved item" : "No saved items yet"}</option>{priceBookItems.map((item) => <option key={item.id} value={item.id}>{item.name} | {money(item.sellPriceCentsExGst)} ex GST / {item.unitLabel}</option>)}</select></label>{priceBookItems.length ? <small>Select an item once, then adjust only its quantity. Current description, type, price and GST are checked again when the draft is saved.</small> : <div><small>Save your common labour, materials and call-outs once, then reuse them here.</small><button type="button" onClick={onOpenPriceBook}>Open Price book</button></div>}</div>
    {jobPackets.length > 0 && <div className="trade-quote-packets"><label><span>Start from a common job</span><select value={packetId} onChange={(event) => setPacketId(event.target.value)}><option value="">Choose saved common work</option>{jobPackets.map((packet) => <option key={packet.id} value={packet.id} disabled={!packet.canApply}>{packet.name} | {packet.lines.length} items | {money(packet.summary.sellCentsExGst)} ex GST{packet.canApply ? "" : " | needs attention"}</option>)}</select></label><div className="trade-quote-packet-actions"><button type="button" disabled={!packetId} onClick={() => applyPacket(false)}>Use standard job</button><button type="button" disabled={!packetId} onClick={() => applyPacket(true)}>Build Good, Better, Best</button></div><small>One common job can stay simple or become three customer choices. Edit only what differs.</small></div>}
    {lines.length > 0 && <section className="trade-quote-base"><header><div><strong>{choices.length ? "Always included" : "Quote items"}</strong><span>{choices.length ? "These lines appear with every customer choice." : "The fastest path for straightforward work."}</span></div></header><div className="trade-quote-lines"><div className="trade-quote-line headings" aria-hidden="true"><span>Type</span><span>Description and section</span><span>Quantity</span><span>Unit price</span><span>Tax</span><span></span></div>{lines.map((line, index) => lineEditor(line, index, (field, value) => updateBaseLine(index, field, value), () => setLines((currentLines) => currentLines.filter((_, position) => position !== index)), lines.length > 1 || choices.length > 0))}</div></section>}
    <div className="trade-quote-builder-actions"><button className="quote-add-line" type="button" onClick={() => setLines((current) => [...current, blankLine()])}>Add included line</button><button type="button" onClick={addAddon}>Add optional extra</button><button type="button" onClick={addChooseOne}>Add choose-one pair</button></div>
    {choices.length > 0 && <section className="trade-quote-choice-builder"><header><div><span>Customer choices</span><h5>Make the decision easy</h5><p>Packages use one clear selection. Optional extras are independent. Choose-one pairs require one answer.</p></div><button type="button" onClick={() => setChoices([])}>Remove all choices</button></header><div className="trade-quote-choice-grid">{choices.map((choice) => <article key={choice.clientKey} className={choice.recommended ? "recommended" : ""}><header><div><span>{choice.kind === "package" ? "Package" : choice.kind === "addon" ? "Optional extra" : "Choose one"}</span><input aria-label="Customer choice name" value={choice.name} maxLength={120} onChange={(event) => updateChoice(choice.clientKey, { name: event.target.value })} /></div><button type="button" onClick={() => setChoices((currentChoices) => currentChoices.filter((item) => item.clientKey !== choice.clientKey))}>Remove</button></header><textarea aria-label={`${choice.name} summary`} value={choice.summary} maxLength={500} rows={2} onChange={(event) => updateChoice(choice.clientKey, { summary: event.target.value })} /><label className="trade-quote-recommended"><input type="checkbox" checked={choice.recommended} onChange={(event) => updateChoice(choice.clientKey, { recommended: event.target.checked })} /><span>Show as recommended</span></label><label className="trade-quote-choice-add"><span>Quick add saved item</span><select value="" onChange={(event) => addSavedLine(event.target.value, choice.clientKey)}><option value="">Choose price-book item</option>{priceBookItems.map((item) => <option key={item.id} value={item.id}>{item.name} | {money(item.sellPriceCentsExGst)} ex GST</option>)}</select></label><div className="trade-quote-choice-lines">{choice.lines.map((line, index) => lineEditor(line, index, (field, value) => updateChoiceLine(choice.clientKey, index, field, value), () => updateChoice(choice.clientKey, { lines: choice.lines.filter((_, position) => position !== index) }), choice.lines.length > 1))}</div><button className="quote-add-line" type="button" onClick={() => updateChoice(choice.clientKey, { lines: [...choice.lines, blankLine()] })}>Add line to this choice</button>{choice.totalCents != null && <strong className="trade-quote-choice-total">{money(choice.totalCents)} incl GST</strong>}</article>)}</div></section>}
    <div className="trade-quote-settings"><label><span>Customer quote email</span><select value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)}><option value="">Choose authorised contact</option>{emails.map((email) => <option key={email}>{email}</option>)}</select><small>Used only when you deliberately email the quote. The secure link needs no customer account.</small></label><label><span>Valid until</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label><label className="wide"><span>Recorded terms</span><textarea rows={4} maxLength={4000} value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Scope assumptions, exclusions and completion terms" /></label></div>
    {current && <><div className="trade-quote-totals"><div><span>Always included</span><strong>{money(current.subtotalCents)}</strong></div><div><span>GST on included</span><strong>{money(current.taxCents)}</strong></div><div><span>Included total</span><strong>{money(current.totalCents)}</strong></div></div>{current.internalSummary && <aside className="trade-quote-internal" aria-label="Internal commercial summary"><div><span>Internal only</span><strong>All saved scope</strong></div><dl><div><dt>Cost ex GST</dt><dd>{money(current.internalSummary.costCentsExGst)}</dd></div><div><dt>Sell ex GST</dt><dd>{money(current.internalSummary.sellCentsExGst)}</dd></div><div><dt>Margin ex GST</dt><dd>{money(current.internalSummary.marginCentsExGst)}</dd></div></dl><small>Customers never receive supplier cost, markup or margin.</small></aside>}</>}
    <div className="trade-quote-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void saveDraft()}>{busy === "save_draft" ? "Saving..." : draftMode ? "Save draft" : "Save as next draft"}</button><button className="primary" type="button" disabled={Boolean(busy)} onClick={openSendPreview}>{draftMode ? "Preview and send" : "Preview and send next version"}</button></div>
    {quote?.link && <section className="trade-quote-share"><header><div><span>Effortless customer review</span><h5>One secure quote link</h5><p>The customer can review, ask, sign, accept or decline without creating an account.</p></div><strong>{quote.link.status}</strong></header>{quote.link.shareUrl ? <><div className="trade-quote-share-link"><input aria-label="Secure quote link" readOnly value={quote.link.shareUrl} /><button type="button" onClick={() => void copyLink()}>Copy link</button><a href={quote.link.shareUrl} target="_blank" rel="noreferrer">Preview</a></div><small>Expires {new Date(quote.link.expiresAt).toLocaleDateString("en-AU")} | Current issue {quote.link.tokenIssue}</small><label className="trade-quote-delivery-confirm"><input type="checkbox" checked={deliveryConfirmed} onChange={(event) => setDeliveryConfirmed(event.target.checked)} /><span>I confirm {quote.link.recipientPreview || "this customer"} asked to receive this current quote by email.</span></label><div className="trade-quote-share-actions"><button type="button" disabled={Boolean(busy) || !deliveryConfirmed} onClick={() => void linkAction("send_quote")}>{busy === "send_quote" ? "Sending..." : "Email quote"}</button><button type="button" disabled={Boolean(busy)} onClick={() => void linkAction("replace_link")}>Replace link</button><button type="button" disabled={Boolean(busy)} onClick={() => void linkAction("revoke_link")}>Revoke link</button></div><small>SMS stays unavailable until the approved Australian sender gate is active.</small></> : <div className="trade-quote-share-actions"><button type="button" disabled={Boolean(busy) || quote.link.status === "accepted" || quote.link.status === "declined"} onClick={() => void linkAction("replace_link")}>Create replacement link</button></div>}</section>}
    {(quote?.timeline?.length || 0) > 0 && <details className="trade-quote-timeline"><summary>Quote activity ({quote?.timeline?.length || 0})</summary>{quote?.timeline?.map((event, index) => <article key={`${event.occurredAt}:${index}`}><strong>{event.type.replaceAll("_", " ")}</strong><span>{event.summary}</span><small>{new Date(event.occurredAt).toLocaleString("en-AU")}</small></article>)}</details>}
    {quote && quote.versions.length > 0 && <details className="trade-quote-history"><summary>Quote history ({quote.versions.length})</summary>{quote.versions.map((version) => <article key={version.id}><div><strong>Version {version.versionNumber} | {version.status.replaceAll("_", " ")}</strong><span>{version.choices.length ? `${version.choices.length} customer choices` : money(version.totalCents)}{version.issuedAt ? ` | Issued ${new Date(version.issuedAt).toLocaleDateString("en-AU")}` : " | Draft"}</span></div>{version.acceptance && <small>{version.acceptance.decision.replaceAll("_", " ")} by {version.acceptance.actorType === "secure_link_holder" ? version.acceptance.signerName : `verified account ${version.acceptance.actorEmail}`} on {new Date(version.acceptance.decidedAt).toLocaleString("en-AU")}{version.acceptance.selectionSummary ? ` | ${version.acceptance.selectionSummary} | ${money(version.acceptance.selectedTotalCents)}` : ""}</small>}</article>)}</details>}
    {message && <p className="trade-import-status" role="status">{message}</p>}
    {sendPreview && <div className="crm-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setSendPreview(null); }}>
      <section className="crm-invoice-preview-dialog crm-quote-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="quote-send-preview-title">
        <header><div><span>Check before sending</span><strong id="quote-send-preview-title">{quote?.quoteNumber || "New customer quote"}</strong><small>To {customerEmail} | {validUntil ? `Valid until ${new Date(`${validUntil}T00:00:00`).toLocaleDateString("en-AU")}` : "Link expires 30 days after issue"}</small></div><button type="button" disabled={Boolean(busy)} onClick={() => setSendPreview(null)}>Close</button></header>
        <div className="trade-quote-send-preview">
          <section><span>Included work</span><div className="trade-quote-preview-lines">{sendPreview.base.lines.length ? sendPreview.base.lines.map((line, index) => <article key={`${line.description}:${index}`}><div><strong>{line.description}</strong><small>{line.sectionHeading} | {(line.quantityMilli / 1000).toLocaleString("en-AU")} x {money(line.unitPriceCents)}{line.taxCode === "gst" ? " plus GST" : " no GST"}</small></div><b>{money(line.totalCents)}</b></article>) : <p>No work is included before the customer chooses an option.</p>}</div></section>
          {sendPreview.choices.length > 0 && <section><span>Customer choices</span><div className="trade-quote-preview-choices">{sendPreview.choices.map((choice) => <article key={choice.clientKey}><div><strong>{choice.name}{choice.recommended ? " | Recommended" : ""}</strong><small>{choice.summary || (choice.kind === "addon" ? "Optional extra" : "Customer choice")}</small></div><b>{choice.kind === "addon" ? `Adds ${money(choice.totals.totalCents)}` : `${money(sendPreview.base.totalCents + choice.totals.totalCents)} total`}</b></article>)}</div></section>}
          <dl><div><dt>Included before choices</dt><dd>{money(sendPreview.base.subtotalCents)}</dd></div><div><dt>Included GST</dt><dd>{money(sendPreview.base.taxCents)}</dd></div><div className="total"><dt>{sendPreview.choices.length ? "Included total" : "Quote total"}</dt><dd>{money(sendPreview.base.totalCents)}</dd></div></dl>
          <section className="trade-quote-preview-terms"><span>Recorded terms</span><p>{terms}</p></section>
          <label className="trade-quote-delivery-confirm"><input type="checkbox" checked={sendConsent} disabled={Boolean(busy)} onChange={(event) => setSendConsent(event.target.checked)} /><span>I confirm this customer asked to receive this quote at {customerEmail}.</span></label>
        </div>
        <footer><button type="button" disabled={Boolean(busy)} onClick={() => setSendPreview(null)}>Go back and edit</button><button type="button" className="btn" disabled={Boolean(busy) || !sendConsent} onClick={() => void sendPreviewedQuote()}>{busy === "preview_send" ? "Saving and sending..." : "Confirm and send quote"}</button></footer>
      </section>
    </div>}
  </section>;
}
