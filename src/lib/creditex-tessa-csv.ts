import {
  analyseCreditexCsv,
  createBlockedInterchangeManifest,
  type CreditexInterchangeInput,
  type CreditexInterchangeIssue,
} from "./creditex-interchange-preflight.ts";

export const CREDITEX_TESSA_CSV_CONTRACT = "tessa-csv/v1.7";
export const CREDITEX_TESSA_CSV_REVIEWED_ON = "2026-08-03";

export const TESSA_SCHEMES = ["ESS", "PDRS"] as const;
export type TessaScheme = typeof TESSA_SCHEMES[number];

const TESSA_SPECIFICATION_PAGE =
  "https://www.energysustainabilityschemes.nsw.gov.au/ess-pdrs/documents/guide/technical-guide-csv-specification-acp-certificate-registration";
const TESSA_SPECIFICATION_WORKBOOK =
  "https://www.energysustainabilityschemes.nsw.gov.au/sites/default/files/cm9_documents/Technical-Guide-CSV-Specification-ACPs-V1.7.XLSX";

export const CREDITEX_TESSA_CSV_DESCRIPTORS = Object.freeze({
  ESS: Object.freeze({
    adapterKey: "nsw-ess-tessa-csv-v1.7",
    scheme: "ESS",
    version: "1.7",
    effectiveFrom: "2026-07-22",
    effectiveTo: "2050-06-30",
    officialSourceUrl: TESSA_SPECIFICATION_PAGE,
    schemaWorkbookUrl: TESSA_SPECIFICATION_WORKBOOK,
    officialExampleUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/ess/documents/forms-and-templates/ess-example-template-csv-implementation-data",
    schemaWorkbookSha256: null,
    exactHeader: null,
    schemaState: "blocked_official_workbook_bytes_not_retained",
    serializerAvailable: false,
    parserAvailable: false,
    externalSubmissionEnabled: false,
  }),
  PDRS: Object.freeze({
    adapterKey: "nsw-pdrs-tessa-csv-v1.7",
    scheme: "PDRS",
    version: "1.7",
    effectiveFrom: "2026-07-22",
    effectiveTo: "2050-06-30",
    officialSourceUrl: TESSA_SPECIFICATION_PAGE,
    schemaWorkbookUrl: TESSA_SPECIFICATION_WORKBOOK,
    officialExampleUrl:
      "https://www.energysustainabilityschemes.nsw.gov.au/pdrs/documents/template/template-pdrs-example",
    schemaWorkbookSha256: null,
    exactHeader: null,
    schemaState: "blocked_official_workbook_bytes_not_retained",
    serializerAvailable: false,
    parserAvailable: false,
    externalSubmissionEnabled: false,
  }),
} as const);

export function preflightBlockedTessaCsv(
  scheme: TessaScheme,
  input: CreditexInterchangeInput,
) {
  const descriptor = CREDITEX_TESSA_CSV_DESCRIPTORS[scheme];
  const analysis = analyseCreditexCsv(input);
  const issues: CreditexInterchangeIssue[] = [...analysis.issues];
  if (!analysis.rows.length) {
    issues.push({
      code: "TESSA_HEADER_REQUIRED",
      message: "A TESSA candidate file must contain a header row.",
    });
  }
  issues.push({
    code: "TESSA_V1_7_SCHEMA_BYTES_NOT_RETAINED",
    message:
      "The exact official TESSA v1.7 workbook bytes, SHA-256 and transcribed field dictionary are not retained, so parsing, validation and export remain blocked.",
  });
  return createBlockedInterchangeManifest({
    adapterKey: descriptor.adapterKey,
    sourceContractVersion: CREDITEX_TESSA_CSV_CONTRACT,
    analysis,
    blockReason:
      "Exact TESSA v1.7 schema bytes and an independently reviewed transcription are required before a regulator-format file can be parsed or emitted.",
    issues,
  });
}
