import { dollarsToCents } from "./trade-quote.ts";
import { normalizeSolarEquipmentItem, type SolarEquipmentItem } from "./trade-solar-equipment.ts";

export type PriceBookSolarPanel = { watts: number; widthM: number; lengthM: number; manufacturer?: string; model?: string;
  datasheetUrl?: string; imageUrl?: string; warrantyYears?: number };

export function parsePriceBookSolarPanel(value: unknown): PriceBookSolarPanel | null {
  if (value === undefined || value === null || value === "" || value === "null") return null;
  let raw: unknown = value;
  if (typeof value === "string") {
    try { raw = JSON.parse(value) as unknown; } catch { throw new Error("INVALID_PRICE_BOOK_SOLAR_PANEL"); }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_PRICE_BOOK_SOLAR_PANEL");
  try {
    const panel = normalizeSolarEquipmentItem({ ...raw, id: "price-book-panel", kind: "panel", name: "Panel", model: "model" in raw ? raw.model || "Panel" : "Panel", quantity: 1 });
    // The normalizer has required these for panel equipment; preserve optional product information only.
    if (panel.watts === undefined || panel.widthM === undefined || panel.lengthM === undefined) throw new Error("INVALID_PRICE_BOOK_SOLAR_PANEL");
    return { watts: panel.watts, widthM: panel.widthM, lengthM: panel.lengthM,
      ...(panel.manufacturer ? { manufacturer: panel.manufacturer } : {}),
      ...("model" in raw && raw.model ? { model: panel.model } : {}), ...(panel.datasheetUrl ? { datasheetUrl: panel.datasheetUrl } : {}),
      ...(panel.imageUrl ? { imageUrl: panel.imageUrl } : {}), ...(panel.warrantyYears === undefined ? {} : { warrantyYears: panel.warrantyYears }) };
  } catch { throw new Error("INVALID_PRICE_BOOK_SOLAR_PANEL"); }
}

export function priceBookSolarEquipment(row: { id: string; name: string; supplierSku?: string; supplierProductId?: string; solarPanel: PriceBookSolarPanel }): SolarEquipmentItem {
  return normalizeSolarEquipmentItem({ ...row.solarPanel, id: row.id, kind: "panel", name: row.name,
    priceBookItemId: row.id,
    model: row.solarPanel.model || row.supplierSku || row.name, manufacturer: row.solarPanel.manufacturer || "", quantity: 1,
    ...(row.supplierProductId ? { catalogueProductId: row.supplierProductId } : {}) });
}

export const PRICE_BOOK_ITEM_TYPES = [
  "labour", "material", "equipment", "subcontractor", "travel", "call_out",
  "disposal", "certificate", "rebate", "discount", "non_billable", "one_off",
] as const;

export type PriceBookItemType = typeof PRICE_BOOK_ITEM_TYPES[number];
export type PriceBookTaxCode = "gst" | "none";

export const PRICE_BOOK_TYPE_LABELS: Record<PriceBookItemType, string> = {
  labour: "Labour",
  material: "Material",
  equipment: "Equipment",
  subcontractor: "Subcontractor",
  travel: "Travel",
  call_out: "Call-out",
  disposal: "Disposal",
  certificate: "Certificate",
  rebate: "Rebate",
  discount: "Discount",
  non_billable: "Non-billable",
  one_off: "One-off work",
};

export const PRICE_BOOK_UNITS = [
  ["each", "Each"], ["roll", "Roll"], ["pack", "Pack"], ["bag", "Bag"], ["hour", "Hour"], ["day", "Day"], ["metre", "Metre"],
  ["square_metre", "Square metre"], ["kilometre", "Kilometre"], ["visit", "Visit"], ["fixed", "Fixed"],
] as const;

const itemTypes = new Set<string>(PRICE_BOOK_ITEM_TYPES);
const units = new Set<string>(PRICE_BOOK_UNITS.map(([value]) => value));
const taxCodes = new Set<string>(["gst", "none"]);

function roundRatioHalfAwayFromZero(numerator: bigint, denominator: bigint) {
  const negative = numerator < BigInt(0);
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / BigInt(2)) / denominator;
  return Number(negative ? -rounded : rounded);
}

