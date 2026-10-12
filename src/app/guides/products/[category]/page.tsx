import { notFound } from "next/navigation";
import { buildPlatformMetadata } from "@/lib/public-site";

type ProductGuidePageProps = { params: Promise<{ category: string }> };

export async function generateStaticParams() {
  const { PRODUCT_GUIDE_CATEGORIES } = await import("@/lib/product-guides");
  return PRODUCT_GUIDE_CATEGORIES.map(category => ({ category: category.slug }));
}

export async function generateMetadata({ params }: ProductGuidePageProps) {
  const { findProductGuideCategory } = await import("@/lib/product-guides");
  const category = findProductGuideCategory((await params).category);
  if (!category) notFound();
  return buildPlatformMetadata({
    path: `/guides/products/${category.slug}`,
    title: `Compare ${category.title} | Australian Energy Assessments`,
    description: category.slug === "hot-water"
      ? "Compare heat-pump tank sizes, noise and reheating with product photos and plain pros and cons. Check model rebates using your postcode and the hot-water system you are replacing."
      : category.slug === "air-conditioning" || category.slug === "multi-split"
        ? "Compare air conditioner efficiency, parts warranties, product photos and plain pros and cons. Filter the options and check model rebates using your postcode and current heating."
        : `Compare ${category.title.toLowerCase()} with product photos, simple pros and cons, visual ratings and sourced technical specs. Filter current models from established brands and compare them side by side.`,
  });
}

export default async function ProductCategoryPage({ params }: ProductGuidePageProps) {
  const { findProductGuideCategory } = await import("@/lib/product-guides");
  const category = findProductGuideCategory((await params).category);
  if (!category) notFound();
  const { ProductComparisonPage } = await import("@/components/ProductComparisonPage");
  return <ProductComparisonPage category={category} />;
}
