import { parseNem12 } from "./electricity/nem12.ts";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker } from "pdfjs-dist/types/src/display/api.d.ts";

export const ENERGY_DOCUMENT_LIMITS = Object.freeze({
  maxFileBytes: 12 * 1024 * 1024,
  maxPdfPages: 30,
  maxPdfTextCharacters: 300_000,
  maxCsvRows: 200_000,
  maxCsvColumns: 80,
  maxVehicleComparisonRows: 100,
});

export type EnergyDocumentFailureCode =
  | "UNSUPPORTED_TYPE"
  | "FILE_TOO_LARGE"
  | "READ_FAILED"
  | "PDF_ENCRYPTED"
  | "PDF_MALFORMED"
  | "PDF_PAGE_LIMIT"
  | "PDF_TEXT_LIMIT"
  | "PDF_IMAGE_ONLY"
  | "GVG_PDF_REQUIRES_CSV"
  | "CSV_ROW_LIMIT"
  | "CSV_MALFORMED"
  | "CSV_UNSUPPORTED_SCHEMA"
  | "CSV_NO_VALID_ROWS";

export interface EnergyDocumentFailure {
  ok: false;
  code: EnergyDocumentFailureCode;
  message: string;
}

export interface LocalEnergyDocumentInput {
  name?: string;
  type?: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

export interface EnergyDocumentPrivacyBoundary {
  processing: "local-only";
  rawContentRetained: false;
  automaticRedaction: "bounded-patterns-only";
  freeTextMayContainPersonalInformation: true;
  automaticallyShared: false;
  leadSharing: "structured-summary-explicit-selection-required";
}

export type EnergyQuoteTopic =
  | "solar-pv"
  | "battery"
  | "hot-water-heat-pump"
  | "heating-cooling"
  | "insulation"
  | "windows-glazing"
  | "draught-ventilation"
  | "ev-charging"
  | "general-electrical"
  | "unclassified-energy-work";

export interface QuoteMetric {
  metric: string;
  value: string;
  unit: string;
  context: string;
}

export interface QuoteAmount {
  label: "total" | "subtotal" | "deposit" | "balance" | "discount-or-rebate" | "other";
  amount: string;
  context: string;
}

export interface EnergyQuoteSummary {
  documentKind: "energy-quote";
  pageCount: number;
  topics: EnergyQuoteTopic[];
  scope: string[];
  quotedItems: string[];
  metrics: QuoteMetric[];
  amounts: QuoteAmount[];
  rebateOrCertificateClaims: string[];
  warranties: string[];
  exclusions: string[];
  missingEvidence: string[];
  questions: string[];
  reviewBoundary: string;
}

export interface ClockWindowSummary {
  busiestAverageInterval: string | null;
  overnightSharePercent: number | null;
  daylightSharePercent: number | null;
  eveningSharePercent: number | null;
  tariffBoundary: string;
}

export interface IntervalSemantics {
  import: "proven-kwh" | "not-provided" | "ambiguous";
  export: "proven-kwh" | "not-provided" | "ambiguous";
  basis: string;
}

export interface ElectricityIntervalSummary {
  documentKind: "electricity-interval-data";
  format: "NEM12" | "header-csv";
  period: {
    startDate: string;
    endDate: string;
    observedDays: number;
    coveragePercent: number;
  };
  rowCount: number;
  intervalMinutes: number | null;
  granularity: string;
  semantics: IntervalSemantics;
  totals: {
    importKwh?: number;
    exportKwh?: number;
    averageDailyImportKwh?: number;
  };
  loadShape: ClockWindowSummary;
  quality: {
    actualPercent?: number;
    validRowsPercent?: number;
  };
  observations: string[];
  ambiguities: string[];
  questions: string[];
}

export interface EnergyQuoteAnalysis {
  ok: true;
  kind: "quote-pdf";
  summary: EnergyQuoteSummary;
  privacy: EnergyDocumentPrivacyBoundary;
}

export interface ElectricityIntervalAnalysis {
  ok: true;
  kind: "interval-csv";
  summary: ElectricityIntervalSummary;
  privacy: EnergyDocumentPrivacyBoundary;
}

export interface GreenVehicleGuideVehicle {
  year: number;
  make: string;
  model: string;
  variant: string;
  energyConsumptionWhPerKm: number;
  electricRangeKm: number;
  currentModelInFile: boolean;
  testCycle: string;
  annualFuelCostAud: number | null;
}

export interface GreenVehicleGuideComparisonSummary {
  documentKind: "green-vehicle-guide-comparison";
  vehicles: GreenVehicleGuideVehicle[];
  vehicleCount: number;
  testCycles: string[];
  sameTestCycle: boolean;
  excludedRowCount: number;
  ambiguities: string[];
  comparisonBoundary: string;
  annualFuelCostBoundary: string;
}

export interface GreenVehicleGuideComparisonAnalysis {
  ok: true;
  kind: "vehicle-comparison-csv";
  summary: GreenVehicleGuideComparisonSummary;
  privacy: EnergyDocumentPrivacyBoundary;
}

export type EnergyDocumentAnalysis =
  | EnergyQuoteAnalysis
  | ElectricityIntervalAnalysis
  | GreenVehicleGuideComparisonAnalysis
  | EnergyDocumentFailure;

const PRIVACY_BOUNDARY: EnergyDocumentPrivacyBoundary = Object.freeze({
  processing: "local-only",
  rawContentRetained: false,
  automaticRedaction: "bounded-patterns-only",
  freeTextMayContainPersonalInformation: true,
  automaticallyShared: false,
  leadSharing: "structured-summary-explicit-selection-required",
});

const TOPIC_PATTERNS: Array<[EnergyQuoteTopic, RegExp]> = [
  ["solar-pv", /\b(?:solar|photovoltaic|pv array|panels?|inverter|microinverter)\b/i],
  ["battery", /\b(?:battery|storage capacity|backup circuit|state of charge)\b/i],
  ["hot-water-heat-pump", /\b(?:heat pump hot water|hot water heat pump|hwhp|hpwh|heat-pump water heater)\b/i],
  ["heating-cooling", /\b(?:reverse cycle|air conditioner|air conditioning|split system|ducted|rcac|heating|cooling)\b/i],
  ["insulation", /\b(?:insulation|insulat(?:e|ing)|bulk batt|blow-in|r-value)\b/i],
  ["windows-glazing", /\b(?:double glaz|secondary glaz|window|glazing|low-e|u-value|shgc)\b/i],
  ["draught-ventilation", /\b(?:draught|draft seal|air seal|ventilation|exhaust fan|blower door|airtight)\b/i],
  ["ev-charging", /\b(?:ev charger|electric vehicle charger|wallbox|vehicle charging|type 2 charger)\b/i],
  ["general-electrical", /\b(?:switchboard|circuit breaker|rcd|electrical upgrade|three[- ]phase|single[- ]phase)\b/i],
];

const SCOPE_PATTERN = /\b(?:supply|install|installation|remove|removal|dispose|decommission|commission|configure|connect|cabling|wiring|switchboard|meter|roof|ceiling|wall|floor|duct|pipe|drain|condensate|permit|inspection|testing|make good|grid connection)\b/i;
const ITEM_PATTERN = /\b(?:model|make|product|panel|inverter|battery|heat pump|air conditioner|split system|insulation|batt|window|glazing|charger|switchboard|controller|optimiser|optimizer)\b/i;
const REBATE_PATTERN = /\b(?:rebate|discount|stcs?|vecs?|veecs?|escs?|certificate|solar homes|government incentive|government contribution)\b/i;
const WARRANTY_PATTERN = /\b(?:warranty|warranted|workmanship guarantee|performance guarantee)\b/i;
const EXCLUSION_PATTERN = /\b(?:exclud(?:e|ed|ing)|not included|by owner|owner to|additional cost|extra cost|subject to site inspection|variation|provisional sum|allowance only)\b/i;

class AnalysisFailure extends Error {
  readonly code: EnergyDocumentFailureCode;

