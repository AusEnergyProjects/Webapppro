import type { ProductComparisonItem, ProductMeasurement } from "@/lib/product-guides";
import type { ProductVisualRating } from "@/lib/product-ratings";

export type ProductComparisonCard = Pick<ProductComparisonItem, "id" | "name" | "brand" | "pros" | "cons" | "warning" | "hotWaterFacts"> & {
  image: Pick<ProductComparisonItem["image"], "src" | "alt">;
  ratings: (Pick<ProductVisualRating, "id" | "label" | "score" | "reason"> & {
    measurement: Pick<ProductMeasurement, "value" | "valueMaximum" | "unit"> | null;
  })[];
  searchText: string;
};

export function productComparisonCard(product: ProductComparisonItem): ProductComparisonCard {
  return {
    id: product.id, name: product.name, brand: product.brand,
    image: { src: product.image.src, alt: product.image.alt },
    pros: product.pros, cons: product.cons, warning: product.warning,
    hotWaterFacts: product.hotWaterFacts,
    ratings: product.ratings.map(({ id, label, score, reason, measurement }) => ({
      id, label, score, reason,
      measurement: measurement ? { value: measurement.value, valueMaximum: measurement.valueMaximum, unit: measurement.unit } : null,
    })),
    searchText: `${product.name} ${product.brand} ${product.technicalSpecs.map(spec => spec.value).join(" ")}`.toLocaleLowerCase("en-AU"),
  };
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function texts(value: unknown): value is string[] { return Array.isArray(value) && value.every(text); }
function https(value: unknown): value is string {
  if (!text(value)) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function measurement(value: unknown): value is ProductMeasurement {
  return record(value) && finite(value.value) && (value.valueMaximum === undefined || finite(value.valueMaximum))
    && text(value.unit) && text(value.basisId) && text(value.variant) && text(value.basis)
    && https(value.sourceUrl) && text(value.checkedAt);
}
function rating(value: unknown): value is ProductVisualRating {
  return record(value) && ["efficiency", "warranty", "chargingPower", "capacity", "noise", "recovery"].includes(String(value.id))
    && text(value.label) && (value.score === null || (finite(value.score) && value.score >= 0 && value.score <= 5))
    && (value.measurement === null || measurement(value.measurement)) && (value.reason === null || text(value.reason))
    && (value.unavailableEvidence === undefined || (record(value.unavailableEvidence) && text(value.unavailableEvidence.reason) && https(value.unavailableEvidence.sourceUrl)));
}
function product(value: unknown): value is ProductComparisonItem {
  return record(value) && text(value.id) && text(value.name) && text(value.brand)
    && record(value.image) && text(value.image.alt) && text(value.image.src) && /^\/products\/[a-z-]+\/[a-z0-9-]+\.webp$/.test(value.image.src) && https(value.image.sourceUrl)
    && texts(value.pros) && value.pros.length > 0 && texts(value.cons) && (value.warning === undefined || text(value.warning))
    && text(value.checkedAt) && Array.isArray(value.sources) && value.sources.every(source => record(source) && text(source.title) && https(source.url) && text(source.kind) && text(source.revision))
    && Array.isArray(value.technicalSpecs) && value.technicalSpecs.every(spec => record(spec) && text(spec.label) && text(spec.value) && https(spec.sourceUrl))
    && record(value.freshness) && text(value.freshness.generation) && (value.freshness.released === null || text(value.freshness.released)) && text(value.freshness.note) && https(value.freshness.sourceUrl)
    && Array.isArray(value.ratings) && value.ratings.every(rating)
    && (value.hotWaterFacts === undefined || (record(value.hotWaterFacts) && text(value.hotWaterFacts.noise) && text(value.hotWaterFacts.recoveryLabel) && text(value.hotWaterFacts.recovery) && text(value.hotWaterFacts.conditions) && (value.hotWaterFacts.recoverySourceUrl === null || https(value.hotWaterFacts.recoverySourceUrl))));
}

export function readProductComparisonDetails(value: unknown, expectedId: string): ProductComparisonItem {
  if (!record(value) || !product(value.product) || value.product.id !== expectedId) throw new Error("The product specifications could not be loaded. Try again.");
  return value.product;
}
