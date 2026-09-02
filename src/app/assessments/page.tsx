import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PUBLIC_SITE } from "@/lib/public-site";

export const metadata: Metadata = {
  title: "Home Energy Assessments, NatHERS and BASIX | Australian Energy Assessments",
  description: "Australia-wide desktop NatHERS and Whole of Home services, plus on-site existing-home ratings with primary field coverage in NSW and Victoria.",
  alternates: { canonical: "/assessments" },
  openGraph: {
    title: "Home Energy Assessments, NatHERS and BASIX",
    description: "Clear guidance for choosing a new-home NatHERS assessment, an existing-home Home Energy Rating or NSW BASIX support.",
    url: "/assessments",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Home Energy Assessments, NatHERS and BASIX",
    description: "Choose the right assessment pathway for an Australian home or residential project.",
  },
};

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

const assessmentHubSchema = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": `${PUBLIC_SITE.apexUrl}/assessments#webpage`,
  url: `${PUBLIC_SITE.apexUrl}/assessments`,
  name: "Home Energy Assessments, NatHERS and BASIX",
  description: metadata.description,
  inLanguage: "en-AU",
  isPartOf: { "@id": PUBLIC_SITE.websiteId },
  about: { "@id": PUBLIC_SITE.organizationId },
  breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
      { "@type": "ListItem", position: 2, name: "Home energy assessments", item: `${PUBLIC_SITE.apexUrl}/assessments` },
    ],
  },
} as const;

export default function AssessmentsPage() {
  return <main className="wrap assessments-page">
    <JsonLd data={assessmentHubSchema} />
    <SiteHeader active="assessments" />
    <header className="guide-hero assessments-hero"><span>Home energy assessments and ratings</span><h1>Which do I need: NatHERS, Home Energy Rating or BASIX?</h1><p>Still on plans? We can assess a new home or major renovation anywhere in Australia. Already built? We visit the home, currently mainly in New South Wales and Victoria. Building or renovating in NSW? You may also need BASIX.</p></header>

    <div className="assessment-asat"><strong>Official guidance checked 1 September 2026</strong><span>Requirements can change by location and project. We explain the likely pathway, but your certifier, council or approval authority confirms what is required.</span></div>

    <section className="assessment-section" aria-labelledby="assessment-pathways-title"><div className="guide-section-heading"><span>Start with the home</span><h2 id="assessment-pathways-title">Match the assessment to the project stage</h2></div><div className="assessment-card-grid">{pathways.map((pathway) => <article className="assessment-card" key={pathway.title}><div><span>{pathway.label}</span><h3>{pathway.title}</h3><p>{pathway.description}</p></div><div className="assessment-boundary"><strong>Important limit</strong><p>{pathway.boundary}</p></div><div className="assessment-evidence"><strong>What to have ready</strong><ul>{pathway.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="assessment-output"><strong>What you receive</strong><p>{pathway.output}</p></div><Link href={pathway.internalHref}>See how it works</Link><a href={pathway.href} target="_blank" rel="noopener noreferrer">Check the {pathway.source}</a></article>)}</div></section>

    <section className="assessment-two-column"><article><span>2026 terminology</span><h2>Home Energy Rating is the new existing-home consumer brand</h2><p>People still search for an existing-home NatHERS assessment, NatHERS assessor, energy assessor or Residential Efficiency Scorecard. Since 1 July 2026, the official existing-home output is a Home Energy Rating and Star Rating. The Residential Efficiency Scorecard service closed on 23 June 2026.</p><Link href="/home-energy-rating-vs-nathers-vs-scorecard">Compare current and legacy rating terms</Link><Link href="/residential-efficiency-scorecard">Read the Scorecard transition guide</Link><Link href="/faq">Read the home energy assessment FAQ</Link></article><article><span>A common distinction</span><h2>Whole of Home is a new-home rating</h2><p>Whole of Home is the 0 to 100+ measure on a new-home certificate. Existing homes now receive a Home Energy Rating from 0 to 100+. Keeping these terms separate helps prevent the wrong certificate being used for a project.</p><Link href="/nathers-whole-of-home">Understand Whole of Home</Link></article></section>

    <section className="assessment-two-column"><article><span>Business sites</span><h2>Commercial work starts with the scope</h2><p>An office, shop, warehouse and industrial process do not need the same audit. Start with the site, available energy data and the decision the report needs to support.</p><Link href="/commercial-and-industrial-assessments">Explore commercial energy assessments</Link></article><article><span>Victorian rentals</span><h2>Understand the 2027 to 2030 energy standards</h2><p>Heating, cooling, hot water, showerheads, ceiling insulation and draughtproofing have different dates and triggers. A rating can help with planning, but it does not prove legal compliance.</p><Link href="/minimum-rental-standards">Read the rental standards guide</Link><Link href="/rental-assessment/request">Request a property review</Link></article></section>

    <section className="assessment-section" aria-labelledby="assessment-process-title"><div className="guide-section-heading"><span>What happens next</span><h2 id="assessment-process-title">From the first call to a useful result</h2></div><ol className="assessment-process"><li><span>01</span><div><h3>Tell us about the home</h3><p>We check the location, project stage and what the assessment needs to help you do.</p></div></li><li><span>02</span><div><h3>Gather the right information</h3><p>For a design, that means current plans and specifications. For an existing home, it means safe access to the property and its fixed systems.</p></div></li><li><span>03</span><div><h3>Assess and clarify</h3><p>The assessor records the evidence, explains any missing details and tests relevant options where they are part of the scope.</p></div></li><li><span>04</span><div><h3>Receive the agreed result</h3><p>You receive the certificate, rating or guidance named in the quote, together with the important assumptions and limits.</p></div></li><li><span>05</span><div><h3>Tell us if the project changes</h3><p>Changes to plans, products or the home can affect the result, so the assessment may need to be checked again.</p></div></li></ol></section>

    <section className="assessment-two-column"><article><span>NatHERS boundary</span><h2>Assessment expertise does not replace the approval authority</h2><p>A valid NatHERS certificate uses accredited software and the relevant assessor pathway. The certifier, council, consent authority and current building rules determine what evidence the project must submit and accept.</p><a href="https://www.homeenergyrating.gov.au/about/about-us/nationwide-house-energy-rating-scheme-nathers" target="_blank" rel="noopener noreferrer">Read the official NatHERS scheme overview</a></article><article><span>BASIX thermal methods</span><h2>Choose the method that fits the NSW project</h2><p>NSW guidance provides DIY, NatHERS simulation and Passive House methods for eligible project types. Complex and multi-dwelling projects may require simulation using NatHERS accredited software.</p><a href="https://www.planningportal.nsw.gov.au/basix-thermal-performance-section" target="_blank" rel="noopener noreferrer">Confirm the official thermal performance methods</a></article></section>

    <section className="assessment-upload-boundary"><div><span>Not sure where to start?</span><h2>Tell us what you are working on</h2><p>The five-minute call checks the location, whether the home is built or still on plans and what result you need. It is a simple logistics call, not the assessment itself.</p></div><Link href="/book-an-assessment">Book now</Link></section>

    <SiteFooter>Assessment information is general until the project location, scope, evidence and approval pathway are confirmed. Requirements can change, and the relevant authority remains the source of truth.</SiteFooter>
  </main>;
}
