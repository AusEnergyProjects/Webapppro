import type {
  CreditexOfficialProductRecord,
} from "./creditex-official-product-registry.ts";
import { australianRegulatorDate } from "./creditex-australian-regulator-date.ts";

export const CREDITEX_CEC_BATTERY_ARTIFACT_CONTRACT =
  "creditex-cec-battery-artifact/v1" as const;
export const CREDITEX_CEC_BATTERY_REGISTRY_CODE = "cec-products" as const;
export const CREDITEX_CEC_BATTERY_SOURCE_KEY =
  "cec-licensed-battery-listing" as const;

// The CEC's current public product page states that the approved list contains
// more than 1,000 batteries. Cross-snapshot count regression is enforced by
// the shared registry synchroniser after this independently reviewed floor.
export const CREDITEX_CEC_BATTERY_ALL_MINIMUM_RECORDS = 1_000;
export const CREDITEX_CEC_BATTERY_CURRENT_MINIMUM_RECORDS = 1_000;
export const CREDITEX_CEC_BATTERY_MAXIMUM_RECORDS = 15_000;
export const CREDITEX_CEC_BATTERY_RESPONSE_MAXIMUM_BYTES = 25_000_000;
export const CREDITEX_CEC_BATTERY_ARTIFACT_MAXIMUM_BYTES = 60_000_000;

const JSON_CONTENT_TYPES = new Set(["application/json", "text/json"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;
const SIGNED_DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;
const SALESFORCE_ID_PATTERN = /^[A-Za-z0-9]{15,18}$/;
const STABLE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

const BATTERY_KEYS = ["BatteryNumber", "Details", "Certificate"] as const;
const DETAIL_KEYS = [
  "Id",
  "Model_Number__c",
  "Series__c",
  "NominalBatteryCapacity",
  "UsableCapacity",
  "DepthOfDischarge",
  "MaxOperatingTemperature",
  "MinOperatingTemp",
  "OutdoorUsage",
  "DCVoltage",
  "BatteryChemistry",
  "RatedDCPower",
] as const;
const CERTIFICATE_KEYS = ["Details"] as const;
const CERTIFICATE_DETAIL_KEYS = [
  "SalesforceBatteryCertID",
  "CompliancePathway",
  "CECApprovedDate",
  "CECExpiredDate",
  "CECApproved",
  "BrandName",
  "ImporterOrResponsibleSupplier",
  "EquipmentCategory",
  "WarrantyAvailableFrom",
] as const;

type JsonObject = Record<string, unknown>;

export type CreditexCecBatteryArtifact = Readonly<{
  contract: typeof CREDITEX_CEC_BATTERY_ARTIFACT_CONTRACT;
  sourceKey: typeof CREDITEX_CEC_BATTERY_SOURCE_KEY;
  capturedAt: string;
  allRecordsResponse: string;
  currentRecordsResponse: string;
}>;

type ParsedBattery = Readonly<{
  sourceRecordKey: string;
  salesforceModelId: string;
  batteryNumber: string;
  certificateId: string;
  model: string;
  series: string;
  nominalCapacityKwh: number;
  cecUsableCapacityKwh: number;
  depthOfDischargePercent: number | null;
  maximumOperatingTemperatureC: number | null;
  minimumOperatingTemperatureC: number | null;
  outdoorUsage: boolean;
  dcVoltageV: number | null;
  batteryChemistry: string;
  cecRatedDcPowerKw: number | null;
  compliancePathway: string;
  approvedDate: string;
  expiredDate: string;
  cecApproved: boolean;
  brand: string;
  supplier: string;
  equipmentCategory: string;
  warrantyUrl: string;
  fingerprint: string;
}>;

function sourceError(message: string): never {
  throw new Error(`CEC licensed battery source invalid: ${message}`);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) return sourceError(`${label} is not an object`);
  return value;
}

function exactKeys(
  value: JsonObject,
  keys: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    return sourceError(`${label} schema changed`);
  }
}

function boundedText(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
) {
  if (typeof value !== "string") return sourceError(`${label} is not text`);
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
    return sourceError(`${label} is not bounded text`);
  }
  return text;
}

function optionalText(value: unknown, label: string, maximum: number) {
  if (value === null || value === undefined || value === "") return "";
  return boundedText(value, label, maximum);
}

function validDate(value: unknown, label: string) {
  const text = boundedText(value, label, 10);
  if (!DATE_PATTERN.test(text)) return sourceError(`${label} is not an ISO date`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== text
  ) {
    return sourceError(`${label} is not a calendar date`);
  }
  return text;
}

