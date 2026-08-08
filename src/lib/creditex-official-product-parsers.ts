import type {
  OfficialProductKind,
  OfficialProductSource,
} from "./creditex-official-product-sources";
import {
  CREDITEX_OFFICIAL_PRODUCT_SOURCE_CONTRACT,
} from "./creditex-official-product-sources.ts";

export type OfficialProductAttribute = string | number | boolean | null;

export type OfficialProductRecord = Readonly<{
  sourceKey: string;
  sourceRecordKey: string;
  productKind: OfficialProductKind;
  manufacturer: string | null;
  brand: string | null;
  model: string;
  series: string | null;
  registrationNumber: string | null;
  certificateNumber: string | null;
  approvalStatus: string;
  eligibleFrom: string | null;
  eligibleTo: string | null;
  availableInAustralia: boolean | null;
  attributes: Readonly<Record<string, OfficialProductAttribute>>;
}>;

export type ParseOfficialProductSourceOptions = Readonly<{
  previousRecordCount?: number;
}>;

export class CreditexOfficialProductSourceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "CreditexOfficialProductSourceError";
    this.code = code;
    this.status = status;
  }
}

function sourceError(
  code: string,
  source: OfficialProductSource,
  message: string,
  status = 422,
): CreditexOfficialProductSourceError {
  return new CreditexOfficialProductSourceError(
    code,
    `${source.sourceKey}: ${message}`,
    status,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAttribute(value: unknown): value is OfficialProductAttribute {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function decodeSource(
  source: OfficialProductSource,
  bytes: Uint8Array,
): string {
  if (!(bytes instanceof Uint8Array)) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_BYTES_INVALID",
      source,
      "source body must be a Uint8Array",
      400,
    );
  }
  if (bytes.byteLength === 0) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_EMPTY",
      source,
      "source body is empty",
    );
  }
  if (bytes.byteLength > source.maxBytes) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_TOO_LARGE",
      source,
      `source body is ${bytes.byteLength} bytes; maximum is ${source.maxBytes}`,
      413,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_ENCODING_INVALID",
      source,
      "source body is not valid UTF-8",
    );
  }
}

function validateContentType(
  source: OfficialProductSource,
  contentType: string,
): void {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (!mediaType || !source.expectedContentTypes.includes(mediaType)) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_CONTENT_TYPE_CHANGED",
      source,
      `received content type ${JSON.stringify(contentType)}`,
    );
  }
}

function assertCount(
  source: OfficialProductSource,
  count: number,
  options: ParseOfficialProductSourceOptions,
): void {
  if (count < source.minimumRecords) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_COUNT_BELOW_MINIMUM",
      source,
      `received ${count} records; controlled minimum is ${source.minimumRecords}`,
    );
  }
  if (count > source.maximumRecords) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_COUNT_ABOVE_MAXIMUM",
      source,
      `received ${count} records; controlled maximum is ${source.maximumRecords}`,
    );
  }
  if (options.previousRecordCount !== undefined) {
    if (
      !Number.isSafeInteger(options.previousRecordCount)
      || options.previousRecordCount < 0
    ) {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_PREVIOUS_COUNT_INVALID",
        source,
        "previousRecordCount must be a non-negative safe integer",
        400,
      );
    }
    if (count < options.previousRecordCount) {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_COUNT_REGRESSION",
        source,
        `received ${count} records; previous accepted source had ${options.previousRecordCount}`,
      );
    }
  }
}

function forEachCsvRow(
  source: OfficialProductSource,
  text: string,
  visitRow: (row: readonly string[], rowIndex: number) => void,
): number {
  let row: string[] = [];
  let rowCount = 0;
  let field = "";
  let inQuotes = false;
  let quotedFieldClosed = false;
  let endedWithRecordSeparator = false;

  const pushField = () => {
    row.push(field);
    field = "";
    quotedFieldClosed = false;
  };
  const appendFieldCharacter = (character: string, offset: number) => {
    if (character === "\0") {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_CSV_MALFORMED",
        source,
        `NUL character at offset ${offset}`,
      );
    }
    field += character;
    if (field.length > 100_000) {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_CSV_MALFORMED",
        source,
        "CSV field exceeds 100,000 characters",
      );
    }
  };
  const pushRow = () => {
    pushField();
    if (rowCount > source.maximumRecords) {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_COUNT_ABOVE_MAXIMUM",
        source,
        `CSV exceeds controlled maximum of ${source.maximumRecords} data records`,
      );
    }
    visitRow(row, rowCount);
    rowCount += 1;
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    endedWithRecordSeparator = false;
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          appendFieldCharacter('"', index);
          index += 1;
        } else {
          inQuotes = false;
          quotedFieldClosed = true;
        }
      } else {
        appendFieldCharacter(character, index);
      }
      continue;
    }
    if (quotedFieldClosed && character !== "," && character !== "\r" && character !== "\n") {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_CSV_MALFORMED",
        source,
        `unexpected character after closing quote at offset ${index}`,
      );
    }
    if (character === '"') {
      if (field.length !== 0) {
        throw sourceError(
          "OFFICIAL_PRODUCT_SOURCE_CSV_MALFORMED",
          source,
          `unexpected quote at offset ${index}`,
        );
      }
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      pushField();
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushRow();
      endedWithRecordSeparator = true;
      continue;
    }
    appendFieldCharacter(character, index);
  }
  if (inQuotes) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_CSV_MALFORMED",
      source,
      "unterminated quoted field",
    );
  }
  if (!endedWithRecordSeparator || row.length > 0 || field.length > 0) pushRow();
  return rowCount;
}