  constructor(code: EnergyDocumentFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AnalysisFailure";
  }
}

function failure(code: EnergyDocumentFailureCode, message: string): EnergyDocumentFailure {
  return { ok: false, code, message };
}

function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function compactLine(value: string, max = 220): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function redactEnergyDocumentIdentifiers(value: string): string {
  return String(value || "")
    .replace(/\bNMI\s*(?:number|no\.?|id)?\s*[:#-]?\s*[A-Z0-9]{8,20}\b/gi, "NMI [redacted]")
    .replace(/\b(?:account|customer|meter)\s*(?:number|no\.?|id|reference)?\s*[:#-]?\s*[A-Z0-9][A-Z0-9-]{4,24}\b/gi, (match) => `${match.split(/\s|:|#/)[0]} [redacted]`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/(?<!\d)(?:\+?61\s?[2-478]|0[2-478])(?:[\s()-]*\d){8}(?!\d)/g, "[phone redacted]")
    .replace(/\b\d{1,5}\s+[A-Za-z][A-Za-z0-9 .'/-]{1,45}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Lane|Ln|Way|Place|Pl|Crescent|Cres)\b[^,\n]*/gi, "[address redacted]");
}

function safeLines(text: string): string[] {
  const redacted = redactEnergyDocumentIdentifiers(text)
    .replace(/\u0000/g, " ")
    .replace(/[\t\f\v]+/g, " ");
  return redacted
    .split(/\r?\n/)
    .map((line) => compactLine(line))
    .filter(Boolean);
}

function topicSpecificEvidence(topics: EnergyQuoteTopic[], text: string): string[] {
  const missing: string[] = [];
  const addUnless = (patterns: RegExp[], label: string) => {
    if (!patterns.every((pattern) => pattern.test(text))) missing.push(label);
  };
  if (topics.includes("solar-pv")) {
    addUnless([/\bpanels?\b/i, /\binverter\b/i, /\b(?:model|datasheet|product code)\b/i], "Panel and inverter identifiers, quantities and datasheets");
    addUnless(
      [/\b(?:layout|orientation|azimuth)\b/i, /\bshad/i, /\b(?:generation|yield|kwh per year|kwh\/year)\b/i],
      "Array layout, orientation, shading assessment and expected generation assumptions",
    );
    addUnless([/\b(?:network|distributor|connection)\b/i, /\bexport\b/i, /\b(?:meter|metering)\b/i], "Network connection, export-limit and metering scope");
  }
  if (topics.includes("battery")) {
    addUnless(
      [/\busable\b/i, /\bkwh\b/i, /\b(?:continuous|rated)\s+(?:power|output)\b/i, /\b(?:round-trip efficiency|rte)\b/i],
      "Usable storage, continuous and peak power, round-trip efficiency and operating limits",
    );
    addUnless([/\bbackup\b/i, /\b(?:changeover|gateway|islanding)\b/i, /\b(?:compatib|network control|export control)\b/i], "Backup circuits, changeover behaviour, compatibility and network-control scope");
    addUnless([/\bwarranty\b/i, /\b(?:throughput|cycles?)\b/i, /\b(?:retained capacity|state of health)\b/i], "Battery warranty term, throughput or cycle limits and retained-capacity conditions");
  }
  if (topics.includes("hot-water-heat-pump")) {
    addUnless(
      [/\b(?:litres?|liters?|\d+\s*l)\b/i, /\brecovery\b/i, /\b(?:cop|efficiency)\b/i, /\b(?:ambient|outdoor)\b/i],
      "Storage volume, recovery performance and efficiency at stated ambient and water temperatures",
    );
    addUnless([/\b(?:operating range|minimum ambient|cold weather)\b/i, /\b(?:noise|db\(?a?\)?)\b/i, /\b(?:condensate|drain)\b/i, /\b(?:circuit|electrical)\b/i], "Cold-weather operating range, noise, condensate, drainage and electrical-circuit scope");
  }
  if (topics.includes("heating-cooling")) {
    addUnless([/\b(?:room-by-room|room by room|heat load|design load)\b/i, /\bheating capacity\b/i, /\bcooling capacity\b/i], "Room-by-room design load and selected heating and cooling capacities");
    addUnless([/\b(?:zoned energy|zerl|energy label)\b/i, /\b(?:climate|design temperature|outdoor temperature)\b/i], "Zoned energy label or equivalent performance at the relevant climate conditions");
    addUnless([/\b(?:noise|db\(?a?\)?)\b/i, /\b(?:pipe|drain)\b/i, /\bcontrols?\b/i, /\b(?:circuit|electrical)\b/i], "Indoor and outdoor noise data, pipe and drain runs, controls and electrical scope");
  }
  if (topics.includes("insulation")) {
    addUnless([/\br[- ]?value\b|\br\s*\d/i, /\b(?:area|m2|m²|coverage)\b/i], "Product R-value, proposed total R-value, area and coverage method");
    addUnless([/\bgaps?\b/i, /\bmoisture\b/i, /\b(?:clearance|downlight|electrical)\b/i, /\b(?:access|remove|removal)\b/i], "Gap treatment, moisture checks, electrical clearances, access and removal scope");
  }
  if (topics.includes("windows-glazing")) {
    addUnless([/\bu[- ]?value\b/i, /\bshgc\b/i, /\bframe\b/i, /\bglass|glazing\b/i], "Whole-window U-value and SHGC for the exact frame and glass system");
    addUnless([/\b(?:opening|fixed|awning|sliding|casement)\b/i, /\b(?:seal|flashing)\b/i, /\b(?:make good|making-good|dispose|disposal)\b/i], "Opening type, air and water sealing, flashing, making-good and disposal scope");
  }
  if (topics.includes("draught-ventilation")) {
    addUnless([/\b(?:location|door|window|gap|penetration)\b/i, /\b(?:combustion|moisture)\b/i, /\bventilation\b/i], "Locations to seal and the method for preserving required combustion and moisture ventilation");
    addUnless([/\b(?:mechanical ventilation|exhaust)\b/i, /\b(?:flow|l\/s|air changes|ach)\b/i], "Existing and proposed mechanical ventilation or exhaust performance");
  }
  if (topics.includes("ev-charging")) {
    addUnless([/\bkw\b/i, /\b(?:amps?|current)\b/i, /\bphase\b/i, /\bcable\b/i, /\b(?:switchboard|rcd|protection)\b/i], "Charger power and current, supply phase, cable run and switchboard protection");
    addUnless([/\bload management\b/i, /\bsolar\b/i, /\bnetwork\b/i, /\bcommission/i], "Load management, solar integration, network requirements and commissioning scope");
  }
  return missing;
}

function classifyAmount(line: string): QuoteAmount["label"] {
  const lastMatch = (pattern: RegExp): number => {
    let index = -1;
    for (const match of line.matchAll(pattern)) index = match.index || 0;
    return index;
  };
  const candidates: Array<{ label: QuoteAmount["label"]; index: number }> = [
    { label: "total", index: lastMatch(/\b(?:grand total|total)\b/gi) },
    { label: "subtotal", index: lastMatch(/\bsubtotal\b/gi) },
    { label: "deposit", index: lastMatch(/\bdeposit\b/gi) },
    { label: "balance", index: lastMatch(/\bbalance\b/gi) },
    { label: "discount-or-rebate", index: lastMatch(/\b(?:rebate|discount|stcs?|vecs?|veecs?|escs?|certificate)\b/gi) },
  ];
  return candidates.sort((a, b) => b.index - a.index)[0]?.index >= 0 ? candidates[0].label : "other";
}

function extractMetrics(lines: string[]): QuoteMetric[] {
  const results: QuoteMetric[] = [];
  const add = (metric: string, value: string, unit: string, context: string) => {
    const key = `${metric}|${value}|${unit}|${context}`.toLowerCase();
    if (!results.some((entry) => `${entry.metric}|${entry.value}|${entry.unit}|${entry.context}`.toLowerCase() === key)) {
      results.push({ metric, value, unit, context });
    }
  };
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const match of line.matchAll(/\b(\d+(?:\.\d+)?)\s*(kwh|kw|wh|w|litres?|liters?|l|db\s*\(?a\)?|stars?)\b/gi)) {
      const unit = match[2].replace(/\s+/g, " ");
      const metric = /kwh|wh/i.test(unit)
        ? "energy-or-storage"
        : /^kw$|^w$/i.test(unit)
          ? "power-or-capacity"
          : /^l|lit/i.test(unit)
            ? "storage-volume"
            : /^db/i.test(unit)
              ? "sound-level"
              : "rating";
      add(metric, match[1], unit, compactLine(line));
    }
    for (const match of line.matchAll(/\b(COP|EER|SEER|SCOP|R[- ]?value|U[- ]?value|SHGC)\s*[:=]?\s*(\d+(?:\.\d+)?)\b/gi)) {
      add(match[1].toLowerCase().replace(/\s+/g, "-"), match[2], "ratio", compactLine(line));
    }
    if (/\bR\s*\d+(?:\.\d+)?\b/i.test(line) && /insulat/i.test(lower)) {
      const value = line.match(/\bR\s*(\d+(?:\.\d+)?)\b/i)?.[1];
      if (value) add("r-value", value, "m2.K/W", compactLine(line));
    }
  }
  return results.slice(0, 24);
}

function extractAmounts(lines: string[]): QuoteAmount[] {
  const amounts: QuoteAmount[] = [];
  for (const line of lines) {
    const matches = [...line.matchAll(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)];
    for (const match of matches) {
      const amount = `$${match[1]}`;
      const matchIndex = match.index || 0;
      const classificationContext = line.slice(Math.max(0, matchIndex - 55), matchIndex + match[0].length);
      const candidate: QuoteAmount = { label: classifyAmount(classificationContext), amount, context: compactLine(line) };
      if (!amounts.some((entry) => entry.amount === candidate.amount && entry.context === candidate.context)) amounts.push(candidate);
    }
  }
  return amounts.slice(0, 16);
}

export function analyseEnergyQuoteText(text: string, pageCount = 1): EnergyQuoteSummary {
  const lines = safeLines(text);
  const joined = lines.join("\n");
  const topics = TOPIC_PATTERNS.filter(([, pattern]) => pattern.test(joined)).map(([topic]) => topic);
  if (!topics.length) topics.push("unclassified-energy-work");

  const scope = unique(lines.filter((line) => SCOPE_PATTERN.test(line))).slice(0, 18);
  const quotedItems = unique(lines.filter((line) => ITEM_PATTERN.test(line))).slice(0, 18);
  const metrics = extractMetrics(lines);
  const amounts = extractAmounts(lines);
  const rebateOrCertificateClaims = unique(lines.filter((line) => REBATE_PATTERN.test(line))).slice(0, 12);
  const warranties = unique(lines.filter((line) => WARRANTY_PATTERN.test(line))).slice(0, 12);
  const exclusions = unique(lines.filter((line) => EXCLUSION_PATTERN.test(line))).slice(0, 12);

  const missingEvidence: string[] = [];
  if (!/\b(?:valid until|valid for|validity|expiry|expires?|quote date|dated)\b/i.test(joined)) missingEvidence.push("Quote validity date");
  if (!/\b(?:model|product code|datasheet|data sheet)\b/i.test(joined)) missingEvidence.push("Exact products, quantities, datasheets and applicable registrations or approvals");
  if (!/\b(?:site inspection|site assessment|site measure|design load|heat load|shading assessment)\b/i.test(joined)) missingEvidence.push("Site inspection assumptions and the boundary between included work and possible variations");
  if (!/\b(?:licen[cs]e|accredit(?:ed|ation)|registration number|saa accreditation)\b/i.test(joined)) missingEvidence.push("Installer and contractor licence details relevant to the work");
  if (!amounts.some((entry) => entry.label === "total")) missingEvidence.push("A clear itemised total including GST");
  if (warranties.length) missingEvidence.push("Separate product, performance and workmanship warranty conditions where they differ");
  else missingEvidence.push("Product, performance and workmanship warranty terms and exclusions");
  if (!exclusions.length) missingEvidence.push("Explicit exclusions, owner responsibilities, making-good and disposal scope");
  if (rebateOrCertificateClaims.length) {
    missingEvidence.push("Scheme name, eligibility date, certificate quantity, assigned certificate value and who carries eligibility risk");
  }
  missingEvidence.push(...topicSpecificEvidence(topics, joined));

  const questions = unique([
    "What site inspection and measured design inputs support the proposed scope and sizes?",
    amounts.some((entry) => entry.label === "total")
      ? "Does the stated total include GST, permits, electrical work, commissioning, disposal and every listed option?"
      : "What is the itemised total including GST, and which costs may still vary?",
    "Which exact product and workmanship warranty documents apply, and who handles a claim?",
    exclusions.length ? "Could any listed exclusion or provisional allowance materially change the final price?" : "What is excluded or payable as a variation?",
    ...(rebateOrCertificateClaims.length
      ? ["Which scheme and eligibility rules support each rebate or certificate claim, and what happens if the final entitlement differs?"]
      : []),
    ...topics.includes("solar-pv") ? ["What generation model, shading inputs, export limit and self-consumption assumptions support the savings claim?"] : [],
    ...topics.includes("battery") ? ["Is quoted capacity usable or nominal, and what power, backup and warranty limits apply?"] : [],
    ...topics.includes("hot-water-heat-pump") ? ["What recovery time and efficiency are expected at this site's coldest relevant ambient conditions?"] : [],
    ...topics.includes("heating-cooling") ? ["What room heat-load calculation supports the selected capacity at local summer and winter design conditions?"] : [],
    ...topics.includes("insulation") ? ["How will the installer verify complete coverage, safe clearances and the achieved total R-value?"] : [],
    ...topics.includes("windows-glazing") ? ["Are the U-value and SHGC whole-window ratings for the exact installed frame and glass configuration?"] : [],
    ...topics.includes("ev-charging") ? ["Has available supply capacity, simultaneous household load and dynamic load management been assessed?"] : [],
  ]).slice(0, 16);

  return {
    documentKind: "energy-quote",
    pageCount,
    topics,
    scope,
    quotedItems,
    metrics,
    amounts,
    rebateOrCertificateClaims,
    warranties,
    exclusions,
    missingEvidence: unique(missingEvidence).slice(0, 24),
    questions,
    reviewBoundary: "Facts are extracted from the supplied quote only. Verify performance, scope, warranty, eligibility and site fit independently before deciding.",
  };
}

function bytesContainEncryptionMarker(bytes: Uint8Array): boolean {
  const decoder = new TextDecoder("latin1");
  const head = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  const tail = decoder.decode(bytes.subarray(Math.max(0, bytes.length - 128 * 1024)));
  return /\/Encrypt\b/.test(`${head}\n${tail}`);
}

async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  if (bytesContainEncryptionMarker(bytes)) {
    throw new AnalysisFailure("PDF_ENCRYPTED", "Password-protected or encrypted PDFs are not supported. Export an unlocked text PDF and try again.");
  }
  let loadingTask: PDFDocumentLoadingTask | null = null;
  let document: PDFDocumentProxy | null = null;
  let pdfWorker: PDFWorker | null = null;
  let nativeWorker: Worker | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (typeof window !== "undefined" && typeof Worker !== "undefined") {
      const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs?worker");
      nativeWorker = new workerModule.default();
      pdfWorker = pdfjs.PDFWorker.create({ port: nativeWorker });
      await pdfWorker.promise;
    } else {
      const nodeWorkerModule = "pdfjs-dist/legacy/build/pdf.worker.mjs";
      await import(/* @vite-ignore */ nodeWorkerModule);
    }
    loadingTask = pdfjs.getDocument({
      data: bytes,
      ...(pdfWorker ? { worker: pdfWorker } : {}),
      useWorkerFetch: false,
      useWasm: false,
      disableFontFace: true,
      useSystemFonts: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      disableStream: true,
      disableAutoFetch: true,
      stopAtErrors: true,
      verbosity: 0,
    });
    document = await loadingTask.promise;
    if (document.numPages > ENERGY_DOCUMENT_LIMITS.maxPdfPages) {
      throw new AnalysisFailure("PDF_PAGE_LIMIT", `PDFs are limited to ${ENERGY_DOCUMENT_LIMITS.maxPdfPages} pages for local analysis.`);
    }
    const pages: string[] = [];
    let characterCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      const pageText = content.items.map((item) => {
        if (!item || typeof item !== "object" || !("str" in item)) return "";
        const textItem = item as { str?: unknown; hasEOL?: unknown };
        return `${typeof textItem.str === "string" ? textItem.str : ""}${textItem.hasEOL ? "\n" : " "}`;
      }).join("");
      characterCount += pageText.length;
      if (characterCount > ENERGY_DOCUMENT_LIMITS.maxPdfTextCharacters) {
        throw new AnalysisFailure("PDF_TEXT_LIMIT", `Extracted PDF text is limited to ${ENERGY_DOCUMENT_LIMITS.maxPdfTextCharacters.toLocaleString()} characters.`);
      }
      pages.push(pageText);
    }
    const text = pages.join("\n").replace(/[ \t]+\n/g, "\n");
    const letters = text.match(/[A-Za-z]/g)?.length || 0;
    if (text.trim().length < 40 || letters < 20) {
      throw new AnalysisFailure("PDF_IMAGE_ONLY", "No usable text was found. Scanned or image-only PDFs need OCR before this local analyser can read them.");
    }
    return { text, pageCount: document.numPages };
  } catch (error) {
    if (error instanceof AnalysisFailure) throw error;
    const named = error as { name?: unknown; message?: unknown; code?: unknown };
    const name = typeof named?.name === "string" ? named.name : "";
    const message = typeof named?.message === "string" ? named.message : "";
    if (name === "PasswordException" || /password|encrypted/i.test(message)) {
      throw new AnalysisFailure("PDF_ENCRYPTED", "Password-protected or encrypted PDFs are not supported. Export an unlocked text PDF and try again.");
    }
    throw new AnalysisFailure("PDF_MALFORMED", "The PDF is malformed or uses unsupported features and could not be read locally.");
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
    pdfWorker?.destroy();
    nativeWorker?.terminate();
  }
}

function isGreenVehicleGuidePdfText(text: string, fileName = ""): boolean {
  const compact = String(text || "").replace(/\s+/g, " ");
  const sourceMatch = /\bGreen Vehicle Guide\b|greenvehicleguide\.gov\.au/i.test(compact)
    || /(?:^|[^a-z])GVG(?:[^a-z]|$)|green[ _-]?vehicle[ _-]?guide/i.test(String(fileName || ""));
  const fieldMatches = [
    /\bAnnual fuel cost\b/i,
    /\bEnergy consumption\b/i,
    /\bElectric range\b/i,
    /\bTest Cycle\b/i,
    /\bIs Current Model\b/i,
  ].filter((pattern) => pattern.test(compact)).length;
  return sourceMatch && fieldMatches >= 3;
}

interface CsvParseSuccess {
  ok: true;
  rows: string[][];
}

function parseCsv(text: string): CsvParseSuccess | EnergyDocumentFailure {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === "\"") {
      if (field) return failure("CSV_MALFORMED", "The CSV contains an unexpected quote character.");
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      if (row.length > ENERGY_DOCUMENT_LIMITS.maxCsvColumns) {
        return failure("CSV_MALFORMED", `CSV files are limited to ${ENERGY_DOCUMENT_LIMITS.maxCsvColumns} columns.`);
      }
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.length > ENERGY_DOCUMENT_LIMITS.maxCsvColumns) {
        return failure("CSV_MALFORMED", `CSV files are limited to ${ENERGY_DOCUMENT_LIMITS.maxCsvColumns} columns.`);
      }
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      if (rows.length > ENERGY_DOCUMENT_LIMITS.maxCsvRows + 1) {
        return failure("CSV_ROW_LIMIT", `CSV files are limited to ${ENERGY_DOCUMENT_LIMITS.maxCsvRows.toLocaleString()} data rows.`);
      }
    } else {
      field += char;
    }
  }
  if (quoted) return failure("CSV_MALFORMED", "The CSV contains an unterminated quoted field.");
  row.push(field);
  if (row.length > ENERGY_DOCUMENT_LIMITS.maxCsvColumns) {
    return failure("CSV_MALFORMED", `CSV files are limited to ${ENERGY_DOCUMENT_LIMITS.maxCsvColumns} columns.`);
  }
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length > ENERGY_DOCUMENT_LIMITS.maxCsvRows + 1) {
    return failure("CSV_ROW_LIMIT", `CSV files are limited to ${ENERGY_DOCUMENT_LIMITS.maxCsvRows.toLocaleString()} data rows.`);
  }
  return { ok: true, rows };
}

