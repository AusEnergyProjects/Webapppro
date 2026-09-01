import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PUBLIC_SITE } from "@/lib/public-site";

const canonical = `${PUBLIC_SITE.platformUrl}/home-energy-rating-vs-nathers-vs-scorecard`;
const title = "Home Energy Rating vs NatHERS vs Scorecard | 2026 Guide";
const description = "Compare Home Energy Rating for existing homes, NatHERS and Whole of Home for new homes, and the Scorecard program that closed in 2026.";
const image = `${PUBLIC_SITE.platformUrl}/aea-home-energy-plan-og-v2.png`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    title,
    description,
    url: canonical,
    type: "article",
    siteName: PUBLIC_SITE.name,
    locale: "en_AU",
    images: [{
      url: image,
      width: 1731,
      height: 909,
      alt: "Australian home energy assessment pathways",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
  },
};

const sources = [
  {
    title: "Existing-home certificate guidance",
    description: "Home Energy Rating explains the 0 to 100+ rating, Star Rating, estimated energy use, upgrade information and NCC boundary for completed homes.",
    href: "https://www.homeenergyrating.gov.au/households/existing-homes/understanding-your-certificate",
    label: "Read the existing-home certificate guide",
  },
  {
    title: "New-home certificate guidance",
    description: "Home Energy Rating explains the thermal Star Rating, Whole of Home rating and regulatory purpose of a new-home certificate.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
    label: "Read the new-home certificate guide",
  },
  {
    title: "Official Scorecard closure notice",
    description: "Home Energy Rating recorded that Residential Efficiency Scorecard closed on 23 June 2026 during the transition to the expanded national pathway.",
    href: "https://www.homeenergyrating.gov.au/news/nathers-news-june-edition-nathers-expansion-stage-2-rolling-out-july",
    label: "Read the Scorecard closure notice",
  },
] as const;

const faqs = [
  {
    question: "Which rating should I ask for if my home is already built?",
    answer: "Ask about the current Home Energy Rating pathway. It assesses the completed home on site and provides a Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, estimated annual energy use and upgrade guidance.",
  },
  {
    question: "Is Home Energy Rating the same as NatHERS Whole of Home?",
    answer: "No. Home Energy Rating is the consumer service for a completed home. Whole of Home is the 0 to 100+ rating used with the thermal Star Rating in the applicable new-home NatHERS certificate pathway.",
  },
  {
    question: "Can an existing-home Home Energy Rating demonstrate NCC compliance?",
    answer: "No. An existing-home certificate cannot demonstrate National Construction Code compliance. A proposed new home or major renovation that needs regulatory evidence must use the relevant new-home certificate and approval pathway.",
  },
  {
    question: "Can I still book Residential Efficiency Scorecard?",
    answer: "No. Residential Efficiency Scorecard closed on 23 June 2026. The term remains useful for finding historical information, but no new Scorecard assessment should be advertised or booked.",
  },
] as const;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: "en-AU",
      dateModified: "2026-09-01",
      isPartOf: { "@id": PUBLIC_SITE.websiteId },
      about: [
        { "@type": "Thing", name: "Home Energy Rating for existing homes" },
        { "@type": "Thing", name: "NatHERS new-home certificates" },
        { "@type": "Thing", name: "Residential Efficiency Scorecard" },
      ],
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.platformUrl}/` },
        { "@type": "ListItem", position: 2, name: "Assessments", item: `${PUBLIC_SITE.platformUrl}/assessments` },
        { "@type": "ListItem", position: 3, name: "Home Energy Rating vs NatHERS vs Scorecard", item: canonical },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${canonical}#faq`,
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ],
};