function exactFieldsMatch(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function parseIsoDateParts(
  value: string,
): readonly [year: number, month: number, day: number] | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  const australian = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (australian) {
    return [Number(australian[3]), Number(australian[2]), Number(australian[1])];
  }
  return null;
}

function normalizeDate(
  source: OfficialProductSource,
  fieldName: string,
  value: OfficialProductAttribute | undefined,
  required: boolean,
): string | null {
  if (value === null || value === undefined || value === "") {
    if (!required) return null;
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_DATE_MISSING",
      source,
      `${fieldName} is required`,
    );
  }
  if (typeof value !== "string") {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_DATE_INVALID",
      source,
      `${fieldName} must be a date string`,
    );
  }
  const dateParts = parseIsoDateParts(value.trim());
  if (!dateParts) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_DATE_INVALID",
      source,
      `${fieldName} has unsupported date ${JSON.stringify(value)}`,
    );
  }
  const [year, month, day] = dateParts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_DATE_INVALID",
      source,
      `${fieldName} has invalid calendar date ${JSON.stringify(value)}`,
    );
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function optionalText(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
  fieldName: string,
): string | null {
  const value = attributes[fieldName];
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_FIELD_INVALID",
      source,
      `${fieldName} must be text`,
    );
  }
  const cleaned = value.trim();
  return cleaned || null;
}

function requiredText(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
  fieldName: string,
): string {
  const value = optionalText(source, attributes, fieldName);
  if (!value) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_IDENTITY_MISSING",
      source,
      `${fieldName} is required`,
    );
  }
  return value;
}

function createSourceRecordKey(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
): string {
  const identity = source.identityFields.map((fieldName) => {
    const value = attributes[fieldName];
    if (value === null || value === undefined || String(value).trim() === "") {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_IDENTITY_MISSING",
        source,
        `${fieldName} is required for the stable source key`,
      );
    }
    const rawValue = String(value);
    return `${rawValue.length}:${rawValue}`;
  });
  return `${source.sourceKey}:${identity.join("|")}`;
}

function recordTextMapping(source: OfficialProductSource): Readonly<{
  manufacturerField: string | null;
  brandField: string | null;
  modelField: string;
  seriesField: string | null;
  registrationNumberField: string | null;
  certificateNumberField: string | null;
}> {
  switch (source.productKind) {
    case "solar_pv_module":
      return {
        manufacturerField: "Licensee/Certificate Holder",
        brandField: null,
        modelField: "Model Number",
        seriesField: null,
        registrationNumberField: null,
        certificateNumberField: null,
      };
    case "solar_inverter":
      return {
        manufacturerField: "Manufacturer",
        brandField: null,
        modelField: "Model Number",
        seriesField: "Series",
        registrationNumberField: null,
        certificateNumberField: null,
      };
    case "solar_battery":
      return {
        manufacturerField: "Manufacturer/Certificate Holder Account",
        brandField: "Brand Name",
        modelField: "Model Number",
        seriesField: "Series",
        registrationNumberField: null,
        certificateNumberField: null,
      };
    case "air_conditioner":
      return {
        manufacturerField: null,
        brandField: "Brand",
        modelField: "Model_No",
        seriesField: "Family Name",
        registrationNumberField: "Registration Number",
        certificateNumberField: null,
      };
    case "electric_water_heater":
      return {
        manufacturerField: null,
        brandField: "Brand",
        modelField: "Model No",
        seriesField: "Family Name",
        registrationNumberField: "Registration Number",
        certificateNumberField: null,
      };
    case "gas_water_heater":
    case "close_control_air_conditioner":
      return {
        manufacturerField: null,
        brandField: "Brand",
        modelField: "Model Number",
        seriesField: "Family Name",
        registrationNumberField: "Registration Number",
        certificateNumberField: null,
      };
    case "household_refrigerator_freezer":
    case "clothes_dryer":
    case "electric_motor":
    case "commercial_refrigerator":
      return {
        manufacturerField: null,
        brandField: "Brand",
        modelField: "Model No",
        seriesField: "Family Name",
        registrationNumberField: "Registration Number",
        certificateNumberField: null,
      };
    case "television":
    case "chiller":
      return {
        manufacturerField: null,
        brandField: "Brand_Reg",
        modelField: "Model_No",
        seriesField: "Family Name",
        registrationNumberField: "Registration Number",
        certificateNumberField: null,
      };
    case "pool_pump":
      return {
        manufacturerField: null,
        brandField: "Brand",
        modelField: "Model",
        seriesField: null,
        registrationNumberField: "Registration Number",
        certificateNumberField: null,
      };
  }
}

function marketAvailabilityField(source: OfficialProductSource): string {
  switch (source.productKind) {
    case "television":
    case "chiller":
      return "SoldIn";
    case "pool_pump":
      return "Available";
    default:
      return "Sold_in";
  }
}

