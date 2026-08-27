import { strFromU8, unzipSync } from "fflate";

export const MAX_ENERGY_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ENERGY_DOCUMENT_REQUEST_BYTES = MAX_ENERGY_DOCUMENT_BYTES + 512 * 1024;

const MAX_EXTRACTED_TEXT_CHARACTERS = 80_000;
const MAX_DOCX_XML_BYTES = 12 * 1024 * 1024;
const MAX_DOCX_XML_FILES = 24;
const MAX_PDF_PAGES = 30;
const PDF_EXTRACTION_TIMEOUT_MS = 8_000;

export type EnergyDocumentKind = "electricity_bill" | "gas_bill" | "energy_quote";

export type EnergyDocumentAnalysis = {
  accepted: boolean;
  kind: EnergyDocumentKind | "unrelated";
  directAnswer: string;
  conversationContext: string;
};

export type EnergyCertificateMarketReference = {
  code: "STC" | "VEEC";
  tradedOn: string;
  priceCents: number;
};

export class EnergyDocumentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "EnergyDocumentError";
    this.status = status;
    this.code = code;
  }
}

function tidyText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT_CHARACTERS);
}

function decodeXml(value: string) {
  const numericEntity = (source: string, radix: number) => {
    const code = Number.parseInt(source, radix);
    return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : "";
  };
  return value
    .replace(/&#(\d+);/g, (_, code: string) => numericEntity(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => numericEntity(code, 16))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function docxXmlToText(xml: string) {
  return tidyText(decodeXml(xml
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, "\t")
    .replace(/<w:br\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/w:(?:p|tr)>/gi, "\n")
    .replace(/<\/w:tc>/gi, "\t")
    .replace(/<[^>]+>/g, "")));
}

function isDocxTextPart(name: string) {
  return name === "word/document.xml"
    || /^word\/(?:header|footer)\d+\.xml$/i.test(name);
}

function extractDocxText(bytes: Uint8Array) {
  let expandedBytes = 0;
  let acceptedFiles = 0;
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes, {
      filter(file) {
        if (!isDocxTextPart(file.name)) return false;
        expandedBytes += file.originalSize;
        acceptedFiles += 1;
        if (expandedBytes > MAX_DOCX_XML_BYTES || acceptedFiles > MAX_DOCX_XML_FILES) {
          throw new EnergyDocumentError(
            413,
            "DOCUMENT_EXPANDED_SIZE_INVALID",
            "This Word document expands beyond the safe analysis limit.",
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof EnergyDocumentError) throw error;
    throw new EnergyDocumentError(
      400,
      "DOCUMENT_UNREADABLE",
      "This Word document could not be read. Save it as a new .docx file or PDF and try again.",
    );
  }
  const documentXml = archive["word/document.xml"];
  if (!documentXml) {
    throw new EnergyDocumentError(
      400,
      "DOCUMENT_UNREADABLE",
      "This file is not a readable modern Word document. Upload a PDF or .docx file.",
    );
  }
  return Object.entries(archive)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, xml]) => docxXmlToText(strFromU8(xml)))
    .filter(Boolean)
    .join("\n\n");
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new EnergyDocumentError(
          408,
          "DOCUMENT_ANALYSIS_TIMEOUT",
          "This document took too long to read. Try a shorter text-based PDF or .docx file.",
        )), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function extractPdfText(bytes: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await withTimeout(getDocumentProxy(bytes), PDF_EXTRACTION_TIMEOUT_MS);
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new EnergyDocumentError(
        413,
        "DOCUMENT_PAGE_LIMIT",
        `PDF analysis is limited to ${MAX_PDF_PAGES} pages.`,
      );
    }
    const result = await withTimeout(
      extractText(pdf, { mergePages: true }),
      PDF_EXTRACTION_TIMEOUT_MS,
    );
    return typeof result.text === "string" ? tidyText(result.text) : "";
  } catch (error) {
    if (error instanceof EnergyDocumentError) throw error;
    throw new EnergyDocumentError(
      400,
      "DOCUMENT_UNREADABLE",
      "This PDF could not be read. Upload a text-based PDF rather than a scan or protected file.",
    );
  } finally {
    await pdf?.cleanup().catch(() => undefined);
  }
}