interface ParsedTimestamp {
  stamp: number;
  dayStamp: number;
  date: string;
  minuteOfDay: number;
  slashDate: boolean;
}

function validUtcParts(year: number, month: number, day: number, hour: number, minute: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute;
}

function parsedTimestamp(year: number, month: number, day: number, hour: number, minute: number, slashDate: boolean): ParsedTimestamp | null {
  if (!validUtcParts(year, month, day, hour, minute)) return null;
  const dayStamp = Date.UTC(year, month - 1, day);
  return {
    stamp: Date.UTC(year, month - 1, day, hour, minute),
    dayStamp,
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    minuteOfDay: hour * 60 + minute,
    slashDate,
  };
}

function parseTimestamp(value: string): ParsedTimestamp | null {
  const normalized = value.trim();
  let match = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (match) return parsedTimestamp(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), false);
  match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) return parsedTimestamp(Number(match[3]), Number(match[2]), Number(match[1]), Number(match[4]), Number(match[5]), true);
  return null;
}

function normalizedHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\bkilowatt[ -]?hours?\b/g, "kwh")
    .replace(/\bwatt[ -]?hours?\b/g, "wh")
    .replace(/\bmegawatt[ -]?hours?\b/g, "mwh")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const GVG_REQUIRED_HEADERS = Object.freeze([
  "ModelReleaseYear",
  "Make",
  "Model",
  "Variant",
  "EnergyConsumptionWhkm",
  "ElectricRangeKm",
  "IsCurrentModel",
  "Test Cycle",
  "AnnualFuelCost",
] as const);

