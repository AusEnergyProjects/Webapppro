import { buildPlatformMetadata } from "@/lib/public-site";

export const metadata = buildPlatformMetadata({
  path: "/guides/products",
  title: "Compare Solar, Battery and Home Upgrade Products | Australian Energy Assessments",
  description: "Compare photos, clear pros and cons, visual ratings and sourced specs for panels, inverters, batteries, heat pumps, single or multi-room aircon and EV chargers.",
});

export default async function ProductGuidesPage() {
  const { ProductComparisonPage } = await import("@/components/ProductComparisonPage");
  const { PRODUCT_GUIDE_CATEGORIES } = await import("@/lib/product-guides");
  return <ProductComparisonPage category={PRODUCT_GUIDE_CATEGORIES[0]} overview />;
}
