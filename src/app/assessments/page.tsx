import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PUBLIC_SITE } from "@/lib/public-site";

export const metadata: Metadata = {
  title: "Home Energy Assessments, NatHERS and BASIX | Australian Energy Assessments",
  description: "Australia-wide NatHERS and home energy assessment support, with primary on-site coverage in NSW and Victoria, plus Whole of Home and NSW BASIX guidance.",
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
    boundary: "Confirm the current National Construction Code pathway and the requirements adopted in your state or territory.",
    description: "A new home NatHERS assessment uses plans and design documents before construction to test thermal performance and, where applicable, Whole of Home energy performance.",
    evidence: ["Current floor plans, elevations and sections", "Construction, insulation, glazing and shading specifications", "Orientation, site details and proposed fixed appliances", "The certifier, council or approval pathway requirements"],
    output: "The relevant NatHERS certificate and design feedback, subject to complete documentation and the applicable approval pathway.",
    internalHref: "/nathers-for-new-homes",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
    source: "official NatHERS new homes guidance",
  },
  {
    label: "Homes that are already built",
    title: "Existing-home Home Energy Rating",
    boundary: "This on-site pathway assesses the home as it exists. It does not provide a new-home certificate and cannot demonstrate National Construction Code compliance.",
    description: "The Home Energy Rating consumer brand launched on 1 July 2026. Under the current brand, an existing-home assessment can provide a Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, estimated annual energy use and upgrade guidance.",
    evidence: ["Access to the home for the required assessment", "Existing building fabric, windows, shading and orientation", "Current heating, cooling, hot water and other fixed appliances", "Known renovations and the household decision the rating should support"],
    output: "A Home Energy Rating certificate with the rating measures, modelled annual energy use and practical upgrade guidance. Modelled results do not guarantee actual bills or savings.",
    internalHref: "/home-energy-rating-for-existing-homes",
    href: "https://www.homeenergyrating.gov.au/households/existing-homes",
    source: "official existing homes guidance",
  },
  {
    label: "NSW residential development",
    title: "BASIX assessment support",
    boundary: "BASIX is a NSW planning requirement. Official guidance currently covers new dwellings, alterations and additions costing $50,000 or more, and swimming pools of 40,000 litres or more.",
    description: "BASIX assesses water, energy, thermal performance and embodied emissions or materials. The resulting commitments must remain aligned with the plans submitted for the relevant development approval pathway.",
    evidence: ["NSW Planning Portal project and development details", "Plans, areas, construction and glazing specifications", "Water, landscaping, pool and fixed energy system selections", "The nominated thermal performance method and approval pathway"],
    output: "BASIX inputs, commitments and certificate support relevant to the project scope. Final submission requirements remain subject to the NSW Planning Portal and consent authority.",
    internalHref: "/basix-nsw",
    href: "https://www.planningportal.nsw.gov.au/basix/about-basix",
    source: "official NSW BASIX guidance",
  },
] as const;