function australiaAvailability(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
): boolean | null {
  if (source.registryCode === "cer-cec-products") return true;
  const soldIn = optionalText(
    source,
    attributes,
    marketAvailabilityField(source),
  );
  if (!soldIn) return null;
  return soldIn.split(",").some((country) => country.trim() === "Australia");
}

const UNAVAILABLE_NUMBERS = new Set([
  "",
  "-",
  "n/a",
  "na",
  "none",
  "not applicable",
]);

function optionalNumber(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
  fieldName: string,
  divisor = 1,
): number | null {
  const rawValue = attributes[fieldName];
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue === "boolean") {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_NUMBER_INVALID",
      source,
      `${fieldName} must be numeric`,
    );
  }
  if (
    typeof rawValue === "string"
    && UNAVAILABLE_NUMBERS.has(rawValue.trim().toLowerCase())
  ) return null;
  const parsed = typeof rawValue === "number"
    ? rawValue
    : Number(rawValue.trim());
  if (!Number.isFinite(parsed)) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_NUMBER_INVALID",
      source,
      `${fieldName} has non-numeric value ${JSON.stringify(rawValue)}`,
    );
  }
  return parsed / divisor;
}

function requiredNumber(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
  fieldName: string,
): number {
  const value = optionalNumber(source, attributes, fieldName);
  if (value === null) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_NUMBER_MISSING",
      source,
      `${fieldName} is required`,
    );
  }
  return value;
}

function firstNumber(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
  candidates: readonly Readonly<{ fieldName: string; divisor?: number }>[],
): number | null {
  for (const candidate of candidates) {
    const value = optionalNumber(
      source,
      attributes,
      candidate.fieldName,
      candidate.divisor,
    );
    if (value !== null) return value;
  }
  return null;
}

function airConditionerFormulaAttributes(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
): Readonly<Record<string, OfficialProductAttribute>> {
  const mappedFields: readonly Readonly<{
    normalized: string;
    raw: string;
  }>[] = [
    { normalized: "residentialTcspfCold", raw: "Residential TCSPF_cold" },
    { normalized: "residentialTcspfMixed", raw: "Residential TCSPF_mixed" },
    { normalized: "residentialTcspfHot", raw: "Residential TCSPF_hot" },
    { normalized: "commercialTcspfCold", raw: "Commercial TCSPF_cold" },
    { normalized: "commercialTcspfMixed", raw: "Commercial TCSPF_mixed" },
    { normalized: "commercialTcspfHot", raw: "Commercial TCSPF_hot" },
    { normalized: "residentialCoolingEnergyColdKwh", raw: "Residential tcec_cold" },
    { normalized: "residentialCoolingEnergyMixedKwh", raw: "Residential tcec_mixed" },
    { normalized: "residentialCoolingEnergyHotKwh", raw: "Residential tcec_hot" },
    { normalized: "commercialCoolingEnergyColdKwh", raw: "Commercial tcec_cold" },
    { normalized: "commercialCoolingEnergyMixedKwh", raw: "Commercial tcec_mixed" },
    { normalized: "commercialCoolingEnergyHotKwh", raw: "Commercial tcec_hot" },
    { normalized: "coolingStarCold", raw: "c_star_cold" },
    { normalized: "coolingStarMixed", raw: "c_star_mixed" },
    { normalized: "coolingStarHot", raw: "c_star_hot" },
    { normalized: "residentialHspfCold", raw: "Residential HSPF_cold" },
    { normalized: "residentialHspfMixed", raw: "Residential HSPF_mixed" },
    { normalized: "residentialHspfHot", raw: "Residential HSPF_hot" },
    { normalized: "commercialHspfCold", raw: "Commercial HSPF_cold" },
    { normalized: "commercialHspfMixed", raw: "Commercial HSPF_mixed" },
    { normalized: "commercialHspfHot", raw: "Commercial HSPF_hot" },
    { normalized: "residentialHeatingEnergyColdKwh", raw: "Residential thec_cold" },
    { normalized: "residentialHeatingEnergyMixedKwh", raw: "Residential thec_mixed" },
    { normalized: "residentialHeatingEnergyHotKwh", raw: "Residential thec_hot" },
    { normalized: "commercialHeatingEnergyColdKwh", raw: "Commercial thec_cold" },
    { normalized: "commercialHeatingEnergyMixedKwh", raw: "Commercial thec_mixed" },
    { normalized: "commercialHeatingEnergyHotKwh", raw: "Commercial thec_hot" },
    { normalized: "heatingStarCold", raw: "h_star_cold" },
    { normalized: "heatingStarMixed", raw: "h_star_mixed" },
    { normalized: "heatingStarHot", raw: "h_star_hot" },
    { normalized: "residentialCoolingEnergyColdWithWaterKwh", raw: "Residential tcec_cold with water" },
    { normalized: "residentialCoolingEnergyMixedWithWaterKwh", raw: "Residential tcec_mixed with water" },
    { normalized: "residentialCoolingEnergyHotWithWaterKwh", raw: "Residential tcec_hot with water" },
  ];
  const normalized: Record<string, OfficialProductAttribute> = {
    ratedCoolingCapacityKw: firstNumber(source, attributes, [
      { fieldName: "Rated Total Cool Capacity W", divisor: 1_000 },
      { fieldName: "C-Total Cool Rated" },
    ]),
    ratedHeatingCapacityKw: firstNumber(source, attributes, [
      { fieldName: "Rated Heating Capacity watts", divisor: 1_000 },
      { fieldName: "H-Total Heat Rated" },
    ]),
    aeeR: optionalNumber(source, attributes, "Rated AEER"),
    acop: optionalNumber(source, attributes, "Rated ACOP"),
    ratedCoolingInputKw: optionalNumber(
      source,
      attributes,
      "Rated cooling power input kW",
    ),
  };
  for (const field of mappedFields) {
    normalized[field.normalized] = optionalNumber(source, attributes, field.raw);
  }
  return normalized;
}

