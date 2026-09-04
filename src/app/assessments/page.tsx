import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { buildApexMetadata, PUBLIC_SITE } from "@/lib/public-site";

export const metadata = buildApexMetadata({
  path: "/assessments",
  title: "Which Home Energy Assessment Do I Need? | Australian Energy Assessments",
  description: "Compare home energy assessment types for new and existing homes: Australia-wide NatHERS plan assessments, on-site Home Energy Ratings and NSW BASIX support.",
});

const pathways = [
  {
    label: "New homes and major renovations",
    title: "NatHERS design assessment",
    boundary: "Your certifier or approval authority confirms the current rules for the state or territory.",
    description: "Still working from plans? A NatHERS assessor models the proposed home before construction. This can cover the thermal Star Rating and, where required, Whole of Home.",
    evidence: ["Current floor plans, elevations and sections", "Construction, insulation, glazing and shading specifications", "Orientation, site details and proposed fixed appliances", "The certifier, council or approval pathway requirements"],
    output: "The relevant NatHERS certificate and design feedback, subject to complete documentation and the applicable approval pathway.",
    internalHref: "/nathers-for-new-homes",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
    source: "official NatHERS new homes guidance",
  },
  {
    label: "Homes that are already built",
    title: "Existing-home Home Energy Rating",
    boundary: "This is for a completed home. It is not the certificate used to prove new-home building-code compliance.",
    description: "Want to understand how your current home performs and what to improve first? An assessor visits the property and provides two ratings, estimated energy use and practical upgrade guidance.",
    evidence: ["Access to the home for the required assessment", "Existing building fabric, windows, shading and orientation", "Current heating, cooling, hot water and other fixed appliances", "Known renovations and the household decision the rating should support"],
    output: "A certificate with a Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, modelled annual energy use and practical upgrade guidance. Modelled results do not guarantee actual bills or savings.",
    internalHref: "/home-energy-rating-for-existing-homes",
    href: "https://www.homeenergyrating.gov.au/households/existing-homes",
    source: "official existing homes guidance",
  },
  {
    label: "NSW residential development",
    title: "BASIX assessment support",
    boundary: "BASIX is specific to NSW. It generally applies to new dwellings, alterations and additions costing $50,000 or more, and swimming pools of 40,000 litres or more. The Planning Portal confirms the current rule.",
    description: "Building or renovating in NSW? BASIX is part of the planning process. It covers water, energy, thermal performance and materials, and the certificate needs to match the submitted plans.",
    evidence: ["NSW Planning Portal project and development details", "Plans, areas, construction and glazing specifications", "Water, landscaping, pool and fixed energy system selections", "The nominated thermal performance method and approval pathway"],
    output: "BASIX inputs, commitments and certificate support relevant to the project scope. Final submission requirements remain subject to the NSW Planning Portal and consent authority.",
    internalHref: "/basix-nsw",
    href: "https://www.planningportal.nsw.gov.au/development-and-assessment/basix",
    source: "official NSW BASIX guidance",
  },
] as const;

const assessmentServiceNodes = pathways.map((pathway) => ({
  "@type": "Service",
  "@id": `${PUBLIC_SITE.apexUrl}${pathway.internalHref}#service`,
  name: pathway.title,
  serviceType: pathway.title,
  description: pathway.description,
  url: `${PUBLIC_SITE.apexUrl}${pathway.internalHref}`,
  provider: { "@id": PUBLIC_SITE.organizationId },
  areaServed: pathway.internalHref === "/basix-nsw"
    ? { "@type": "AdministrativeArea", name: "New South Wales" }
    : { "@type": "Country", name: "Australia" },
}));

const assessmentHubSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": `${PUBLIC_SITE.apexUrl}/assessments#webpage`,
      url: `${PUBLIC_SITE.apexUrl}/assessments`,
      name: "Which home energy assessment do I need?",
      description: metadata.description,
      inLanguage: "en-AU",
      dateModified: "2026-09-03",
      isPartOf: { "@id": PUBLIC_SITE.websiteId },
      publisher: { "@id": PUBLIC_SITE.organizationId },
      about: assessmentServiceNodes.map((service) => ({ "@id": service["@id"] })),
      mainEntity: { "@id": `${PUBLIC_SITE.apexUrl}/assessments#assessment-types` },
      breadcrumb: { "@id": `${PUBLIC_SITE.apexUrl}/assessments#breadcrumb` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${PUBLIC_SITE.apexUrl}/assessments#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Home energy assessments", item: `${PUBLIC_SITE.apexUrl}/assessments` },
      ],
    },
    {
      "@type": "ItemList",
      "@id": `${PUBLIC_SITE.apexUrl}/assessments#assessment-types`,
      name: "Home energy assessment types",
      numberOfItems: assessmentServiceNodes.length,
      itemListElement: assessmentServiceNodes.map((service, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: { "@id": service["@id"] },
      })),
    },
    ...assessmentServiceNodes,
  ],
} as const;

