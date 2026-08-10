import {
  CER_ASHP_POSTCODE_ZONE_RANGES,
  CER_PV_POSTCODE_ZONE_RANGES,
  CER_SWH_POSTCODE_ZONE_RANGES,
} from "../data/cer-sres-postcode-zones.ts";

export const CREDITEX_SRES_REGISTRY_CONTRACT =
  "creditex-sres-official-registry/v1";
export const CER_SRES_REGISTRY_REVIEWED_ON = "2026-08-10";
export const CER_SRES_REGISTER_REVIEWED_VERSION = 58;
export const CER_SRES_REGISTER_REVIEWED_PUBLISHED_ON = "2026-08-10";
export const CER_SRES_REGISTER_RELEASE_URL =
  "https://cer.gov.au/news-and-media/news/2026/august/register-solar-water-heaters-version-58-now-available";
export const CER_SRES_PRODUCT_REGISTER_URL =
  "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-water-heaters/register-solar-water-heaters";
export const CER_SRES_POSTCODE_ZONE_URL =
  "https://cer.gov.au/document/postcode-zones-solar-water-heaters-and-heat-pumps";
export const CER_SRES_POSTCODE_ZONE_SHA256 =
  "eddfe37821c6beb69d58c81c4bee92c061f5b80f29746fefbeb3c123c03de1ec";
export const CER_SRES_PV_POSTCODE_ZONE_URL =
  "https://cer.gov.au/document/postcode-zone-ratings-and-zones-solar-panel-systems";
export const CER_SRES_PV_POSTCODE_ZONE_SHA256 =
  "58cd05502692011b22b314f48be673e80a74e7775d569aa2989a956968dc72e3";

export const CER_SRES_REFERENCE_SOURCES = [
  {
    sourceKey: "cer-swh-ashp-postcode-zones",
    url: CER_SRES_POSTCODE_ZONE_URL,
    expectedContentType: "application/pdf",
    expectedSha256: CER_SRES_POSTCODE_ZONE_SHA256,
  },
  {
    sourceKey: "cer-pv-postcode-zones",
    url: CER_SRES_PV_POSTCODE_ZONE_URL,
    expectedContentType: "application/pdf",
    expectedSha256: CER_SRES_PV_POSTCODE_ZONE_SHA256,
  },
] as const;

export const CER_SRES_PRODUCT_SOURCES = [
  {
    sourceKey: "cer-ashp",
    technology: "air_source_heat_pump",
    category: "capacity_at_most_425l",
    url: "https://cer.gov.au/document/air-source-heat-pump-models",
    registerMetadataUrl:
      "https://cer.gov.au/document/air-source-heat-pump-models-0",
    expectedColumns: 10,
    minimumRecords: 1_178,
    reviewedRelease: {
      version: CER_SRES_REGISTER_REVIEWED_VERSION,
      publishedOn: CER_SRES_REGISTER_REVIEWED_PUBLISHED_ON,
      recordCount: 1_178,
      csvSha256:
        "b764b58c6717a82563da6db498e03c9e63940de35865e483f6395e33ac12916b",
      workbookSha256:
        "12c9b300992d29c88a35e0a70c486ebff862fa8e5febdd6576000c3f9045e241",
    },
  },
  {
    sourceKey: "cer-swh-lt-700l",
    technology: "solar_water_heater",
    category: "capacity_less_than_700l",
    url: "https://cer.gov.au/document/solar-water-heater-models-capacity-less-700l",
    registerMetadataUrl:
      "https://cer.gov.au/document/solar-water-heater-models-capacity-less-700l-0",
    expectedColumns: 9,
    minimumRecords: 6_591,
    reviewedRelease: {
      version: CER_SRES_REGISTER_REVIEWED_VERSION,
      publishedOn: CER_SRES_REGISTER_REVIEWED_PUBLISHED_ON,
      recordCount: 6_591,
      csvSha256:
        "c93c34b33011f0688d09cdb9278f563a782c06464ddb9abed96aa870b6078c9b",
      workbookSha256:
        "f43cd02ac317d61a44683dd382883b9ca09dbf800666af5365c0852daf31f8a5",
    },
  },
  {
    sourceKey: "cer-swh-ge-700l",
    technology: "solar_water_heater",
    category: "capacity_at_least_700l",
    url: "https://cer.gov.au/document/solar-water-heater-models-capacity-more-700l",
    registerMetadataUrl:
      "https://cer.gov.au/document/solar-water-heater-models-capacity-more-700l-0",
    expectedColumns: 9,
    minimumRecords: 8_989,
    reviewedRelease: {
      version: CER_SRES_REGISTER_REVIEWED_VERSION,
      publishedOn: CER_SRES_REGISTER_REVIEWED_PUBLISHED_ON,
      recordCount: 8_989,
      csvSha256:
        "95162d637f75ae5b94b1a687c262f503c897607f5143ba03a1f3bc88b3659903",
      workbookSha256:
        "cb27f9a0546f80e8ea9d0e04449e8f5953ead5d27193473149bb7f2fa8edf179",
    },
  },
] as const;

