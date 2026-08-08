import type {
  WaSupportedSolutionSource,
} from "./creditex-wa-product-sources";
import {
  CREDITEX_WA_PRODUCT_SOURCE_CONTRACT,
} from "./creditex-wa-product-sources.ts";

export type WaProductAttribute = string | number | boolean | null;

export type WaSupportedSolutionRecord = Readonly<{
  sourceKey: string;
  sourceRecordKey: string;
  productKind: "inverter_compatibility";
  brand: string;
  manufacturer: string;
  series: string;
  model: string;
  effectiveSnapshotDate: string;
  derGeneratorProvisional: string | null;
  derGeneratorFullListing: string | null;
  derStorageProvisional: string | null;
  derStorageFullListing: string | null;
  derStorageSupported: boolean;
  derStorageActivationReady: boolean;
  attributes: Readonly<Record<string, WaProductAttribute>>;
}>;

export type ParseWaSupportedSolutionsOptions = Readonly<{
  previousRecordCount?: number;
}>;

export class CreditexWaProductSourceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "CreditexWaProductSourceError";
    this.code = code;
    this.status = status;
  }
}

function sourceError(
  code: string,
  source: WaSupportedSolutionSource,
  message: string,
  status = 422,
): CreditexWaProductSourceError {
  return new CreditexWaProductSourceError(
    code,
    `${source.sourceKey}: ${message}`,
    status,
  );
}

function decodeSource(
  source: WaSupportedSolutionSource,
  bytes: Uint8Array,
): string {
  if (!(bytes instanceof Uint8Array)) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_BYTES_INVALID",
      source,
      "source body must be a Uint8Array",
      400,
    );
  }
  if (bytes.byteLength === 0) {
    throw sourceError("WA_PRODUCT_SOURCE_EMPTY", source, "source body is empty");
  }
  if (bytes.byteLength > source.maxBytes) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_TOO_LARGE",
      source,
      `source body is ${bytes.byteLength} bytes; maximum is ${source.maxBytes}`,
      413,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw sourceError(
      "WA_PRODUCT_SOURCE_ENCODING_INVALID",
      source,
      "source body is not valid UTF-8",
    );
  }
}

function validateContentType(
  source: WaSupportedSolutionSource,
  contentType: string,
): void {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (!mediaType || !source.expectedContentTypes.includes(mediaType)) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_CONTENT_TYPE_CHANGED",
      source,
      `received content type ${JSON.stringify(contentType)}`,
    );
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  quot: '"',
  rsquo: "'",
};

function decodeHtmlEntities(
  source: WaSupportedSolutionSource,
  value: string,
): string {
  return value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi,
    (entity, token: string) => {
      if (token.startsWith("#")) {
        const hexadecimal = token[1]?.toLowerCase() === "x";
        const digits = token.slice(hexadecimal ? 2 : 1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (!Number.isSafeInteger(codePoint) || codePoint > 0x10ffff) {
          throw sourceError(
            "WA_PRODUCT_SOURCE_HTML_MALFORMED",
            source,
            `invalid numeric HTML entity ${entity}`,
          );
        }
        return String.fromCodePoint(codePoint);
      }
      const decoded = NAMED_ENTITIES[token.toLowerCase()];
      if (decoded === undefined) {
        throw sourceError(
          "WA_PRODUCT_SOURCE_SCHEMA_CHANGED",
          source,
          `unreviewed HTML entity ${entity}`,
        );
      }
      return decoded;
    },
  );
}

function semanticText(
  source: WaSupportedSolutionSource,
  html: string,
): string {
  const withoutNonText = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<span\b[^>]*\btick-text-for-search\b[^>]*>[\s\S]*?<\/span\s*>/gi, " ")
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(source, withoutNonText)
    .replace(/\s+/g, " ")
    .trim();
}

function elementBodies(
  html: string,
  elementName: "thead" | "tbody" | "tr" | "th" | "td",
): string[] {
  const pattern = new RegExp(
    `<${elementName}\\b[^>]*>([\\s\\S]*?)<\\/${elementName}\\s*>`,
    "gi",
  );
  return [...html.matchAll(pattern)].map((match) => match[1]);
}

