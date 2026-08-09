import type {
  CreditexOfficialProductRecord,
} from "./creditex-official-product-registry.ts";

export const CREDITEX_TESSA_PRODUCT_REGISTRY_CODE =
  "nsw-tessa-products" as const;
export const CREDITEX_TESSA_PRODUCT_SOURCE_KEY =
  "nsw-tessa-accepted-water-heaters" as const;
export const CREDITEX_TESSA_PRODUCT_MINIMUM_RECORDS = 500;
export const CREDITEX_TESSA_PRODUCT_MAXIMUM_RECORDS = 20_000;
export const CREDITEX_TESSA_PRODUCT_MAXIMUM_BYTES = 10_000_000;

export const CREDITEX_TESSA_PRODUCT_EXPORT_HEADER = [
  "Accepted Product ID",
  "Product Type",
  "Method(s)",
  "Activity Definition",
  "Effective From",
  "Effective To",
  "Brand",
  "Model Number",
  "AS/NZS4234 version",
  "Zone 3 System Size",
  "Zone 3 Peak Load (MJ/day)\u00a0",
  "Zone 3 Annual Energy Savings %",
  "Zone 3 Bs (GJ/year)\u00a0",
  "Zone 3 Be (GJ/year)",
  "Zone 3 HPelec (GJ/year)",
  "Zone 3 HPgas (GJ/year)",
  "Zone 3 RefElec (GJ/year)",
  "Zone 5 System Size\u00a0",
  "Zone 5 Peak Load (MJ/day)\u00a0",
  "Zone 5 Annual Energy Savings %\u00a0",
  "Zone 5 Bs (GJ/year)\u00a0",
  "Zone 5 Be (GJ/year)",
  "Zone 5 HPelec (GJ/year)",
  "Zone 5 HPgas (GJ/year)",
  "Zone 5 RefElec (GJ/year)",
  "No. of hot water tank(s) ",
  "Tank Model Number\u00a0",
  "Tank Size (L)\u00a0",
  "Pre-heat tank model number(s)",
  "Finishing tank model number(s)\u00a0",
  "Pre-heat tank volume (L)\u00a0",
  "Finishing tank volume (L)\u00a0",
  "Total system tank volume (L)\u00a0",
  "Collector Type",
  "Collector Model Number",
  "No. of collectors",
  "No. of  heat pump(s)",
  "Heat pump unit model number(s)\u00a0",
  "Total heat pump thermal capacity (kW)\u00a0",
  "System booster type\u00a0",
  "Booster model number(s)\u00a0",
  "Total thermal capacity (kW)",
  "System Type",
  "Refrigerant type (GWP)",
  "Refrigerant charge (kg)",
  "Limitations",
  "Status",
] as const;

const CSV_CONTENT_TYPES = new Set(["text/csv"]);
const ACCEPTED_PRODUCT_ID = /^ACC\d{7,12}$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;
const SOURCE_DATE = /^(\d{2})-(\d{2})-(\d{4})$/;
const ACTIVITY = /^D(?:17|18|19|20)$/;
const MAXIMUM_CELL_CHARACTERS = 100_000;

type CsvRow = readonly string[];
type CsvRecord = Readonly<Record<
  typeof CREDITEX_TESSA_PRODUCT_EXPORT_HEADER[number],
  string
>>;

function sourceError(message: string): never {
  throw new Error(`TESSA accepted-product source invalid: ${message}`);
}