export function calculatePriceBookRates(costCents: number, sellCents: number) {
  if (!Number.isSafeInteger(costCents) || costCents < 0 || !Number.isSafeInteger(sellCents)) throw new Error("INVALID_PRICE_BOOK_MONEY");
  const grossProfitCents = sellCents - costCents;
  const markupBasisPoints = costCents > 0 && sellCents > 0
    ? roundRatioHalfAwayFromZero(BigInt(grossProfitCents) * BigInt(10_000), BigInt(costCents)) : 0;
  const marginBasisPoints = sellCents > 0
    ? roundRatioHalfAwayFromZero(BigInt(grossProfitCents) * BigInt(10_000), BigInt(sellCents)) : 0;
  return { grossProfitCents, markupBasisPoints, marginBasisPoints };
}

export function priceBookQuoteLineType(itemType: PriceBookItemType): "product" | "labour" | "adjustment" {
  if (["certificate", "rebate", "discount", "non_billable"].includes(itemType)) return "adjustment";
  if (["labour", "subcontractor", "travel", "call_out", "disposal", "one_off"].includes(itemType)) return "labour";
  return "product";
}

export function priceBookItemAllowsNegativeSellPrice(itemType: PriceBookItemType) {
  return itemType === "certificate" || itemType === "rebate" || itemType === "discount";
}

export function priceBookItemRequiresZeroSupplierCost(itemType: PriceBookItemType) {
  return priceBookItemAllowsNegativeSellPrice(itemType);
}

export function normalisePriceBookCategory(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_PRICE_BOOK_CATEGORY");
  const category = value.trim().replace(/\s+/gu, " ");
  if (category.length > 80 || /[\u0000-\u001f\u007f]/u.test(category)) throw new Error("INVALID_PRICE_BOOK_CATEGORY");
  return category;
}

export function normalisePriceBookInput(raw: Record<string, unknown>, clean: (value: unknown, length: number) => string) {
  const itemType = clean(raw.itemType, 30) as PriceBookItemType;
  const name = clean(raw.name, 140);
  const description = clean(raw.description, 500);
  const unitLabelInput = clean(raw.unitLabel, 30);
  const unitLabel = units.has(unitLabelInput) ? unitLabelInput : "each";
  const taxCode = clean(raw.taxCode, 20) as PriceBookTaxCode;
  if (!itemTypes.has(itemType) || !name || !taxCodes.has(taxCode)) throw new Error("INVALID_PRICE_BOOK_ITEM");

  const supplierCostCentsExGst = dollarsToCents(raw.supplierCost || "0");
  const allowNegative = priceBookItemAllowsNegativeSellPrice(itemType);
  const sellPriceCentsExGst = dollarsToCents(raw.sellPrice, allowNegative);
  if (allowNegative && sellPriceCentsExGst >= 0) throw new Error("INVALID_PRICE_BOOK_ADJUSTMENT");
  if (!allowNegative && itemType !== "non_billable" && sellPriceCentsExGst <= 0) throw new Error("INVALID_PRICE_BOOK_SELL_PRICE");
  if (itemType === "non_billable" && sellPriceCentsExGst !== 0) throw new Error("INVALID_PRICE_BOOK_NON_BILLABLE");
  if (allowNegative && supplierCostCentsExGst !== 0) throw new Error("INVALID_PRICE_BOOK_ADJUSTMENT");

  const durationText = String(raw.expectedDurationMinutes ?? "0").trim();
  if (!/^\d{1,5}$/.test(durationText)) throw new Error("INVALID_PRICE_BOOK_DURATION");
  const expectedDurationMinutes = Number(durationText);
  if (expectedDurationMinutes < 0 || expectedDurationMinutes > 10_080) throw new Error("INVALID_PRICE_BOOK_DURATION");
  const solarPanel = Object.hasOwn(raw, "solarPanel") ? parsePriceBookSolarPanel(raw.solarPanel) : undefined;
  if (solarPanel && itemType !== "material" && itemType !== "equipment") throw new Error("INVALID_PRICE_BOOK_SOLAR_PANEL_TYPE");

  return {
    name,
    description,
    itemType,
    ...(Object.hasOwn(raw, "category") ? { category: normalisePriceBookCategory(raw.category) } : {}),
    unitLabel,
    supplierCostCentsExGst,
    sellPriceCentsExGst,
    taxCode,
    ...calculatePriceBookRates(supplierCostCentsExGst, sellPriceCentsExGst),
    expectedDurationMinutes,
    requiredSkill: clean(raw.requiredSkill, 80),
    supplierName: clean(raw.supplierName, 140),
    supplierSku: clean(raw.supplierSku, 100),
    supplierProductId: clean(raw.supplierProductId, 180),
    ...(solarPanel === undefined ? {} : { solarPanel }),
  };
}
