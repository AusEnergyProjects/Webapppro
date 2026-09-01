import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PUBLIC_SITE } from "@/lib/public-site";

const canonical = `${PUBLIC_SITE.apexUrl}/residential-efficiency-scorecard`;
const title = "Residential Efficiency Scorecard Closed | 2026 Update";
const description = "Residential Efficiency Scorecard closed on 23 June 2026. Learn what changed and use the current Home Energy Rating pathway for an existing home.";
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
      alt: "Australian Energy Assessments home energy guidance",
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
    title: "Official Scorecard closure notice",
    description: "Home Energy Rating recorded that the Victorian Government closed Residential Efficiency Scorecard on 23 June 2026 as the national existing-home pathway expanded.",
    href: "https://www.homeenergyrating.gov.au/news/nathers-news-june-edition-nathers-expansion-stage-2-rolling-out-july",
    label: "Read the official closure notice",
  },
  {
    title: "Official Home Energy Rating launch notice",
    description: "The Australian Government announced the Home Energy Rating consumer service and website on 1 July 2026.",
    href: "https://www.energy.gov.au/news/home-energy-rating-launched-today",
    label: "Read the official launch notice",
  },
] as const;

const faqs = [
  {
    question: "Can I book a new Residential Efficiency Scorecard assessment?",
    answer: "No. Residential Efficiency Scorecard closed on 23 June 2026. No new Scorecard assessments should be advertised or booked. Ask about the current Home Energy Rating pathway for an existing home instead.",
  },
  {
    question: "What replaced Scorecard for an existing home?",
    answer: "Home Energy Rating is the current national consumer pathway. It launched under the new brand on 1 July 2026 and provides a Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, estimated annual energy use and upgrade guidance.",
  },
  {
    question: "Is my older Scorecard certificate automatically invalid?",
    answer: "The program closure does not rewrite the historical document or the condition of the home when it was assessed. For a current decision, ask whether a new Home Energy Rating is needed and check any certificate date, property changes and purpose before relying on older information.",
  },
  {
    question: "Can an existing-home rating prove NCC compliance?",
    answer: "No. A Home Energy Rating for an existing home cannot demonstrate National Construction Code compliance. A project that needs regulatory evidence must use the relevant new-home certificate and approval pathway.",
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
      about: {
        "@type": "Thing",
        name: "Residential Efficiency Scorecard transition to Home Energy Rating",
      },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Assessments", item: `${PUBLIC_SITE.apexUrl}/assessments` },
        { "@type": "ListItem", position: 3, name: "Residential Efficiency Scorecard", item: canonical },
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

export default function ResidentialEfficiencyScorecardPage() {
  return (
    <main className="wrap assessments-page">
      <JsonLd data={structuredData} />
      <SiteHeader active="assessments" />

      <nav className="guide-source-links" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/assessments">Assessments</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Residential Efficiency Scorecard</span>
      </nav>

      <header className="guide-hero assessments-hero">
        <span>Legacy existing-home program</span>
        <h1>Residential Efficiency Scorecard closed on 23 June 2026</h1>
        <p>Residential Efficiency Scorecard is no longer an assessment that should be advertised or booked. The current consumer pathway for a home that is already built is Home Energy Rating, launched under its new national brand on 1 July 2026.</p>
      </header>

      <div className="assessment-asat">
        <strong>Official guidance reviewed 1 September 2026</strong>
        <span>This page preserves a well-known legacy search term while directing households to the current official service. Check current Home Energy Rating guidance before relying on older Scorecard information.</span>
      </div>

      <section className="assessment-section" aria-labelledby="scorecard-transition-title">
        <div className="guide-section-heading">
          <span>What changed</span>
          <h2 id="scorecard-transition-title">Closed program, current pathway and regulatory boundary</h2>
        </div>
        <div className="assessment-card-grid">
          <article className="assessment-card">
            <div><span>Closed program</span><h3>Do not advertise new Scorecard assessments</h3><p>The Victorian Government closed Residential Efficiency Scorecard on 23 June 2026 after operating it on behalf of Australian governments.</p></div>
            <div className="assessment-boundary"><strong>Current status</strong><p>No new Scorecard assessment should be presented as available after the closure date.</p></div>
            <div className="assessment-evidence"><strong>When reading old content</strong><ul><li>Check the publication date</li><li>Separate historical certificates from current services</li><li>Do not reuse superseded booking language</li><li>Follow current official terminology</li></ul></div>
            <div className="assessment-output"><strong>Correct next step</strong><p>Route a household seeking a current assessment to Home Energy Rating for existing homes.</p></div>
            <a href={sources[0].href} target="_blank" rel="noreferrer">{sources[0].label}</a>
          </article>

          <article className="assessment-card">
            <div><span>Current existing-home service</span><h3>Use Home Energy Rating now</h3><p>The Home Energy Rating brand launched on 1 July 2026 for the current national consumer service covering homes that are already built.</p></div>
            <div className="assessment-boundary"><strong>Current output</strong><p>The certificate provides a Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, estimated annual energy use and upgrade guidance.</p></div>
            <div className="assessment-evidence"><strong>Useful for</strong><ul><li>Understanding current home performance</li><li>Prioritising upgrade investigations</li><li>Discussing comfort and energy use</li><li>Tracking changes with current evidence</li></ul></div>
            <div className="assessment-output"><strong>Assessment method</strong><p>This is an on-site assessment of the completed home, not a plan-based new-home certificate.</p></div>
            <Link href="/home-energy-rating-for-existing-homes">Open the current existing-home rating guide</Link>
          </article>

          <article className="assessment-card">
            <div><span>New-home regulatory pathway</span><h3>Keep NatHERS new-home certificates separate</h3><p>A proposed new home or applicable major renovation uses the plan-based NatHERS new-home pathway, including the relevant thermal Star Rating and Whole of Home rating.</p></div>
            <div className="assessment-boundary"><strong>NCC boundary</strong><p>An existing-home Home Energy Rating cannot demonstrate National Construction Code compliance. The relevant new-home certificate can support that purpose for the confirmed project pathway.</p></div>
            <div className="assessment-evidence"><strong>Choose by evidence</strong><ul><li>Completed home needs on-site evidence</li><li>Proposed design needs plans and specifications</li><li>Approval evidence follows the jurisdiction</li><li>Certificate names are not interchangeable</li></ul></div>
            <div className="assessment-output"><strong>Correct terminology</strong><p>Use Scorecard only for historical context, Home Energy Rating for existing homes and NatHERS Whole of Home only for the new-home certificate pathway.</p></div>
            <Link href="/home-energy-rating-vs-nathers-vs-scorecard">Compare the three terms</Link>
          </article>
        </div>
      </section>

      <section className="assessment-two-column" aria-label="Official sources">
        {sources.map((source) => (
          <article key={source.href}>
            <span>Official source</span>
            <h2>{source.title}</h2>
            <p>{source.description}</p>
            <a href={source.href} target="_blank" rel="noreferrer">{source.label}</a>
          </article>
        ))}
      </section>

      <section className="assessment-section" aria-labelledby="scorecard-faq-title">
        <div className="guide-section-heading"><span>Clear answers</span><h2 id="scorecard-faq-title">Residential Efficiency Scorecard transition questions</h2></div>
        <div className="assessment-two-column">
          {faqs.map((faq) => (
            <article key={faq.question}><span>Question</span><h2>{faq.question}</h2><p>{faq.answer}</p></article>
          ))}
        </div>
      </section>

      <section className="assessment-upload-boundary">
        <div><span>Need a current assessment?</span><h2>Use the Home Energy Rating pathway for an existing home</h2><p>Explain the property location, why you need the rating and whether the home is already built. The assessment team can confirm the current pathway before detailed documents are supplied.</p></div>
        <Link href="/home-energy-rating-for-existing-homes">Read the current rating guide</Link>
        <Link href="/book-an-assessment">Book an assessment discussion</Link>
      </section>

      <SiteFooter>Residential Efficiency Scorecard closed on 23 June 2026. Current existing-home assessments use Home Energy Rating, while regulatory new-home evidence uses the relevant new-home NatHERS pathway.</SiteFooter>
    </main>
  );
}