export type CerSresProductSource = typeof CER_SRES_PRODUCT_SOURCES[number];
export type CerSresReferenceSource = typeof CER_SRES_REFERENCE_SOURCES[number];
export type CerSresRegisteredTechnology =
  | "air_source_heat_pump"
  | "solar_water_heater";
export type CerSresPostcodeTechnology =
  | CerSresRegisteredTechnology
  | "solar_pv";

export type CerSresProductRecord = {
  sourceRecordKey: string;
  sourceItem: string;
  technology: CerSresRegisteredTechnology;
  category: string;
  brand: string;
  model: string;
  eligibleFrom: string;
  eligibleTo: string;
  zone1Stcs: number | null;
  zone2Stcs: number | null;
  zone3Stcs: number | null;
  zone4Stcs: number | null;
  zone5Stcs: number | null;
};

export type CerSresPostcodeResolution = {
  postcode: string;
  technology: CerSresPostcodeTechnology;
  zone: number;
  rating: "1.622" | "1.536" | "1.382" | "1.185" | null;
  sourceUrl: string;
  sourceVersion: string;
  sourceSha256: string;
};

export class CreditexSresRegistryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreditexSresRegistryError";
    this.code = code;
    this.status = status;
  }
}

function fail(code: string, status: number, message: string): never {
  throw new CreditexSresRegistryError(code, status, message);
}

function sortedRanges<T extends readonly [number, number, ...unknown[]]>(
  ranges: readonly T[],
) {
  return [...ranges].sort((left, right) => left[0] - right[0]);
}

export function validateCerSresPostcodeRanges() {
  const zonedRangeSets: readonly [
    label: string,
    ranges: readonly (readonly [number, number, number])[],
    maximumZone: number,
  ][] = [
    ["air-source heat pump", CER_ASHP_POSTCODE_ZONE_RANGES, 5],
    ["solar water heater", CER_SWH_POSTCODE_ZONE_RANGES, 4],
  ];
  for (const [label, ranges, maximumZone] of zonedRangeSets) {
    const sorted = sortedRanges(ranges);
    let previousTo = -1;
    for (const [from, to, zone] of sorted) {
      if (
        !Number.isInteger(from)
        || !Number.isInteger(to)
        || !Number.isInteger(zone)
        || from < 0
        || to > 9_999
        || from > to
        || zone < 1
        || zone > maximumZone
        || from <= previousTo
      ) {
        throw new Error(`Invalid or overlapping CER ${label} postcode range.`);
      }
      previousTo = to;
    }
  }

  const pv = sortedRanges(CER_PV_POSTCODE_ZONE_RANGES);
  let expectedFrom = 0;
  for (const [from, to, zone, rating] of pv) {
    if (
      from !== expectedFrom
      || from > to
      || zone < 1
      || zone > 4
      || ([null, "1.622", "1.536", "1.382", "1.185"] as const)[zone]
        !== rating
    ) {
      throw new Error("Invalid CER solar PV postcode zone transcription.");
    }
    expectedFrom = to + 1;
  }
  if (expectedFrom !== 10_000) {
    throw new Error("CER solar PV postcode zones do not cover 0000 to 9999.");
  }
  return true;
}