function motorLoadCoverage(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
  fieldName: string,
): Readonly<{ at75Percent: boolean | null; at100Percent: boolean | null }> {
  const value = optionalText(source, attributes, fieldName);
  if (value === null || UNAVAILABLE_NUMBERS.has(value.toLowerCase())) {
    return { at75Percent: null, at100Percent: null };
  }
  if (value === "75") return { at75Percent: true, at100Percent: false };
  if (value === "100") return { at75Percent: false, at100Percent: true };
  if (value.toLowerCase() === "both") {
    return { at75Percent: true, at100Percent: true };
  }
  throw sourceError(
    "OFFICIAL_PRODUCT_SOURCE_FIELD_INVALID",
    source,
    `${fieldName} must be 75, 100, Both, or unavailable`,
  );
}

function motorFormulaAttributes(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
): Readonly<Record<string, OfficialProductAttribute>> {
  const highEfficiencyLoad = motorLoadCoverage(
    source,
    attributes,
    "High_eff_load",
  );
  const mepsComplianceLoad = motorLoadCoverage(
    source,
    attributes,
    "MEPS_compl_load",
  );
  return {
    ratedOutputKw: optionalNumber(source, attributes, "kWatt"),
    efficiencyAt50Percent: optionalNumber(source, attributes, "Eff50"),
    efficiencyAt75Percent: optionalNumber(source, attributes, "Eff75"),
    efficiencyAtFullLoad: optionalNumber(source, attributes, "EffFL"),
    numberOfPoles: optionalNumber(source, attributes, "NumPls"),
    fullLoadTorqueNm: optionalNumber(source, attributes, "Torque_FL"),
    highEfficiencyCompliant: yesNoWithQualifiedYes(
      source,
      attributes,
      "High_eff_compl",
    ),
    highEfficiencyAt75Percent: highEfficiencyLoad.at75Percent,
    highEfficiencyAt100Percent: highEfficiencyLoad.at100Percent,
    mepsApplicable: optionalText(source, attributes, "MEPS_Applic"),
    mepsCompliantAt75Percent: mepsComplianceLoad.at75Percent,
    mepsCompliantAt100Percent: mepsComplianceLoad.at100Percent,
  };
}