function parseCsv(text: string): readonly CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  const pushField = () => {
    if (field.length > MAXIMUM_CELL_CHARACTERS) {
      sourceError("a CSV cell exceeds its reviewed length");
    }
    row.push(field);
    field = "";
    closedQuote = false;
  };
  const pushRow = () => {
    pushField();
    if (
      row.length !== CREDITEX_TESSA_PRODUCT_EXPORT_HEADER.length
      || row.every((value) => value === "")
    ) {
      sourceError(`CSV row ${rows.length + 1} has an invalid column count`);
    }
    rows.push(row);
    row = [];
    if (rows.length > CREDITEX_TESSA_PRODUCT_MAXIMUM_RECORDS + 1) {
      sourceError("CSV exceeds the official export row limit");
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') {
        field += character;
        continue;
      }
      if (text[index + 1] === '"') {
        field += '"';
        index += 1;
        continue;
      }
      quoted = false;
      closedQuote = true;
      continue;
    }
    if (closedQuote && character !== "," && character !== "\r" && character !== "\n") {
      sourceError("CSV contains text after a closing quote");
    }
    if (character === '"') {
      if (field !== "" || closedQuote) {
        sourceError("CSV contains a quote inside an unquoted field");
      }
      quoted = true;
      continue;
    }
    if (character === ",") {
      pushField();
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushRow();
      continue;
    }
    field += character;
  }
  if (quoted) sourceError("CSV contains an unclosed quoted field");
  if (field !== "" || row.length > 0 || closedQuote) pushRow();
  return rows;
}

function exactHeader(row: CsvRow) {
  if (
    row.length !== CREDITEX_TESSA_PRODUCT_EXPORT_HEADER.length
    || row.some(
      (value, index) => value !== CREDITEX_TESSA_PRODUCT_EXPORT_HEADER[index],
    )
  ) {
    sourceError("CSV header schema changed");
  }
}

function recordFromRow(row: CsvRow): CsvRecord {
  return Object.fromEntries(
    CREDITEX_TESSA_PRODUCT_EXPORT_HEADER.map((header, index) => [
      header,
      row[index],
    ]),
  ) as CsvRecord;
}

function boundedText(
  value: string,
  label: string,
  maximum: number,
  required = false,
) {
  const text = value.trim();
  if (
    (required && !text)
    || text.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) {
    sourceError(`${label} is outside its reviewed text contract`);
  }
  return text;
}

function optionalNumber(value: string, label: string) {
  const text = value.trim();
  if (!text) return null;
  if (!DECIMAL.test(text)) sourceError(`${label} is not a reviewed decimal`);
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < -1_000_000_000 || parsed > 1_000_000_000) {
    sourceError(`${label} is outside its reviewed numeric range`);
  }
  return parsed;
}

function sourceDate(value: string, label: string, required: boolean) {
  const text = value.trim();
  if (!text && !required) return "";
  const match = SOURCE_DATE.exec(text);
  if (!match) sourceError(`${label} is not a DD-MM-YYYY date`);
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    sourceError(`${label} is not a calendar date`);
  }
  return iso;
}

function acceptedActivities(value: string) {
  const text = boundedText(value, "Activity Definition", 100, true);
  const values = text.split(",").map((item) => item.trim());
  if (
    values.length < 1
    || values.length > 4
    || new Set(values).size !== values.length
    || values.some((item) => !ACTIVITY.test(item))
  ) {
    sourceError("Activity Definition contains an unsupported activity set");
  }
  return values;
}

function optionalSystemSize(value: string, label: string) {
  const text = boundedText(value, label, 20);
  if (text && text !== "Small" && text !== "Medium") {
    sourceError(`${label} contains an unsupported system size`);
  }
  return text;
}

