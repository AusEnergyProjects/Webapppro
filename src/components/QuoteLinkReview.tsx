"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { isPayableQuoteDecisionInvoice } from "@/lib/trade-quote-receipt";
import { canonicalGoogleBusinessProfileUrl } from "@/lib/trade-google-business-profile.mjs";
import type { QuoteEquipment } from "@/lib/trade-quote-equipment";
import { selectedQuoteProductDocuments, type QuoteProductDocumentSummary } from "@/lib/trade-quote-product-documents";
import { QuoteProductDocuments } from "./TradeQuoteProductDocuments";
import { TradeQuoteEquipmentCards } from "./TradeQuoteEquipmentCards";

type Line = {
  id: string;
  lineType?: "product" | "labour" | "adjustment";
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  sectionHeading: string;
};
type Choice = {
  id: string;
  kind: "package" | "addon" | "choose_one";
  groupKey: string;
  name: string;
  summary: string;
  recommended: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  items: Line[];
};
type Question = {
  id: string;
  question: string;
  answer: string;
  status: string;
  askedAt: string;
  answeredAt: string;
};
type Quote = {
  equipment?: QuoteEquipment;
  productDocuments?: QuoteProductDocumentSummary[];
  linkId: string;
  quoteVersionId: string;
  quoteNumber: string;
  versionNumber: number;
  workNumber: string;
  workTitle: string;
  customerName: string;
  customerNumber: string;
  siteLabel: string;
  siteSummary: string;
  business: {
    name: string;
    email: string;
    phone: string;
    abn: string;
    website: string;
    googleBusinessProfileUrl?: string;
    themeKey: string;
    borderStyle: string;
    hasLogo: boolean;
  };
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  customerMessage: string;
  terms: string;
  validUntil: string;
  issuedAt: string;
  hasRoofImage?: boolean;
  consentStatement: string;
  expiresAt: string;
  items: Line[];
  choices: Choice[];
  questions: Question[];
};
type QuoteInvoiceReceipt = {
  id: string;
  number: string;
  status: "issued" | "attention_required";
  documentLabel: "Invoice" | "Tax Invoice";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  dueAt: string;
  issueBlockerCode: string;
};
type QuotePaymentReceipt = {
  availability: "bank_transfer" | "not_configured" | "withheld";
  method: "bank_transfer" | "none";
  accountName: string;
  bsb: string;
  accountNumber: string;
  reference: string;
  terms: string;
  amountDueCents: number;
  currency: "AUD";
  dueAt: string;
};
type QuoteDecisionReceipt = {
  acceptanceId: string;
  decision: "accepted" | "declined";
  signerName: string;
  decidedAt: string;
  consentStatement: string;
  commercialReference: string;
  invoice: QuoteInvoiceReceipt | null;
  payment: QuotePaymentReceipt;
};
type Result = {
  ok?: boolean;
  quote?: Quote;
  receipt?: QuoteDecisionReceipt;
  conversation?: { questions: Question[] } | null;
  decision?: "accepted" | "declined";
  duplicate?: boolean;
  commercial?: unknown;
  error?: string;
};

type DecisionIdFactory = (
  storage: Pick<Storage, "getItem" | "setItem">,
  storageKey: string,
  createId: () => string,
) => string;

export const getOrCreateQuoteDecisionId: DecisionIdFactory = (
  storage,
  storageKey,
  createId,
) => {
  const existing = storage.getItem(storageKey);
  if (
    existing &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      existing,
    )
  ) {
    return existing;
  }
  const created = createId();
  storage.setItem(storageKey, created);
  return created;
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);