function formulaAttributes(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
): Readonly<Record<string, OfficialProductAttribute>> {
  switch (source.productKind) {
    case "solar_pv_module":
      return { ratedPowerW: null };
    case "solar_inverter":
      return {
        ratedAcOutputKw: requiredNumber(source, attributes, "AC Power (kW)"),
      };
    case "solar_battery":
      return {
        nominalCapacityKwh: requiredNumber(
          source,
          attributes,
          "Nominal Battery Capacity (kWh)",
        ),
        usableCapacityKwh: requiredNumber(
          source,
          attributes,
          "Usable Capacity (kWh)",
        ),
        ratedAcPowerKw: null,
        ratedDcPowerKw: null,
      };
    case "air_conditioner":
      return airConditionerFormulaAttributes(source, attributes);
    case "close_control_air_conditioner":
      return {
        ratedCoolingCapacityKw: optionalNumber(
          source,
          attributes,
          "Cooling Capacity",
        ),
        ratedInputPowerKw: optionalNumber(
          source,
          attributes,
          "Rated Power Input",
        ),
        aeeR: optionalNumber(source, attributes, "EER"),
        ratedHeatingCapacityKw: null,
        acop: null,
      };
    case "electric_water_heater":
      return {
        storageCapacityLitres: optionalNumber(
          source,
          attributes,
          "Gross Store Cap",
        ),
        declaredStandingHeatLossKwhPer24h: optionalNumber(
          source,
          attributes,
          "Decl Stand Heat",
        ),
      };
    case "gas_water_heater":
      return {
        storageCapacityLitres: optionalNumber(
          source,
          attributes,
          "Storage Capacity (Litres)",
        ),
        nominalGasConsumptionMjPerHour: optionalNumber(
          source,
          attributes,
          "Nominal Gas Consumption (MJ/Hour)",
        ),
        nominalDeliveryLitresPerMinuteAt45cRise: optionalNumber(
          source,
          attributes,
          "Nominal Delivery output (x Litres per min. @ 45AdegC rise)",
        ),
        comparativeAnnualEnergyConsumptionMjPerYear: optionalNumber(
          source,
          attributes,
          "Comparative Annual Energy Consumption (MJ/Year)",
        ),
        suitableForSolarBoosting: strictYesNo(
          source,
          attributes,
          "Suitable for Solar boosting",
        ),
      };
    case "household_refrigerator_freezer":
      return {
        labelledEnergyConsumptionKwhPerYear: optionalNumber(
          source,
          attributes,
          "Labelled energy consumption (kWh/year)",
        ),
        starRating: optionalNumber(source, attributes, "Star2009"),
        starRatingIndex: optionalNumber(source, attributes, "SRI2009"),
        refrigeratorGroup: optionalText(source, attributes, "Group"),
        refrigeratorDesignation: optionalText(
          source,
          attributes,
          "Designation",
        ),
        compartmentTypes: optionalText(source, attributes, "CompartType"),
        totalVolumeLitres: optionalNumber(source, attributes, "Tot Vol"),
        freshFoodVolumeLitres: optionalNumber(source, attributes, "FF Vol"),
        freezerVolumeLitres: optionalNumber(source, attributes, "FZ Vol"),
        adjustedVolumeLitres: optionalNumber(
          source,
          attributes,
          "Adjusted volume",
        ),
      };
    case "television":
      return {
        labelledEnergyConsumptionKwhPerYear: optionalNumber(
          source,
          attributes,
          "Labelled energy consumption (kWh/year)",
        ),
        starRating: optionalNumber(source, attributes, "Star2"),
        starRatingIndex: optionalNumber(
          source,
          attributes,
          "Star Rating Index",
        ),
        averageModePowerW: optionalNumber(
          source,
          attributes,
          "Avg_mode_power",
        ),
        screenSizeCm: optionalNumber(source, attributes, "screensize"),
        screenAreaCm2: optionalNumber(source, attributes, "Screen_Area"),
      };
    case "clothes_dryer": {
      const isCombinationWasherDryer = strictYesNo(
        source,
        attributes,
        "Combination",
      );
      return {
        capacityKg: optionalNumber(source, attributes, "Cap"),
        labelledEnergyConsumptionKwhPerYear: optionalNumber(
          source,
          attributes,
          "Labelled energy consumption (kWh/year)",
        ),
        starRating: optionalNumber(source, attributes, "New Star"),
        starRatingIndex: optionalNumber(source, attributes, "New SRI"),
        programTimeMinutes: optionalNumber(source, attributes, "Prog Time"),
        dryerType: optionalText(source, attributes, "Type"),
        isCombinationWasherDryer,
        isStandaloneClothesDryer: isCombinationWasherDryer === null
          ? null
          : !isCombinationWasherDryer,
      };
    }
    case "pool_pump":
      return {
        projectedAnnualEnergyConsumptionKwh: optionalNumber(
          source,
          attributes,
          "Labelled energy consumption (kWh/year)",
        ),
        maximumTestedInputW: optionalNumber(source, attributes, "High"),
        minimumTestedInputW: optionalNumber(source, attributes, "Low"),
        nameplateInputPowerW: optionalNumber(
          source,
          attributes,
          "Nameplate Input Power",
        ),
        inputPowerW: optionalNumber(source, attributes, "Input Power"),
        dailyRunTimeHours: optionalNumber(
          source,
          attributes,
          "Daily Run Time",
        ),
        starRating: optionalNumber(source, attributes, "Star Rating"),
        starRatingIndex: optionalNumber(
          source,
          attributes,
          "Star Rating Index",
        ),
        weightedEnergyFactor: optionalNumber(
          source,
          attributes,
          "Weighted Energy Factor",
        ),
        poolPumpType: optionalText(source, attributes, "Pool Pump Type"),
      };
    case "electric_motor":
      return motorFormulaAttributes(source, attributes);
    case "commercial_refrigerator":
      return {
        totalEnergyConsumptionKwhPer24h: firstNumber(source, attributes, [
          { fieldName: "Total Energy Consumption(kWh/24h)" },
          { fieldName: "total_energy_cons" },
        ]),
        energyEfficiencyIndex: optionalNumber(
          source,
          attributes,
          "Energy Efficiency Index",
        ),
        efficiencyKwhPer24hPerM2: optionalNumber(
          source,
          attributes,
          "Efficiency (kWh/24h/m2)",
        ),
        totalDisplayAreaM2: optionalNumber(
          source,
          attributes,
          "total_dis_area",
        ),
        netVolumeLitres: optionalNumber(source, attributes, "Net Volume"),
        productClassNumber: optionalNumber(
          source,
          attributes,
          "Product Class Number",
        ),
        starRating: optionalNumber(source, attributes, "Star Rating"),
        highEfficiency: strictYesNo(
          source,
          attributes,
          "high_efficiency",
        ),
        cabinetType: optionalText(source, attributes, "Cabinet Type"),
        dutyType: optionalText(source, attributes, "Duty Type"),
      };
    case "chiller":
      return {
        ratedCoolingCapacityKw: optionalNumber(
          source,
          attributes,
          "cooling_capacity",
        ),
        declaredCop: optionalNumber(source, attributes, "Decl_COP"),
        declaredIplv: optionalNumber(source, attributes, "Decl_IPLV"),
        condenserType: optionalText(source, attributes, "condenser_type"),
        standardRating: strictYesNo(
          source,
          attributes,
          "standard_rating",
        ),
        registrationBasis: optionalText(
          source,
          attributes,
          "Registration Basis",
        ),
      };
  }
}