validateCerSresPostcodeRanges();

function postcodeNumber(value: unknown) {
  const postcode = String(value || "").trim();
  if (!/^\d{4}$/.test(postcode)) {
    fail(
      "SRES_POSTCODE_INVALID",
      400,
      "Enter a four digit Australian installation postcode.",
    );
  }
  return { postcode, number: Number(postcode) };
}

export function resolveCerSresPostcode(
  technology: CerSresPostcodeTechnology,
  value: unknown,
): CerSresPostcodeResolution {
  const postcode = postcodeNumber(value);
  if (technology === "solar_pv") {
    const range = CER_PV_POSTCODE_ZONE_RANGES.find(
      ([from, to]) => postcode.number >= from && postcode.number <= to,
    );
    if (!range) {
      return fail(
        "SRES_POSTCODE_ZONE_UNAVAILABLE",
        422,
        "The official solar PV postcode zone could not be resolved.",
      );
    }
    return {
      postcode: postcode.postcode,
      technology,
      zone: range[2],
      rating: range[3],
      sourceUrl: CER_SRES_PV_POSTCODE_ZONE_URL,
      sourceVersion: "effective-2020-01-01",
      sourceSha256: CER_SRES_PV_POSTCODE_ZONE_SHA256,
    };
  }

  const ranges = technology === "air_source_heat_pump"
    ? CER_ASHP_POSTCODE_ZONE_RANGES
    : CER_SWH_POSTCODE_ZONE_RANGES;
  const range = ranges.find(
    ([from, to]) => postcode.number >= from && postcode.number <= to,
  );
  if (!range) {
    return fail(
      "SRES_POSTCODE_ZONE_UNAVAILABLE",
      422,
      "The postcode is not assigned to an official zone for this technology.",
    );
  }
  return {
    postcode: postcode.postcode,
    technology,
    zone: range[2],
    rating: null,
    sourceUrl: CER_SRES_POSTCODE_ZONE_URL,
    sourceVersion: "version-3-effective-2020-01-01",
    sourceSha256: CER_SRES_POSTCODE_ZONE_SHA256,
  };
}

function csvRows(value: string) {
  if (new TextEncoder().encode(value).byteLength > 1_900_000) {
    return fail(
      "SRES_PRODUCT_SOURCE_TOO_LARGE",
      502,
      "The official product source exceeded the controlled size limit.",
    );
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"') {
        if (value[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      if (field) {
        return fail(
          "SRES_PRODUCT_SOURCE_INVALID",
          502,
          "The official product CSV contains an invalid quoted field.",
        );
      }
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      "The official product CSV contains an unterminated quoted field.",
    );
  }
  row.push(field.replace(/\r$/, ""));
  if (row.some((item) => item !== "")) rows.push(row);
  if (rows.length > 12_001) {
    return fail(
      "SRES_PRODUCT_SOURCE_TOO_LARGE",
      502,
      "The official product source exceeded the controlled row limit.",
    );
  }
  return rows;
}

const MONTHS = new Map([
  ["Jan", "01"], ["Feb", "02"], ["Mar", "03"], ["Apr", "04"],
  ["May", "05"], ["Jun", "06"], ["Jul", "07"], ["Aug", "08"],
  ["Sep", "09"], ["Oct", "10"], ["Nov", "11"], ["Dec", "12"],
]);

function cerDate(value: string) {
  const match = /^(\d{2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(value.trim());
  const month = match ? MONTHS.get(match[2]) : "";
  if (!match || !month) {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      "The official product source contains an invalid eligibility date.",
    );
  }
  const date = `${match[3]}-${month}-${match[1]}`;
  if (new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      "The official product source contains an invalid eligibility date.",
    );
  }
  return date;
}

function textField(value: string, label: string, maximum = 200) {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned || cleaned !== value.trim() || cleaned.length > maximum) {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      `The official product source contains an invalid ${label}.`,
    );
  }
  return cleaned;
}