type GvgHeader = typeof GVG_REQUIRED_HEADERS[number];

function gvgHeaderKey(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function gvgHeaderIndexes(headers: string[]): {
  candidate: boolean;
  complete: boolean;
  duplicates: string[];
  missing: string[];
  indexes: Record<GvgHeader, number>;
} {
  const keyed = headers.map(gvgHeaderKey);
  const expectedKeys = GVG_REQUIRED_HEADERS.map(gvgHeaderKey);
  const matchedCount = expectedKeys.filter((key) => keyed.includes(key)).length;
  const missing = GVG_REQUIRED_HEADERS.filter((header) => !keyed.includes(gvgHeaderKey(header)));
  const duplicates = GVG_REQUIRED_HEADERS.filter((header) => keyed.filter((key) => key === gvgHeaderKey(header)).length > 1);
  return {
    candidate: matchedCount >= 5,
    complete: missing.length === 0 && duplicates.length === 0,
    duplicates,
    missing,
    indexes: Object.fromEntries(GVG_REQUIRED_HEADERS.map((header) => [header, keyed.indexOf(gvgHeaderKey(header))])) as Record<GvgHeader, number>,
  };
}

function compactVehicleField(value: string, maxLength: number): string | null {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (!compact || compact.length > maxLength || /[\u0000-\u001f\u007f]/.test(compact)) return null;
  return compact;
}

function strictDecimal(value: string, minimum: number, maximum: number): number | null {
  const compact = String(value || "").trim().replace(/,/g, "");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(compact)) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function annualFuelCost(value: string): number | null | "invalid" {
  const compact = String(value || "").trim();
  if (!compact) return null;
  const parsed = strictDecimal(compact.replace(/^\$\s*/, ""), 0, 1_000_000);
  return parsed === null ? "invalid" : parsed;
}

function vehicleIdentity(vehicle: GreenVehicleGuideVehicle): string {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.variant}`;
}

function sameVehicleFacts(left: GreenVehicleGuideVehicle, right: GreenVehicleGuideVehicle): boolean {
  return left.energyConsumptionWhPerKm === right.energyConsumptionWhPerKm
    && left.electricRangeKm === right.electricRangeKm
    && left.currentModelInFile === right.currentModelInFile
    && left.testCycle.toLowerCase() === right.testCycle.toLowerCase()
    && left.annualFuelCostAud === right.annualFuelCostAud;
}

function analyseGreenVehicleGuideRows(parsed: CsvParseSuccess): GreenVehicleGuideComparisonAnalysis | EnergyDocumentFailure {
  if (parsed.rows.length < 2) return failure("CSV_NO_VALID_ROWS", "The Green Vehicle Guide CSV does not contain any vehicle rows.");
  if (parsed.rows.length - 1 > ENERGY_DOCUMENT_LIMITS.maxVehicleComparisonRows) {
    return failure(
      "CSV_ROW_LIMIT",
      `Green Vehicle Guide comparisons are limited to ${ENERGY_DOCUMENT_LIMITS.maxVehicleComparisonRows} vehicle rows. Export a narrower comparison from GVG and try again.`,
    );
  }
  const headerState = gvgHeaderIndexes(parsed.rows[0]);
  if (!headerState.complete) {
    const problems = [
      headerState.missing.length ? `missing: ${headerState.missing.join(", ")}` : "",
      headerState.duplicates.length ? `duplicated: ${headerState.duplicates.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    return failure("CSV_UNSUPPORTED_SCHEMA", `The Green Vehicle Guide CSV headers are incomplete or ambiguous (${problems}). Download a fresh CSV export from GVG.`);
  }

  const vehicles: GreenVehicleGuideVehicle[] = [];
  const ambiguities: string[] = [];
  let excludedRowCount = 0;
  parsed.rows.slice(1).forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const yearText = String(row[headerState.indexes.ModelReleaseYear] || "").trim();
    const year = /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
    const make = compactVehicleField(row[headerState.indexes.Make], 80);
    const model = compactVehicleField(row[headerState.indexes.Model], 120);
    const variant = compactVehicleField(row[headerState.indexes.Variant], 160);
    const energy = strictDecimal(row[headerState.indexes.EnergyConsumptionWhkm], 1, 5_000);
    const range = strictDecimal(row[headerState.indexes.ElectricRangeKm], 1, 5_000);
    const currentText = String(row[headerState.indexes.IsCurrentModel] || "").trim();
    const currentModelInFile = /^yes$/i.test(currentText) ? true : /^no$/i.test(currentText) ? false : null;
    const testCycle = compactVehicleField(row[headerState.indexes["Test Cycle"]], 100);
    const cost = annualFuelCost(row[headerState.indexes.AnnualFuelCost]);
    const invalidFields = [
      Number.isInteger(year) && year >= 1900 && year <= 2100 ? "" : "year",
      make ? "" : "make",
      model ? "" : "model",
      variant ? "" : "variant",
      energy !== null ? "" : "Wh/km",
      range !== null ? "" : "electric range",
      currentModelInFile !== null ? "" : "current-model flag",
      testCycle && !/^n\/?a$/i.test(testCycle) ? "" : "test cycle",
      cost !== "invalid" ? "" : "annual fuel cost",
    ].filter(Boolean);
    if (invalidFields.length) {
      excludedRowCount += 1;
      ambiguities.push(`Row ${rowNumber} was excluded because ${invalidFields.join(", ")} could not be validated.`);
      return;
    }
    vehicles.push({
      year,
      make: make as string,
      model: model as string,
      variant: variant as string,
      energyConsumptionWhPerKm: energy as number,
      electricRangeKm: range as number,
      currentModelInFile: currentModelInFile as boolean,
      testCycle: testCycle as string,
      annualFuelCostAud: cost as number | null,
    });
  });

  const byIdentity = new Map<string, GreenVehicleGuideVehicle[]>();
  vehicles.forEach((vehicle) => {
    const key = vehicleIdentity(vehicle).toLowerCase();
    byIdentity.set(key, [...(byIdentity.get(key) || []), vehicle]);
  });
  const unambiguousVehicles: GreenVehicleGuideVehicle[] = [];
  byIdentity.forEach((matches) => {
    if (matches.length === 1) {
      unambiguousVehicles.push(matches[0]);
      return;
    }
    const label = vehicleIdentity(matches[0]);
    if (matches.every((candidate) => sameVehicleFacts(matches[0], candidate))) {
      unambiguousVehicles.push(matches[0]);
      excludedRowCount += matches.length - 1;
      ambiguities.push(`${matches.length - 1} duplicate row${matches.length === 2 ? "" : "s"} for ${label} were ignored.`);
      return;
    }
    excludedRowCount += matches.length;
    ambiguities.push(`${matches.length} conflicting rows for ${label} were excluded rather than choosing one.`);
  });
  if (!unambiguousVehicles.length) {
    return failure("CSV_NO_VALID_ROWS", "No Green Vehicle Guide rows had an unambiguous vehicle identity, Wh/km, electric range, current-model flag and test cycle.");
  }

  const testCycles = unique(unambiguousVehicles.map((vehicle) => vehicle.testCycle));
  const normalisedCycles = unique(testCycles.map((cycle) => cycle.toLowerCase()));
  const sameTestCycle = normalisedCycles.length === 1;
  if (!sameTestCycle) {
    ambiguities.unshift(`Mixed laboratory test cycles were found (${testCycles.join(", ")}). Wh/km and range are shown, but should not be ranked as directly comparable.`);
  }
  return {
    ok: true,
    kind: "vehicle-comparison-csv",
    privacy: PRIVACY_BOUNDARY,
    summary: {
      documentKind: "green-vehicle-guide-comparison",
      vehicles: unambiguousVehicles,
      vehicleCount: unambiguousVehicles.length,
      testCycles,
      sameTestCycle,
      excludedRowCount,
      ambiguities: unique(ambiguities).slice(0, 24),
      comparisonBoundary: "This is a local summary of the supplied Green Vehicle Guide CSV. Wh/km and electric range are controlled laboratory results, not guaranteed real-world efficiency or range. The current-model flag is only what the downloaded file states and is not checked online.",
      annualFuelCostBoundary: "Annual fuel cost is the estimate stored in the supplied CSV. The distance and price inputs behind that estimate are not included in these columns, so confirm them in GVG before relying on the amount.",
    },
  };
}