function validCapturedAt(value: unknown) {
  const text = boundedText(value, "artifact capturedAt", 24);
  if (!INSTANT_PATTERN.test(text) || Number.isNaN(Date.parse(text))) {
    return sourceError("artifact capturedAt is not an exact UTC instant");
  }
  if (Date.parse(text) > Date.now() + 10 * 60 * 1_000) {
    return sourceError("artifact capturedAt is future-dated");
  }
  return text;
}

function decimal(
  value: unknown,
  label: string,
  options: { allowZero?: boolean; maximum?: number } = {},
) {
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string" && DECIMAL_PATTERN.test(value.trim())) {
    numeric = Number(value.trim());
  } else {
    return sourceError(`${label} is not a reviewed decimal`);
  }
  const maximum = options.maximum ?? 1_000_000;
  if (
    !Number.isFinite(numeric)
    || (options.allowZero ? numeric < 0 : numeric <= 0)
    || numeric > maximum
  ) {
    return sourceError(`${label} is outside its reviewed range`);
  }
  return numeric;
}

function optionalDecimal(
  value: unknown,
  label: string,
  maximum: number,
) {
  if (value === null || value === undefined || value === "") return null;
  return decimal(value, label, { allowZero: true, maximum });
}

function optionalSignedDecimal(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (value === null || value === undefined || value === "") return null;
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (
    typeof value === "string"
    && SIGNED_DECIMAL_PATTERN.test(value.trim())
  ) {
    numeric = Number(value.trim());
  } else {
    return sourceError(`${label} is not a reviewed signed decimal`);
  }
  if (
    !Number.isFinite(numeric)
    || numeric < minimum
    || numeric > maximum
  ) {
    return sourceError(`${label} is outside its reviewed range`);
  }
  return numeric;
}

function boundedRawJsonText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    return sourceError(`${label} is not text`);
  }
  // Preserve the exact response bytes represented by the retained artifact.
  // JSON formatting whitespace is valid; other control characters are not.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    return sourceError(`${label} contains unsupported control characters`);
  }
  if (
    new TextEncoder().encode(value).byteLength
      > CREDITEX_CEC_BATTERY_RESPONSE_MAXIMUM_BYTES
  ) {
    return sourceError(`${label} exceeds its byte limit`);
  }
  return value;
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") return sourceError(`${label} is not boolean`);
  return value;
}

function parseDocument(raw: string, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return sourceError(`${label} is not JSON`);
  }
  const document = requiredObject(parsed, label);
  exactKeys(document, ["Batteries"], label);
  if (!Array.isArray(document.Batteries)) {
    return sourceError(`${label}.Batteries is not an array`);
  }
  return document.Batteries;
}

function stableToken(value: unknown, label: string) {
  const text = boundedText(value, label, 100);
  if (!STABLE_TOKEN_PATTERN.test(text)) {
    return sourceError(`${label} is not a stable identifier`);
  }
  return text;
}

