export type QuoteInvoiceTemplateSource = {
  quoteId: string;
  quoteVersionId: string;
  quoteNumber: string;
  versionNumber: number;
  status: string;
  terms: string;
};

export type QuoteInvoiceTemplateChoice = {
  id: string;
  position: number;
  kind: string;
  groupKey: string;
  recommended: boolean;
};

export type QuoteInvoiceTemplateItem = {
  position: number;
  quoteChoiceId: string;
  description: string;
  quantityMilli: number;
  taxCode: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export type QuoteInvoiceTemplateLine = {
  description: string;
  unitPriceCentsExGst: number;
  taxCode: "gst" | "none";
  priceBookItemId: string;
};

export type QuoteInvoiceTemplate = QuoteInvoiceTemplateSource & {
  lines: QuoteInvoiceTemplateLine[];
  discountCents: number;
  totalCents: number;
};

const MAX_INVOICE_LINE_CENTS = 10_000_000;
const MAX_INVOICE_TOTAL_CENTS = 100_000_000;
const MAX_INVOICE_LINES = 8;

function clean(value: unknown, maximum: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function quantityDescription(description: string, quantityMilli: number) {
  if (quantityMilli === 1000) return description;
  const quantity = (quantityMilli / 1000).toFixed(3).replace(/\.?0+$/, "");
  return clean(`${description} (${quantity} quoted)`, 180);
}

function splitLine(description: string, subtotalCents: number, taxCode: "gst" | "none") {
  const lines: QuoteInvoiceTemplateLine[] = [];
  let remaining = subtotalCents;
  while (remaining > 0) {
    const amount = Math.min(remaining, MAX_INVOICE_LINE_CENTS);
    const part = lines.length + 1;
    lines.push({
      description: clean(part === 1 ? description : `${description} (part ${part})`, 180),
      unitPriceCentsExGst: amount,
      taxCode,
      priceBookItemId: "",
    });
    remaining -= amount;
  }
  return lines;
}

function defaultChoiceIds(choices: readonly QuoteInvoiceTemplateChoice[]) {
  const selected = new Map<string, QuoteInvoiceTemplateChoice>();
  for (const choice of [...choices].sort((a, b) => a.position - b.position)) {
    if (choice.kind === "addon") continue;
    const key = `${choice.kind}:${choice.groupKey}`;
    if (!selected.has(key) || choice.recommended) selected.set(key, choice);
  }
  return new Set([...selected.values()].map((choice) => choice.id));
}

function invoiceTotal(lines: readonly QuoteInvoiceTemplateLine[], discountCents: number) {
  const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCentsExGst, 0);
  if (subtotalCents <= 0 || discountCents < 0 || discountCents >= subtotalCents) return -1;
  const taxableSubtotalCents = lines.reduce((sum, line) => (
    sum + (line.taxCode === "gst" ? line.unitPriceCentsExGst : 0)
  ), 0);
  const lineTaxCents = lines.reduce((sum, line) => (
    sum + (line.taxCode === "gst" ? Math.round(line.unitPriceCentsExGst / 10) : 0)
  ), 0);
  const taxableDiscountCents = discountCents && taxableSubtotalCents
    ? Math.min(taxableSubtotalCents, Number((
        BigInt(discountCents) * BigInt(taxableSubtotalCents) + BigInt(Math.floor(subtotalCents / 2))
      ) / BigInt(subtotalCents)))
    : 0;
  const taxDiscountCents = Math.min(lineTaxCents, Math.floor((taxableDiscountCents + 5) / 10));
  return subtotalCents - discountCents + lineTaxCents - taxDiscountCents;
}

/**
 * Converts the current quote's default selection into the intentionally small
 * quick-invoice contract. Returns null rather than changing a quoted total when
 * the source cannot be represented exactly in that contract.
 */
export function buildQuoteInvoiceTemplate(
  source: QuoteInvoiceTemplateSource,
  items: readonly QuoteInvoiceTemplateItem[],
  choices: readonly QuoteInvoiceTemplateChoice[],
): QuoteInvoiceTemplate | null {
  const selectedChoiceIds = defaultChoiceIds(choices);
  const selectedItems = [...items]
    .filter((item) => !item.quoteChoiceId || selectedChoiceIds.has(item.quoteChoiceId))
    .sort((a, b) => a.position - b.position);
  if (!selectedItems.length) return null;

  let discountCents = 0;
  let selectedTotalCents = 0;
  const detailedLines: QuoteInvoiceTemplateLine[] = [];
  for (const item of selectedItems) {
    const taxCode = item.taxCode === "none" ? "none" : item.taxCode === "gst" ? "gst" : null;
    if (!taxCode
      || !Number.isSafeInteger(item.quantityMilli)
      || item.quantityMilli < 1
      || !Number.isSafeInteger(item.subtotalCents)
      || !Number.isSafeInteger(item.taxCents)
      || !Number.isSafeInteger(item.totalCents)
      || item.totalCents !== item.subtotalCents + item.taxCents) return null;
    selectedTotalCents += item.totalCents;
    if (item.subtotalCents < 0) {
      discountCents += -item.subtotalCents;
      continue;
    }
    if (item.subtotalCents === 0) continue;
    if (taxCode === "none" ? item.taxCents !== 0 : item.taxCents !== Math.round(item.subtotalCents / 10)) return null;
    const description = quantityDescription(clean(item.description, 180), item.quantityMilli);
    if (!description) return null;
    detailedLines.push(...splitLine(description, item.subtotalCents, taxCode));
  }

  if (!detailedLines.length || !Number.isSafeInteger(discountCents) || discountCents > MAX_INVOICE_TOTAL_CENTS) return null;
  let lines = detailedLines;
  if (lines.length > MAX_INVOICE_LINES) {
    const grouped = new Map<"gst" | "none", number>();
    for (const line of lines) grouped.set(line.taxCode, (grouped.get(line.taxCode) || 0) + line.unitPriceCentsExGst);
    lines = [...grouped.entries()].flatMap(([taxCode, amount]) => splitLine(
      `${clean(source.quoteNumber, 120)} quoted work${taxCode === "gst" ? "" : " (GST free)"}`,
      amount,
      taxCode,
    ));
  }
  if (lines.length > MAX_INVOICE_LINES) return null;
  const totalCents = invoiceTotal(lines, discountCents);
  if (totalCents !== selectedTotalCents || totalCents <= 0 || totalCents > MAX_INVOICE_TOTAL_CENTS) return null;

  return {
    quoteId: clean(source.quoteId, 180),
    quoteVersionId: clean(source.quoteVersionId, 180),
    quoteNumber: clean(source.quoteNumber, 120),
    versionNumber: Number(source.versionNumber),
    status: clean(source.status, 40),
    terms: String(source.terms || "").trim().slice(0, 20_000),
    lines,
    discountCents,
    totalCents,
  };
}
