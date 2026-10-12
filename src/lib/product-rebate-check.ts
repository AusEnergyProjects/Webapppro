export const CURRENT_HOT_WATER_SYSTEM_OPTIONS = [
  { value: "electric-storage", label: "Electric hot-water tank" },
  { value: "gas-lpg", label: "Gas hot water (mains or bottled gas)" },
  { value: "heat-pump", label: "Heat-pump hot water" },
  { value: "solar-hot-water", label: "Solar hot water (panels heat the water)" },
  { value: "new-installation", label: "No existing hot-water system" },
  { value: "not-sure", label: "I'm not sure" },
] as const;

export type CurrentHotWaterSystem = typeof CURRENT_HOT_WATER_SYSTEM_OPTIONS[number]["value"];
export const CURRENT_HEATING_SYSTEM_OPTIONS = [
  { value: "electric-room", label: "Fixed electric room heater; no air conditioner", scenario: "i" },
  { value: "electric-room-with-ac", label: "Fixed electric room heater and air conditioner, both being removed", scenario: "ii" },
  { value: "central-electric", label: "Central electric or electric underfloor heating; no air conditioner", scenario: "iii" },
  { value: "central-electric-with-ac", label: "Central electric or electric underfloor heating and air conditioner, both being removed", scenario: "iv" },
  { value: "ducted-reverse-cycle", label: "Ducted air conditioner that heats and cools", scenario: "v" },
  { value: "room-reverse-cycle", label: "Room air conditioner that heats and cools", scenario: "vi" },
  { value: "ducted-gas", label: "Ducted gas heating; no air conditioner", scenario: "vii" },
  { value: "ducted-gas-with-ac", label: "Ducted gas heating and air conditioner, both being removed", scenario: "viii" },
  { value: "room-gas", label: "Room gas heater; no air conditioner", scenario: "ix" },
  { value: "room-gas-with-ac", label: "Room gas heater and air conditioner, both being removed", scenario: "x" },
  { value: "no-removal", label: "Adding air conditioning without removing any existing equipment", scenario: "xi" },
  { value: "not-sure", label: "I'm not sure", scenario: null },
] as const;
export type ProductRebateCategory = "hot-water" | "air-conditioning" | "multi-split";
export type CurrentHeatingSystem = typeof CURRENT_HEATING_SYSTEM_OPTIONS[number]["value"];
export type CurrentRebateSystem = CurrentHotWaterSystem | CurrentHeatingSystem;
export function currentRebateSystemOptions(category: ProductRebateCategory) {
  return category === "hot-water" ? CURRENT_HOT_WATER_SYSTEM_OPTIONS : CURRENT_HEATING_SYSTEM_OPTIONS;
}
export function heatingVeuScenario(currentSystem: CurrentRebateSystem) {
  return CURRENT_HEATING_SYSTEM_OPTIONS.find(option => option.value === currentSystem)?.scenario ?? null;
}
export type ProductRebateCheckRequest = {
  productId: string;
  postcode: string;
  suburb: string;
  state: string;
  installationDate: string;
  currentSystem: CurrentRebateSystem;
};
export type RebateSource = { title: string; url: string; version?: string };
export type ProductCertificateValue = {
  status: "current" | "stale" | "unavailable";
  grossValueCents: number | null;
  unitPriceCents: number | null;
  tradedOn: string | null;
  checkedAt: string | null;
  sourceUrl: string;
  estimatedValueCents: number | null;
  registrationFeeCents: number | null;
  allowancePercent: 10 | null;
  allowanceCents: number | null;
  feeSourceUrl: string | null;
  feeCheckedOn: string | null;
  estimateAsOf: string | null;
  note: string;
};
export type ProductRebateProgramResult = {
  program: "sres" | "veu" | "solar-victoria";
  label: string;
  status: "calculated" | "potential" | "not-applicable" | "not-confirmed";
  quantity: number | null;
  unit: "STC" | "VEEC" | null;
  maximumAmountAud: number | null;
  summary: string;
  conditions: string[];
  sources: RebateSource[];
  matchedModel: string | null;
  sourceCheckedAt: string | null;
  receiptHash: string | null;
  issueCode: string | null;
  retryable: boolean;
  certificateValue: ProductCertificateValue | null;
};
export type ProductRebateCheckResult = {
  ok: true;
  productId: string;
  productName: string;
  category: ProductRebateCategory;
  checkedAt: string;
  location: { postcode: string; suburb: string; state: string };
  installationDate: string;
  currentSystem: CurrentRebateSystem;
  results: ProductRebateProgramResult[];
};

