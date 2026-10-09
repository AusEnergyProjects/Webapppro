import type { ProductMeasurement } from "./product-guides";

export type ProductRatingId = "cost" | "efficiency" | "warranty" | "chargingPower";
export type ProductRatingMethod = { id: ProductRatingId; label: string; unit: string; basisId: string; maximum: number; explanation: string };
export type ProductVisualRating = { id: ProductRatingId; label: string; score: number | null; measurement: ProductMeasurement | null; reason: string | null };

const warranty = (maximum: number): ProductRatingMethod => ({ id: "warranty", label: "Parts warranty", unit: "included-product-years", basisId: "included-all-parts", maximum, explanation: `${maximum} years for the shortest listed parts term is the 5-point reference. Usage limits may end cover sooner. This covers the listed product; extra equipment and installation have separate warranties. Included parts can have different terms. Specs shows these and any usage limits.` });
const cost = (unit: string, basisId: string, maximum: number, scale: string): ProductRatingMethod => ({ id: "cost", label: "Cost level", unit, basisId, maximum, explanation: `More bars means higher equipment cost. 0 means $0; ${scale} is the 5-point reference. Published prices include GST, before rebates and installation. Match the model and included equipment.` });
const efficiency = (unit: string, basisId: string, maximum: number, explanation: string): ProductRatingMethod => ({ id: "efficiency", label: "Energy efficiency", unit, basisId, maximum, explanation });

const METHODS: Record<string, ProductRatingMethod[]> = {
  solar: [cost("aud-per-w", "panel-unit-gst", 1, "$1 per panel watt"), efficiency("panel-efficiency-percent", "panel-stc", 25, "25% panel efficiency is the 5-point reference under standard laboratory conditions. This measures panel output for its area, not your annual solar yield."), warranty(30)],
  inverters: [cost("aud-per-kw", "inverter-unit-gst", 1000, "$1,000 per kW of inverter output"), efficiency("weighted-efficiency-percent", "inverter-european-weighted", 100, "100% European-weighted conversion efficiency is the 5-point reference. Peak-only figures are not substituted. Small differences stay small."), warranty(15)],
  batteries: [cost("aud-per-kwh", "complete-battery-system-gst-no-rebate", 1500, "$1,500 per usable kWh"), efficiency("ac-round-trip-percent", "battery-ac-round-trip", 100, "100% whole-system efficiency charging and discharging is the 5-point reference. Battery-only DC figures are not substituted."), warranty(15)],
  "hot-water": [cost("aud-system", "hot-water-unit-gst", 6000, "$6,000 for the unit"), efficiency("cop-a20-w15-55", "cop-a20-w15-55", 5, "Five units of heat per unit of electricity is the 5-point reference at the same published test conditions: air 20°C dry/15°C wet, water 15 to 55°C. Other test points are not substituted."), warranty(7)],
  "air-conditioning": [cost("aud-system", "single-ac-pair-gst", 4000, "$4,000 for the indoor and outdoor pair"), efficiency("zoned-heating-stars", "mixed-climate-heating-stars", 10, "10 official heating stars is the 5-point reference for the exact indoor/outdoor pair in the mixed climate zone. Compare similar sizes. Other climates and family-best ratings are not substituted."), warranty(7)],
  "multi-split": [cost("aud-system", "multi-split-kit-gst", 10000, "$10,000 for the complete equipment combination"), efficiency("zoned-heating-stars", "mixed-climate-heating-stars", 10, "10 official heating stars is the 5-point reference for the exact indoor/outdoor combination in the mixed climate zone. A multi-room system may not carry this label; that leaves this bar unscored."), warranty(7)],
  "ev-chargers": [cost("aud-system", "ev-charger-unit-gst", 3000, "$3,000 for the charger and its included cable"), { id: "chargingPower", label: "Charging power", unit: "ev-ac-kw", basisId: "ev-ac-rated-output", maximum: 22, explanation: "22 kW is the 5-point reference for rated AC charging power. Your car's onboard charger, electrical supply and installation can limit actual speed. This is not an efficiency rating or a promise of faster charging." }, warranty(5)],
};

export function productRatingMethods(category: string): ProductRatingMethod[] {
  const methods = METHODS[category];
  if (!methods) throw new Error(`Unknown product rating category: ${category}`);
  return methods;
}

export function calculateProductRating(method: ProductRatingMethod, measurement: ProductMeasurement | null | undefined): ProductVisualRating {
  if (!measurement) return { id: method.id, label: method.label, score: null, measurement: null, reason: "No comparable published figure" };
  if (!Number.isFinite(measurement.value) || measurement.value < 0 || !measurement.variant.trim() || !measurement.basis.trim() || !/^https:\/\//.test(measurement.sourceUrl)) throw new Error(`Invalid ${method.id} product measurement`);
  if (measurement.unit !== method.unit || measurement.basisId !== method.basisId) return { id: method.id, label: method.label, score: null, measurement, reason: "Different measurement or package basis" };
  const score = Math.round(Math.min(5, measurement.value / method.maximum * 5) * 10) / 10;
  return { id: method.id, label: method.label, score, measurement, reason: null };
}
