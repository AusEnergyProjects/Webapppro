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

const ENERGY_QUOTE_CATEGORIES: ReadonlyArray<[string, RegExp]> = [
  ["solar", /\b(?:solar|photovoltaic|pv system|inverter)\b/i],
  ["battery", /\b(?:home battery|battery storage|battery system)\b/i],
  ["heat-pump hot water", /\b(?:heat pump hot water|heat-pump hot water|hpwh)\b/i],
  ["heating or cooling", /\b(?:reverse[- ]cycle|split system|air conditioning|heating and cooling|hvac)\b/i],
  ["insulation", /\binsulation\b/i],
  ["windows or draught sealing", /\b(?:double glazing|glazing|window replacement|draught seal|weather seal)\b/i],
  ["EV charging", /\b(?:ev charger|electric vehicle charger|charging station)\b/i],
  ["electrical work", /\b(?:switchboard|electrical upgrade|electrician|rcbo|circuit breaker)\b/i],
  ["gas appliance replacement", /\b(?:gas heater|gas hot water|gas appliance).{0,80}\b(?:replace|replacement|decommission|remove)\b/i],
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
    };
  }

  const categories = ENERGY_QUOTE_CATEGORIES
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => label);
  const scope = categories.length ? categories.join(", ") : "home-energy work";
  return {
    accepted: true,
    kind,
    directAnswer: `I found a home-energy quote covering ${scope}${total ? `, with an apparent total of ${total}` : ""}. Before accepting it, confirm exact brand and model numbers, capacity or performance, the full installation and switchboard scope, exclusions, rebate assumptions, workmanship warranty and who provides after-sales support.`,
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