function warrantyUrl(value: unknown, label: string) {
  const text = optionalText(value, label, 2_000);
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return sourceError(`${label} is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return sourceError(`${label} is not an HTTP URL`);
  }
  return text;
}

function parseBattery(value: unknown, label: string): ParsedBattery {
  const battery = requiredObject(value, label);
  exactKeys(battery, BATTERY_KEYS, label);
  const details = requiredObject(battery.Details, `${label}.Details`);
  exactKeys(details, DETAIL_KEYS, `${label}.Details`);
  const certificate = requiredObject(
    battery.Certificate,
    `${label}.Certificate`,
  );
  exactKeys(certificate, CERTIFICATE_KEYS, `${label}.Certificate`);
  const certificateDetails = requiredObject(
    certificate.Details,
    `${label}.Certificate.Details`,
  );
  exactKeys(
    certificateDetails,
    CERTIFICATE_DETAIL_KEYS,
    `${label}.Certificate.Details`,
  );

  const salesforceModelId = boundedText(
    details.Id,
    `${label}.Details.Id`,
    18,
  );
  if (!SALESFORCE_ID_PATTERN.test(salesforceModelId)) {
    return sourceError(`${label}.Details.Id is not a Salesforce identifier`);
  }
  const batteryNumber = stableToken(
    battery.BatteryNumber,
    `${label}.BatteryNumber`,
  );
  const certificateId = stableToken(
    certificateDetails.SalesforceBatteryCertID,
    `${label}.Certificate.Details.SalesforceBatteryCertID`,
  );
  const approvedDate = validDate(
    certificateDetails.CECApprovedDate,
    `${label}.Certificate.Details.CECApprovedDate`,
  );
  const expiredDate = validDate(
    certificateDetails.CECExpiredDate,
    `${label}.Certificate.Details.CECExpiredDate`,
  );
  if (expiredDate < approvedDate) {
    return sourceError(`${label} has an inverted certificate window`);
  }

  const parsed = {
    sourceRecordKey: `${salesforceModelId}:${batteryNumber}:${certificateId}`,
    salesforceModelId,
    batteryNumber,
    certificateId,
    model: boundedText(details.Model_Number__c, `${label}.Details.Model_Number__c`, 500),
    series: optionalText(details.Series__c, `${label}.Details.Series__c`, 300),
    nominalCapacityKwh: decimal(
      details.NominalBatteryCapacity,
      `${label}.Details.NominalBatteryCapacity`,
    ),
    cecUsableCapacityKwh: decimal(
      details.UsableCapacity,
      `${label}.Details.UsableCapacity`,
    ),
    depthOfDischargePercent: optionalDecimal(
      details.DepthOfDischarge,
      `${label}.Details.DepthOfDischarge`,
      100,
    ),
    maximumOperatingTemperatureC: optionalSignedDecimal(
      details.MaxOperatingTemperature,
      `${label}.Details.MaxOperatingTemperature`,
      -100,
      200,
    ),
    minimumOperatingTemperatureC: optionalSignedDecimal(
      details.MinOperatingTemp,
      `${label}.Details.MinOperatingTemp`,
      -100,
      200,
    ),
    outdoorUsage: requiredBoolean(
      details.OutdoorUsage,
      `${label}.Details.OutdoorUsage`,
    ),
    dcVoltageV: optionalDecimal(
      details.DCVoltage,
      `${label}.Details.DCVoltage`,
      10_000,
    ),
    batteryChemistry: optionalText(
      details.BatteryChemistry,
      `${label}.Details.BatteryChemistry`,
      200,
    ),
    cecRatedDcPowerKw: optionalDecimal(
      details.RatedDCPower,
      `${label}.Details.RatedDCPower`,
      1_000_000,
    ),
    compliancePathway: boundedText(
      certificateDetails.CompliancePathway,
      `${label}.Certificate.Details.CompliancePathway`,
      500,
    ),
    approvedDate,
    expiredDate,
    cecApproved: requiredBoolean(
      certificateDetails.CECApproved,
      `${label}.Certificate.Details.CECApproved`,
    ),
    brand: boundedText(
      certificateDetails.BrandName,
      `${label}.Certificate.Details.BrandName`,
      300,
    ),
    supplier: boundedText(
      certificateDetails.ImporterOrResponsibleSupplier,
      `${label}.Certificate.Details.ImporterOrResponsibleSupplier`,
      300,
    ),
    equipmentCategory: boundedText(
      certificateDetails.EquipmentCategory,
      `${label}.Certificate.Details.EquipmentCategory`,
      300,
    ),
    warrantyUrl: warrantyUrl(
      certificateDetails.WarrantyAvailableFrom,
      `${label}.Certificate.Details.WarrantyAvailableFrom`,
    ),
  };
  return {
    ...parsed,
    fingerprint: JSON.stringify(parsed),
  };
}

function parseListing(
  raw: string,
  label: string,
  minimumRecords: number,
) {
  const values = parseDocument(raw, label);
  if (
    values.length < minimumRecords
    || values.length > CREDITEX_CEC_BATTERY_MAXIMUM_RECORDS
  ) {
    return sourceError(`${label} record count is outside its reviewed range`);
  }
  const byRecordKey = new Map<string, ParsedBattery>();
  const salesforceIds = new Set<string>();
  const batteryNumbers = new Set<string>();
  values.forEach((value, index) => {
    const record = parseBattery(value, `${label}.Batteries[${index}]`);
    if (
      byRecordKey.has(record.sourceRecordKey)
      || salesforceIds.has(record.salesforceModelId)
      || batteryNumbers.has(record.batteryNumber)
    ) {
      return sourceError(`${label} contains duplicate product identity`);
    }
    byRecordKey.set(record.sourceRecordKey, record);
    salesforceIds.add(record.salesforceModelId);
    batteryNumbers.add(record.batteryNumber);
  });
  return byRecordKey;
}

function normalizedRecord(
  value: ParsedBattery,
  current: boolean,
  capturedOn: string,
): CreditexOfficialProductRecord {
  const elapsedExpiry = value.expiredDate < capturedOn;
  const approvalStatus = current || elapsedExpiry
    ? "approved"
    : "not_approved";
  return {
    sourceKey: CREDITEX_CEC_BATTERY_SOURCE_KEY,
    sourceRecordKey: value.sourceRecordKey,
    productKind: "cec_battery",
    manufacturer: value.supplier,
    brand: value.brand,
    model: value.model,
    series: value.series,
    registrationNumber: value.batteryNumber,
    certificateNumber: value.certificateId,
    // An elapsed certificate remains historically selectable within its exact
    // published window. A non-current row whose certificate end is still in
    // the future may have been suspended or de-listed; without an exact status
    // effective date it is retained but blocked for every calculation.
    approvalStatus,
    eligibleFrom: value.approvedDate,
    eligibleTo: value.expiredDate,
    availableInAustralia: true,
    attributes: {
      cecBatteryNumber: value.batteryNumber,
      cecSalesforceModelId: value.salesforceModelId,
      cecCertificateId: value.certificateId,
      nominalBatteryCapacityKwh: value.nominalCapacityKwh,
      cecPublishedUsableCapacityKwh: value.cecUsableCapacityKwh,
      cecCurrentEndpointMember: current,
      cecApprovedCurrent: value.cecApproved,
      cecHistoricalEligibilityIndeterminate:
        !current && !elapsedExpiry,
      cecEquipmentCategory: value.equipmentCategory,
      cecCompliancePathway: value.compliancePathway,
      cecOutdoorUsage: value.outdoorUsage,
      cecDepthOfDischargePercent: value.depthOfDischargePercent,
      cecMaximumOperatingTemperatureC:
        value.maximumOperatingTemperatureC,
      cecMinimumOperatingTemperatureC:
        value.minimumOperatingTemperatureC,
      cecDcVoltageV: value.dcVoltageV,
      cecBatteryChemistry: value.batteryChemistry,
      // This is retained under its exact CEC field meaning. It is not treated
      // as PDRS Battery Inverter Output without a distinct official field.
      cecRatedDcPowerKw: value.cecRatedDcPowerKw,
      cecWarrantyUrl: value.warrantyUrl,
      cecApprovedDate: value.approvedDate,
      cecExpiredDate: value.expiredDate,
    },
  };
}

export function parseCreditexCecBatteryArtifact(
  bytes: Uint8Array,
  contentType: string,
): readonly CreditexOfficialProductRecord[] {
  const normalizedContentType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (!JSON_CONTENT_TYPES.has(normalizedContentType)) {
    return sourceError("artifact content type changed");
  }
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 1
    || bytes.byteLength > CREDITEX_CEC_BATTERY_ARTIFACT_MAXIMUM_BYTES
  ) {
    return sourceError("artifact byte count is outside its reviewed range");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return sourceError("artifact is not UTF-8");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return sourceError("artifact is not JSON");
  }
  const artifact = requiredObject(value, "artifact");
  exactKeys(
    artifact,
    [
      "contract",
      "sourceKey",
      "capturedAt",
      "allRecordsResponse",
      "currentRecordsResponse",
    ],
    "artifact",
  );
  if (
    artifact.contract !== CREDITEX_CEC_BATTERY_ARTIFACT_CONTRACT
    || artifact.sourceKey !== CREDITEX_CEC_BATTERY_SOURCE_KEY
  ) {
    return sourceError("artifact identity changed");
  }
  const capturedAt = validCapturedAt(artifact.capturedAt);
  const capturedOn = australianRegulatorDate(capturedAt);
  const allRaw = boundedRawJsonText(
    artifact.allRecordsResponse,
    "all-record response",
  );
  const currentRaw = boundedRawJsonText(
    artifact.currentRecordsResponse,
    "current-record response",
  );
  const all = parseListing(
    allRaw,
    "all-record response",
    CREDITEX_CEC_BATTERY_ALL_MINIMUM_RECORDS,
  );
  const current = parseListing(
    currentRaw,
    "current-record response",
    CREDITEX_CEC_BATTERY_CURRENT_MINIMUM_RECORDS,
  );
  if (current.size > all.size) {
    return sourceError("current-record count exceeds all-record count");
  }

  for (const [identity, currentRecord] of current) {
    const allRecord = all.get(identity);
    if (!allRecord || allRecord.fingerprint !== currentRecord.fingerprint) {
      return sourceError("current-record data does not reconcile to all records");
    }
    if (
      !currentRecord.cecApproved
      || currentRecord.approvedDate > capturedOn
      || currentRecord.expiredDate < capturedOn
    ) {
      return sourceError("current endpoint contains a non-current certificate");
    }
  }

  const records: CreditexOfficialProductRecord[] = [];
  for (const [identity, record] of all) {
    const isCurrent = current.has(identity);
    if (record.approvedDate > capturedOn) {
      return sourceError("all records contain a future approval");
    }
    if (isCurrent !== record.cecApproved) {
      return sourceError("CECApproved does not reconcile to current endpoint membership");
    }
    records.push(normalizedRecord(record, isCurrent, capturedOn));
  }
  records.sort((left, right) => (
    left.sourceRecordKey < right.sourceRecordKey
      ? -1
      : left.sourceRecordKey > right.sourceRecordKey
        ? 1
        : 0
  ));
  return records;
}
