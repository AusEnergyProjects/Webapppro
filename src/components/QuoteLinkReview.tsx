"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

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
type BannerCrop = {
  xBasisPoints: number;
  yBasisPoints: number;
  widthBasisPoints: number;
  heightBasisPoints: number;
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
    themeKey: string;
    borderStyle: string;
    hasLogo: boolean;
    hasBanner: boolean;
    bannerCrop: BannerCrop;
  };
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  customerMessage: string;
  terms: string;
  validUntil: string;
  issuedAt: string;
  consentStatement: string;
  expiresAt: string;
  items: Line[];
  choices: Choice[];
  questions: Question[];
};
type Result = {
  ok?: boolean;
  quote?: Quote;
  decision?: string;
  error?: string;
};

const money = (cents: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function bannerBackgroundStyle(
  crop: BannerCrop,
  naturalWidth: number,
  naturalHeight: number,
): CSSProperties {
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { backgroundPosition: "center", backgroundSize: "cover" };
  }
  let x = (clamp(crop.xBasisPoints, 0, 10_000) / 10_000) * naturalWidth;
  let y = (clamp(crop.yBasisPoints, 0, 10_000) / 10_000) * naturalHeight;
  let width =
    (clamp(crop.widthBasisPoints, 1, 10_000) / 10_000) * naturalWidth;
  let height =
    (clamp(crop.heightBasisPoints, 1, 10_000) / 10_000) * naturalHeight;
  width = Math.min(width, naturalWidth - x);
  height = Math.min(height, naturalHeight - y);

  if (width / height > 5) {
    const nextWidth = height * 5;
    x += (width - nextWidth) / 2;
    width = nextWidth;
  } else {
    const nextHeight = width / 5;
    y += (height - nextHeight) / 2;
    height = nextHeight;
  }

  const xFraction = x / naturalWidth;
  const yFraction = y / naturalHeight;
  const widthFraction = width / naturalWidth;
  const heightFraction = height / naturalHeight;
  const position = (start: number, size: number) =>
    size >= 0.999999 ? 50 : (start / (1 - size)) * 100;

  return {
    backgroundPosition: `${position(xFraction, widthFraction)}% ${position(
      yFraction,
      heightFraction,
    )}%`,
    backgroundSize: `${100 / widthFraction}% ${100 / heightFraction}%`,
  };
}

function CroppedBanner({
  endpoint,
  business,
}: {
  endpoint: string;
  business: Quote["business"];
}) {
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const source = `${endpoint}/media/banner`;
  useEffect(() => {
    const image = new window.Image();
    image.onload = () =>
      setNaturalSize({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    image.src = source;
    return () => {
      image.onload = null;
    };
  }, [source]);
  return (
    <div
      className="quote-link-brand-banner"
      role="img"
      aria-label={`${business.name} banner`}
      style={{
        aspectRatio: "5 / 1",
        height: "auto",
        backgroundImage: `url("${source}")`,
        backgroundRepeat: "no-repeat",
        ...bannerBackgroundStyle(
          business.bannerCrop,
          naturalSize.width,
          naturalSize.height,
        ),
      }}
    />
  );
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

export function QuoteLinkReview({ token }: { token: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [signerName, setSignerName] = useState("");
  const [consent, setConsent] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState("");
  const endpoint = `/api/quote-review/${encodeURIComponent(token)}`;
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const result = (await response.json().catch(() => ({}))) as Result;
    if (!response.ok || !result.quote) {
      throw new Error(result.error || "This quote could not be opened.");
    }
    setQuote(result.quote);
    const required = new Map<string, Choice>();
    for (const choice of result.quote.choices.filter(
      (item) => item.kind !== "addon",
    )) {
      const key = `${choice.kind}:${choice.groupKey}`;
      const current = required.get(key);
      if (!current || choice.recommended) required.set(key, choice);
    }
    setSelected([...required.values()].map((item) => item.id));
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
  }, [load]);

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
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as Result;
    if (!response.ok) {
      throw new Error(result.error || "The quote could not be updated.");
    }
    return result;
  }
  async function ask() {
    setBusy("question");
    setMessage("");
    try {
      const result = await post({ action: "ask_question", question });
      if (result.quote) setQuote(result.quote);
      setQuestion("");
      setMessage("Your question is now in the trade office timeline.");
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
  async function decide(decision: "accepted" | "declined") {
    setBusy(decision);
    setMessage("");
    try {
      const result = await post({
        action: "decide",
        decision,
        signerName,
        consentConfirmed: consent,
        selectedChoiceIds: selected,
      });
      setFinished(result.decision || decision);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Your decision could not be recorded.",
      );
    } finally {
      setBusy("");
    }
  }
  if (finished) {
    return (
      <main className="quote-link-shell">
        <section className="quote-link-finished">
          <span>Decision recorded</span>
          <h1>Quote {finished}</h1>
          <p>
            The trade business now has your signed decision and exact total.
            This secure link has closed automatically.
          </p>
        </section>
      </main>
    );
  }
  if (!quote) {
    return (
      <main className="quote-link-shell">
        <section className="quote-link-loading">
          <strong>Opening secure quote</strong>
          {message && <p role="alert">{message}</p>}
        </section>
      </main>
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
    <main
      className="quote-link-shell"
      data-theme={quote.business.themeKey}
      data-border={quote.business.borderStyle}
    >
      <article className="quote-link-document">
        {quote.business.hasBanner && (
          <CroppedBanner endpoint={endpoint} business={quote.business} />
        )}
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
        {quote.items.length > 0 && (
          <section className="quote-link-block" aria-label="Quote items">
            <QuoteLines lines={quote.items} />
          </section>
        )}
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
        </section>
        <section className="quote-link-question">
          <span>Need one detail clarified?</span>
          <h2>Ask the trade business</h2>
          {quote.questions.map((item) => (
            <article key={item.id}>
              <strong>Your question</strong>
              <p>{item.question}</p>
              {item.answer && (
                <>
                  <strong>Trade response</strong>
                  <p>{item.answer}</p>
                </>
              )}
            </article>
          ))}
          <label>
            <span>Your question</span>
            <textarea
              value={question}
              maxLength={1000}
              rows={3}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about the scope, timing or an option"
            />
          </label>
          <button
            type="button"
            disabled={busy === "question" || question.trim().length < 5}
            onClick={() => void ask()}
          >
            {busy === "question" ? "Sending..." : "Send question"}
          </button>
        </section>
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
                : `Accept for ${money(totals.total)}`}
            </button>
            <button
              type="button"
              disabled={
                Boolean(busy) || signerName.trim().length < 2 || !consent
              }
              onClick={() => void decide("declined")}
            >
              {busy === "declined" ? "Recording..." : "Decline quote"}
            </button>
          </div>
        </section>
        {message && (
          <p className="quote-link-message" role="status">
            {message}
          </p>
        )}
      </article>
    </main>
  );
}
