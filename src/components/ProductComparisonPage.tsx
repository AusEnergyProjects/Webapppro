import Link from "next/link";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";
import { JsonLd } from "./JsonLd";
import { ProductComparisonBrowser } from "./ProductComparisonBrowser";
import { PRODUCT_GUIDE_CATEGORIES, PRODUCT_GUIDE_REVIEW_DATE, type ProductGuideCategory } from "@/lib/product-guides";
import { PUBLIC_SITE } from "@/lib/public-site";
import styles from "./ProductComparison.module.css";
const CATEGORY_LABELS: Record<string, string> = { solar: "Solar panels", inverters: "Inverters", batteries: "Batteries", "hot-water": "Heat-pump hot water", "air-conditioning": "Aircon" };

export function ProductComparisonPage({ category, overview = false }: { category: ProductGuideCategory; overview?: boolean }) {
  const path = `/guides/products${overview ? "" : `/${category.slug}`}`;
  const products = [...category.options].sort((a, b) => a.name.localeCompare(b.name, "en-AU")).map(({ id, name, brand, image, comparisons, warning, sources, checkedAt }) => ({ id, name, brand, image, comparisons, warning, sources, checkedAt }));
  return <main className={`wrap ${styles.page}`}>
    <SiteHeader active="products" />
    <header className={styles.hero}><h1>Compare products</h1><Link href={category.comparePath}>{category.slug === "hot-water" || category.slug === "air-conditioning" ? "Check upgrade savings" : "Check solar savings"} ↗</Link></header>
    <nav className={styles.categories} aria-label="Product categories">{PRODUCT_GUIDE_CATEGORIES.map(item => <Link key={item.slug} href={`/guides/products/${item.slug}`} aria-current={item.slug === category.slug ? "page" : undefined}>{CATEGORY_LABELS[item.slug]}</Link>)}</nav>
    {category.comparisonNote && <p className={styles.measurementNote}>{category.comparisonNote}</p>}
    <JsonLd data={{ "@context": "https://schema.org", "@type": "CollectionPage", name: `${CATEGORY_LABELS[category.slug]} comparison`, url: `${PUBLIC_SITE.apexUrl}${path}`, dateModified: PRODUCT_GUIDE_REVIEW_DATE, ...(overview ? { hasPart: PRODUCT_GUIDE_CATEGORIES.map(item => ({ "@type": "CollectionPage", name: CATEGORY_LABELS[item.slug], url: `${PUBLIC_SITE.apexUrl}/guides/products/${item.slug}` })) } : {}), mainEntity: { "@type": "ItemList", itemListOrder: "https://schema.org/ItemListUnordered", numberOfItems: products.length, itemListElement: products.map(product => ({ "@type": "ListItem", name: product.name, url: `${PUBLIC_SITE.apexUrl}${path}#${product.id}` })) } }} />
    <ProductComparisonBrowser key={category.slug} products={products} criteria={category.criteria} />
    <SiteFooter>Product information is based on manufacturer sources. Match the quoted model and installation to your home.</SiteFooter>
  </main>;
}
