import solar from "./product-guides/solar.json";
import inverters from "./product-guides/inverters.json";
import batteries from "./product-guides/batteries.json";
import hotWater from "./product-guides/hot-water.json";
import airConditioning from "./product-guides/air-conditioning.json";

export type ProductGuideSource = { title: string; url: string; kind: string; revision: string };
export type ProductComparisonCriterion = { id: string; label: string };
export type ProductComparisonPoint = { criterion: string; pro: string | null; con: string };
export type ProductGuideOption = {
  id: string; name: string; group: string; fit: string; why: string; check: string;
  checkedAt: string; sources: ProductGuideSource[];
  brand: string;
  image: { src: string; alt: string; sourceUrl: string };
  comparisons: ProductComparisonPoint[];
  warning?: string;
};
export type ProductComparisonItem = Pick<ProductGuideOption, "id" | "name" | "brand" | "image" | "comparisons" | "warning" | "sources" | "checkedAt">;
export type ProductGuideCategory = { slug: string; title: string; comparePath: string; comparisonNote?: string; criteria: ProductComparisonCriterion[]; options: ProductGuideOption[] };
export const PRODUCT_GUIDE_REVIEW_DATE = "2026-10-10";
export const PRODUCT_GUIDE_CATEGORIES: ProductGuideCategory[] = [
  { slug: "solar", title: "Solar panels", comparePath: "/compare", comparisonNote: "More watts per square metre means more panel capacity in the same space. Smaller heat-loss figures mean less power lost.", criteria: [{"id":"roof-space","label":"Power from your roof"},{"id":"hot-weather","label":"Hot weather"},{"id":"warranty","label":"Warranty and help"}], options: solar },
  { slug: "inverters", title: "Solar inverters", comparePath: "/compare", criteria: [{"id":"battery","label":"Add a battery"},{"id":"blackout","label":"During a blackout"},{"id":"roof-layout","label":"Different roof directions"}], options: inverters },
  { slug: "batteries", title: "Home batteries", comparePath: "/compare", comparisonNote: "kWh measures stored energy; kW measures power for running appliances. Storage figures are per battery or block, before choosing your complete system.", criteria: [{"id":"existing-solar","label":"Keep your existing solar"},{"id":"blackout","label":"During a blackout"},{"id":"expansion","label":"Storage now and later"}], options: batteries },
  { slug: "hot-water", title: "Heat-pump hot water", comparePath: "/gas-compare", criteria: [{"id":"busy-showers","label":"Busy shower times"},{"id":"heating-times","label":"Choose when it heats"},{"id":"upkeep","label":"Servicing and warranty"}], options: hotWater },
  { slug: "air-conditioning", title: "Air conditioners", comparePath: "/gas-compare", criteria: [{"id":"comfort","label":"Airflow comfort"},{"id":"controls","label":"Phone controls"},{"id":"installation","label":"Fitting your rooms"}], options: airConditioning },
];
export function findProductGuideCategory(slug: string): ProductGuideCategory | undefined {
  return PRODUCT_GUIDE_CATEGORIES.find(category => category.slug === slug);
}
