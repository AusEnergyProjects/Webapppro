import solar from "./product-guides/solar.json";
import inverters from "./product-guides/inverters.json";
import batteries from "./product-guides/batteries.json";
import hotWater from "./product-guides/hot-water.json";
import airConditioning from "./product-guides/air-conditioning.json";
import multiSplit from "./product-guides/multi-split.json";
import evChargers from "./product-guides/ev-chargers.json";
import type { ProductVisualRating } from "./product-ratings";

export type ProductGuideSource = { title: string; url: string; kind: string; revision: string };
export type ProductMeasurement = { value: number; unit: string; basisId: string; variant: string; basis: string; sourceUrl: string; checkedAt: string; referenceFor?: string; priceEvidence?: "published-guide" };
export type ProductMeasurementGap = { reason: string; sourceUrl: string };
export type ProductTechnicalSpec = { label: string; value: string; sourceUrl: string };
export type ProductFreshness = { generation: string; released: string | null; sourceUrl: string; note: string };
export type HotWaterNoise = { value: number; metric: "sound-pressure" | "sound-power" | "not-stated"; distanceMetres: number | null; mode: string; sourceUrl: string };
type HotWaterTest = { airTemperatureC: number | null; waterStartC: number; waterEndC: number; sourceUrl: string; basis: string };
export type HotWaterRecovery = HotWaterTest & ({ thermalOutputKw: number; litresPerHour?: never; minutes?: never; heatedLitres?: never } | { litresPerHour: number; thermalOutputKw?: never; minutes?: never; heatedLitres?: never } | { minutes: number; heatedLitres: number; thermalOutputKw?: never; litresPerHour?: never });
export type HotWaterPerformance = { noise: HotWaterNoise | null; recovery: HotWaterRecovery | null };
export type ProductHotWaterFacts = { noise: string; recovery: string; conditions: string; recoverySourceUrl: string | null };
export type ProductGuideOption = {
  id: string; name: string;
  checkedAt: string; sources: ProductGuideSource[];
  brand: string;
  image: { src: string; alt: string; sourceUrl: string };
  pros: string[];
  cons: string[];
  warning?: string;
  measurements: { cost: ProductMeasurement | null; efficiency?: ProductMeasurement | null; capacity?: ProductMeasurement | null; chargingPower?: ProductMeasurement | null; warranty: ProductMeasurement | null };
  measurementGaps?: Partial<Record<"cost" | "efficiency" | "capacity" | "chargingPower" | "warranty", ProductMeasurementGap>>;
  technicalSpecs: ProductTechnicalSpec[];
  freshness: ProductFreshness;
  hotWaterPerformance?: HotWaterPerformance;
};
export type ProductComparisonItem = Pick<ProductGuideOption, "id" | "name" | "brand" | "image" | "pros" | "cons" | "warning" | "sources" | "checkedAt" | "technicalSpecs" | "freshness"> & { ratings: ProductVisualRating[]; hotWaterFacts?: ProductHotWaterFacts };
export type ProductGuideCategory = { slug: string; title: string; comparePath: string; comparisonNote?: string; options: ProductGuideOption[] };

// JSON imports widen string literals. Narrow the authored evidence at this boundary,
// rejecting unsupported values instead of casting the catalogue to its public type.
type AuthoredMeasurement = Omit<ProductMeasurement, "priceEvidence"> & { priceEvidence?: string };
type AuthoredNoise = Omit<HotWaterNoise, "metric"> & { metric: string };
type AuthoredProduct = Omit<ProductGuideOption, "measurements" | "hotWaterPerformance"> & {
  measurements: Omit<ProductGuideOption["measurements"], "cost"> & { cost: AuthoredMeasurement | null };
  hotWaterPerformance?: { noise: AuthoredNoise | null; recovery: HotWaterRecovery | null };
};
function readCost(measurement: AuthoredMeasurement | null): ProductMeasurement | null {
  if (!measurement) return null;
  const { priceEvidence, ...figure } = measurement;
  if (priceEvidence === undefined) return figure;
  if (priceEvidence !== "published-guide") throw new Error("Unsupported catalogue price evidence");
  return { ...figure, priceEvidence };
}
function readNoise(noise: AuthoredNoise | null): HotWaterNoise | null {
  if (!noise) return null;
  const { metric, ...figure } = noise;
  if (metric !== "sound-pressure" && metric !== "sound-power" && metric !== "not-stated") throw new Error("Unsupported heat-pump noise measurement");
  return { ...figure, metric };
}
function readOptions(options: AuthoredProduct[]): ProductGuideOption[] {
  return options.map(({ measurements, hotWaterPerformance, ...product }) => ({
    ...product,
    measurements: { ...measurements, cost: readCost(measurements.cost) },
    ...(hotWaterPerformance ? { hotWaterPerformance: { noise: readNoise(hotWaterPerformance.noise), recovery: hotWaterPerformance.recovery } } : {}),
  }));
}
export const PRODUCT_GUIDE_REVIEW_DATE = "2026-10-10";
export const PRODUCT_GUIDE_CATEGORIES: ProductGuideCategory[] = [
  { slug: "solar", title: "Solar panels", comparePath: "/compare", comparisonNote: "The bars compare published panel figures. Actual electricity generated depends on your roof, location and installation.", options: readOptions(solar) },
  { slug: "inverters", title: "Solar inverters", comparePath: "/compare", options: readOptions(inverters) },
  { slug: "batteries", title: "Home batteries", comparePath: "/compare", comparisonNote: "kWh is the amount stored. kW is how much appliance power the system can deliver at once. Backup needs the right equipment and wiring.", options: readOptions(batteries) },
  { slug: "hot-water", title: "Heat-pump hot water", comparePath: "/gas-compare", comparisonNote: "Lower noise usually means quieter operation. Compare the same noise test and distance. Reheat times use 100 litres; check the water and air temperatures shown.", options: readOptions(hotWater) },
  { slug: "air-conditioning", title: "Air conditioners", comparePath: "/gas-compare", options: readOptions(airConditioning) },
  { slug: "multi-split", title: "Multi-room air conditioners", comparePath: "/gas-compare", comparisonNote: "One outdoor unit serves several indoor units. Room sizes and the chosen combination affect cost and performance.", options: readOptions(multiSplit) },
  { slug: "ev-chargers", title: "EV chargers", comparePath: "/compare", comparisonNote: "Your car and home supply set the actual charging speed. A 22 kW charger needs three-phase power and a compatible car to deliver its full speed. Solar charging can require extra meters or controls.", options: readOptions(evChargers) },
];
export function findProductGuideCategory(slug: string): ProductGuideCategory | undefined {
  return PRODUCT_GUIDE_CATEGORIES.find(category => category.slug === slug);
}