function exactRowsMatch(
  actual: readonly (readonly string[])[],
  expected: readonly (readonly string[])[],
): boolean {
  return actual.length === expected.length
    && actual.every((row, rowIndex) => (
      row.length === expected[rowIndex]?.length
      && row.every((cell, cellIndex) => cell === expected[rowIndex]?.[cellIndex])
    ));
}

function parseSnapshotDate(
  source: WaSupportedSolutionSource,
  html: string,
): string {
  const firstIndex = html.indexOf("Last Updated Date:");
  if (firstIndex < 0 || firstIndex !== html.lastIndexOf("Last Updated Date:")) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_SNAPSHOT_DATE_CHANGED",
      source,
      "expected exactly one Last Updated Date marker",
    );
  }
  const markerText = semanticText(source, html.slice(firstIndex, firstIndex + 300));
  const match = /Last Updated Date:\s*(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)\s+(\d{4})/.exec(
    markerText,
  );
  if (!match) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_SNAPSHOT_DATE_CHANGED",
      source,
      `could not parse snapshot date from ${JSON.stringify(markerText)}`,
    );
  }
  const months: Readonly<Record<string, number>> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  const day = Number(match[1]);
  const month = months[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (!month) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_SNAPSHOT_DATE_CHANGED",
      source,
      `unrecognized month ${match[2]}`,
    );
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_SNAPSHOT_DATE_CHANGED",
      source,
      "published snapshot date is not a valid calendar date",
    );
  }
  const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (isoDate < source.reviewedSnapshotDate) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_SNAPSHOT_REGRESSION",
      source,
      `published snapshot ${isoDate} predates reviewed snapshot ${source.reviewedSnapshotDate}`,
    );
  }
  return isoDate;
}

function supportedSolutionsTable(
  source: WaSupportedSolutionSource,
  html: string,
): string {
  const tablePattern = /<table\b(?=[^>]*\bid\s*=\s*["']inverterTable["'])[^>]*>([\s\S]*?)<\/table\s*>/gi;
  const tables = [...html.matchAll(tablePattern)];
  if (tables.length !== 1) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      `expected one inverterTable; received ${tables.length}`,
    );
  }
  return tables[0][1];
}

function validateTableHeader(
  source: WaSupportedSolutionSource,
  tableHtml: string,
): void {
  const headers = elementBodies(tableHtml, "thead");
  if (headers.length !== 1) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      `expected one table header; received ${headers.length}`,
    );
  }
  const actualRows = elementBodies(headers[0], "tr").map((row) => (
    elementBodies(row, "th").map((cell) => semanticText(source, cell))
  ));
  if (!exactRowsMatch(actualRows, source.expectedHeaderRows)) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      `table headings do not match the reviewed schema; received ${JSON.stringify(actualRows)}`,
    );
  }
}

function assertRecordCount(
  source: WaSupportedSolutionSource,
  count: number,
  options: ParseWaSupportedSolutionsOptions,
): void {
  if (count < source.minimumRecords) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_COUNT_BELOW_MINIMUM",
      source,
      `received ${count} rows; controlled minimum is ${source.minimumRecords}`,
    );
  }
  if (count > source.maximumRecords) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_COUNT_ABOVE_MAXIMUM",
      source,
      `received ${count} rows; controlled maximum is ${source.maximumRecords}`,
    );
  }
  if (options.previousRecordCount !== undefined) {
    if (
      !Number.isSafeInteger(options.previousRecordCount)
      || options.previousRecordCount < 0
    ) {
      throw sourceError(
        "WA_PRODUCT_SOURCE_PREVIOUS_COUNT_INVALID",
        source,
        "previousRecordCount must be a non-negative safe integer",
        400,
      );
    }
    if (count < options.previousRecordCount) {
      throw sourceError(
        "WA_PRODUCT_SOURCE_COUNT_REGRESSION",
        source,
        `received ${count} rows; previous accepted source had ${options.previousRecordCount}`,
      );
    }
  }
}

function requiredCell(
  source: WaSupportedSolutionSource,
  value: string,
  fieldName: string,
  rowNumber: number,
): string {
  if (value) return value;
  throw sourceError(
    "WA_PRODUCT_SOURCE_IDENTITY_MISSING",
    source,
    `row ${rowNumber} has no ${fieldName}`,
  );
}

