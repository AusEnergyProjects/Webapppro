import type { ProductComparisonItem } from "@/lib/product-guides";
import type { ProductRatingId, ProductVisualRating } from "@/lib/product-ratings";

export type ProductComparisonFilters = {
  query: string;
  brand: string;
  figureLimits: Partial<Record<ProductRatingId, number>>;
};

const FIGURE_FILTERS: Record<string, { thresholds: readonly number[]; unit: string; maximum?: boolean }> = {
  "panel-efficiency-percent": { thresholds: [20, 22, 23, 24, 25], unit: "%" },
  "peak-efficiency-percent": { thresholds: [95, 97, 98, 99], unit: "%" },
  "usable-kwh": { thresholds: [5, 10, 15, 20, 30], unit: " kWh" },
  "tank-litres": { thresholds: [180, 200, 250, 300], unit: " litres" },
  "zoned-heating-stars": { thresholds: [2, 3, 4, 5, 7], unit: " heating stars" },
  "cooling-kw": { thresholds: [5, 7, 10, 15, 20], unit: " kW" },
  "ev-ac-kw": { thresholds: [7, 11, 22], unit: " kW" },
  "included-product-years": { thresholds: [2, 5, 10, 15, 20, 25, 30], unit: " years" },
  "published-noise-db": { thresholds: [35, 40, 45, 50, 55, 60, 65], unit: " dB", maximum: true },
  "recovery-litres-per-hour": { thresholds: [50, 75, 100, 125, 150], unit: " litres per hour" },
};

function verifiedFigure(rating: ProductVisualRating | undefined) {
  if (!rating || rating.score === null || !Number.isFinite(rating.score)
    || rating.score < 0 || rating.score > 5 || !rating.measurement
    || !Number.isFinite(rating.measurement.value) || rating.measurement.value < 0) return null;
  return rating.measurement;
}

export function productComparisonFilterOptions(products: readonly ProductComparisonItem[], id: ProductRatingId | undefined) {
  const figures = products.map(product => verifiedFigure(product.ratings.find(rating => rating.id === id))).filter(figure => figure !== null);
  const units = new Set(figures.map(figure => figure.unit));
  if (units.size !== 1) return [];
  const definition = FIGURE_FILTERS[figures[0].unit];
  if (!definition) return [];
  const boundary = definition.maximum ? Math.min(...figures.map(figure => figure.value)) : Math.max(...figures.map(figure => figure.value));
  return definition.thresholds.filter(value => definition.maximum ? value >= boundary : value <= boundary)
    .map(value => ({ value, label: `${definition.maximum ? "Up to" : "At least"} ${value}${definition.unit}` }));
}

function meetsLimit(product: ProductComparisonItem, id: string, limits: ProductComparisonFilters["figureLimits"]) {
  const rating = product.ratings.find(rating => rating.id === id);
  const limit = rating ? limits[rating.id] : undefined;
  if (limit === undefined || !Number.isFinite(limit) || limit < 0) return false;
  const figure = verifiedFigure(rating);
  if (!figure) return false;
  const definition = FIGURE_FILTERS[figure.unit];
  return Boolean(definition && (definition.maximum ? figure.value <= limit : figure.value >= limit));
}

export function filterProductComparisons(products: readonly ProductComparisonItem[], filters: ProductComparisonFilters) {
  const query = filters.query.trim().toLocaleLowerCase("en-AU");
  return products.filter(product => (!filters.brand || product.brand === filters.brand)
    && `${product.name} ${product.brand} ${product.technicalSpecs.map(spec => spec.value).join(" ")}`.toLocaleLowerCase("en-AU").includes(query)
    && Object.keys(filters.figureLimits).every(id => meetsLimit(product, id, filters.figureLimits)));
}