interface EnergyColumn {
  index: number;
  direction: "import" | "export";
  factor: number;
  header: string;
}

function unitFactor(header: string): number | null {
  if (/(?:^|_)kwh(?:_|$)/.test(header)) return 1;
  if (/(?:^|_)mwh(?:_|$)/.test(header)) return 1000;
  if (/(?:^|_)wh(?:_|$)/.test(header)) return 0.001;
  return null;
}

function energyColumn(header: string, index: number): EnergyColumn | null {
  const factor = unitFactor(header);
  if (factor === null) return null;
  if (/(?:^|_)(?:export|exported|grid_export|grid_exported|solar_export|solar_exported|feed_in)(?:_|$)/.test(header)) return { index, direction: "export", factor, header };
  if (/(?:^|_)(?:import|imported|grid_import|grid_imported|consumption|usage|general_usage|controlled_load)(?:_|$)/.test(header)) return { index, direction: "import", factor, header };
  return null;
}

function modeInterval(values: number[]): { minutes: number | null; consistency: number } {
  const counts = new Map<number, number>();
  values.forEach((value) => {
    if (value > 0 && value <= 24 * 60) counts.set(value, (counts.get(value) || 0) + 1);
  });
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (!ordered.length) return { minutes: null, consistency: 0 };
  const total = ordered.reduce((sum, [, count]) => sum + count, 0);
  return { minutes: ordered[0][0], consistency: ordered[0][1] / total };
}