function formulaSourceFields(source: OfficialProductSource): string {
  switch (source.productKind) {
    case "solar_pv_module":
      return "ratedPowerW:not-published";
    case "solar_inverter":
      return "AC Power (kW)";
    case "solar_battery":
      return "Nominal Battery Capacity (kWh)|Usable Capacity (kWh)|ratedAcPowerKw:not-published|ratedDcPowerKw:not-published";
    case "air_conditioner":
      return [
        "Rated Total Cool Capacity W",
        "C-Total Cool Rated",
        "Rated Heating Capacity watts",
        "H-Total Heat Rated",
        "Rated AEER",
        "Rated ACOP",
        "Rated cooling power input kW",
        "Residential TCSPF_cold",
        "Residential TCSPF_mixed",
        "Residential TCSPF_hot",
        "Commercial TCSPF_cold",
        "Commercial TCSPF_mixed",
        "Commercial TCSPF_hot",
        "Residential tcec_cold",
        "Residential tcec_mixed",
        "Residential tcec_hot",
        "Commercial tcec_cold",
        "Commercial tcec_mixed",
        "Commercial tcec_hot",
        "Residential HSPF_cold",
        "Residential HSPF_mixed",
        "Residential HSPF_hot",
        "Commercial HSPF_cold",
        "Commercial HSPF_mixed",
        "Commercial HSPF_hot",
        "Residential thec_cold",
        "Residential thec_mixed",
        "Residential thec_hot",
        "Commercial thec_cold",
        "Commercial thec_mixed",
        "Commercial thec_hot",
        "c_star_cold",
        "c_star_mixed",
        "c_star_hot",
        "h_star_cold",
        "h_star_mixed",
        "h_star_hot",
      ].join("|");
    case "electric_water_heater":
      return "Gross Store Cap|Decl Stand Heat";
    case "gas_water_heater":
      return "Storage Capacity (Litres)|Nominal Gas Consumption (MJ/Hour)|Nominal Delivery output (x Litres per min. @ 45AdegC rise)|Comparative Annual Energy Consumption (MJ/Year)|Suitable for Solar boosting";
    case "close_control_air_conditioner":
      return "Cooling Capacity|Rated Power Input|EER";
    case "household_refrigerator_freezer":
      return "Labelled energy consumption (kWh/year)|Star2009|SRI2009|Group|Designation|CompartType|Tot Vol|FF Vol|FZ Vol|Adjusted volume";
    case "television":
      return "Labelled energy consumption (kWh/year)|Star2|Star Rating Index|Avg_mode_power|screensize|Screen_Area";
    case "clothes_dryer":
      return "Cap|Labelled energy consumption (kWh/year)|New Star|New SRI|Prog Time|Type|Combination";
    case "pool_pump":
      return "Labelled energy consumption (kWh/year)|High|Low|Nameplate Input Power|Input Power|Daily Run Time|Star Rating|Star Rating Index|Weighted Energy Factor|Pool Pump Type";
    case "electric_motor":
      return "kWatt|Eff50|Eff75|EffFL|NumPls|Torque_FL|High_eff_compl|High_eff_load|MEPS_Applic|MEPS_compl_load";
    case "commercial_refrigerator":
      return "Total Energy Consumption(kWh/24h)|total_energy_cons|Energy Efficiency Index|Efficiency (kWh/24h/m2)|total_dis_area|Net Volume|Product Class Number|Star Rating|high_efficiency|Cabinet Type|Duty Type";
    case "chiller":
      return "cooling_capacity|Decl_COP|Decl_IPLV|condenser_type|standard_rating|Registration Basis";
  }
}

function strictYesNo(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
  fieldName: string,
): boolean | null {
  const value = optionalText(source, attributes, fieldName);
  if (value === null) return null;
  if (UNAVAILABLE_NUMBERS.has(value.toLowerCase())) return null;
  if (value === "Yes") return true;
  if (value === "No") return false;
  throw sourceError(
    "OFFICIAL_PRODUCT_SOURCE_FIELD_INVALID",
    source,
    `${fieldName} must be Yes or No`,
  );
}

function yesNoWithQualifiedYes(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
  fieldName: string,
): boolean | null {
  const value = optionalText(source, attributes, fieldName);
  if (value === null) return null;
  if (UNAVAILABLE_NUMBERS.has(value.toLowerCase())) return null;
  if (value === "Yes" || value.startsWith("Yes - ")) return true;
  if (value === "No") return false;
  throw sourceError(
    "OFFICIAL_PRODUCT_SOURCE_FIELD_INVALID",
    source,
    `${fieldName} must be No, Yes, or an official qualified Yes value`,
  );
}

function eligibilityAttributes(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
): Readonly<Record<string, OfficialProductAttribute>> {
  const normalized: Record<string, OfficialProductAttribute> = {
    sourceSchemaVersion: CREDITEX_OFFICIAL_PRODUCT_SOURCE_CONTRACT,
    sourceSchemaKey: `${source.sourceKey}@${source.verifiedAt}`,
    sourceFieldCount: source.expectedFields.length,
    sourceFormulaFields: formulaSourceFields(source),
  };
  if (source.productKind === "solar_pv_module") {
    normalized.fireTested = strictYesNo(source, attributes, "Fire Tested");
  }
  if (source.registryCode === "gems-products") {
    normalized.sourceAvailabilityStatus = optionalText(
      source,
      attributes,
      "Availability Status",
    );
    normalized.sourceSoldIn = optionalText(
      source,
      attributes,
      marketAvailabilityField(source),
    );
    normalized.sourceApplicationStandard = optionalText(
      source,
      attributes,
      "ApplStandard",
    );
    normalized.sourceProductClass = optionalText(
      source,
      attributes,
      "Product Class",
    );
  }
  return normalized;
}