const assessmentHubSchema = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "@id": `${PUBLIC_SITE.platformUrl}/assessments#webpage`,
  url: `${PUBLIC_SITE.platformUrl}/assessments`,
  name: "Home Energy Assessments, NatHERS and BASIX",
  description: metadata.description,
  inLanguage: "en-AU",
  isPartOf: { "@id": PUBLIC_SITE.websiteId },
  about: { "@id": PUBLIC_SITE.organizationId },
  breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.platformUrl}/` },
      { "@type": "ListItem", position: 2, name: "Home energy assessments", item: `${PUBLIC_SITE.platformUrl}/assessments` },
    ],
  },
} as const;

export default function AssessmentsPage() {
  return <main className="wrap assessments-page">
    <JsonLd data={assessmentHubSchema} />
    <SiteHeader active="assessments" />
    <header className="guide-hero assessments-hero"><span>Home energy assessments and ratings</span><h1>NatHERS, Home Energy Rating and BASIX assessment pathways</h1><p>Australian Energy Assessments supports projects across Australia and helps homeowners and project teams identify the right assessment for a new design, an existing home or a NSW residential project. On-site assessments are primarily delivered in New South Wales and Victoria, with other locations confirmed case by case.</p></header>

    <div className="assessment-asat"><strong>Official guidance checked 1 September 2026</strong><span>Building, planning and assessment requirements can change. Confirm the current rules for the project location and approval pathway before relying on a certificate or rating.</span></div>

    <section className="assessment-section" aria-labelledby="assessment-pathways-title"><div className="guide-section-heading"><span>Choose the pathway</span><h2 id="assessment-pathways-title">New design, existing home or NSW BASIX</h2></div><div className="assessment-card-grid">{pathways.map((pathway) => <article className="assessment-card" key={pathway.title}><div><span>{pathway.label}</span><h3>{pathway.title}</h3><p>{pathway.description}</p></div><div className="assessment-boundary"><strong>Where it applies</strong><p>{pathway.boundary}</p></div><div className="assessment-evidence"><strong>Useful evidence to prepare</strong><ul>{pathway.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="assessment-output"><strong>Expected output</strong><p>{pathway.output}</p></div><Link href={pathway.internalHref}>Explore this assessment</Link><a href={pathway.href} target="_blank" rel="noopener noreferrer">Confirm with {pathway.source}</a></article>)}</div></section>

    <section className="assessment-two-column"><article><span>2026 terminology</span><h2>Home Energy Rating is the new existing-home consumer brand</h2><p>People still search for an existing-home NatHERS assessment, NatHERS assessor, energy assessor or Residential Efficiency Scorecard. Since 1 July 2026, the official existing-home output is a Home Energy Rating and Star Rating. The Residential Efficiency Scorecard service closed on 23 June 2026.</p><Link href="/home-energy-rating-vs-nathers-vs-scorecard">Compare current and legacy rating terms</Link><Link href="/residential-efficiency-scorecard">Read the Scorecard transition guide</Link></article><article><span>A common distinction</span><h2>Whole of Home is a new-home rating</h2><p>Whole of Home is the 0 to 100+ measure on a new-home certificate. Existing homes now receive a Home Energy Rating from 0 to 100+. Keeping these terms separate helps prevent the wrong certificate being used for a project.</p><Link href="/nathers-whole-of-home">Understand Whole of Home</Link></article></section>

    <section className="assessment-section" aria-labelledby="assessment-process-title"><div className="guide-section-heading"><span>A controlled process</span><h2 id="assessment-process-title">Keep the model, certificate and project aligned</h2></div><ol className="assessment-process"><li><span>01</span><div><h3>Confirm the pathway</h3><p>Identify the state or territory, building stage, approval route and the decision the assessment must support.</p></div></li><li><span>02</span><div><h3>Gather current evidence</h3><p>Use coordinated plans and specifications for a design assessment, or the actual building and appliances for an existing home rating.</p></div></li><li><span>03</span><div><h3>Model and resolve gaps</h3><p>Record assumptions, flag missing details and test design changes before treating an indicative option as a project commitment.</p></div></li><li><span>04</span><div><h3>Issue the relevant evidence</h3><p>Provide the certificate, rating or project commitments required for the confirmed pathway, subject to complete and consistent inputs.</p></div></li><li><span>05</span><div><h3>Control later changes</h3><p>Keep the approved plans, specifications and commitments aligned when products, layouts or construction details change.</p></div></li></ol></section>

    <section className="assessment-two-column"><article><span>NatHERS boundary</span><h2>Assessment expertise does not replace the approval authority</h2><p>A valid NatHERS certificate uses accredited software and the relevant assessor pathway. The certifier, council, consent authority and current building rules determine what evidence the project must submit and accept.</p><a href="https://www.homeenergyrating.gov.au/about/about-us/nationwide-house-energy-rating-scheme-nathers" target="_blank" rel="noopener noreferrer">Read the official NatHERS scheme overview</a></article><article><span>BASIX thermal methods</span><h2>Choose the method that fits the NSW project</h2><p>NSW guidance provides DIY, NatHERS simulation and Passive House methods for eligible project types. Complex and multi-dwelling projects may require simulation using NatHERS accredited software.</p><a href="https://www.planningportal.nsw.gov.au/basix-thermal-performance-section" target="_blank" rel="noopener noreferrer">Confirm the official thermal performance methods</a></article></section>

    <section className="assessment-upload-boundary"><div><span>Ready to discuss the project?</span><h2>Book the right home energy assessment</h2><p>Tell us whether the home is proposed, under construction, being renovated or already built. We can then confirm the assessment pathway and the evidence needed before work starts.</p></div><Link href="/book-an-assessment">Book an assessment</Link></section>

    <section className="assessment-upload-boundary"><div><span>Victorian rental properties</span><h2>Request a minimum standards assessment without an account</h2><p>Rental minimum standards are included. Electrical, gas and smoke alarm checks are separate and remain off unless you request them. Sending the form starts a review, not a booking.</p></div><Link href="/rental-assessment/request">Request a rental assessment</Link></section>

    <SiteFooter>Assessment information is general until the project location, scope, evidence and approval pathway are confirmed. Requirements can change, and the relevant authority remains the source of truth.</SiteFooter>
  </main>;
}
