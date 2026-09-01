import Link from "next/link";
import { GuideSection, GuideShell } from "@/components/GuideShell";
import { JsonLd } from "@/components/JsonLd";
import { PublicFaqList, type PublicFaq } from "@/components/PublicFaqList";
import { PUBLIC_SITE, buildApexMetadata } from "@/lib/public-site";

const path = "/commercial-and-industrial-assessments";
const canonical = `${PUBLIC_SITE.apexUrl}${path}`;
const title = "Commercial Energy Assessments and Audits | Australian Energy Assessments";
const description = "Independent commercial energy assessment scoping for offices, shops, warehouses and agreed industrial sites, with clear evidence, priorities and limits.";

export const metadata = buildApexMetadata({ path, title, description });

const faqs: readonly PublicFaq[] = [
  {
    question: "Does every commercial assessment include a site visit?",
    answer: "No. The right method depends on the site, the decision you need to make and the evidence already available. We confirm whether the work needs a visit, a data review, specialist measurements or a combination before quoting it.",
  },
  {
    question: "Can you estimate savings and payback?",
    answer: "Where the data supports it, the report can include indicative savings and payback assumptions. They are not guarantees. Operating hours, production, weather, tariffs and future prices can all change the result.",
  },
  {
    question: "Do you recommend particular brands?",
    answer: "The assessment is product independent. We focus on the problem, the performance needed and the evidence a quote should contain. A final purchase decision still needs current product, installer, warranty and site checks.",
  },
  {
    question: "Can you assess industrial process equipment?",
    answer: "Potentially, but only when the equipment, data and required expertise are clear. Motors, compressors, pumps and process loads are included only when they are part of the agreed scope. Specialist engineering or measurement work may be separate.",
  },
];

const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service",
      "@id": `${canonical}#service`,
      name: "Commercial energy assessment",
      serviceType: "Commercial and industrial energy assessment scoping and analysis",
      description,
      url: canonical,
      provider: { "@id": PUBLIC_SITE.organizationId },
      audience: { "@type": "BusinessAudience", audienceType: "Commercial property and facility operators" },
      availableChannel: {
        "@type": "ServiceChannel",
        serviceUrl: `${PUBLIC_SITE.apexUrl}/book-an-assessment`,
      },
    },
    {
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: "en-AU",
      dateModified: "2026-09-02",
      isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId },
      about: { "@id": `${canonical}#service` },
      breadcrumb: { "@id": `${canonical}#breadcrumb` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Assessments", item: `${PUBLIC_SITE.apexUrl}/assessments` },
        { "@type": "ListItem", position: 3, name: "Commercial energy assessments", item: canonical },
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

export default function CommercialEnergyAssessmentsPage() {
  return <GuideShell
    active="assessments"
    label="Commercial energy assessments"
    title="Tell us what you operate and what is driving the bill"
    introduction="An office, a warehouse and a process site do not need the same audit. We start by understanding the site, the decision you need to make and the evidence available. Then we define a useful scope before promising a report."
  >
    <JsonLd data={schema} />
    <div className="assessment-asat">
      <strong>Service scope reviewed 2 September 2026</strong>
      <span>Travel, measurements, specialist input, deliverables and price are confirmed for the site before work begins.</span>
    </div>

    <GuideSection eyebrow="Who it can suit" title="Different sites need different questions">
      <div className="guide-principle-grid">
        <article><strong>Offices and retail</strong><p>Look at operating hours, heating and cooling, lighting, hot water, controls and the way energy use changes across the day.</p></article>
        <article><strong>Warehouses and shared facilities</strong><p>Separate base loads from operational loads and check lighting, ventilation, temperature control, building fabric and common equipment.</p></article>
        <article><strong>Industrial and process sites</strong><p>Agree which motors, pumps, compressors, process heating or production loads belong in the review and whether specialist measurement is needed.</p></article>
      </div>
    </GuideSection>

    <GuideSection eyebrow="Possible scope" title="What we can review when it is relevant">
      <ul className="guide-checklist">
        <li>Electricity and gas bills, interval data and operating hours</li>
        <li>Peak demand, load patterns, power factor and network charges</li>
        <li>Heating, cooling, ventilation and control settings</li>
        <li>Lighting, hot water and agreed process heating</li>
        <li>Insulation, glazing, shading and obvious air leakage</li>
        <li>Motors, pumps, compressors and machinery in the agreed scope</li>
        <li>Tariff suitability and current incentive pathways</li>
        <li>Upgrade dependencies, site constraints and missing evidence</li>
      </ul>
      <div className="guide-note"><strong>The scope comes first</strong><p>A walkthrough is not automatically a detailed engineering audit. If the decision needs electrical testing, calibrated measurement, design certification or another regulated service, that work must be identified and completed by the right qualified professional.</p></div>
    </GuideSection>

    <GuideSection eyebrow="How it works" title="A clear path from question to report">
      <div className="guide-card-grid">
        <article className="guide-card"><span>Step 1</span><h3>Scope the decision</h3><p>Tell us about the site, the energy problem and what the report needs to support.</p></article>
        <article className="guide-card"><span>Step 2</span><h3>Collect the evidence</h3><p>We agree on bills, interval data, equipment information, plans and site access.</p></article>
        <article className="guide-card"><span>Step 3</span><h3>Review the site and data</h3><p>We examine only the systems and operating patterns included in the written scope.</p></article>
        <article className="guide-card"><span>Step 4</span><h3>Explain the priorities</h3><p>You receive the agreed findings, assumptions, practical actions and important limits.</p></article>
      </div>
    </GuideSection>

    <GuideSection eyebrow="Deliverable" title="Useful evidence, not a shopping list">
      <div className="guide-two-column">
        <div><h3>What the report can contain</h3><ul><li>Current-use and operating-pattern summary</li><li>Observed issues and missing evidence</li><li>Prioritised operational and upgrade actions</li><li>Indicative savings or payback only where the evidence supports them</li><li>Relevant incentive checks and next professional steps</li></ul></div>
        <div><h3>What we do not assume</h3><ul><li>That every site needs the same technology</li><li>That a rebate makes an upgrade worthwhile</li><li>That modelled savings guarantee future bills</li><li>That assessment advice replaces engineering, electrical or compliance work</li></ul></div>
      </div>
    </GuideSection>

    <GuideSection eyebrow="Independent advice" title="The assessment is separate from the equipment sale">
      <p>Australian Energy Assessments does not sell the equipment being assessed or take product commissions for assessment recommendations. We explain the performance needed and the evidence a supplier quote should contain, while you keep control of the purchasing decision.</p>
    </GuideSection>

    <GuideSection eyebrow="Questions" title="Commercial assessment FAQs">
      <PublicFaqList faqs={faqs} />
    </GuideSection>

    <section className="guide-callout guide-callout-primary"><div><h2>Start with a five-minute scope call</h2><p>Have the site type, postcode, main energy concern and any recent bills or interval data in mind. The call confirms the next step. It is not the audit itself.</p></div><Link href="/book-an-assessment">Book now</Link></section>
  </GuideShell>;
}