function mapRecord(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
): OfficialProductRecord {
  const fields = recordTextMapping(source);
  const model = requiredText(source, attributes, fields.modelField);
  const status = source.approvalStatusField
    ? requiredText(source, attributes, source.approvalStatusField)
    : "Approved";
  const sourceRecordKey = createSourceRecordKey(source, attributes);
  const requiredEffectiveDates = source.registryCode === "cer-cec-products";
  return Object.freeze({
    sourceKey: source.sourceKey,
    sourceRecordKey,
    productKind: source.productKind,
    manufacturer: fields.manufacturerField
      ? optionalText(source, attributes, fields.manufacturerField)
      : null,
    brand: fields.brandField
      ? optionalText(source, attributes, fields.brandField)
      : null,
    model,
    series: fields.seriesField
      ? optionalText(source, attributes, fields.seriesField)
      : null,
    registrationNumber: fields.registrationNumberField
      ? optionalText(source, attributes, fields.registrationNumberField)
      : null,
    certificateNumber: fields.certificateNumberField
      ? optionalText(source, attributes, fields.certificateNumberField)
      : null,
    approvalStatus: status,
    eligibleFrom: source.eligibleFromField
      ? normalizeDate(
          source,
          source.eligibleFromField,
          attributes[source.eligibleFromField],
          requiredEffectiveDates,
        )
      : null,
    eligibleTo: source.eligibleToField
      ? normalizeDate(
          source,
          source.eligibleToField,
          attributes[source.eligibleToField],
          requiredEffectiveDates,
        )
      : null,
    availableInAustralia: australiaAvailability(source, attributes),
    attributes: Object.freeze({
      ...eligibilityAttributes(source, attributes),
      ...formulaAttributes(source, attributes),
    }),
  });
}

function assertUniqueRecords(
  source: OfficialProductSource,
  records: readonly OfficialProductRecord[],
): void {
  const identities = new Set<string>();
  for (const record of records) {
    if (identities.has(record.sourceRecordKey)) {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_DUPLICATE",
        source,
        `duplicate stable key ${record.sourceRecordKey}`,
      );
    }
    identities.add(record.sourceRecordKey);
  }
}

type ReconciledCkanRow = Readonly<{
  record: OfficialProductRecord;
  payloadSignature: string;
  duplicateDatastoreRowCount: number;
}>;

function encodedAttribute(value: OfficialProductAttribute): string {
  if (value === null) return "z;";
  if (typeof value === "boolean") return value ? "b1;" : "b0;";
  if (typeof value === "number") {
    const text = Object.is(value, -0) ? "-0" : String(value);
    return `n${text.length}:${text}`;
  }
  return `s${value.length}:${value}`;
}

function ckanPayloadSignature(
  source: OfficialProductSource,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
): string {
  const parts: string[] = [];
  for (const fieldName of source.expectedFields) {
    if (fieldName !== "_id") {
      parts.push(encodedAttribute(attributes[fieldName] ?? null));
    }
  }
  return parts.join("");
}

function addReconciledCkanRow(
  source: OfficialProductSource,
  uniqueRows: Map<string, ReconciledCkanRow>,
  attributes: Readonly<Record<string, OfficialProductAttribute>>,
) {
  const sourceRecordKey = createSourceRecordKey(source, attributes);
  const payloadSignature = ckanPayloadSignature(source, attributes);
  const existing = uniqueRows.get(sourceRecordKey);
  if (!existing) {
    uniqueRows.set(sourceRecordKey, {
      record: mapRecord(source, attributes),
      payloadSignature,
      duplicateDatastoreRowCount: 1,
    });
    return;
  }
  if (existing.payloadSignature !== payloadSignature) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_DUPLICATE",
      source,
      `stable key ${sourceRecordKey} has conflicting CKAN rows`,
    );
  }
  uniqueRows.set(sourceRecordKey, {
    record: existing.record,
    payloadSignature: existing.payloadSignature,
    duplicateDatastoreRowCount: existing.duplicateDatastoreRowCount + 1,
  });
}

function reconciledCkanRecords(
  source: OfficialProductSource,
  uniqueRows: ReadonlyMap<string, ReconciledCkanRow>,
) {
  const records = [...uniqueRows.values()].map((row) => {
    const { record } = row;
    if (row.duplicateDatastoreRowCount === 1) return record;
    return Object.freeze({
      ...record,
      attributes: Object.freeze({
        ...record.attributes,
        duplicateDatastoreRowCount: row.duplicateDatastoreRowCount,
      }),
    });
  });
  assertUniqueRecords(source, records);
  return Object.freeze(records);
}

function csvRowAttributes(
  source: OfficialProductSource,
  row: readonly string[],
  rowIndex: number,
) {
  if (row.length !== source.expectedFields.length) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      `CSV row ${rowIndex + 2} has ${row.length} fields; expected ${source.expectedFields.length}`,
    );
  }
  const attributes: Record<string, OfficialProductAttribute> = {};
  source.expectedFields.forEach((fieldName, fieldIndex) => {
    attributes[fieldName] = row[fieldIndex];
  });
  return attributes;
}