function integerField(value: string, label: string) {
  if (!/^\d+$/.test(value.trim())) {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      `The official product source contains an invalid ${label}.`,
    );
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 1_000_000) {
    return fail(
      "SRES_PRODUCT_SOURCE_INVALID",
      502,
      `The official product source contains an invalid ${label}.`,
    );
  }
  return number;
}

function entitlementField(value: string, label: string) {
  return value.trim() === "NA" ? null : integerField(value, label);
}

const COMMON_HEADERS = [
  "Item",
  "Brand",
  "Model",
  "Eligible from",
  "Eligible to",
  "Number of certificates for an installation in Zone1",
  "Number of certificates for an installation in Zone2",
  "Number of certificates for an installation in Zone3",
  "Number of certificates for an installation in Zone4",
];

export function parseCerSresProductCsv(
  value: string,
  source: CerSresProductSource,
): CerSresProductRecord[] {
  const rows = csvRows(value.replace(/^\uFEFF/, ""));
  const expectedHeaders = source.expectedColumns === 10
    ? [...COMMON_HEADERS, "Number of certificates for an installation in Zone5"]
    : COMMON_HEADERS;
  if (
    !rows.length
    || rows[0].length !== expectedHeaders.length
    || rows[0].some((header, index) => header.trim() !== expectedHeaders[index])
  ) {
    return fail(
      "SRES_PRODUCT_SOURCE_SCHEMA_CHANGED",
      502,
      "The official product CSV columns changed and the refresh was quarantined.",
    );
  }

  const records: CerSresProductRecord[] = [];
  const identities = new Set<string>();
  for (const [offset, row] of rows.slice(1).entries()) {
    if (row.length !== expectedHeaders.length) {
      return fail(
        "SRES_PRODUCT_SOURCE_SCHEMA_CHANGED",
        502,
        `The official product CSV row ${offset + 2} has an unexpected column count.`,
      );
    }
    const sourceItem = String(integerField(row[0], "item number"));
    const sourceRecordKey = `${source.sourceKey}:${sourceItem}`;
    if (identities.has(sourceRecordKey)) {
      return fail(
        "SRES_PRODUCT_SOURCE_DUPLICATE",
        502,
        "The official product source contains a duplicate record identity.",
      );
    }
    identities.add(sourceRecordKey);
    const eligibleFrom = cerDate(row[3]);
    const eligibleTo = cerDate(row[4]);
    if (eligibleTo < eligibleFrom) {
      return fail(
        "SRES_PRODUCT_SOURCE_INVALID",
        502,
        "The official product source contains a reversed eligibility period.",
      );
    }
    records.push({
      sourceRecordKey,
      sourceItem,
      technology: source.technology,
      category: source.category,
      brand: textField(row[1], "brand"),
      model: textField(row[2], "model"),
      eligibleFrom,
      eligibleTo,
      zone1Stcs: entitlementField(row[5], "Zone 1 entitlement"),
      zone2Stcs: entitlementField(row[6], "Zone 2 entitlement"),
      zone3Stcs: entitlementField(row[7], "Zone 3 entitlement"),
      zone4Stcs: entitlementField(row[8], "Zone 4 entitlement"),
      zone5Stcs: source.expectedColumns === 10
        ? entitlementField(row[9], "Zone 5 entitlement")
        : null,
    });
  }
  if (records.length < source.minimumRecords) {
    return fail(
      "SRES_PRODUCT_SOURCE_INCOMPLETE",
      502,
      "The official product source returned too few records and was quarantined.",
    );
  }
  return records;
}

export function registeredStcsForZone(
  product: Pick<
    CerSresProductRecord,
    "zone1Stcs" | "zone2Stcs" | "zone3Stcs" | "zone4Stcs" | "zone5Stcs"
  >,
  zone: number,
) {
  const value = [
    product.zone1Stcs,
    product.zone2Stcs,
    product.zone3Stcs,
    product.zone4Stcs,
    product.zone5Stcs,
  ][zone - 1];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return fail(
      "SRES_PRODUCT_ZONE_UNAVAILABLE",
      422,
      "The selected product has no registered entitlement for this postcode zone.",
    );
  }
  return String(value);
}
