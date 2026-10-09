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
    description: `Compare ${category.title.toLowerCase()} with product photos, simple pros and cons, visual ratings and sourced technical specs. See current models from established brands side by side.`,
  });
}

export default async function ProductCategoryPage({ params }: ProductGuidePageProps) {
  const { findProductGuideCategory } = await import("@/lib/product-guides");
  const category = findProductGuideCategory((await params).category);
  if (!category) notFound();
  const { ProductComparisonPage } = await import("@/components/ProductComparisonPage");
  return <ProductComparisonPage category={category} />;
}