interface ShapeRecord {
  minuteOfDay: number;
  value: number;
}

function loadShape(records: ShapeRecord[]): ClockWindowSummary {
  if (!records.length) {
    return {
      busiestAverageInterval: null,
      overnightSharePercent: null,
      daylightSharePercent: null,
      eveningSharePercent: null,
      tariffBoundary: "No proven import-energy series was available. Tariff peak and off-peak periods cannot be inferred from column names or clock time alone.",
    };
  }
  const bins = new Map<number, { total: number; count: number }>();
  let total = 0;
  let overnight = 0;
  let daylight = 0;
  let evening = 0;
  records.forEach((record) => {
    total += record.value;
    if (record.minuteOfDay < 6 * 60) overnight += record.value;
    if (record.minuteOfDay >= 9 * 60 && record.minuteOfDay < 15 * 60) daylight += record.value;
    if (record.minuteOfDay >= 16 * 60 && record.minuteOfDay < 21 * 60) evening += record.value;
    const bin = bins.get(record.minuteOfDay) || { total: 0, count: 0 };
    bin.total += record.value;
    bin.count += 1;
    bins.set(record.minuteOfDay, bin);
  });
  const busiest = [...bins.entries()].sort((a, b) => (b[1].total / b[1].count) - (a[1].total / a[1].count))[0]?.[0];
  const formatMinute = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return {
    busiestAverageInterval: typeof busiest === "number" ? formatMinute(busiest) : null,
    overnightSharePercent: total > 0 ? round(overnight / total * 100, 1) : 0,
    daylightSharePercent: total > 0 ? round(daylight / total * 100, 1) : 0,
    eveningSharePercent: total > 0 ? round(evening / total * 100, 1) : 0,
    tariffBoundary: "These are descriptive clock windows only: overnight 00:00-06:00, daylight 09:00-15:00 and evening 16:00-21:00. They are not retailer peak, shoulder or off-peak periods.",
  };
}

function intervalObservations(shape: ClockWindowSummary, importTotal?: number, exportTotal?: number): string[] {
  const observations: string[] = [];
  if (typeof importTotal === "number") observations.push(`Valid recorded grid-import intervals sum to ${round(importTotal)} kWh.`);
  if (typeof exportTotal === "number") observations.push(`Valid recorded grid-export intervals sum to ${round(exportTotal)} kWh.`);
  if (shape.busiestAverageInterval) observations.push(`The highest average import interval starts at ${shape.busiestAverageInterval} in the file's local clock labels.`);
  if (shape.daylightSharePercent !== null) observations.push(`${shape.daylightSharePercent}% of proven import energy falls in the 09:00-15:00 daylight window.`);
  if (shape.eveningSharePercent !== null) observations.push(`${shape.eveningSharePercent}% of proven import energy falls in the 16:00-21:00 evening window.`);
  if (shape.overnightSharePercent !== null) observations.push(`${shape.overnightSharePercent}% of proven import energy falls in the 00:00-06:00 overnight window.`);
  return observations;
}

function yyyymmdd(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
}

function analyseNem12(text: string): ElectricityIntervalAnalysis | EnergyDocumentFailure {
  const result = parseNem12(text);
  if (!result.ok) return failure("CSV_MALFORMED", result.err);
  const importRecords: ShapeRecord[] = [];
  result.series.forEach((day) => day.import.forEach((value, bin) => importRecords.push({ minuteOfDay: bin * 30, value })));
  const shape = loadShape(importRecords);
  const exportProven = result.bChannels.size > 0;
  const rowCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
  const ambiguities = [...result.warnings];
  if (result.registers.length > 1) ambiguities.push("Multiple consumption registers are present. Confirm general usage and controlled-load roles before applying a tariff.");
  if (result.intervalLengths.length > 1) ambiguities.push("The file contains mixed interval lengths; the profile was normalised to half-hour bins for this summary.");
  const questions = [
    "Which retailer plan and exact peak, shoulder, off-peak and demand windows should be tested against these intervals?",
    "Were any heating, cooling, hot-water, pool, EV or occupancy changes made during the covered period?",
    exportProven
      ? "What solar size, inverter limit and battery operating mode produced the recorded exports?"
      : "Does the property have solar or a battery, and does the file include a separate export channel?",
    "Are any consumption registers controlled load, and what equipment and tariff use them?",
  ];
  return {
    ok: true,
    kind: "interval-csv",
    privacy: PRIVACY_BOUNDARY,
    summary: {
      documentKind: "electricity-interval-data",
      format: "NEM12",
      period: {
        startDate: yyyymmdd(result.startDate),
        endDate: yyyymmdd(result.endDate),
        observedDays: result.spanDays,
        coveragePercent: round(result.coverageRatio * 100, 1),
      },
      rowCount,
      intervalMinutes: result.intervalLengths.length === 1 ? result.intervalLengths[0] : null,
      granularity: result.intervalLengths.length === 1 ? `${result.intervalLengths[0]} minutes` : `mixed: ${result.intervalLengths.join(", ")} minutes`,
      semantics: {
        import: "proven-kwh",
        export: exportProven ? "proven-kwh" : "not-provided",
        basis: "NEM12 active-energy E consumption and B export channel conventions with declared Wh, kWh or MWh units.",
      },
      totals: {
        importKwh: round(result.importKwh),
        ...(exportProven ? { exportKwh: round(result.exportKwh) } : {}),
        averageDailyImportKwh: round(result.importKwh / result.spanDays),
      },
      loadShape: shape,
      quality: { actualPercent: round(result.actualPct * 100, 1) },
      observations: intervalObservations(shape, result.importKwh, exportProven ? result.exportKwh : undefined),
      ambiguities: unique(ambiguities),
      questions,
    },
  };
}

