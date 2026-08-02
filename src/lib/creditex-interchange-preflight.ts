import { createHash } from "node:crypto";

export const CREDITEX_INTERCHANGE_PREFLIGHT_CONTRACT =
  "creditex-interchange-preflight/v1";
export const CREDITEX_INTERCHANGE_PREFLIGHT_REVIEWED_ON = "2026-08-03";

export type CreditexInterchangeInput = string | Uint8Array;

export type CreditexInterchangeIssue = Readonly<{
  code: string;
  message: string;
  rowNumber?: number;
  fieldNumber?: number;
}>;

export type CreditexCsvAnalysis = Readonly<{
  rawSha256: string;
  byteLength: number;
  rows: readonly (readonly string[])[];
  issues: readonly CreditexInterchangeIssue[];
}>;

export type CreditexBlockedInterchangeManifest = Readonly<{
  contract: typeof CREDITEX_INTERCHANGE_PREFLIGHT_CONTRACT;
  adapterKey: string;
  sourceContractVersion: string;
  rawSha256: string;
  byteLength: number;
  headerFieldCount: number;
  dataRecordCount: number;
  status: "blocked";
  externalSubmissionEnabled: false;
  blockReason: string;
  issues: readonly CreditexInterchangeIssue[];
  manifestSha256: string;
}>;

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

export function creditexCanonicalSha256(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

export function creditexRawSha256(value: Uint8Array) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function bytesFromInput(input: CreditexInterchangeInput) {
  return typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      issue: null,
    };
  } catch {
    return {
      text: "",
      issue: {
        code: "CSV_INVALID_UTF8",
        message: "The candidate file is not valid UTF-8.",
      } satisfies CreditexInterchangeIssue,
    };
  }
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  const issues: CreditexInterchangeIssue[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;
  let rowNumber = 1;
  let fieldNumber = 1;

  const finishField = () => {
    row.push(field);
    field = "";
    quoteClosed = false;
    fieldNumber += 1;
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
    rowNumber += 1;
    fieldNumber = 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character !== '"') {
        field += character;
        continue;
      }
      if (text[index + 1] === '"') {
        field += '"';
        index += 1;
        continue;
      }
      inQuotes = false;
      quoteClosed = true;
      continue;
    }

    if (quoteClosed && character !== "," && character !== "\r"
      && character !== "\n") {
      issues.push({
        code: "CSV_CHARACTER_AFTER_CLOSING_QUOTE",
        message:
          "Only a delimiter or row ending may follow a closing quote.",
        rowNumber,
        fieldNumber,
      });
      quoteClosed = false;
      field += character;
      continue;
    }
    if (character === '"') {
      if (field.length > 0) {
        issues.push({
          code: "CSV_QUOTE_IN_UNQUOTED_FIELD",
          message: "A quoted field must begin with the quote character.",
          rowNumber,
          fieldNumber,
        });
        field += character;
      } else {
        inQuotes = true;
      }
      continue;
    }
    if (character === ",") {
      finishField();
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      finishRow();
      continue;
    }
    field += character;
  }

  if (inQuotes) {
    issues.push({
      code: "CSV_UNCLOSED_QUOTED_FIELD",
      message: "A quoted field is not closed.",
      rowNumber,
      fieldNumber,
    });
  }
  if (
    text.length > 0
    && !text.endsWith("\n")
    && !text.endsWith("\r")
  ) {
    finishRow();
  }

  return { rows, issues };
}

export function analyseCreditexCsv(
  input: CreditexInterchangeInput,
): CreditexCsvAnalysis {
  const rawBytes = bytesFromInput(input);
  const decoded = decodeUtf8(rawBytes);
  if (decoded.issue) {
    return deepFreeze({
      rawSha256: creditexRawSha256(rawBytes),
      byteLength: rawBytes.byteLength,
      rows: [],
      issues: [decoded.issue],
    });
  }
  const parsed = parseCsv(decoded.text);
  return deepFreeze({
    rawSha256: creditexRawSha256(rawBytes),
    byteLength: rawBytes.byteLength,
    rows: parsed.rows,
    issues: parsed.issues,
  });
}

export function createBlockedInterchangeManifest(input: {
  adapterKey: string;
  sourceContractVersion: string;
  analysis: CreditexCsvAnalysis;
  blockReason: string;
  issues: readonly CreditexInterchangeIssue[];
}): CreditexBlockedInterchangeManifest {
  const core = {
    contract: CREDITEX_INTERCHANGE_PREFLIGHT_CONTRACT,
    adapterKey: input.adapterKey,
    sourceContractVersion: input.sourceContractVersion,
    rawSha256: input.analysis.rawSha256,
    byteLength: input.analysis.byteLength,
    headerFieldCount: input.analysis.rows[0]?.length || 0,
    dataRecordCount: Math.max(0, input.analysis.rows.length - 1),
    status: "blocked" as const,
    externalSubmissionEnabled: false as const,
    blockReason: input.blockReason,
    issues: input.issues,
  } as const;
  return deepFreeze({
    ...core,
    manifestSha256: creditexCanonicalSha256(core),
  });
}

export const CREDITEX_VEU_INTERCHANGE_DESCRIPTOR = deepFreeze({
  adapterKey: "veu-authorised-api",
  sourceContractVersion: "current-authorised-pack-unavailable",
  publicRegistryUrl: "https://veu.esc.vic.gov.au/vpr/s/public-registry",
  schemaState: "blocked_current_authorised_contract_unavailable",
  serializerAvailable: false,
  parserAvailable: false,
  externalSubmissionEnabled: false,
  blockReason:
    "The public VEU registry is not a submission contract. The current ESC API pack, sandbox, authentication contract and representative response receipts are unavailable.",
} as const);

export function preflightBlockedVeuFixture(
  input: CreditexInterchangeInput,
) {
  const analysis = analyseCreditexCsv(input);
  const issue = {
    code: "VEU_AUTHORISED_CONTRACT_UNAVAILABLE",
    message: CREDITEX_VEU_INTERCHANGE_DESCRIPTOR.blockReason,
  } satisfies CreditexInterchangeIssue;
  return createBlockedInterchangeManifest({
    adapterKey: CREDITEX_VEU_INTERCHANGE_DESCRIPTOR.adapterKey,
    sourceContractVersion:
      CREDITEX_VEU_INTERCHANGE_DESCRIPTOR.sourceContractVersion,
    analysis,
    blockReason: CREDITEX_VEU_INTERCHANGE_DESCRIPTOR.blockReason,
    issues: [...analysis.issues, issue],
  });
}