function supportedFormat(fileName: string, contentType: string, bytes: Uint8Array) {
  const extension = fileName.trim().toLowerCase().match(/\.(pdf|docx)$/)?.[1] || "";
  const pdfMagic = bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
    && bytes[3] === 0x46 && bytes[4] === 0x2d;
  const zipMagic = bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
  const cleanType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (extension === "pdf" && pdfMagic && (
    !cleanType || cleanType === "application/pdf" || cleanType === "application/octet-stream"
  )) return "pdf";
  if (extension === "docx" && zipMagic && (
    !cleanType
    || cleanType === "application/zip"
    || cleanType === "application/octet-stream"
    || cleanType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )) return "docx";
  throw new EnergyDocumentError(
    415,
    "DOCUMENT_TYPE_UNSUPPORTED",
    "Upload a PDF or modern Word .docx file whose contents match its file type.",
  );
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1]?.replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return "";
}

function apparentTotal(text: string) {
  const value = firstMatch(text, [
    /\b(?:total amount due|amount due|balance due|new charges|total incl(?:uding)? gst|quote total|total price|total)\b[^$\d]{0,30}\$\s*([\d,]+(?:\.\d{2})?)/i,
    /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:total amount due|amount due|balance due|total incl(?:uding)? gst|quote total|total price)\b/i,
  ]);
  return value ? `$${value}` : "";
}

function usageFigures(text: string) {
  const figures = [...text.matchAll(/\b([\d,]+(?:\.\d+)?)\s*(kwh|mj)\b/gi)]
    .map((match) => `${match[1]} ${match[2].toUpperCase()}`);
  return [...new Set(figures)].slice(0, 3);
}

type QuoteCertificateFact = {
  code: "STC" | "VEEC";
  quantity: number;
  unitRate: string;
  credit: string;
  reconciles: boolean;
};

function decimalAmount(value: string) {
  const amount = Number(value.replaceAll(",", ""));
  return Number.isFinite(amount) ? amount : null;
}

function money(value: number) {
  return `$${value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })}`;
}

