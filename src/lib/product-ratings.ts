import type { ProductMeasurement, ProductMeasurementGap } from "./product-guides";

export type ProductRatingId = "cost" | "efficiency" | "warranty" | "chargingPower" | "capacity";
export type ProductRatingMethod = { id: ProductRatingId; label: string; unit: string; basisId: string; maximum: number; explanation: string };
export type ProductRatingExplanation = Pick<ProductRatingMethod, "id" | "label" | "explanation">;
export type ProductVisualRating = { id: ProductRatingId; label: string; score: number | null; measurement: ProductMeasurement | null; reason: string | null; costEvidence?: Pick<ProductMeasurement, "variant" | "sourceUrl" | "checkedAt" | "referenceFor" | "priceEvidence">; unavailableEvidence?: ProductMeasurementGap };

const warranty = (maximum: number): ProductRatingMethod => ({ id: "warranty", label: "Parts warranty", unit: "included-product-years", basisId: "main-product-parts", maximum, explanation: `${maximum} years of main-product parts cover is the 5-point reference. Free registration requirements are shown in Specs; paid extensions are excluded. Accessories, labour and installation may have separate terms. Battery usage limits can end cover sooner; heat-pump component and tank terms are listed separately.` });
const cost = (unit: string, basisId: string, maximum: number): ProductRatingMethod => ({ id: "cost", label: "Cost level", unit, basisId, maximum, explanation: "More bars means higher equipment cost. We research Australian equipment listings and published cost guides, then compare equivalent packages on a fixed scale within this category. A range cost guide uses a named, priced model from the same range; other sizes or configurations may cost differently. Specs identifies the reference. Dollar amounts are withheld because installation, rebates, inclusions and the trade's service change your quote. This is a relative guide, not an installed-price estimate." });
const efficiency = (unit: string, basisId: string, maximum: number, explanation: string): ProductRatingMethod => ({ id: "efficiency", label: "Energy efficiency", unit, basisId, maximum, explanation });
const capacity = (label: string, unit: string, basisId: string, maximum: number, explanation: string): ProductRatingMethod => ({ id: "capacity", label, unit, basisId, maximum, explanation });

const METHODS: Record<string, ProductRatingMethod[]> = {
  solar: [cost("aud-per-w", "panel-unit-gst", 1), efficiency("panel-efficiency-percent", "panel-stc", 25, "25% panel efficiency is the 5-point reference under standard laboratory conditions. This measures panel output for its area, not your annual solar yield."), warranty(30)],
  inverters: [cost("aud-per-kw", "inverter-unit-gst", 1000), efficiency("peak-efficiency-percent", "inverter-peak-solar-grid", 100, "100% peak solar-to-grid conversion is the 5-point reference. These are the maker's best test-condition figures, not annual savings. European-weighted, CEC-weighted and battery-path figures are listed separately where available; they are not mixed into this bar. Small differences stay small."), warranty(15)],
  batteries: [cost("aud-per-kwh", "complete-battery-system-gst-no-rebate", 1500), capacity("Usable storage", "usable-kwh", "battery-usable-storage", 40, "40 usable kWh is the 5-point reference. More storage can run appliances for longer, but is not automatically better value. Compare the listed module count and choose capacity for your usage; backup power is a separate figure in Specs."), warranty(15)],
  "hot-water": [cost("aud-system", "hot-water-unit-gst", 6000), capacity("Tank size", "tank-litres", "hot-water-tank-volume", 400, "400 litres is the 5-point reference. This is the published tank volume, not an efficiency rating or a promise of how many showers. Larger tanks need more space. Household use and reheating speed also matter."), warranty(7)],
  "air-conditioning": [cost("aud-system", "single-ac-pair-gst", 4000), efficiency("zoned-heating-stars", "mixed-climate-heating-stars", 10, "10 official heating stars is the 5-point reference for the exact indoor/outdoor pair in the mixed climate zone. Compare similar sizes. Other climates and family-best ratings are not substituted."), warranty(7)],
  "multi-split": [cost("aud-system", "multi-split-kit-gst", 10000), capacity("Cooling capacity", "cooling-kw", "multi-split-rated-cooling", 20, "20 kW of rated cooling is the 5-point reference. This is the system's simultaneous output, not the sum of indoor-unit labels or an efficiency score. The installer needs to size each room and check the exact supported combination."), warranty(7)],
  "ev-chargers": [cost("aud-system", "ev-charger-unit-gst", 3000), { id: "chargingPower", label: "Charging power", unit: "ev-ac-kw", basisId: "ev-ac-rated-output", maximum: 22, explanation: "22 kW is the 5-point reference for rated AC charging power. Your car's onboard charger, electrical supply and installation can limit actual speed. This is not an efficiency rating or a promise of faster charging." }, warranty(5)],
};

export function productRatingMethods(category: string): ProductRatingMethod[] {
  const methods = METHODS[category];
  if (!methods) throw new Error(`Unknown product rating category: ${category}`);
  return methods;
}

// Equipment prices support the relative bar on the server, never a public quote anchor.
export function publicProductRating(rating: ProductVisualRating): ProductVisualRating {
  if (rating.id !== "cost") return rating;
  const evidence = rating.measurement;
  return { id: rating.id, label: rating.label, score: rating.score, measurement: null, reason: rating.reason, ...(rating.unavailableEvidence ? { unavailableEvidence: rating.unavailableEvidence } : {}), ...(evidence ? { costEvidence: { variant: evidence.variant, sourceUrl: evidence.sourceUrl, checkedAt: evidence.checkedAt, ...(evidence.referenceFor ? { referenceFor: evidence.referenceFor } : {}), ...(evidence.priceEvidence ? { priceEvidence: evidence.priceEvidence } : {}) } } : {}) };
}

export function calculateProductRating(method: ProductRatingMethod, measurement: ProductMeasurement | null | undefined, gap?: ProductMeasurementGap): ProductVisualRating {
  if (gap && (!gap.reason.trim() || !/^https:\/\//.test(gap.sourceUrl) || measurement)) throw new Error(`Invalid ${method.id} measurement gap`);
  if (!measurement) return { id: method.id, label: method.label, score: null, measurement: null, reason: gap?.reason ?? "No comparable published figure", ...(gap ? { unavailableEvidence: gap } : {}) };
  if (!Number.isFinite(measurement.value) || measurement.value < 0 || !measurement.variant.trim() || !measurement.basis.trim() || !/^https:\/\//.test(measurement.sourceUrl)) throw new Error(`Invalid ${method.id} product measurement`);
  if (measurement.referenceFor !== undefined && (method.id !== "cost" || !measurement.referenceFor.trim())) throw new Error(`Invalid ${method.id} product cost reference`);
  if (measurement.priceEvidence !== undefined && (method.id !== "cost" || measurement.priceEvidence !== "published-guide")) throw new Error(`Invalid ${method.id} price evidence`);
  if (measurement.unit !== method.unit || measurement.basisId !== method.basisId) return { id: method.id, label: method.label, score: null, measurement, reason: "Different measurement or package basis" };
  const score = Math.round(Math.min(5, measurement.value / method.maximum * 5) * 10) / 10;
  return { id: method.id, label: method.label, score, measurement, reason: null };
}