export class ProductRebateCheckError extends Error {
  readonly code = "PRODUCT_REBATE_REQUEST_INVALID";
  readonly status = 400;
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > maximum) {
    throw new ProductRebateCheckError(`Choose a valid ${label}.`);
  }
  return value;
}

export function parseProductRebateCheckRequest(value: unknown): ProductRebateCheckRequest {
  if (!isRecord(value)) {
    throw new ProductRebateCheckError("Send a valid rebate check.");
  }
  const allowed = ["productId", "postcode", "suburb", "state", "installationDate", "currentSystem"];
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new ProductRebateCheckError("The rebate check contains missing or unsupported fields.");
  }
  const { productId, postcode, suburb, state, installationDate, currentSystem } = value;
  const exactPostcode = requiredText(postcode, "postcode", 4);
  if (!/^\d{4}$/.test(exactPostcode)) throw new ProductRebateCheckError("Enter a four-digit postcode.");
  const exactState = requiredText(state, "state or territory", 3);
  if (!["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].includes(exactState)) {
    throw new ProductRebateCheckError("Choose a valid state or territory.");
  }
  const exactDate = requiredText(installationDate, "installation date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exactDate) || !Number.isFinite(Date.parse(exactDate))
      || new Date(exactDate).toISOString().slice(0, 10) !== exactDate) {
    throw new ProductRebateCheckError("Choose a real installation date.");
  }
  const option = [...CURRENT_HOT_WATER_SYSTEM_OPTIONS, ...CURRENT_HEATING_SYSTEM_OPTIONS].find(option => option.value === currentSystem);
  if (!option) throw new ProductRebateCheckError("Choose your current hot-water or heating system.");
  return {
    productId: requiredText(productId, "product", 100), postcode: exactPostcode,
    suburb: requiredText(suburb, "suburb", 100), state: exactState,
    installationDate: exactDate, currentSystem: option.value,
  };
}

/** Match an authored exact identity, preserving model suffixes and electrical variants. */
export function exactRebateIdentity(left: string, right: string): boolean {
  return left.trim().toLocaleUpperCase("en-AU") === right.trim().toLocaleUpperCase("en-AU");
}

export function hotWaterVeuActivity(currentSystem: CurrentRebateSystem): "1D" | "3C" | null {
  if (currentSystem === "electric-storage") return "1D";
  if (currentSystem === "gas-lpg") return "3C";
  return null;
}

export function wholeCertificateQuantity(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error("The governed calculator returned an invalid certificate quantity.");
  }
  return Number(value);
}

