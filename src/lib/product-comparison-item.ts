import type { ProductComparisonItem, ProductGuideOption } from "./product-guides";
import { calculateProductRating, productRatingMethods } from "./product-ratings";
import { hotWaterComparisonFacts, hotWaterComparisonMeasurements } from "./product-hot-water";

// Both the server-rendered catalogue and the on-demand Specs response use the
// same figures. This helper imports calculations, never the source catalogue.
export function buildProductComparisonItem(option: ProductGuideOption, category: string): ProductComparisonItem {
  const { id, name, brand, image, pros, cons, warning, sources, checkedAt, technicalSpecs, freshness, measurements, measurementGaps, hotWaterPerformance } = option;
  const performance = hotWaterPerformance ?? { noise: null, recovery: null };
  const figures = { ...measurements, ...(category === "hot-water" ? hotWaterComparisonMeasurements(performance, name, checkedAt) : { noise: null, recovery: null }) };
  return {
    id, name, brand, image, pros, cons, warning, sources, checkedAt, technicalSpecs, freshness,
    ratings: productRatingMethods(category).map(method => calculateProductRating(method, figures[method.id], method.id === "noise" || method.id === "recovery" ? undefined : measurementGaps?.[method.id])),
    ...(category === "hot-water" ? { hotWaterFacts: hotWaterComparisonFacts(performance) } : {}),
  };
}