function quoteCertificateFact(text: string, code: QuoteCertificateFact["code"]): QuoteCertificateFact | null {
  const patterns = [
    new RegExp(`\\b${code}(?:\\s+credit)?\\s*[-:–]?\\s*(\\d{1,5})\\s+(?:at|x)\\s+\\$([\\d,]+(?:\\.\\d{1,2})?)[^\\n]{0,40}?-?\\$([\\d,]+(?:\\.\\d{1,2})?)`, "i"),
    new RegExp(`\\b${code}\\s+total[^\\n]{0,120}?\\b(\\d{1,5})\\s+\\$([\\d,]+(?:\\.\\d{1,2})?)\\s+\\$([\\d,]+(?:\\.\\d{1,2})?)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const quantity = Number(match[1]);
    const rate = decimalAmount(match[2]);
    const credit = decimalAmount(match[3]);
    if (!Number.isInteger(quantity) || quantity < 1 || rate === null || rate <= 0 || credit === null || credit <= 0) continue;
    return {
      code,
      quantity,
      unitRate: money(rate),
      credit: money(credit),
      reconciles: Math.abs((quantity * rate) - credit) < 0.011,
    };
  }
  return null;
}

function quoteCertificateFacts(text: string) {
  return (["STC", "VEEC"] as const)
    .map((code) => quoteCertificateFact(text, code))
    .filter((fact): fact is QuoteCertificateFact => fact !== null);
}

function quoteVeecFeeBreakdown(text: string) {
  const match = text.match(/\$([\d,]+(?:\.\d{1,2})?)\s+sale value\s*-\s*\$([\d,]+(?:\.\d{1,2})?)\s+registration\s*-\s*\$([\d,]+(?:\.\d{1,2})?)\s+compliance\s*=\s*\$([\d,]+(?:\.\d{1,2})?)\s+ex gst/i);
  if (!match) return null;
  const saleValue = decimalAmount(match[1]);
  const registration = decimalAmount(match[2]);
  const compliance = decimalAmount(match[3]);
  const net = decimalAmount(match[4]);
  if (saleValue === null || saleValue < 0
    || registration === null || registration < 0
    || compliance === null || compliance < 0
    || net === null || net < 0) return null;
  return {
    saleValue: money(saleValue),
    registration: money(registration),
    compliance: money(compliance),
    net: money(net),
    reconciles: Math.abs((saleValue - registration - compliance) - net) < 0.011,
  };
}

function quoteCertificateCreditTotal(text: string) {
  const value = firstMatch(text, [
    /\btotal certificate credits? (?:are|of)?\s*\$([\d,]+(?:\.\d{1,2})?)\s+ex gst/i,
    /\bcertificate credits?[^\n]{0,120}?\btotal\s*-?\$([\d,]+(?:\.\d{1,2})?)/i,
  ]);
  const amount = value ? decimalAmount(value) : null;
  return amount !== null && amount > 0 ? money(amount) : "";
}

function quoteConditionalSolarVictoriaRebate(text: string) {
  const value = firstMatch(text, [
    /\bpotential solar victoria[^\n]{0,100}?not included\s*-?\$([\d,]+(?:\.\d{1,2})?)/i,
    /\bpossible solar victoria amount[^\n]{0,100}?\$([\d,]+(?:\.\d{1,2})?)[^\n]{0,80}?not (?:included|deducted)/i,
  ]);
  const amount = value ? decimalAmount(value) : null;
  return amount !== null && amount > 0 ? money(amount) : "";
}

function quotePrimaryProductModel(text: string) {
  const candidates: string[] = [];
  const patterns = [
    /\bmodel(?: number| no\.?)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,29})\b/gi,
    /\b((?:HPA|HWS)[A-Z0-9]*(?:-[A-Z0-9]+)+)\b/gi,
    /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b(?=[^\n]{0,24}\bmodel\b)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[1]?.replace(/[./]+$/g, "").toUpperCase();
      if (!candidate || !/[A-Z]/.test(candidate) || !/\d/.test(candidate)) continue;
      if (!candidates.includes(candidate)) candidates.push(candidate);
    }
  }
  return candidates[0] || "";
}

export function appendEnergyCertificateMarketReferences(
  conversationContext: string,
  references: readonly EnergyCertificateMarketReference[],
) {
  if (!conversationContext.startsWith("Uploaded energy quote summary for follow-up:")
    || !/\b(?:STC|VEEC) \d+ at \$/.test(conversationContext)) return conversationContext;
  const quotedCodes = (["STC", "VEEC"] as const)
    .filter((code) => new RegExp(`\\b${code} \\d+ at \\$`).test(conversationContext));
  const relevant = references
    .filter((reference) => quotedCodes.includes(reference.code)
      && /^\d{4}-\d{2}-\d{2}$/.test(reference.tradedOn)
      && Number.isInteger(reference.priceCents)
      && reference.priceCents > 0)
    .sort((left, right) => left.code.localeCompare(right.code));
  const dates = new Set(relevant.map((reference) => reference.tradedOn));
  if (relevant.length !== quotedCodes.length || dates.size !== 1) return conversationContext;
  const tradedOn = relevant[0].tradedOn;
  const values = relevant.map((reference) => `${reference.code} ${money(reference.priceCents / 100)}`).join(", ");
  const next = `${conversationContext} latest reported market reference ${tradedOn}: ${values};`;
  return next.length <= 600 ? next : conversationContext;
}

const ENERGY_QUOTE_CATEGORIES: ReadonlyArray<[string, RegExp]> = [
  ["solar", /\b(?:solar pv|solar panels?|photovoltaic|pv system|solar inverter)\b/i],
  ["battery", /\b(?:home battery|battery storage|battery system)\b/i],
  ["hot water", /\b(?:heat[- ]pump (?:hot[- ]water|water heater)|hot[- ]water (?:system|unit)|water heater|\bhws\b)\b/i],
  ["electric cooking", /\b(?:electric stove|electric cooktop|induction cooktop|electric oven|cooking appliance)\b/i],
  ["heating or cooling", /\b(?:reverse[- ]cycle|split system|air conditioning|heating and cooling|hvac)\b/i],
  ["insulation", /\binsulation\b/i],
  ["windows or draught sealing", /\b(?:double glazing|glazing|window replacement|draught seal|weather seal)\b/i],
  ["EV charging", /\b(?:ev charger|electric vehicle charger|charging station)\b/i],
  ["electrical work", /\b(?:switchboard|electrical upgrade|electrician|rcbo|circuit breaker)\b/i],
  ["gas appliance replacement", /\b(?:gas heater|gas hot water|gas appliance).{0,80}\b(?:replace|replacement|decommission|remove)\b/i],
];

const ENERGY_QUOTE_STRUCTURE: ReadonlyArray<[string, RegExp]> = [
  ["itemised pricing", /\b(?:detailed scope and pricing|unit ex gst|amount ex gst|price summary|net price by section)\b/i],
  ["model or capacity details", /\b(?:model|capacity|\d+(?:\.\d+)?\s*(?:kw|litres?|liters?|l\b))\b/i],
  ["allowances or exclusions", /\b(?:allowance|allowances|excluded|exclusion|exclusions|beyond (?:the )?(?:base )?scope)\b/i],
  ["warranty terms", /\bwarrant(?:y|ies)\b/i],
];

export function classifyEnergyDocument(textInput: string): EnergyDocumentKind | "unrelated" {
  const text = tidyText(textInput);
  const hasBillStructure = /\b(?:tax invoice|energy bill|electricity bill|gas bill|billing period|amount due|total due|account summary|meter read)\b/i.test(text);
  const hasElectricityEvidence = /\b(?:electricity|nmi|kwh|solar feed[- ]in|controlled load)\b/i.test(text);
  const hasGasEvidence = /\b(?:natural gas|gas usage|mirn|megajoules?|\bmj\b|gas meter|gas supply charge)\b/i.test(text);
  const hasBillMeasure = /\b(?:kwh|\bmj\b|usage charge|supply charge|tariff|meter number|previous read|current read)\b/i.test(text);
  if (hasBillStructure && hasBillMeasure && hasElectricityEvidence) return "electricity_bill";
  if (hasBillStructure && hasBillMeasure && hasGasEvidence) return "gas_bill";

  const hasQuoteStructure = /\b(?:quotation|quote number|quote no\.?|proposal|scope of works|valid for \d+ days|acceptance|deposit|total price|total incl(?:uding)? gst)\b/i.test(text);
  const categoryCount = ENERGY_QUOTE_CATEGORIES.filter(([, pattern]) => pattern.test(text)).length;
  const hasTradeScope = /\b(?:supply and install|installation|installer|labour|warranty|model|capacity|rebate|certificate)\b/i.test(text);
  if (hasQuoteStructure && categoryCount > 0 && hasTradeScope) return "energy_quote";
  return "unrelated";
}

export function analyseExtractedEnergyDocument(textInput: string): EnergyDocumentAnalysis {
  const text = tidyText(textInput);
  const kind = classifyEnergyDocument(text);
  if (kind === "unrelated") {
    return {
      accepted: false,
      kind,
      directAnswer: "This document doesn’t appear to be related to a home-energy quote or electricity or gas bill, so I haven’t analysed it.",
      conversationContext: "",
    };
  }

  const total = apparentTotal(text);
  const usage = usageFigures(text);
  if (kind === "electricity_bill" || kind === "gas_bill") {
    const service = kind === "electricity_bill" ? "electricity" : "gas";
    const article = kind === "electricity_bill" ? "an" : "a";
    const figures = [
      total ? `an apparent total due of ${total}` : "no clearly labelled total due",
      usage.length ? `usage figures including ${usage.join(", ")}` : "no clearly labelled usage total",
    ].join(" and ");
    return {
      accepted: true,
      kind,
      directAnswer: `I found ${article} ${service} bill. The readable content shows ${figures}. Check the billing period, daily supply charge, usage rates, concessions and any solar feed-in credit before comparing plans. I have not repeated account numbers, meter identifiers or address details in this analysis.`,
      conversationContext: [
        `Uploaded ${service} bill summary for follow-up:`,
        total ? `apparent total due ${total}` : "no clearly labelled total due",
        usage.length ? `usage figures ${usage.join(", ")}` : "no clearly labelled usage total",
      ].join(" "),
    };
  }

  const categories = ENERGY_QUOTE_CATEGORIES
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
  const quoteStructure = ENERGY_QUOTE_STRUCTURE
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
  const scope = categories.length ? categories.join(", ") : "home-energy work";
  const quotedModel = quotePrimaryProductModel(text);
  const certificateFacts = quoteCertificateFacts(text);
  const veecFees = quoteVeecFeeBreakdown(text);
  const certificateCreditTotal = quoteCertificateCreditTotal(text);
  const solarVictoriaRebate = quoteConditionalSolarVictoriaRebate(text);
  const hasCertificateOrRebateAssumptions = /\b(?:certificate credits?|veecs?|stcs?|rebate allowance|rebate assumption)\b/i.test(text);
  const creditDirection = hasCertificateOrRebateAssumptions
    ? " The quote appears to include certificate credits or rebate assumptions, so confirm the eligible quantities, rates, GST treatment and any conditional rebate separately before signing."
    : "";
  const structureDirection = quoteStructure.length
    ? ` The readable content also appears to include ${quoteStructure.join(", ")}.`
    : "";
  return {
    accepted: true,
    kind,
    directAnswer: certificateFacts.length
      ? `I found a home-energy quote covering ${scope}${quotedModel ? `, quoting model ${quotedModel}` : ""}${total ? `, with an apparent total of ${total}` : ""}. The readable certificate lines show ${certificateFacts.map((fact) => `${fact.quantity} ${fact.code}s at ${fact.unitRate} each (${fact.credit} ex GST)`).join(" and ")}${certificateCreditTotal ? `, totalling ${certificateCreditTotal} ex GST` : ""}. You can ask me whether the quoted equipment, rates, fees or final total look reasonable.`
      : `I found a home-energy quote covering ${scope}${total ? `, with an apparent total of ${total}` : ""}.${structureDirection}${creditDirection} Before accepting it, confirm the supplied details match the site, the complete installation and switchboard scope, extra rates, certificate assumptions, warranty and after-sales responsibility.`,
    conversationContext: [
      `Uploaded energy quote summary for follow-up: scope includes ${scope};`,
      quotedModel ? `quoted model ${quotedModel};` : "",
      total ? `apparent total ${total};` : "",
      ...certificateFacts.map((fact) => `${fact.code} ${fact.quantity} at ${fact.unitRate} = ${fact.credit} ex GST, arithmetic ${fact.reconciles ? "reconciles" : "does not reconcile"};`),
      veecFees ? `VEEC fee breakdown gross ${veecFees.saleValue}, registration ${veecFees.registration}, compliance ${veecFees.compliance}, net ${veecFees.net}, arithmetic ${veecFees.reconciles ? "reconciles" : "does not reconcile"};` : "",
      certificateCreditTotal ? `total certificate credits ${certificateCreditTotal} ex GST;` : "",
      solarVictoriaRebate ? `conditional Solar Victoria rebate ${solarVictoriaRebate} not included;` : "",
      !certificateFacts.length && quoteStructure.length ? `quote structure includes ${quoteStructure.join(", ")};` : "",
      !certificateFacts.length && hasCertificateOrRebateAssumptions ? "certificate credits or rebate assumptions detected." : "",
    ].filter(Boolean).join(" ").trim(),
  };
}

export async function analyseEnergyDocumentBytes(input: {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
}): Promise<EnergyDocumentAnalysis> {
  if (input.bytes.byteLength < 1) {
    throw new EnergyDocumentError(400, "DOCUMENT_EMPTY", "Choose a non-empty PDF or .docx file.");
  }
  if (input.bytes.byteLength > MAX_ENERGY_DOCUMENT_BYTES) {
    throw new EnergyDocumentError(413, "DOCUMENT_SIZE_INVALID", "Documents must be no larger than 5 MB.");
  }
  const format = supportedFormat(input.fileName, input.contentType, input.bytes);
  const text = format === "pdf"
    ? await extractPdfText(input.bytes)
    : extractDocxText(input.bytes);
  if (text.length < 20) {
    throw new EnergyDocumentError(
      400,
      "DOCUMENT_TEXT_UNREADABLE",
      "I couldn’t find enough readable text. Upload a text-based PDF or modern .docx file rather than a scan.",
    );
  }
  return analyseExtractedEnergyDocument(text);
}
