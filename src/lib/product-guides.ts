import solar from "./product-guides/solar.json";
import inverters from "./product-guides/inverters.json";
import batteries from "./product-guides/batteries.json";
import hotWater from "./product-guides/hot-water.json";
import airConditioning from "./product-guides/air-conditioning.json";
import multiSplit from "./product-guides/multi-split.json";
import evChargers from "./product-guides/ev-chargers.json";
import type { ProductVisualRating } from "./product-ratings";

export type ProductGuideSource = { title: string; url: string; kind: string; revision: string };
export type ProductMeasurement = { value: number; unit: string; basisId: string; variant: string; basis: string; sourceUrl: string; checkedAt: string };
export type ProductTechnicalSpec = { label: string; value: string; sourceUrl: string };
export type ProductFreshness = { generation: string; released: string | null; sourceUrl: string; note: string };
export type ProductGuideOption = {
  id: string; name: string;
  checkedAt: string; sources: ProductGuideSource[];
  brand: string;
  image: { src: string; alt: string; sourceUrl: string };
  pros: string[];
  cons: string[];
  warning?: string;
  measurements: { cost: ProductMeasurement | null; efficiency?: ProductMeasurement | null; chargingPower?: ProductMeasurement | null; warranty: ProductMeasurement | null };
  technicalSpecs: ProductTechnicalSpec[];
  freshness: ProductFreshness;
};
export type ProductComparisonItem = Pick<ProductGuideOption, "id" | "name" | "brand" | "image" | "pros" | "cons" | "warning" | "sources" | "checkedAt" | "technicalSpecs" | "freshness"> & { ratings: ProductVisualRating[] };
export type ProductGuideCategory = { slug: string; title: string; comparePath: string; comparisonNote?: string; options: ProductGuideOption[] };
export const PRODUCT_GUIDE_REVIEW_DATE = "2026-10-10";
export const PRODUCT_GUIDE_CATEGORIES: ProductGuideCategory[] = [
  { slug: "solar", title: "Solar panels", comparePath: "/compare", comparisonNote: "The bars compare published panel figures. Actual electricity generated depends on your roof, location and installation.", options: solar },
  { slug: "inverters", title: "Solar inverters", comparePath: "/compare", options: inverters },
  { slug: "batteries", title: "Home batteries", comparePath: "/compare", comparisonNote: "kWh is the amount stored. kW is how much appliance power the system can deliver at once. Backup needs the right equipment and wiring.", options: batteries },
  { slug: "hot-water", title: "Heat-pump hot water", comparePath: "/gas-compare", options: hotWater },
  { slug: "air-conditioning", title: "Air conditioners", comparePath: "/gas-compare", options: airConditioning },
  { slug: "multi-split", title: "Multi-room air conditioners", comparePath: "/gas-compare", comparisonNote: "One outdoor unit serves several indoor units. Room sizes and the chosen combination affect cost and performance.", options: multiSplit },
  { slug: "ev-chargers", title: "EV chargers", comparePath: "/compare", comparisonNote: "Your car and home supply set the actual charging speed. A 22 kW charger needs three-phase power and a compatible car to deliver its full speed. Solar charging can require extra meters or controls.", options: evChargers },
];
export function findProductGuideCategory(slug: string): ProductGuideCategory | undefined {
  return PRODUCT_GUIDE_CATEGORIES.find(category => category.slug === slug);
}