export type ProductRebateLocalitiesResult = { ok: true; localities: Array<{ suburb: string; state: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function nullableCents(value: unknown): boolean {
  return value === null || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function nullableDate(value: unknown): boolean {
  return value === null || typeof value === "string" && Number.isFinite(Date.parse(value))
    && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) === value);
}
function isCertificateValue(value: unknown): value is ProductCertificateValue {
  if (!isRecord(value)) return false;
  return ["current", "stale", "unavailable"].includes(String(value.status))
    && [value.grossValueCents, value.unitPriceCents, value.estimatedValueCents, value.registrationFeeCents, value.allowanceCents].every(nullableCents)
    && [value.tradedOn, value.checkedAt, value.feeSourceUrl, value.feeCheckedOn, value.estimateAsOf].every(nullableString)
    && [value.tradedOn, value.checkedAt, value.feeCheckedOn, value.estimateAsOf].every(nullableDate)
    && typeof value.sourceUrl === "string" && /^https:\/\//.test(value.sourceUrl)
    && (value.feeSourceUrl === null || /^https:\/\//.test(String(value.feeSourceUrl)))
    && (value.allowancePercent === null || value.allowancePercent === 10)
    && typeof value.note === "string"
    && (value.status === "unavailable" ? [value.grossValueCents, value.unitPriceCents, value.tradedOn, value.checkedAt, value.estimatedValueCents, value.registrationFeeCents, value.allowancePercent, value.allowanceCents, value.feeSourceUrl, value.feeCheckedOn, value.estimateAsOf].every(field => field === null)
      : value.grossValueCents !== null && typeof value.unitPriceCents === "number" && value.unitPriceCents > 0 && value.tradedOn !== null && value.checkedAt !== null)
    && (value.status === "current" || value.estimatedValueCents === null)
    && (value.estimatedValueCents === null ? [value.registrationFeeCents, value.allowancePercent, value.allowanceCents, value.feeSourceUrl, value.feeCheckedOn, value.estimateAsOf].every(field => field === null)
      : typeof value.grossValueCents === "number" && typeof value.registrationFeeCents === "number" && value.allowancePercent === 10 && typeof value.allowanceCents === "number" && value.feeSourceUrl !== null && value.feeCheckedOn !== null && value.estimateAsOf !== null
        && value.estimatedValueCents === value.grossValueCents - value.registrationFeeCents - value.allowanceCents);
}
function isProgramResult(value: unknown): value is ProductRebateProgramResult {
  if (!isRecord(value)) return false;
  return ["sres", "veu", "solar-victoria"].includes(String(value.program))
    && typeof value.label === "string"
    && ["calculated", "potential", "not-applicable", "not-confirmed"].includes(String(value.status))
    && (value.quantity === null || (typeof value.quantity === "number" && Number.isSafeInteger(value.quantity) && value.quantity >= 0))
    && (value.unit === null || value.unit === "STC" || value.unit === "VEEC")
    && (value.maximumAmountAud === null || (typeof value.maximumAmountAud === "number" && Number.isFinite(value.maximumAmountAud) && value.maximumAmountAud >= 0))
    && typeof value.summary === "string" && strings(value.conditions)
    && Array.isArray(value.sources) && value.sources.every(source => isRecord(source)
      && typeof source.title === "string" && typeof source.url === "string" && /^https:\/\//.test(source.url)
      && (source.version === undefined || typeof source.version === "string"))
    && nullableString(value.matchedModel) && nullableString(value.sourceCheckedAt) && nullableString(value.receiptHash)
    && nullableString(value.issueCode) && typeof value.retryable === "boolean"
    && (value.certificateValue === null || value.status === "calculated" && isCertificateValue(value.certificateValue))
    && (!isRecord(value.certificateValue) || value.certificateValue.grossValueCents === null || typeof value.quantity === "number" && typeof value.certificateValue.unitPriceCents === "number" && value.certificateValue.grossValueCents === value.quantity * value.certificateValue.unitPriceCents)
    && (value.quantity === null ? value.unit === null : value.status === "calculated" && value.unit !== null)
    && (value.maximumAmountAud === null || value.status === "potential");
}

export function isProductRebateCheckResult(value: unknown): value is ProductRebateCheckResult {
  if (!isRecord(value) || !isRecord(value.location)) return false;
  return value.ok === true && typeof value.productId === "string" && typeof value.productName === "string"
    && typeof value.checkedAt === "string" && typeof value.installationDate === "string"
    && typeof value.location.postcode === "string" && typeof value.location.suburb === "string" && typeof value.location.state === "string"
    && (value.category === "hot-water" || value.category === "air-conditioning" || value.category === "multi-split")
    && currentRebateSystemOptions(value.category).some(option => option.value === value.currentSystem)
    && Array.isArray(value.results) && value.results.every(isProgramResult)
    && (value.category === "hot-water"
      ? value.results.length === 3 && new Set(value.results.map(result => result.program)).size === 3
      : value.results.length === 1 && value.results[0].program === "veu");
}

export function readProductRebateCheckResult(value: unknown): ProductRebateCheckResult {
  if (!isProductRebateCheckResult(value)) throw new Error("The rebate check returned an invalid response. Try again.");
  return value;
}

export function readProductRebateLocalities(value: unknown): ProductRebateLocalitiesResult {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.localities)
      || !value.localities.every(locality => isRecord(locality) && typeof locality.suburb === "string" && typeof locality.state === "string")) {
    throw new Error("The suburb lookup returned an invalid response. Try again.");
  }
  return { ok: true, localities: value.localities.map(locality => ({ suburb: locality.suburb, state: locality.state })) };
}
