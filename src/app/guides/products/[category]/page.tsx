import { notFound } from "next/navigation";
import { ProductComparisonPage } from "@/components/ProductComparisonPage";
import { findProductGuideCategory, PRODUCT_GUIDE_CATEGORIES } from "@/lib/product-guides";
import { buildPlatformMetadata } from "@/lib/public-site";

type ProductGuidePageProps = { params: Promise<{ category: string }> };

export function generateStaticParams() {
  return PRODUCT_GUIDE_CATEGORIES.map(category => ({ category: category.slug }));
}

export async function generateMetadata({ params }: ProductGuidePageProps) {
  const category = findProductGuideCategory((await params).category);
  if (!category) notFound();
  return buildPlatformMetadata({
    path: `/guides/products/${category.slug}`,
    title: `Compare ${category.title} | Australian Energy Assessments`,
    description: `See ${category.title.toLowerCase()} photos and compare their pros and cons side by side. Find products from established brands without rankings or star ratings.`,
  });
}

export default async function ProductCategoryPage({ params }: ProductGuidePageProps) {
  const category = findProductGuideCategory((await params).category);
  if (!category) notFound();
  return <ProductComparisonPage category={category} />;
}
