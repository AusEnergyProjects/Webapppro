import { ProductComparisonPage } from "@/components/ProductComparisonPage";
import { PRODUCT_GUIDE_CATEGORIES } from "@/lib/product-guides";
import { buildPlatformMetadata } from "@/lib/public-site";

export const metadata = buildPlatformMetadata({
  path: "/guides/products",
  title: "Compare Solar, Battery and Home Upgrade Products | Australian Energy Assessments",
  description: "See product photos and compare clear pros and cons for solar panels, inverters, batteries, heat-pump hot water and air conditioners.",
});

export default function ProductGuidesPage() {
  return <ProductComparisonPage category={PRODUCT_GUIDE_CATEGORIES[0]} overview />;
}