export default function HomeEnergyRatingComparisonPage() {
  return (
    <main className="wrap assessments-page">
      <JsonLd data={structuredData} />
      <SiteHeader active="assessments" />

      <nav className="guide-source-links" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/assessments">Assessments</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Rating terminology guide</span>
      </nav>

      <header className="guide-hero assessments-hero">
        <span>2026 terminology guide</span>
        <h1>Home Energy Rating vs NatHERS vs Residential Efficiency Scorecard</h1>
        <p>The terms are related, but they are not interchangeable. Use Home Energy Rating for the current assessment of a completed home, use the relevant NatHERS and Whole of Home pathway for a proposed new home, and use Residential Efficiency Scorecard only when discussing the program that closed on 23 June 2026.</p>
      </header>

      <div className="assessment-asat">
        <strong>Official guidance reviewed 1 September 2026</strong>
        <span>Assessment names, certificate rules and jurisdictional approval requirements can change. Use the official certificate guidance and confirm the project pathway before relying on an assessment.</span>
      </div>

      <section className="assessment-section" aria-labelledby="rating-comparison-title">
        <div className="guide-section-heading"><span>Compare the pathways</span><h2 id="rating-comparison-title">Choose by building stage, output and purpose</h2></div>
        <div className="assessment-card-grid">
          <article className="assessment-card">
            <div><span>Current existing-home service</span><h3>Home Energy Rating</h3><p>An assessor records a completed home on site using the current national existing-home method.</p></div>
            <div className="assessment-boundary"><strong>Use it when</strong><p>The home is already built and the household needs current performance information or upgrade guidance.</p></div>
            <div className="assessment-evidence"><strong>Certificate includes</strong><ul><li>Home Energy Rating from 0 to 100+</li><li>Star Rating from 0 to 10</li><li>Estimated annual energy use</li><li>Upgrade guidance</li></ul></div>
            <div className="assessment-output"><strong>Important boundary</strong><p>This existing-home certificate cannot demonstrate National Construction Code compliance.</p></div>
            <Link href="/home-energy-rating-for-existing-homes">Open the existing-home rating guide</Link>
          </article>

          <article className="assessment-card">
            <div><span>Current new-home pathway</span><h3>NatHERS and Whole of Home</h3><p>A plan-based assessment models a proposed design before construction using coordinated plans, specifications and fixed system details.</p></div>
            <div className="assessment-boundary"><strong>Use it when</strong><p>A proposed new home or applicable major renovation needs design testing or evidence for the confirmed approval pathway.</p></div>
            <div className="assessment-evidence"><strong>Certificate can include</strong><ul><li>Thermal Star Rating from 0 to 10</li><li>Whole of Home rating from 0 to 100+</li><li>Modelled design information</li><li>Certificate status and assumptions</li></ul></div>
            <div className="assessment-output"><strong>Important boundary</strong><p>The correct new-home certificate can support National Construction Code evidence when it meets the jurisdiction and approval requirements.</p></div>
            <Link href="/nathers-for-new-homes">Open the new-home NatHERS guide</Link>
          </article>

          <article className="assessment-card">
            <div><span>Closed legacy program</span><h3>Residential Efficiency Scorecard</h3><p>Scorecard was the earlier government-supported existing-home rating program and is still common in older pages, certificates and search queries.</p></div>
            <div className="assessment-boundary"><strong>Current status</strong><p>The program closed on 23 June 2026. No new Scorecard assessment should be advertised or booked.</p></div>
            <div className="assessment-evidence"><strong>Use the term only for</strong><ul><li>Historical program information</li><li>Older Scorecard certificates</li><li>Explaining the 2026 transition</li><li>Directing users to the current service</li></ul></div>
            <div className="assessment-output"><strong>Correct next step</strong><p>A household seeking a current existing-home assessment should ask about Home Energy Rating.</p></div>
            <Link href="/residential-efficiency-scorecard">Read the Scorecard transition guide</Link>
          </article>
        </div>
      </section>

      <section className="assessment-section" aria-labelledby="rating-decision-title">
        <div className="guide-section-heading"><span>Simple decision path</span><h2 id="rating-decision-title">Start with the building stage</h2></div>
        <ol className="assessment-process">
          <li><span>01</span><div><h3>Home already built</h3><p>Use Home Energy Rating for a current on-site assessment and upgrade guidance.</p></div></li>
          <li><span>02</span><div><h3>Home still being designed</h3><p>Use the relevant new-home NatHERS pathway, including Whole of Home where applicable.</p></div></li>
          <li><span>03</span><div><h3>Old page says Scorecard</h3><p>Treat it as legacy information and check the current Home Energy Rating service.</p></div></li>
        </ol>
      </section>

      <section className="assessment-two-column" aria-label="Official sources">
        {sources.map((source) => (
          <article key={source.href}><span>Official source</span><h2>{source.title}</h2><p>{source.description}</p><a href={source.href} target="_blank" rel="noreferrer">{source.label}</a></article>
        ))}
      </section>

      <section className="assessment-section" aria-labelledby="rating-comparison-faq-title">
        <div className="guide-section-heading"><span>Clear answers</span><h2 id="rating-comparison-faq-title">Home rating terminology questions</h2></div>
        <div className="assessment-two-column">
          {faqs.map((faq) => (
            <article key={faq.question}><span>Question</span><h2>{faq.question}</h2><p>{faq.answer}</p></article>
          ))}
        </div>
      </section>

      <section className="assessment-upload-boundary">
        <div><span>Still unsure?</span><h2>Describe the building stage and purpose first</h2><p>Tell the assessment team whether the home is proposed or already built, where it is located and what the rating must support. That is enough to identify the current pathway before detailed evidence is supplied.</p></div>
        <Link href="/book-an-assessment">Book an assessment discussion</Link>
      </section>

      <SiteFooter>Home Energy Rating, NatHERS Whole of Home and Residential Efficiency Scorecard describe different assessment pathways and periods. Choose the current service by building stage and required evidence.</SiteFooter>
    </main>
  );
}