function sourceRecordKey(
  source: WaSupportedSolutionSource,
  values: readonly string[],
): string {
  return `${source.sourceKey}:${values.map((value) => `${value.length}:${value}`).join("|")}`;
}

function optionalCell(value: string): string | null {
  return value || null;
}

function hasActivationTick(cellHtml: string): boolean {
  return /class\s*=\s*["'][^"']*\b(?:tick-icon|inverter-with-tick)\b[^"']*["']/i
    .test(cellHtml);
}

function parseTableRecords(
  source: WaSupportedSolutionSource,
  tableHtml: string,
  effectiveSnapshotDate: string,
  options: ParseWaSupportedSolutionsOptions,
): readonly WaSupportedSolutionRecord[] {
  const bodies = elementBodies(tableHtml, "tbody");
  if (bodies.length !== 1) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      `expected one table body; received ${bodies.length}`,
    );
  }
  const rows = elementBodies(bodies[0], "tr");
  assertRecordCount(source, rows.length, options);
  const identities = new Set<string>();
  const records = rows.map((rowHtml, rowIndex) => {
    const cells = elementBodies(rowHtml, "td");
    if (cells.length !== 8) {
      throw sourceError(
        "WA_PRODUCT_SOURCE_SCHEMA_CHANGED",
        source,
        `row ${rowIndex + 1} has ${cells.length} cells; expected 8`,
      );
    }
    const values = cells.map((cell) => semanticText(source, cell));
    const brand = requiredCell(source, values[0], "Brand", rowIndex + 1);
    const manufacturer = requiredCell(
      source,
      values[1],
      "Inverter OEM",
      rowIndex + 1,
    );
    const series = requiredCell(source, values[2], "Series", rowIndex + 1);
    const model = requiredCell(source, values[3], "Model", rowIndex + 1);
    const recordKey = sourceRecordKey(
      source,
      [brand, manufacturer, series, model],
    );
    if (identities.has(recordKey)) {
      throw sourceError(
        "WA_PRODUCT_SOURCE_DUPLICATE",
        source,
        `duplicate hardware identity ${recordKey}`,
      );
    }
    identities.add(recordKey);
    const derStorageProvisional = optionalCell(values[6]);
    const derStorageFullListing = optionalCell(values[7]);
    return Object.freeze({
      sourceKey: source.sourceKey,
      sourceRecordKey: recordKey,
      productKind: source.productKind,
      brand,
      manufacturer,
      series,
      model,
      effectiveSnapshotDate,
      derGeneratorProvisional: optionalCell(values[4]),
      derGeneratorFullListing: optionalCell(values[5]),
      derStorageProvisional,
      derStorageFullListing,
      derStorageSupported: Boolean(
        derStorageProvisional || derStorageFullListing,
      ),
      derStorageActivationReady: hasActivationTick(cells[6])
        || hasActivationTick(cells[7]),
      attributes: Object.freeze({
        sourceSchemaVersion: CREDITEX_WA_PRODUCT_SOURCE_CONTRACT,
        sourceSnapshotDate: effectiveSnapshotDate,
        compatibilityFieldNames:
          "DER Generator Provisional|DER Generator Full Listing|DER Storage Provisional|DER Storage Full Listing",
      }),
    });
  });
  return Object.freeze(records);
}

export function parseWaSupportedSolutionsSource(
  source: WaSupportedSolutionSource,
  bytes: Uint8Array,
  contentType: string,
  options: ParseWaSupportedSolutionsOptions = {},
): readonly WaSupportedSolutionRecord[] {
  validateContentType(source, contentType);
  const html = decodeSource(source, bytes);
  if (/\0/.test(html)) {
    throw sourceError(
      "WA_PRODUCT_SOURCE_HTML_MALFORMED",
      source,
      "source contains a NUL character",
    );
  }
  const effectiveSnapshotDate = parseSnapshotDate(source, html);
  const tableHtml = supportedSolutionsTable(source, html);
  validateTableHeader(source, tableHtml);
  return parseTableRecords(source, tableHtml, effectiveSnapshotDate, options);
}