function rowRecord(row: CsvRecord, index: number): CreditexOfficialProductRecord {
  const rowLabel = `row ${index + 2}`;
  const sourceRecordKey = boundedText(
    row["Accepted Product ID"],
    `${rowLabel} Accepted Product ID`,
    20,
    true,
  );
  if (!ACCEPTED_PRODUCT_ID.test(sourceRecordKey)) {
    sourceError(`${rowLabel} Accepted Product ID is not a stable TESSA identity`);
  }
  const productType = boundedText(
    row["Product Type"],
    `${rowLabel} Product Type`,
    100,
    true,
  );
  const productKind = productType === "Water Heater - Heat Pump"
    ? "nsw_heat_pump_water_heater" as const
    : productType === "Water Heater - Solar (Electric Boosted)"
      ? "nsw_solar_water_heater" as const
      : sourceError(`${rowLabel} Product Type is outside the D17-D20 contract`);
  const method = boundedText(row["Method(s)"], `${rowLabel} Method(s)`, 50, true);
  if (method !== "HEER") sourceError(`${rowLabel} is not a HEER product`);
  const activities = acceptedActivities(row["Activity Definition"]);
  const status = boundedText(row.Status, `${rowLabel} Status`, 20, true);
  if (status !== "Active" && status !== "Cancelled") {
    sourceError(`${rowLabel} has an unsupported official status`);
  }
  const effectiveFrom = sourceDate(
    row["Effective From"],
    `${rowLabel} Effective From`,
    status === "Active",
  );
  const effectiveTo = sourceDate(
    row["Effective To"],
    `${rowLabel} Effective To`,
    false,
  );
  if (
    status === "Active" && effectiveTo
    || status === "Cancelled" && Boolean(effectiveFrom) !== Boolean(effectiveTo)
    || effectiveFrom && effectiveTo && effectiveTo < effectiveFrom
  ) {
    sourceError(`${rowLabel} has an inconsistent effective-date window`);
  }
  const historicallyAccepted = status === "Active"
    || Boolean(effectiveFrom && effectiveTo);
  const brand = boundedText(row.Brand, `${rowLabel} Brand`, 300, true);
  const model = boundedText(
    row["Model Number"],
    `${rowLabel} Model Number`,
    500,
    true,
  );
  const text = (header: typeof CREDITEX_TESSA_PRODUCT_EXPORT_HEADER[number], maximum = 1_000) => (
    boundedText(row[header], `${rowLabel} ${header}`, maximum)
  );
  const number = (header: typeof CREDITEX_TESSA_PRODUCT_EXPORT_HEADER[number]) => (
    optionalNumber(row[header], `${rowLabel} ${header}`)
  );
  const zone3SystemSize = optionalSystemSize(
    row["Zone 3 System Size"],
    `${rowLabel} Zone 3 System Size`,
  );
  const zone5SystemSize = optionalSystemSize(
    row["Zone 5 System Size\u00a0"],
    `${rowLabel} Zone 5 System Size`,
  );

  return {
    sourceKey: CREDITEX_TESSA_PRODUCT_SOURCE_KEY,
    sourceRecordKey,
    productKind,
    manufacturer: brand,
    brand,
    model,
    series: productType,
    registrationNumber: sourceRecordKey,
    certificateNumber: "",
    // A cancelled row with a complete official window remains selectable for
    // an implementation inside that exact historical window. A cancelled row
    // without dates cannot establish an eligibility window and remains
    // retained but blocked.
    approvalStatus: historicallyAccepted ? "approved" : "not_approved",
    eligibleFrom: effectiveFrom,
    eligibleTo: effectiveTo,
    availableInAustralia: historicallyAccepted,
    attributes: {
      tessaAcceptedProductId: sourceRecordKey,
      tessaProductType: productType,
      tessaMethod: method,
      tessaAcceptedActivities: activities.join(","),
      tessaOfficialStatus: status,
      tessaOfficialEffectiveFrom: effectiveFrom,
      tessaOfficialEffectiveTo: effectiveTo,
      asNzs4234Version: text("AS/NZS4234 version", 20),
      zone3SystemSize: zone3SystemSize || null,
      zone3PeakLoadMjPerDay: number("Zone 3 Peak Load (MJ/day)\u00a0"),
      zone3AnnualEnergySavingsPercent: number("Zone 3 Annual Energy Savings %"),
      zone3BsGjPerYear: number("Zone 3 Bs (GJ/year)\u00a0"),
      zone3BeGjPerYear: number("Zone 3 Be (GJ/year)"),
      zone3HpElecGjPerYear: number("Zone 3 HPelec (GJ/year)"),
      zone3HpGasGjPerYear: number("Zone 3 HPgas (GJ/year)"),
      zone3RefElecGjPerYear: number("Zone 3 RefElec (GJ/year)"),
      zone5SystemSize: zone5SystemSize || null,
      zone5PeakLoadMjPerDay: number("Zone 5 Peak Load (MJ/day)\u00a0"),
      zone5AnnualEnergySavingsPercent: number("Zone 5 Annual Energy Savings %\u00a0"),
      zone5BsGjPerYear: number("Zone 5 Bs (GJ/year)\u00a0"),
      zone5BeGjPerYear: number("Zone 5 Be (GJ/year)"),
      zone5HpElecGjPerYear: number("Zone 5 HPelec (GJ/year)"),
      zone5HpGasGjPerYear: number("Zone 5 HPgas (GJ/year)"),
      zone5RefElecGjPerYear: number("Zone 5 RefElec (GJ/year)"),
      numberOfHotWaterTanks: number("No. of hot water tank(s) "),
      tankModelNumber: text("Tank Model Number\u00a0"),
      tankSizeLitres: number("Tank Size (L)\u00a0"),
      preHeatTankModelNumbers: text("Pre-heat tank model number(s)"),
      finishingTankModelNumbers: text("Finishing tank model number(s)\u00a0"),
      preHeatTankVolumeLitres: number("Pre-heat tank volume (L)\u00a0"),
      finishingTankVolumeLitres: number("Finishing tank volume (L)\u00a0"),
      totalSystemTankVolumeLitres: number("Total system tank volume (L)\u00a0"),
      collectorType: text("Collector Type"),
      collectorModelNumber: text("Collector Model Number"),
      numberOfCollectors: number("No. of collectors"),
      numberOfHeatPumps: number("No. of  heat pump(s)"),
      heatPumpUnitModelNumbers: text("Heat pump unit model number(s)\u00a0"),
      totalHeatPumpThermalCapacityKw: number("Total heat pump thermal capacity (kW)\u00a0"),
      systemBoosterType: text("System booster type\u00a0"),
      boosterModelNumbers: text("Booster model number(s)\u00a0"),
      totalThermalCapacityKw: number("Total thermal capacity (kW)"),
      systemType: text("System Type"),
      refrigerantType: text("Refrigerant type (GWP)"),
      refrigerantChargeKg: number("Refrigerant charge (kg)"),
      limitations: text("Limitations", 10_000),
    },
  };
}

