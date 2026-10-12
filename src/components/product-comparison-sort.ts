import type { ProductRatingExplanation, ProductRatingId } from "@/lib/product-ratings";
import type { ProductComparisonCard } from "./product-comparison-data";

export type ProductComparisonSort = {
  criterion: "name" | ProductRatingId;
  direction: "ascending" | "descending";
};

export function nextProductComparisonSort(current: ProductComparisonSort, criterion: ProductComparisonSort["criterion"]): ProductComparisonSort {
  if (current.criterion === criterion) return { criterion, direction: current.direction === "ascending" ? "descending" : "ascending" };
  return { criterion, direction: criterion === "name" || criterion === "noise" ? "ascending" : "descending" };
}

export function productComparisonSortLabel(method: Pick<ProductRatingExplanation, "id" | "label"> | null, direction: ProductComparisonSort["direction"]) {
  const ascending = direction === "ascending";
  if (!method) return ascending ? "A to Z" : "Z to A";
  if (method.id === "warranty") return `Warranty: ${ascending ? "shortest" : "longest"}`;
  if (method.id === "noise") return `Noise: ${ascending ? "quietest" : "loudest"}`;
  if (method.id === "recovery") return `Reheating: ${ascending ? "slowest" : "fastest"}`;
  if (method.id === "efficiency") return `Efficiency: ${ascending ? "lowest" : "highest"}`;
  if (method.id === "chargingPower") return `Charging power: ${ascending ? "lowest" : "highest"}`;
  if (method.label === "Tank size") return `Tank size: ${ascending ? "smallest" : "largest"}`;
  if (method.label === "Usable storage") return `Storage: ${ascending ? "least" : "most"}`;
  return `${method.label}: ${ascending ? "lowest" : "highest"}`;
}

function verifiedValue(rating: ProductComparisonCard["ratings"][number] | undefined) {
  if (!rating || rating.score === null || !Number.isFinite(rating.score)
    || rating.score < 0 || rating.score > 5 || !rating.measurement
    || !Number.isFinite(rating.measurement.value) || rating.measurement.value < 0) return null;
  // A published range uses its conservative lower endpoint, just like the bar.
  return rating.measurement.value;
}

const names = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });

export function sortProductComparisons(products: readonly ProductComparisonCard[], query: string, sort: ProductComparisonSort) {
  const search = query.trim().toLocaleLowerCase("en-AU");
  const direction = sort.direction === "ascending" ? 1 : -1;
  return products.map((product, index) => ({ product, index }))
    .filter(({ product }) => product.searchText.includes(search))
    .sort((a, b) => {
      if (sort.criterion === "name") return names.compare(a.product.name, b.product.name) * direction || a.index - b.index;
      const aValue = verifiedValue(a.product.ratings.find(rating => rating.id === sort.criterion));
      const bValue = verifiedValue(b.product.ratings.find(rating => rating.id === sort.criterion));
      if (aValue === null) return bValue === null ? a.index - b.index : 1;
      if (bValue === null) return -1;
      return (aValue - bValue) * direction || a.index - b.index;
    }).map(({ product }) => product);
}