export default function AssessmentsPage() {
  return <main className="wrap assessments-page">
    <JsonLd data={assessmentHubSchema} />
    <SiteHeader active="assessments" />
    <header className="guide-hero assessments-hero"><span>NatHERS, Home Energy Rating and BASIX</span><h1>Choose the right home energy assessment</h1><p>Home energy assessments are not all the same. For a new home, we rate the plans before construction. For a home that is already built, an assessor visits the property and shows how it performs now. We help you choose the right service before you pay or collect documents you do not need.</p></header>

    <section className="assessment-two-column" aria-label="Home energy assessment overview"><article><span>The short answer</span><h2>What is a home energy assessment?</h2><p>It is a structured check of a home&apos;s design or current condition. Depending on the job, the result may be a NatHERS certificate for proposed plans, a Home Energy Rating for an existing property or practical advice for a narrower energy question.</p></article><article><span>Where we work</span><h2>Plan-based work is available Australia-wide</h2><p>We can complete new-home NatHERS work from plans anywhere in Australia. Most of our existing-home visits are currently in New South Wales and Victoria, and we confirm availability elsewhere before booking.</p></article></section>

    <div className="assessment-asat"><strong>Official guidance checked 1 September 2026</strong><span>Requirements can change by location and project. We explain the likely pathway, but your certifier, council or approval authority confirms what is required.</span></div>

    <section className="assessment-section" aria-labelledby="assessment-pathways-title"><div className="guide-section-heading"><span>Start with the home</span><h2 id="assessment-pathways-title">Match the assessment to the project stage</h2></div><div className="assessment-card-grid">{pathways.map((pathway) => <article className="assessment-card" key={pathway.title}><div><span>{pathway.label}</span><h3>{pathway.title}</h3><p>{pathway.description}</p></div><div className="assessment-boundary"><strong>Important limit</strong><p>{pathway.boundary}</p></div><div className="assessment-evidence"><strong>What to have ready</strong><ul>{pathway.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="assessment-output"><strong>What you receive</strong><p>{pathway.output}</p></div><Link href={pathway.internalHref}>See how it works</Link><a href={pathway.href} target="_blank" rel="noopener noreferrer">Check the {pathway.source}</a></article>)}</div></section>

    <section className="assessment-two-column"><article><span>2026 terminology</span><h2>Home Energy Rating is the new existing-home consumer brand</h2><p>People still search for an existing-home NatHERS assessment, NatHERS assessor, energy assessor or Residential Efficiency Scorecard. Since 1 July 2026, the official existing-home output is a Home Energy Rating and Star Rating. The Residential Efficiency Scorecard service closed on 23 June 2026.</p><Link href="/home-energy-rating-vs-nathers-vs-scorecard">Compare current and legacy rating terms</Link><Link href="/residential-efficiency-scorecard">Read the Scorecard transition guide</Link><Link href="/faq">Read the home energy assessment FAQ</Link></article><article><span>A common distinction</span><h2>Whole of Home is a new-home rating</h2><p>Whole of Home is the 0 to 100+ measure on a new-home certificate. Existing homes now receive a Home Energy Rating from 0 to 100+. Keeping these terms separate helps prevent the wrong certificate being used for a project.</p><Link href="/nathers-whole-of-home">Understand Whole of Home</Link></article></section>

    <section className="assessment-two-column"><article><span>Business sites</span><h2>Commercial work starts with the scope</h2><p>An office, shop, warehouse and industrial process do not need the same audit. Start with the site, available energy data and the decision the report needs to support.</p><Link href="/commercial-and-industrial-assessments">Explore commercial energy assessments</Link></article><article><span>Victorian rentals</span><h2>Understand the 2027 to 2030 energy standards</h2><p>Heating, cooling, hot water, showerheads, ceiling insulation and draughtproofing have different dates and triggers. A rating can help with planning, but it does not prove legal compliance.</p><Link href="/minimum-rental-standards">Read the rental standards guide</Link><Link href="/rental-assessment/request">Request a property review</Link></article></section>

    <section className="assessment-two-column"><article><span>Building diagnostics</span><h2>Blower door testing measures air leakage</h2><p>A calibrated pressure test can quantify whole-home leakage. Thermal imaging can then help investigate insulation, thermal bridges and likely leakage locations when the test conditions are suitable.</p><Link href="/blower-door-thermal-imaging">Compare blower door testing and thermal imaging</Link></article><article><span>Important distinction</span><h2>A diagnostic test is not automatically a formal rating</h2><p>These tests can support a home investigation or retrofit plan, but they do not automatically produce a NatHERS certificate, Home Energy Rating, building approval, moisture report or structural inspection. Confirm the output you need before booking.</p></article></section>

    <section className="assessment-section" aria-labelledby="assessment-process-title"><div className="guide-section-heading"><span>What happens next</span><h2 id="assessment-process-title">From the first call to a useful result</h2></div><ol className="assessment-process"><li><span>01</span><div><h3>Tell us about the home</h3><p>We check the location, project stage and what the assessment needs to help you do.</p></div></li><li><span>02</span><div><h3>Gather the right information</h3><p>For a design, that means current plans and specifications. For an existing home, it means safe access to the property and its fixed systems.</p></div></li><li><span>03</span><div><h3>Assess and clarify</h3><p>The assessor records the evidence, explains any missing details and tests relevant options where they are part of the scope.</p></div></li><li><span>04</span><div><h3>Receive the agreed result</h3><p>You receive the certificate, rating or guidance named in the quote, together with the important assumptions and limits.</p></div></li><li><span>05</span><div><h3>Tell us if the project changes</h3><p>Changes to plans, products or the home can affect the result, so the assessment may need to be checked again.</p></div></li></ol></section>

    <section className="assessment-two-column"><article><span>Clear pricing</span><h2>How much does a home energy assessment cost?</h2><p>There is no honest single price for every assessment. The quote depends on the service, home size, project complexity, location, travel, plans already available and the certificate or report you need. We confirm the scope and price before paid work starts.</p><Link href="/guides/free-home-energy-assessments">See what affects the price and when funding may apply</Link></article><article><span>Independent help</span><h2>Why speak with Australian Energy Assessments?</h2><p>We explain the options in plain language, separate current Home Energy Rating terms from older names and link to the official rules behind our guidance. The first five-minute call is only to check what you need.</p><Link href="/team">Meet the assessment team</Link><Link href="/book-an-assessment">Book the five-minute call</Link></article></section>

    <section className="assessment-two-column"><article><span>NatHERS boundary</span><h2>Assessment expertise does not replace the approval authority</h2><p>A valid NatHERS certificate uses accredited software and the relevant assessor pathway. The certifier, council, consent authority and current building rules determine what evidence the project must submit and accept.</p><a href="https://www.homeenergyrating.gov.au/about/about-us/nationwide-house-energy-rating-scheme-nathers" target="_blank" rel="noopener noreferrer">Read the official NatHERS scheme overview</a></article><article><span>BASIX thermal methods</span><h2>Choose the method that fits the NSW project</h2><p>NSW guidance provides DIY, NatHERS simulation and Passive House methods for eligible project types. Complex and multi-dwelling projects may require simulation using NatHERS accredited software.</p><a href="https://www.planningportal.nsw.gov.au/basix-thermal-performance-section" target="_blank" rel="noopener noreferrer">Confirm the official thermal performance methods</a></article></section>

    <section className="assessment-upload-boundary"><div><span>Not sure where to start?</span><h2>Tell us what you are working on</h2><p>The five-minute call checks the location, whether the home is built or still on plans and what result you need. It is a simple logistics call, not the assessment itself.</p></div><Link href="/book-an-assessment">Book now</Link></section>

    <SiteFooter>Assessment information is general until the project location, scope, evidence and approval pathway are confirmed. Requirements can change, and the relevant authority remains the source of truth.</SiteFooter>
  </main>;
}