function displayDate(value: string) {
  if (!value) return "To be confirmed";
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const parsed = new Date(dateOnly ? `${dateOnly}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function QuoteDecisionReceiptView({
  receipt,
  receiptPdfUrl,
  conversation,
  embedded = false,
}: {
  receipt: QuoteDecisionReceipt;
  receiptPdfUrl: string;
  conversation?: ReactNode;
  embedded?: boolean;
}) {
  const Surface = embedded ? "section" : "main";
  if (receipt.decision === "declined") {
    return (
      <Surface className="quote-link-shell">
        <section className="quote-link-receipt quote-link-receipt-declined">
          <span>Decision recorded</span>
          <h1>Quote declined</h1>
          <p>The trade business has your signed decision.</p>
          <dl>
            <div>
              <dt>Reference</dt>
              <dd>{receipt.commercialReference}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{displayDate(receipt.decidedAt)}</dd>
            </div>
          </dl>
        </section>
      </Surface>
    );
  }

  const invoice = receipt.invoice;
  const payment = receipt.payment;
  const payableInvoice = isPayableQuoteDecisionInvoice(invoice);
  const bankTransferReady =
    payableInvoice &&
    payment.availability === "bank_transfer" &&
    payment.method === "bank_transfer" &&
    Boolean(payment.accountName && payment.bsb && payment.accountNumber);

  return (
    <Surface className="quote-link-shell">
      <section className="quote-link-receipt">
        <header>
          <span>Decision recorded</span>
          <h1>Quote accepted</h1>
          <p>
            Your signed acceptance is saved. Keep this page for the invoice and
            payment reference.
          </p>
        </header>

        {invoice && payableInvoice ? (
          <section
            className="quote-link-invoice-receipt"
            aria-label="Invoice summary"
          >
            <div>
              <span>Invoice</span>
              <strong>{invoice.number}</strong>
            </div>
            <dl>
              <div>
                <dt>Amount due</dt>
                <dd>{money(invoice.totalCents)}</dd>
              </div>
              <div>
                <dt>Due</dt>
                <dd>{displayDate(invoice.dueAt)}</dd>
              </div>
              <div>
                <dt>GST</dt>
                <dd>{money(invoice.taxCents)}</dd>
              </div>
            </dl>
          </section>
        ) : invoice?.status === "attention_required" ? (
          <section className="quote-link-payment-pending" role="status">
            <strong>Acceptance recorded</strong>
            <p>
              The trade business is confirming the existing invoice for this
              job. Do not make another payment until it confirms the correct
              invoice and payment reference.
            </p>
          </section>
        ) : (
          <section className="quote-link-payment-pending" role="status">
            <strong>Your invoice is being prepared</strong>
            <p>
              Your acceptance is safely recorded under{" "}
              {receipt.commercialReference}.
            </p>
          </section>
        )}

        {invoice?.status === "attention_required" ? null : bankTransferReady ? (
          <section
            className="quote-link-bank-transfer"
            aria-label="Bank transfer details"
          >
            <header>
              <span>Pay by bank transfer</span>
              <strong>{money(payment.amountDueCents)}</strong>
            </header>
            <dl>
              <div>
                <dt>Account name</dt>
                <dd>{payment.accountName}</dd>
              </div>
              <div>
                <dt>BSB</dt>
                <dd>{payment.bsb}</dd>
              </div>
              <div>
                <dt>Account number</dt>
                <dd>{payment.accountNumber}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd>{payment.reference}</dd>
              </div>
            </dl>
            {payment.terms && <p>{payment.terms}</p>}
          </section>
        ) : (
          <section className="quote-link-payment-pending" role="status">
            <strong>Payment details are being prepared</strong>
            <p>
              The trade business will provide its payment instructions. Do not
              pay using details from an unexpected message.
            </p>
          </section>
        )}

        <section
          className="quote-link-receipt-download"
          aria-label="Customer PDF record"
        >
          <div>
            <span>Customer record</span>
            <strong>Keep an offline copy</strong>
            <p>
              Save the server-prepared acceptance, invoice summary and payment
              reference as a PDF.
            </p>
          </div>
          <a href={receiptPdfUrl} download>
            Save acceptance PDF
          </a>
        </section>

        {conversation}
        <footer>
          <span>Acceptance reference</span>
          <strong>{receipt.commercialReference}</strong>
          <small>Recorded {displayDate(receipt.decidedAt)}</small>
        </footer>
      </section>
    </Surface>
  );
}

function QuoteQuestions({ questions, question, onChange, onSend, onRefresh, busy, message }: {
  questions: Question[]; question: string; onChange: (value: string) => void; onSend: () => void;
  onRefresh: () => void; busy: string; message?: string;
}) {
  return <section className="quote-link-question" aria-label="Messages with the trade business">
    <span>Keep the conversation with this job</span>
    <h2>Ask the trade business</h2>
    {questions.map((item) => <article key={item.id}>
      <strong>Your question</strong><p>{item.question}</p>
      {item.answer ? <><strong>Trade response</strong><p>{item.answer}</p></> : <small>Awaiting a response</small>}
    </article>)}
    <label><span>Your question</span><textarea value={question} maxLength={1000} rows={3}
      onChange={(event) => onChange(event.target.value)} placeholder="Ask about this job, the scope or timing" /></label>
    <button type="button" disabled={Boolean(busy) || question.trim().length < 5} onClick={onSend}>
      {busy === "question" ? "Sending..." : "Send question"}
    </button>
    <button type="button" disabled={Boolean(busy)} onClick={onRefresh}>{busy === "questions_refresh" ? "Checking..." : "Check for replies"}</button>
    <small>Your message goes straight to the business in TLink. Return to this secure page to read its reply.</small>
    {message && <p role="status">{message}</p>}
  </section>;
}

function QuoteLines({ lines }: { lines: Line[] }) {
  const sections = [
    ...new Set(lines.map((line) => line.sectionHeading || "Included work")),
  ];
  return (
    <div className="quote-link-sections">
      {sections.map((section) => (
        <section key={section}>
          {(sections.length > 1 || section !== "Included work") && (
            <h4>{section}</h4>
          )}
          {lines
            .filter(
              (line) =>
                (line.sectionHeading || "Included work") === section,
            )
            .map((line) => (
              <div key={line.id}>
                <span>
                  <b>{line.description}</b>
                  <small>
                    {line.quantityMilli / 1000} x{" "}
                    {money(line.unitPriceCents)}
                  </small>
                </span>
                <strong>{money(line.totalCents)}</strong>
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}

export function QuoteLinkReview({ token, embedded = false, refreshVersion = 0, onDecisionRecorded }: { token: string; embedded?: boolean; refreshVersion?: number; onDecisionRecorded?: () => void }) {
  const Surface = embedded ? "section" : "main";
  const decisionIdFallback = useRef("");
  const loadedQuoteVersion = useRef("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [receipt, setReceipt] = useState<QuoteDecisionReceipt | null>(null);
  const [conversation, setConversation] = useState<{ questions: Question[] } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [signerName, setSignerName] = useState("");
  const [consent, setConsent] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [failedDecision, setFailedDecision] = useState<"accepted" | "declined" | "">("");
  const [opening, setOpening] = useState(true);
  const endpoint = `/api/quote-review/${encodeURIComponent(token)}`;
  const load = useCallback(async () => {
    setOpening(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const result = (await response.json().catch(() => ({}))) as Result;
      if (!response.ok || (!result.quote && !result.receipt)) {
        throw new Error(result.error || "This quote could not be opened.");
      }
      if (result.receipt) {
        setReceipt(result.receipt);
        setConversation(result.conversation ?? null);
        setQuote(null);
        return;
      }
      const nextQuote = result.quote;
      if (!nextQuote) throw new Error("This quote could not be opened.");
      setQuote(nextQuote);
      setReceipt(null);
      setConversation(null);
      const required = new Map<string, Choice>();
      for (const choice of nextQuote.choices.filter(
        (item) => item.kind !== "addon",
      )) {
        const key = `${choice.kind}:${choice.groupKey}`;
        const current = required.get(key);
        if (!current || choice.recommended) required.set(key, choice);
      }
      if (loadedQuoteVersion.current !== nextQuote.quoteVersionId) {
        setSelected([...required.values()].map((item) => item.id));
        loadedQuoteVersion.current = nextQuote.quoteVersionId;
        setConsent(false);
      }
    } catch (error) {
      setQuote(null); setReceipt(null); setConversation(null);
      throw error;
    } finally {
      setOpening(false);
    }
  }, [endpoint]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      void load().catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "This quote could not be opened.",
        ),
      ),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [load, refreshVersion]);

  const selectedChoices = useMemo(
    () =>
      quote?.choices.filter((choice) => selected.includes(choice.id)) || [],
    [quote, selected],
  );
  const totals = useMemo(
    () => ({
      subtotal:
        (quote?.subtotalCents || 0) +
        selectedChoices.reduce(
          (sum, choice) => sum + choice.subtotalCents,
          0,
        ),
      tax:
        (quote?.taxCents || 0) +
        selectedChoices.reduce((sum, choice) => sum + choice.taxCents, 0),
      total:
        (quote?.totalCents || 0) +
        selectedChoices.reduce((sum, choice) => sum + choice.totalCents, 0),
    }),
    [quote, selectedChoices],
  );
  const selectedLines = useMemo(
    () => [
      ...(quote?.items || []),
      ...selectedChoices.flatMap((choice) => choice.items),
    ],
    [quote, selectedChoices],
  );
  const discountSubtotal = useMemo(
    () =>
      selectedLines.reduce(
        (sum, line) =>
          line.subtotalCents < 0 ? sum + line.subtotalCents : sum,
        0,
      ),
    [selectedLines],
  );
  const grossSubtotal = totals.subtotal - discountSubtotal;

  function choose(choice: Choice) {
    setSelected((current) =>
      choice.kind === "addon"
        ? current.includes(choice.id)
          ? current.filter((id) => id !== choice.id)
          : [...current, choice.id]
        : [
            ...current.filter(
              (id) =>
                !quote?.choices.some(
                  (item) =>
                    item.id === id &&
                    item.kind === choice.kind &&
                    item.groupKey === choice.groupKey,
                ),
            ),
            choice.id,
          ],
    );
  }
  async function post(body: Record<string, unknown>) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const result = (await response.json().catch(() => ({}))) as Result;
      if (!response.ok) {
        throw new Error(result.error || "The quote could not be updated.");
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          "The connection timed out. Retry to confirm whether it was received.",
        );
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  async function ask() {
    setBusy("question");
    setMessage("");
    try {
      const result = await post({ action: "ask_question", question });
      if (result.quote) setQuote(result.quote);
      if (result.receipt) {
        setReceipt(result.receipt);
        setConversation(result.conversation ?? null);
      }
      setQuestion("");
      setMessage("Your question has been sent to the business.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Your question could not be sent.",
      );
    } finally {
      setBusy("");
    }
  }
  async function refreshQuestions() {
    setBusy("questions_refresh"); setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const result = (await response.json()) as Result;
      if (!response.ok || (!result.quote && !result.receipt)) throw new Error(result.error || "Replies could not be loaded.");
      if (result.receipt) {
        setReceipt(result.receipt); setQuote(null); setConversation(result.conversation ?? null);
      } else if (result.quote) setQuote(result.quote);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Replies could not be loaded."); }
    finally { setBusy(""); }
  }
  async function decide(decision: "accepted" | "declined") {
    if (!quote) return;
    setBusy(decision);
    setMessage("");
    setFailedDecision("");
    try {
      const storageKey = `quote-review:decision:${quote.linkId}:${quote.quoteVersionId}`;
      let clientDecisionId = "";
      try {
        clientDecisionId = getOrCreateQuoteDecisionId(
          window.sessionStorage,
          storageKey,
          () => crypto.randomUUID(),
        );
      } catch {
        decisionIdFallback.current ||= crypto.randomUUID();
        clientDecisionId = decisionIdFallback.current;
      }
      const result = await post({
        action: "decide",
        decision,
        clientDecisionId,
        signerName,
        consentConfirmed: consent,
        selectedChoiceIds: selected,
      });
      if (!result.receipt) {
        throw new Error(
          "Your decision may have been recorded, but its receipt was not returned. Retry to confirm it safely.",
        );
      }
      setReceipt(result.receipt);
      onDecisionRecorded?.();
      setQuote(null);
      // Communication is loaded separately so its availability cannot change the accepted financial result.
      if (result.receipt.decision === "accepted") await refreshQuestions();
    } catch (error) {
      setFailedDecision(decision);
      setMessage(
        error instanceof Error
          ? error.message
          : "Your decision could not be recorded.",
      );
    } finally {
      setBusy("");
    }
  }
  if (receipt) {
    return (
      <QuoteDecisionReceiptView
        receipt={receipt}
        embedded={embedded}
        receiptPdfUrl={`${endpoint}/receipt`}
        conversation={receipt.decision === "accepted" && conversation ? <QuoteQuestions questions={conversation.questions}
          question={question} onChange={setQuestion} onSend={() => void ask()} onRefresh={() => void refreshQuestions()} busy={busy} message={message} /> : undefined}
      />
    );
  }
  if (!quote) {
    return (
      <Surface className="quote-link-shell">
        <section className="quote-link-loading">
          <strong>
            {opening ? "Opening secure quote" : "Quote could not be opened"}
          </strong>
          {message && <p role="alert">{message}</p>}
          {!opening && (
            <button
              type="button"
              onClick={() =>
                void load().catch((error) =>
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "This quote could not be opened.",
                  ),
                )
              }
            >
              Retry
            </button>
          )}
        </section>
      </Surface>
    );
  }
  const groups = [
    ...new Set(
      quote.choices
        .filter((choice) => choice.kind !== "addon")
        .map((choice) => `${choice.kind}:${choice.groupKey}`),
    ),
  ];
  const addons = quote.choices.filter((choice) => choice.kind === "addon");
  return (
    <Surface
      className="quote-link-shell"
      data-theme={quote.business.themeKey}
      data-border={quote.business.borderStyle}
    >
      <article className="quote-link-document">
        <header>
          <div className="quote-link-brand-heading">
            {quote.business.hasLogo && (
              <div
                className="quote-link-brand-logo"
                role="img"
                aria-label={`${quote.business.name} logo`}
                style={{
                  backgroundImage: `url("${endpoint}/media/logo")`,
                }}
              />
            )}
            <div>
              <span>Quote from</span>
              <h1>{quote.business.name}</h1>
              {canonicalGoogleBusinessProfileUrl(quote.business.googleBusinessProfileUrl) && (
                <p><a href={canonicalGoogleBusinessProfileUrl(quote.business.googleBusinessProfileUrl) || undefined} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline", textUnderlineOffset: "3px", fontWeight: 600 }}>View Google business profile</a></p>
              )}
              <p>
                {quote.business.phone}
                {quote.business.email ? ` | ${quote.business.email}` : ""}
                {quote.business.abn ? ` | ABN ${quote.business.abn}` : ""}
              </p>
            </div>
          </div>
          <a
            className="quote-print-button"
            href={`${endpoint}/pdf?download=1`}
          >
            Download PDF
          </a>
        </header>
        <section className="quote-link-summary">
          <div>
            <span>Quote</span>
            <strong>
              {quote.quoteNumber} | Version {quote.versionNumber}
            </strong>
            <small>
              {quote.workTitle} | {quote.workNumber}
            </small>
          </div>
          <div>
            <span>Prepared for</span>
            <strong>{quote.customerName}</strong>
            <small>
              {quote.siteLabel} | {quote.siteSummary}
            </small>
          </div>
          <div>
            <span>Valid until</span>
            <strong>
              {quote.validUntil || "Contact trade business"}
            </strong>
          </div>
        </section>
        {quote.customerMessage && (
          <section className="quote-link-customer-message">
            <span>From {quote.business.name}</span>
            <p>{quote.customerMessage}</p>
          </section>
        )}
        {quote.hasRoofImage && (
          <section className="quote-link-block" aria-label="Roof design">
            <h2>Roof design</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${endpoint}/media/roof`} alt="Proposed roof design" style={{ display: "block", width: "100%", height: "auto", borderRadius: 10 }} />
            <p>Indicative layout. Confirm roof dimensions and installation details on site.</p>
          </section>
        )}
        {quote.items.length > 0 && (
          <section className="quote-link-block" aria-label="Quote items">
            <QuoteLines lines={quote.items} />
          </section>
        )}
        {quote.equipment && <TradeQuoteEquipmentCards items={quote.equipment.common} title={quote.choices.length ? "Equipment included in every option" : "Selected equipment"} />}
        {groups.map((group) => {
          const choices = quote.choices.filter(
            (choice) => `${choice.kind}:${choice.groupKey}` === group,
          );
          return (
            <fieldset className="quote-link-choices" key={group}>
              <legend>
                {choices[0]?.kind === "package"
                  ? "Choose your package"
                  : "Choose one"}
              </legend>
              <p>One clear selection is required.</p>
              <div>
                {choices.map((choice) => (
                  <label
                    className={`${selected.includes(choice.id) ? "selected" : ""} ${choice.recommended ? "recommended" : ""}`}
                    key={choice.id}
                  >
                    <input
                      type="radio"
                      name={group}
                      checked={selected.includes(choice.id)}
                      onChange={() => choose(choice)}
                    />
                    <span>
                      {choice.recommended && <em>Recommended</em>}
                      <b>{choice.name}</b>
                      <small>{choice.summary}</small>
                      <strong>
                        {money((quote.totalCents || 0) + choice.totalCents)} incl
                        GST before other extras
                      </strong>
                    </span>
                    <QuoteLines lines={choice.items} />
                    <TradeQuoteEquipmentCards items={quote.equipment?.choices.find((group) => group.choiceKey === choice.id)?.items || []} title={`Equipment in ${choice.name}`} />
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
        {addons.length > 0 && (
          <fieldset className="quote-link-choices addons">
            <legend>Optional extras</legend>
            <p>Add only what you want.</p>
            <div>
              {addons.map((choice) => (
                <label
                  className={selected.includes(choice.id) ? "selected" : ""}
                  key={choice.id}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(choice.id)}
                    onChange={() => choose(choice)}
                  />
                  <span>
                    <b>{choice.name}</b>
                    <small>{choice.summary}</small>
                    <strong>+ {money(choice.totalCents)}</strong>
                  </span>
                  <QuoteLines lines={choice.items} />
                  <TradeQuoteEquipmentCards items={quote.equipment?.choices.find((group) => group.choiceKey === choice.id)?.items || []} title={`Equipment in ${choice.name}`} />
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <section className="quote-link-total" aria-live="polite">
          <span>Total incl GST</span>
          <strong>{money(totals.total)}</strong>
          <dl>
            <div>
              <dt>Subtotal ex GST</dt>
              <dd>{money(grossSubtotal)}</dd>
            </div>
            {discountSubtotal < 0 && (
              <div>
                <dt>Discount ex GST</dt>
                <dd>{money(discountSubtotal)}</dd>
              </div>
            )}
            <div>
              <dt>GST</dt>
              <dd>{money(totals.tax)}</dd>
            </div>
          </dl>
          <small>
            Calculated and checked again by the server when you accept.
          </small>
        </section>
        <section className="quote-link-terms">
          <span>Recorded terms</span>
          <h2>Scope, exclusions and completion terms</h2>
          <p>{quote.terms}</p>
          <QuoteProductDocuments documents={selectedQuoteProductDocuments(quote.productDocuments || [], selected)} choices={quote.choices} />
          {Boolean(quote.productDocuments?.some((document) => document.choiceKeys.length)) && <p>The proposal PDF includes clearly labelled documents for all offered options. The list above follows your selected options.</p>}
        </section>
        <QuoteQuestions questions={quote.questions} question={question} onChange={setQuestion}
          onSend={() => void ask()} onRefresh={() => void refreshQuestions()} busy={busy} />
        <section className="quote-link-signature">
          <span>Signed decision</span>
          <h2>Type your name to sign</h2>
          <label>
            <span>Full name</span>
            <input
              value={signerName}
              maxLength={160}
              autoComplete="name"
              onChange={(event) => setSignerName(event.target.value)}
            />
          </label>
          <label className="quote-link-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I confirm I am authorised to make this decision and understand it
              applies to this exact quote version, selected choices, total and
              recorded terms.
            </span>
          </label>
          <div>
            <button
              className="primary"
              type="button"
              disabled={
                Boolean(busy) || signerName.trim().length < 2 || !consent
              }
              onClick={() => void decide("accepted")}
            >
              {busy === "accepted"
                ? "Recording..."
                : failedDecision === "accepted"
                  ? `Retry acceptance for ${money(totals.total)}`
                : `Accept for ${money(totals.total)}`}
            </button>
            <button
              type="button"
              disabled={
                Boolean(busy) || signerName.trim().length < 2 || !consent
              }
              onClick={() => void decide("declined")}
            >
              {busy === "declined"
                ? "Recording..."
                : failedDecision === "declined"
                  ? "Retry decline"
                  : "Decline quote"}
            </button>
          </div>
        </section>
        {message && (
          <p className="quote-link-message" role="alert">
            {message}
          </p>
        )}
      </article>
    </Surface>
  );
}