export function parseCreditexTessaAcceptedProductCsv(
  bytes: Uint8Array,
  contentType: string,
): readonly CreditexOfficialProductRecord[] {
  const normalizedContentType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (!CSV_CONTENT_TYPES.has(normalizedContentType)) {
    sourceError("export content type changed");
  }
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 1
    || bytes.byteLength > CREDITEX_TESSA_PRODUCT_MAXIMUM_BYTES
  ) {
    sourceError("export byte count is outside its reviewed range");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return sourceError("export is not UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff) {
    return sourceError("export unexpectedly contains a byte-order mark");
  }
  const roundTrip = new TextEncoder().encode(text);
  if (
    roundTrip.byteLength !== bytes.byteLength
    || roundTrip.some((byte, index) => byte !== bytes[index])
  ) {
    sourceError("export has an unsupported byte representation");
  }
  const rows = parseCsv(text);
  if (
    rows.length < CREDITEX_TESSA_PRODUCT_MINIMUM_RECORDS + 1
    || rows.length > CREDITEX_TESSA_PRODUCT_MAXIMUM_RECORDS + 1
  ) {
    sourceError("export record count is outside its reviewed range");
  }
  exactHeader(rows[0]);
  const records = rows.slice(1).map((row, index) => (
    rowRecord(recordFromRow(row), index)
  ));
  const identities = new Set<string>();
  for (const record of records) {
    if (identities.has(record.sourceRecordKey)) {
      sourceError("export contains a duplicate Accepted Product ID");
    }
    identities.add(record.sourceRecordKey);
  }
  records.sort((left, right) => left.sourceRecordKey.localeCompare(
    right.sourceRecordKey,
  ));
  return records;
}