function parseCsvSource(
  source: OfficialProductSource,
  text: string,
  options: ParseOfficialProductSourceOptions,
): readonly OfficialProductRecord[] {
  const uniqueRows = source.resourceId
    ? new Map<string, ReconciledCkanRow>()
    : null;
  const records: OfficialProductRecord[] = [];
  let dataRowCount = 0;
  const rowCount = forEachCsvRow(source, text, (row, rowIndex) => {
    if (rowIndex === 0) {
      const header = [...row];
      if (header[0]?.startsWith("\uFEFF")) header[0] = header[0].slice(1);
      if (!exactFieldsMatch(header, source.expectedFields)) {
        throw sourceError(
          "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
          source,
          `CSV fields do not match the controlled schema; received ${JSON.stringify(header)}`,
        );
      }
      return;
    }
    const attributes = csvRowAttributes(source, row, rowIndex - 1);
    dataRowCount += 1;
    if (uniqueRows) {
      addReconciledCkanRow(source, uniqueRows, attributes);
    } else {
      records.push(mapRecord(source, attributes));
    }
  });
  if (rowCount === 0) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_EMPTY",
      source,
      "CSV has no header row",
    );
  }
  assertCount(source, dataRowCount, options);
  if (uniqueRows) return reconciledCkanRecords(source, uniqueRows);
  assertUniqueRecords(source, records);
  return Object.freeze(records);
}

function parseJson(source: OfficialProductSource, text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_JSON_MALFORMED",
      source,
      "source body is not valid JSON",
    );
  }
}

function ckanFieldNames(
  source: OfficialProductSource,
  fields: unknown,
): string[] {
  if (!Array.isArray(fields)) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      "CKAN result.fields is not an array",
    );
  }
  return fields.map((field, index) => {
    if (!isObject(field) || typeof field.id !== "string") {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
        source,
        `CKAN field ${index} has no text id`,
      );
    }
    return field.id;
  });
}

function ckanAttributes(
  source: OfficialProductSource,
  record: unknown,
  rowIndex: number,
): Readonly<Record<string, OfficialProductAttribute>> {
  if (!isObject(record)) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      `CKAN record ${rowIndex} is not an object`,
    );
  }
  const actualFields = Object.keys(record);
  if (
    actualFields.length !== source.expectedFields.length
    || source.expectedFields.some((fieldName) => !Object.hasOwn(record, fieldName))
  ) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      `CKAN record ${rowIndex} does not match the controlled fields`,
    );
  }
  const attributes: Record<string, OfficialProductAttribute> = {};
  for (const fieldName of source.expectedFields) {
    const value = record[fieldName];
    if (!isAttribute(value)) {
      throw sourceError(
        "OFFICIAL_PRODUCT_SOURCE_FIELD_INVALID",
        source,
        `CKAN record ${rowIndex} field ${fieldName} is not a primitive value`,
      );
    }
    attributes[fieldName] = value;
  }
  return attributes;
}

function parseCkanSource(
  source: OfficialProductSource,
  text: string,
  options: ParseOfficialProductSourceOptions,
): readonly OfficialProductRecord[] {
  const document = parseJson(source, text);
  if (!isObject(document) || document.success !== true || !isObject(document.result)) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      "CKAN response is not a successful datastore response",
    );
  }
  const result = document.result;
  if (result.resource_id !== source.resourceId) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_RESOURCE_CHANGED",
      source,
      `CKAN returned resource ${JSON.stringify(result.resource_id)}`,
    );
  }
  const fieldNames = ckanFieldNames(source, result.fields);
  if (!exactFieldsMatch(fieldNames, source.expectedFields)) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      `CKAN fields do not match the controlled schema; received ${JSON.stringify(fieldNames)}`,
    );
  }
  if (!Number.isSafeInteger(result.total) || Number(result.total) < 0) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      "CKAN result.total is not a non-negative safe integer",
    );
  }
  if (!Array.isArray(result.records)) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_SCHEMA_CHANGED",
      source,
      "CKAN result.records is not an array",
    );
  }
  const total = Number(result.total);
  if (result.records.length !== total) {
    throw sourceError(
      "OFFICIAL_PRODUCT_SOURCE_INCOMPLETE",
      source,
      `CKAN response contains ${result.records.length} of ${total} records`,
    );
  }
  assertCount(source, total, options);
  const uniqueRows = new Map<string, ReconciledCkanRow>();
  result.records.forEach((record, index) => {
    const attributes = ckanAttributes(source, record, index + 1);
    addReconciledCkanRow(source, uniqueRows, attributes);
  });
  return reconciledCkanRecords(source, uniqueRows);
}

export function parseOfficialProductSource(
  source: OfficialProductSource,
  bytes: Uint8Array,
  contentType: string,
  options: ParseOfficialProductSourceOptions = {},
): readonly OfficialProductRecord[] {
  validateContentType(source, contentType);
  const text = decodeSource(source, bytes);
  if (source.format === "csv") return parseCsvSource(source, text, options);
  if (source.format === "ckan_datastore_json") {
    return parseCkanSource(source, text, options);
  }
  throw sourceError(
    "OFFICIAL_PRODUCT_SOURCE_FORMAT_UNSUPPORTED",
    source,
    `unsupported format ${String(source.format)}`,
    400,
  );
}
