import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideShell, GuideSection } from "@/components/GuideShell";
import { JsonLd } from "@/components/JsonLd";
import { findProductGuideCategory, PRODUCT_GUIDE_CATEGORIES, PRODUCT_GUIDE_REVIEW_DATE } from "@/lib/product-guides";
import { buildPlatformMetadata, PUBLIC_SITE } from "@/lib/public-site";
import styles from "../../page.module.css";

type ProductGuidePageProps = { params: Promise<{ category: string }> };

export function generateStaticParams() {
  return PRODUCT_GUIDE_CATEGORIES.map(category => ({ category: category.slug }));
}

export async function generateMetadata({ params }: ProductGuidePageProps) {
  const category = findProductGuideCategory((await params).category);
  if (!category) notFound();
  return buildPlatformMetadata({
    path: `/guides/products/${category.slug}`,
    title: `20 ${category.title} Options Explained | Australian Energy Assessments`,
    description: category.summary,
  });
}

function groupId(group: string) { return group.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }

export default async function ProductCategoryPage({ params }: ProductGuidePageProps) {
  const category = findProductGuideCategory((await params).category);
  if (!category) notFound();
  const options = [...category.options].sort((left, right) => left.name.localeCompare(right.name, "en-AU"));
  const groups = [...new Set(options.map(option => option.group))];
  return <GuideShell label="20 options, explained" title={`${category.title}: what could suit your home?`} introduction={category.introduction}>
    <JsonLd data={{ "@context": "https://schema.org", "@type": "CollectionPage", name: `20 ${category.title.toLowerCase()} options explained`, url: `${PUBLIC_SITE.apexUrl}/guides/products/${category.slug}`, dateModified: PRODUCT_GUIDE_REVIEW_DATE, mainEntity: { "@type": "ItemList", itemListOrder: "https://schema.org/ItemListUnordered", numberOfItems: options.length, itemListElement: options.map(option => ({ "@type": "ListItem", name: option.name, url: `${PUBLIC_SITE.apexUrl}/guides/products/${category.slug}#${option.id}` })) } }} />
    <nav className={styles.jumpNav} aria-label="Product guide navigation"><Link href="/guides/products">All upgrade options</Link><Link href={category.learnPath}>Understand the basics</Link><a href="#options">See the 20 options</a><a href="#your-quote">What to check in your quote</a></nav>
    <section className={styles.answerPanel} aria-labelledby="system-start"><h2 id="system-start">Start here</h2>{category.startingPoints.map(point => <p key={point.title}><strong>{point.title}</strong> {point.answer}</p>)}<div className={styles.inlineLinks}><Link href={category.comparePath}>{category.compareLabel}</Link><Link href="/guides/products#how-we-chose">How the research works</Link></div></section>
    <div id="options" className={styles.sectionAnchor}><GuideSection eyebrow="Match the system to the job" title="Twenty options to consider">
      <p>Choose the part that sounds like your home. Within each group, options are alphabetical. Household fit is our interpretation of maker information, not a product test or a score. Prices vary with the complete installation.</p>
      <nav className={styles.jumpNav} aria-label="Jump to a household need">{groups.map(group => <a key={group} href={`#${groupId(group)}`}>{group}</a>)}</nav>
      {groups.map(group => <section key={group} id={groupId(group)} className={styles.sectionAnchor} aria-label={group}>
        <h3 className={styles.checklistTitle}>{group}</h3><div className={`guide-card-grid ${styles.productOptions}`}>{options.filter(option => option.group === group).map(option => <article key={option.id} id={option.id} className="guide-card">
          <span>Could suit your home if...</span><h4>{option.name}</h4><p>{option.fit}</p><p><strong>Why consider it:</strong> {option.why}</p><p><strong>Check before choosing:</strong> {option.check}</p>
          <div className="guide-source-links">{option.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" title={`${source.kind}. ${source.revision}`}>{source.title}</a>)}</div>
          <p><small>Source checked <time dateTime={option.checkedAt}>10 October 2026</time>.</small></p>
        </article>)}</div>
      </section>)}
    </GuideSection></div>
    <div id="your-quote" className={styles.sectionAnchor}><GuideSection eyebrow="When you receive a quote" title="The details that help you decide"><ul className="guide-checklist">{category.quoteQuestions.map(question => <li key={question}>{question}</li>)}</ul><p>A family name on this page does not confirm approval, local stock, eligibility or suitability for your property. Check the exact model and installation with the supplier. Get clear on who provides local help and what the warranty covers.</p><div className={styles.inlineLinks}><Link href="/trusted-suppliers">Check suppliers and support</Link><Link href="/rebates">Check current assistance</Link></div></GuideSection></div>
    <section className="guide-callout guide-callout-primary"><div><h2>Put the options in your home&apos;s context</h2><p>Use your own bill or home details to explore the likely benefits, then match equipment to the job you need it to do.</p></div><Link href={category.comparePath}>{category.compareLabel}</Link></section>
  </GuideShell>;
}
