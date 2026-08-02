import {
  analyseCreditexCsv,
  createBlockedInterchangeManifest,
  type CreditexInterchangeInput,
  type CreditexInterchangeIssue,
} from "./creditex-interchange-preflight.ts";

export const CREDITEX_REC_BULK_UPLOAD_CONTRACT =
  "rec-registry-bulk-upload/current-public-guide";
export const CREDITEX_REC_BULK_UPLOAD_REVIEWED_ON = "2026-08-03";
export const REC_BULK_UPLOAD_MAXIMUM_RECORDS = 250;

export const REC_BULK_UPLOAD_KINDS = ["SGU", "SWH_ASHP"] as const;
export type RecBulkUploadKind = typeof REC_BULK_UPLOAD_KINDS[number];

const REC_BULK_UPLOAD_GUIDE =
  "https://cer.gov.au/document/rec-registry-guide-bulk-upload-small-generation-unit-and-solar-water-heater-installs";

const PUBLIC_FILE_CONTRACT = Object.freeze({
  fileType: "CSV",
  extension: ".CSV",
  characterSet: "UTF-8",
  columnDelimiter: "comma",
  textQualifier: "double quote",
  headerRequired: true,
  maximumRecords: REC_BULK_UPLOAD_MAXIMUM_RECORDS,
  validationStages: Object.freeze(["structural", "functional"]),
  completeFileAcceptance: "binary",
});

export const CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS = Object.freeze({
  SGU: Object.freeze({
    adapterKey: "rec-registry-sgu-bulk-upload",
    kind: "SGU",
    officialSourceUrl: REC_BULK_UPLOAD_GUIDE,
    applicability:
      "Small generation unit installations on or after 1 April 2022.",
    ...PUBLIC_FILE_CONTRACT,
    exactHeader: null,
    fieldDictionarySha256: null,
    schemaState: "blocked_official_dictionary_bytes_not_retained",
    serializerAvailable: false,
    functionalParserAvailable: false,
    externalSubmissionEnabled: false,
  }),
  SWH_ASHP: Object.freeze({
    adapterKey: "rec-registry-swh-ashp-bulk-upload",
    kind: "SWH_ASHP",
    officialSourceUrl: REC_BULK_UPLOAD_GUIDE,
    applicability:
      "Solar water heater and air-source heat pump bulk registration.",
    ...PUBLIC_FILE_CONTRACT,
    exactHeader: null,
    fieldDictionarySha256: null,
    schemaState: "blocked_official_dictionary_bytes_not_retained",
    serializerAvailable: false,
    functionalParserAvailable: false,
    externalSubmissionEnabled: false,
  }),
} as const);

export function preflightBlockedRecBulkUpload(
  kind: RecBulkUploadKind,
  input: CreditexInterchangeInput,
) {
  const descriptor = CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS[kind];
  const analysis = analyseCreditexCsv(input);
  const issues: CreditexInterchangeIssue[] = [...analysis.issues];
  if (!analysis.rows.length) {
    issues.push({
      code: "REC_HEADER_REQUIRED",
      message: "A REC Registry bulk candidate must contain a header row.",
    });
  }
  const dataRecordCount = Math.max(0, analysis.rows.length - 1);
  if (dataRecordCount > REC_BULK_UPLOAD_MAXIMUM_RECORDS) {
    issues.push({
      code: "REC_MAXIMUM_RECORDS_EXCEEDED",
      message:
        `REC Registry bulk upload permits no more than ${REC_BULK_UPLOAD_MAXIMUM_RECORDS} data records.`,
    });
  }
  issues.push({
    code: "REC_EXACT_DICTIONARY_NOT_RETAINED",
    message:
      "The exact official header, data dictionary, business rules and reference data are not retained as an approved versioned asset, so functional parsing and export remain blocked.",
  });
  return createBlockedInterchangeManifest({
    adapterKey: descriptor.adapterKey,
    sourceContractVersion: CREDITEX_REC_BULK_UPLOAD_CONTRACT,
    analysis,
    blockReason:
      "An exact retained and independently reviewed REC Registry dictionary is required before a regulator-format file can be emitted.",
    issues,
  });
}