function findTimestampColumns(headers: string[]): { timestamp: number | null; date: number | null; time: number | null } {
  const timestamp = headers.findIndex((header) => /^(?:timestamp|date_time|datetime|interval_start|interval_datetime|read_datetime|reading_datetime)$/.test(header));
  const date = headers.findIndex((header) => /^(?:date|read_date|reading_date|interval_date)$/.test(header));
  const time = headers.findIndex((header) => /^(?:time|read_time|reading_time|interval_time)$/.test(header));
  return { timestamp: timestamp >= 0 ? timestamp : null, date: date >= 0 ? date : null, time: time >= 0 ? time : null };
}

function analyseHeaderCsvRows(parsed: CsvParseSuccess): ElectricityIntervalAnalysis | EnergyDocumentFailure {
  if (parsed.rows.length < 2) return failure("CSV_NO_VALID_ROWS", "The CSV does not contain a header and interval-data rows.");
  const headers = parsed.rows[0].map(normalizedHeader);
  const timestampColumns = findTimestampColumns(headers);
  if (timestampColumns.timestamp === null && (timestampColumns.date === null || timestampColumns.time === null)) {
    return failure("CSV_UNSUPPORTED_SCHEMA", "No supported timestamp column was found. Use an ISO date-time column or separate date and time columns.");
  }
  const energyColumns = headers.map(energyColumn).filter((column): column is EnergyColumn => Boolean(column));
  const importColumns = energyColumns.filter((column) => column.direction === "import");
  const exportColumns = energyColumns.filter((column) => column.direction === "export");
  const ambiguousEnergyHeaders = headers.filter((header) => /(?:import|export|consumption|usage|feed_in|energy)/.test(header) && unitFactor(header) === null);
  const initialImportSemantics: IntervalSemantics["import"] = importColumns.length === 1 ? "proven-kwh" : importColumns.length > 1 ? "ambiguous" : "not-provided";
  const initialExportSemantics: IntervalSemantics["export"] = exportColumns.length === 1 ? "proven-kwh" : exportColumns.length > 1 ? "ambiguous" : "not-provided";

  const records: Array<{ timestamp: ParsedTimestamp; importKwh?: number; exportKwh?: number }> = [];
  let invalidRows = 0;
  let invalidEnergyValues = 0;
  let negativeValues = 0;
  let slashDates = false;
  for (const row of parsed.rows.slice(1)) {
    const timestampValue = timestampColumns.timestamp !== null
      ? row[timestampColumns.timestamp]
      : `${row[timestampColumns.date as number] || ""} ${row[timestampColumns.time as number] || ""}`;
    const timestamp = parseTimestamp(timestampValue || "");
    if (!timestamp) {
      invalidRows += 1;
      continue;
    }
    slashDates ||= timestamp.slashDate;
    const readColumn = (column: EnergyColumn | undefined): number | undefined => {
      if (!column) return undefined;
      const rawValue = String(row[column.index] || "").trim().replace(/,/g, "");
      const value = Number(rawValue);
      if (!rawValue || !Number.isFinite(value)) {
        invalidEnergyValues += 1;
        return undefined;
      }
      if (value < 0) {
        negativeValues += 1;
        return undefined;
      }
      return value * column.factor;
    };
    records.push({
      timestamp,
      ...(initialImportSemantics === "proven-kwh" ? { importKwh: readColumn(importColumns[0]) } : {}),
      ...(initialExportSemantics === "proven-kwh" ? { exportKwh: readColumn(exportColumns[0]) } : {}),
    });
  }
  if (!records.length) return failure("CSV_NO_VALID_ROWS", "No rows contained a supported date-time value.");
  records.sort((a, b) => a.timestamp.stamp - b.timestamp.stamp);
  const duplicateTimestamps = records.reduce((count, record, index) => count + (index > 0 && record.timestamp.stamp === records[index - 1].timestamp.stamp ? 1 : 0), 0);
  const importSemantics: IntervalSemantics["import"] = duplicateTimestamps && initialImportSemantics === "proven-kwh" ? "ambiguous" : initialImportSemantics;
  const exportSemantics: IntervalSemantics["export"] = duplicateTimestamps && initialExportSemantics === "proven-kwh" ? "ambiguous" : initialExportSemantics;
  const differences = records.slice(1).map((record, index) => Math.round((record.timestamp.stamp - records[index].timestamp.stamp) / 60_000));
  const interval = modeInterval(differences);
  const observedDays = new Set(records.map((record) => record.timestamp.date)).size;
  const first = records[0].timestamp;
  const last = records[records.length - 1].timestamp;
  const expectedRows = interval.minutes && last.stamp > first.stamp ? Math.round((last.stamp - first.stamp) / (interval.minutes * 60_000)) + 1 : records.length;
  const uniqueTimestampCount = records.length - duplicateTimestamps;
  const importValues = records.filter((record): record is typeof record & { importKwh: number } => typeof record.importKwh === "number");
  const exportValues = records.filter((record): record is typeof record & { exportKwh: number } => typeof record.exportKwh === "number");
  const importTotal = importSemantics === "proven-kwh" ? importValues.reduce((sum, record) => sum + record.importKwh, 0) : undefined;
  const exportTotal = exportSemantics === "proven-kwh" ? exportValues.reduce((sum, record) => sum + record.exportKwh, 0) : undefined;
  const shape = loadShape(importSemantics === "proven-kwh" ? importValues.map((record) => ({ minuteOfDay: record.timestamp.minuteOfDay, value: record.importKwh })) : []);
  const ambiguities: string[] = [];
  if (ambiguousEnergyHeaders.length) ambiguities.push("One or more energy-like columns do not declare Wh, kWh or MWh, so their totals were not interpreted.");
  if (importColumns.length > 1) ambiguities.push("Multiple import-energy columns were found. They were not summed because they may overlap or represent separate registers.");
  if (exportColumns.length > 1) ambiguities.push("Multiple export-energy columns were found. They were not summed because they may overlap or represent separate registers.");
  if (duplicateTimestamps) ambiguities.push(`${duplicateTimestamps} duplicate timestamp rows were found. Totals may represent overlapping channels and should be checked.`);
  if (negativeValues) ambiguities.push(`${negativeValues} negative energy values were excluded because their sign convention was not declared.`);
  if (invalidEnergyValues) ambiguities.push(`${invalidEnergyValues} blank or non-numeric energy values were excluded from totals.`);
  if (invalidRows) ambiguities.push(`${invalidRows} rows had unsupported or invalid date-time values and were excluded.`);
  if (interval.consistency < 0.95) ambiguities.push("Interval spacing is mixed or incomplete; the reported granularity is only the most common spacing.");
  if (slashDates) ambiguities.push("Slash dates were interpreted as Australian DD/MM/YYYY. Confirm that convention before using dated tariff windows.");
  if (!energyColumns.length) ambiguities.push("No column declared both an import or export meaning and an energy unit. No energy totals were calculated.");

  const questions = [
    "Which retailer plan and exact peak, shoulder, off-peak and demand windows should be tested against these timestamps?",
    "Do the timestamps mark the start or end of each interval, and are they local standard time or clock time?",
    "Does the file contain separate general usage, controlled-load, solar export or battery channels?",
    "Were any major appliance, occupancy, tariff, solar or battery changes made during the covered period?",
    importSemantics !== "proven-kwh" ? "Which single column is grid import energy, and what unit does it use?" : "Which appliances explain the highest average import time?",
    exportSemantics !== "proven-kwh" ? "Is grid export available in another explicitly labelled kWh column or file?" : "What solar and battery settings produced the recorded export pattern?",
  ];
  const validRowsPercent = round(records.length / Math.max(1, parsed.rows.length - 1) * 100, 1);
  return {
    ok: true,
    kind: "interval-csv",
    privacy: PRIVACY_BOUNDARY,
    summary: {
      documentKind: "electricity-interval-data",
      format: "header-csv",
      period: {
        startDate: first.date,
        endDate: last.date,
        observedDays,
        coveragePercent: round(Math.min(1, uniqueTimestampCount / Math.max(1, expectedRows)) * 100, 1),
      },
      rowCount: records.length,
      intervalMinutes: interval.minutes,
      granularity: interval.minutes ? `${interval.minutes} minutes${interval.consistency < 0.95 ? " (most common)" : ""}` : "not established",
      semantics: {
        import: importSemantics,
        export: exportSemantics,
        basis: importSemantics === "proven-kwh" || exportSemantics === "proven-kwh"
          ? "Only a single direction-specific column with an explicit Wh, kWh or MWh unit was converted to kWh."
          : "Column direction or energy units were not uniquely established, so no totals were inferred.",
      },
      totals: {
        ...(typeof importTotal === "number" ? { importKwh: round(importTotal), averageDailyImportKwh: round(importTotal / observedDays) } : {}),
        ...(typeof exportTotal === "number" ? { exportKwh: round(exportTotal) } : {}),
      },
      loadShape: shape,
      quality: { validRowsPercent },
      observations: intervalObservations(shape, importTotal, exportTotal),
      ambiguities,
      questions,
    },
  };
}

