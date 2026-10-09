import Link from "next/link";
import { GuideShell, GuideSection } from "@/components/GuideShell";
import { JsonLd } from "@/components/JsonLd";
import { PRODUCT_GUIDE_CATEGORIES, PRODUCT_GUIDE_EVIDENCE, PRODUCT_GUIDE_REVIEW_DATE } from "@/lib/product-guides";
import { buildPlatformMetadata, PUBLIC_SITE } from "@/lib/public-site";
import styles from "../page.module.css";

export const metadata = buildPlatformMetadata({
  path: "/guides/products",
  title: "Home Energy Product Guides | Australian Energy Assessments",
  description: "Explore panels, inverters, batteries, heat-pump hot water and air conditioners. Twenty options each, with plain-language pros, cons and household advice.",
});

export default function ProductGuidesPage() {
  return <GuideShell label="Better answers before you buy" title="Find the right system for your home" introduction="Five upgrade guides. Twenty options in each. See who they could suit, their pros and cons and what to check in a quote, without needing to learn every technical term.">
    <JsonLd data={{ "@context": "https://schema.org", "@type": "CollectionPage", name: "Home energy product guides", url: `${PUBLIC_SITE.apexUrl}/guides/products`, dateModified: PRODUCT_GUIDE_REVIEW_DATE, hasPart: PRODUCT_GUIDE_CATEGORIES.map(category => ({ "@type": "CollectionPage", name: category.title, url: `${PUBLIC_SITE.apexUrl}/guides/products/${category.slug}` })) }} />
    <section className={styles.answerPanel} aria-labelledby="product-guide-answer">
      <h2 id="product-guide-answer">Start with what you need the system to do</h2>
      <p>A battery for a home office in a blackout needs a different assessment from one bought mainly for evening bill savings. A hot-water system needs to keep up with your showers. Air conditioning needs to work in the rooms you actually use.</p>
      <p>These are researched options to help you choose a shortlist. Each guide explains useful differences and trade-offs. The right installation and local support matter alongside the equipment.</p>
      <div className={styles.inlineLinks}><a href="#choose-upgrade">Choose an upgrade</a><a href="#how-we-chose">How we chose the options</a><Link href="/guides">All home energy guides</Link></div>
    </section>
    <div id="choose-upgrade" className={styles.sectionAnchor}><GuideSection eyebrow="Choose what you want to improve" title="Explore your options">
      <div className="guide-card-grid">{PRODUCT_GUIDE_CATEGORIES.map(category => <article key={category.slug} className="guide-card">
        <span>20 options explained</span><h3>{category.title}</h3><p>{category.summary}</p><Link href={`/guides/products/${category.slug}`}>Explore {category.title.toLowerCase()}</Link>
      </article>)}</div>
    </GuideSection></div>
    <div id="how-we-chose" className={styles.sectionAnchor}><GuideSection eyebrow="Know what sits behind the advice" title="How we chose the 20 options">
      <p>We reviewed public Australian manufacturer material, independent buying guidance, installer surveys and official resources. We selected distinct product families from established brands with an Australian presence, documented features and useful household differences. Sizes within one family are grouped together. Within each household group, cards are listed alphabetically. There is no leaderboard, and online star ratings or review counts do not determine the selection.</p>
      <p>Our household-fit explanations are our interpretation of the documented features. We have not installed or tested these 100 options, and we have not verified every model&apos;s current stock or rebate registration. Each card links to the evidence checked on <time dateTime={PRODUCT_GUIDE_REVIEW_DATE}>10 October 2026</time>. Confirm the exact quoted model before buying.</p>
      <div className="guide-card-grid">{PRODUCT_GUIDE_EVIDENCE.map(item => <article key={item.title} className="guide-card"><h3>{item.title}</h3><p>{item.explanation}</p>{item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">Read the source</a>}</article>)}</div>
      <div className={styles.inlineLinks}><a href="https://www.choice.com.au/home-improvement/water/hot-water-systems/review-and-compare/heat-pump-hot-water-systems" target="_blank" rel="noopener noreferrer">CHOICE hot-water comparison and its limits</a><a href="https://www.energy.gov.au/solar/get-know-solar-technology/batteries" target="_blank" rel="noopener noreferrer">Australian Government battery guidance</a><a href="https://www.energyrating.gov.au/consumer-information/products/heating-and-cooling" target="_blank" rel="noopener noreferrer">Government air-conditioner energy labels</a></div>
    </GuideSection></div>
    <GuideSection eyebrow="Useful answers, clear limits" title="What does best really mean?">
      <div className="guide-principle-grid"><article><strong>Best fit for your household</strong><p>Match the system to your roof, appliances, climate and existing equipment. A feature only adds value when it solves your problem.</p></article><article><strong>Support you can check</strong><p>Look for a named service contact, clear warranty conditions and a written explanation of who pays for fault finding and labour.</p></article><article><strong>A complete quote</strong><p>Compare equipment and installation scope together. A price without the required wiring, controls or backup equipment tells you little.</p></article></div>
    </GuideSection>
    <section className="guide-callout guide-callout-primary"><div><h2>See what an upgrade could change for you</h2><p>Use your own bill or home details to explore the likely benefits before choosing equipment.</p></div><Link href="/plan">Explore my home options</Link></section>
  </GuideShell>;
}
