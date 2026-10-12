import type { ProductMeasurement, ProductMeasurementGap } from "./product-guides";

export type ProductRatingId = "efficiency" | "warranty" | "chargingPower" | "capacity" | "noise" | "recovery";
export type ProductRatingMethod = { id: ProductRatingId; label: string; unit: string; basisId: string; maximum: number; minimum?: number; direction?: "lower"; explanation: string };
export type ProductRatingExplanation = Pick<ProductRatingMethod, "id" | "label" | "explanation">;
export type ProductVisualRating = { id: ProductRatingId; label: string; score: number | null; measurement: ProductMeasurement | null; reason: string | null; unavailableEvidence?: ProductMeasurementGap };

const warranty = (maximum: number): ProductRatingMethod => ({ id: "warranty", label: "Parts warranty", unit: "included-product-years", basisId: "main-product-parts", maximum, explanation: `${maximum} years of main-product parts cover is the 5-point reference. Free registration requirements are shown in Specs; paid extensions are excluded. Accessories, labour and installation may have separate terms. Battery usage limits can end cover sooner; heat-pump component and tank terms are listed separately.` });
const efficiency = (unit: string, basisId: string, maximum: number, explanation: string): ProductRatingMethod => ({ id: "efficiency", label: "Energy efficiency", unit, basisId, maximum, explanation });
const capacity = (label: string, unit: string, basisId: string, maximum: number, explanation: string): ProductRatingMethod => ({ id: "capacity", label, unit, basisId, maximum, explanation });

const METHODS: Record<string, ProductRatingMethod[]> = {
  solar: [efficiency("panel-efficiency-percent", "panel-stc", 25, "25% panel efficiency is the 5-point reference under standard laboratory conditions. This measures panel output for its area, not your annual solar yield."), warranty(30)],
  inverters: [efficiency("peak-efficiency-percent", "inverter-peak-solar-grid", 100, "100% peak solar-to-grid conversion is the 5-point reference. These are the maker's best test-condition figures, not annual savings. European-weighted, CEC-weighted and battery-path figures are listed separately where available; they are not mixed into this bar. Small differences stay small."), warranty(15)],
  batteries: [capacity("Usable storage", "usable-kwh", "battery-usable-storage", 40, "40 usable kWh is the 5-point reference. More storage can run appliances for longer, but is not automatically better value. Compare the listed module count and choose capacity for your usage; backup power is a separate figure in Specs."), warranty(15)],
  "hot-water": [capacity("Tank size", "tank-litres", "hot-water-tank-volume", 400, "400 litres is the 5-point reference. This is the published tank volume, not an efficiency rating or a promise of how many showers. Larger tanks need more space. Household use and reheating speed also matter."), warranty(7),
    { id: "noise", label: "Noise", unit: "published-noise-db", basisId: "published-hot-water-noise", minimum: 35, maximum: 65, direction: "lower", explanation: "More bars means quieter: 35 dB is the 5-point reference and 65 dB is zero. The bar uses the maker- or seller-published number; its source and original measurement conditions are in Specs. Seller figures are labelled separately. This visual scale is not a certification or a measure of how many times louder one unit sounds." },
    { id: "recovery", label: "Reheating speed", unit: "recovery-litres-per-hour", basisId: "hot-water-recovery-rate", maximum: 150, explanation: "More bars means faster reheating. 150 litres per hour is the 5-point reference. Calculated rates use the same 45°C rise in water temperature. Colder air can slow reheating; makers do not all use the same air-temperature test. Separately labelled maker estimates retain their published basis. Original tests and assumptions are in Specs." },
  ],
  "air-conditioning": [efficiency("zoned-heating-stars", "mixed-climate-heating-stars", 10, "10 official heating stars is the 5-point reference for the exact indoor/outdoor pair in the mixed climate zone. Compare similar sizes. Other climates and family-best ratings are not substituted."), warranty(7)],
  "multi-split": [capacity("Cooling capacity", "cooling-kw", "multi-split-rated-cooling", 20, "20 kW of rated cooling is the 5-point reference. This is the system's simultaneous output, not the sum of indoor-unit labels or an efficiency score. The installer needs to size each room and check the exact supported combination."), warranty(7)],
  "ev-chargers": [{ id: "chargingPower", label: "Charging power", unit: "ev-ac-kw", basisId: "ev-ac-rated-output", maximum: 22, explanation: "22 kW is the 5-point reference for rated AC charging power. Your car's onboard charger, electrical supply and installation can limit actual speed. This is not an efficiency rating or a promise of faster charging." }, warranty(5)],
};

export function productRatingMethods(category: string): ProductRatingMethod[] {
  const methods = METHODS[category];
  if (!methods) throw new Error(`Unknown product rating category: ${category}`);
  return methods;
}

export function calculateProductRating(method: ProductRatingMethod, measurement: ProductMeasurement | null | undefined, gap?: ProductMeasurementGap): ProductVisualRating {
  if (gap && (!gap.reason.trim() || !/^https:\/\//.test(gap.sourceUrl) || measurement)) throw new Error(`Invalid ${method.id} measurement gap`);
  if (!measurement) return { id: method.id, label: method.label, score: null, measurement: null, reason: gap?.reason ?? "No comparable published figure", ...(gap ? { unavailableEvidence: gap } : {}) };
  if (!Number.isFinite(measurement.value) || measurement.value < 0 || (measurement.valueMaximum !== undefined && (!Number.isFinite(measurement.valueMaximum) || measurement.valueMaximum < measurement.value)) || !measurement.variant.trim() || !measurement.basis.trim() || !/^https:\/\//.test(measurement.sourceUrl)) throw new Error(`Invalid ${method.id} product measurement`);
  if (measurement.unit !== method.unit || measurement.basisId !== method.basisId) return { id: method.id, label: method.label, score: null, measurement, reason: "Different measurement or package basis" };
  const ratio = method.direction === "lower"
    ? (method.maximum - measurement.value) / (method.maximum - (method.minimum ?? 0))
    : measurement.value / method.maximum;
  const score = Math.round(Math.max(0, Math.min(5, ratio * 5)) * 10) / 10;
  return { id: method.id, label: method.label, score, measurement, reason: null };
}