function analyseHeaderCsv(text: string): ElectricityIntervalAnalysis | EnergyDocumentFailure {
  const parsed = parseCsv(text);
  return parsed.ok ? analyseHeaderCsvRows(parsed) : parsed;
}

export function analyseElectricityIntervalCsv(text: string): ElectricityIntervalAnalysis | EnergyDocumentFailure {
  const normalized = String(text || "").replace(/^\uFEFF/, "");
  const rowEstimate = (normalized.match(/\n/g)?.length || 0) + 1;
  if (rowEstimate > ENERGY_DOCUMENT_LIMITS.maxCsvRows + 1) {
    return failure("CSV_ROW_LIMIT", `CSV files are limited to ${ENERGY_DOCUMENT_LIMITS.maxCsvRows.toLocaleString()} data rows.`);
  }
  if (/^100\s*,\s*NEM12\b/im.test(normalized)) return analyseNem12(normalized);
  return analyseHeaderCsv(normalized);
}

export function analyseEnergyCsv(text: string): GreenVehicleGuideComparisonAnalysis | ElectricityIntervalAnalysis | EnergyDocumentFailure {
  const normalized = String(text || "").replace(/^\uFEFF/, "");
  const rowEstimate = (normalized.match(/\n/g)?.length || 0) + 1;
  if (rowEstimate > ENERGY_DOCUMENT_LIMITS.maxCsvRows + 1) {
    return failure("CSV_ROW_LIMIT", `CSV files are limited to ${ENERGY_DOCUMENT_LIMITS.maxCsvRows.toLocaleString()} data rows.`);
  }
  if (/^100\s*,\s*NEM12\b/im.test(normalized)) return analyseNem12(normalized);
  const parsed = parseCsv(normalized);
  if (!parsed.ok) return parsed;
  const gvgHeaders = gvgHeaderIndexes(parsed.rows[0] || []);
  if (gvgHeaders.complete || gvgHeaders.candidate) return analyseGreenVehicleGuideRows(parsed);
  return analyseHeaderCsvRows(parsed);
}

function detectDocumentKind(input: LocalEnergyDocumentInput): "pdf" | "csv" | null {
  const name = String(input.name || "").toLowerCase();
  const type = String(input.type || "").toLowerCase();
  if (name.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (name.endsWith(".csv") || name.endsWith(".txt") || /^(?:text\/csv|text\/plain|application\/csv)$/.test(type)) return "csv";
  return null;
}

export async function analyseLocalEnergyDocument(input: LocalEnergyDocumentInput): Promise<EnergyDocumentAnalysis> {
  const kind = detectDocumentKind(input);
  if (!kind) return failure("UNSUPPORTED_TYPE", "Choose a text-based PDF quote, electricity interval CSV or Green Vehicle Guide CSV.");
  if (!Number.isFinite(input.size) || input.size < 0 || input.size > ENERGY_DOCUMENT_LIMITS.maxFileBytes) {
    return failure("FILE_TOO_LARGE", `Files are limited to ${Math.round(ENERGY_DOCUMENT_LIMITS.maxFileBytes / 1024 / 1024)} MB for local analysis.`);
  }
  let bytes: Uint8Array | null = null;
  try {
    const buffer = await input.arrayBuffer();
    bytes = new Uint8Array(buffer);
    if (bytes.byteLength > ENERGY_DOCUMENT_LIMITS.maxFileBytes) {
      return failure("FILE_TOO_LARGE", `Files are limited to ${Math.round(ENERGY_DOCUMENT_LIMITS.maxFileBytes / 1024 / 1024)} MB for local analysis.`);
    }
    if (kind === "pdf") {
      const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(16, bytes.length)));
      if (!/^%PDF-/.test(header)) return failure("PDF_MALFORMED", "The selected file does not contain a valid PDF header.");
      const extracted = await extractPdfText(bytes);
      if (isGreenVehicleGuidePdfText(extracted.text, input.name)) {
        return failure(
          "GVG_PDF_REQUIRES_CSV",
          "This is a Green Vehicle Guide PDF. Download the same results as CSV from GVG and choose that file so vehicle variants, Wh/km, electric range and test cycles can be compared exactly. The PDF was read locally and was not uploaded or stored.",
        );
      }
      return {
        ok: true,
        kind: "quote-pdf",
        privacy: PRIVACY_BOUNDARY,
        summary: analyseEnergyQuoteText(extracted.text, extracted.pageCount),
      };
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return analyseEnergyCsv(text);
  } catch (error) {
    if (error instanceof AnalysisFailure) return failure(error.code, error.message);
    return failure("READ_FAILED", "The file could not be read locally. Choose the original PDF or CSV and try again.");
  } finally {
    if (bytes && bytes.byteLength) {
      try { bytes.fill(0); } catch { /* PDF.js may transfer ownership of the buffer. */ }
    }
    bytes = null;
  }
}
