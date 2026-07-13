import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";

export const metadata = {
  title: "NatHERS and BASIX Assessments | Australian Energy Assessments",
  description: "NatHERS assessment services for new and existing homes, plus BASIX support for NSW residential projects.",
};

const pathways = [
  {
    label: "New homes and major renovations",
    title: "NatHERS design assessment",
    boundary: "Confirm the current National Construction Code pathway and the requirements adopted in your state or territory.",
    description: "A new home NatHERS assessment uses plans and design documents before construction to test thermal performance and, where applicable, Whole of Home energy performance.",
    evidence: ["Current floor plans, elevations and sections", "Construction, insulation, glazing and shading specifications", "Orientation, site details and proposed fixed appliances", "The certifier, council or approval pathway requirements"],
    output: "The relevant NatHERS certificate and design feedback, subject to complete documentation and the applicable approval pathway.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
    source: "official NatHERS new homes guidance",
  },
  {
    label: "Homes that are already built",
    title: "Existing home energy rating",
    boundary: "This pathway assesses the home as it exists, including the current building and appliances. It is different from a plan-based new home certificate.",
    description: "A Home Energy Rating can show current performance and help prioritise improvements for comfort, energy use and running costs before renovating, selling, renting or upgrading.",
    evidence: ["Access to the home for the required assessment", "Existing building fabric, windows, shading and orientation", "Current heating, cooling, hot water and other fixed appliances", "Known renovations and the household decision the rating should support"],
    output: "A Home Energy Rating certificate that records current performance and supports upgrade planning and progress tracking.",
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
    href: "https://www.planningportal.nsw.gov.au/basix/about-basix",
    source: "official NSW BASIX guidance",
  },
] as const;

export default function AssessmentsPage() {
  return <main className="wrap assessments-page">
    <SiteHeader active="assessments" />
    <header className="guide-hero assessments-hero"><span>NatHERS and BASIX</span><h1>Assessment evidence for better homes and compliant designs</h1><p>Australian Energy Assessments specialises in NatHERS for new and existing homes, plus BASIX support for NSW residential projects. Start with the building stage, location and approval pathway so the right evidence is assessed.</p></header>

    <div className="assessment-asat"><strong>Official guidance checked 14 July 2026</strong><span>Building, planning and assessment requirements can change. Confirm the current rules for the project location and approval pathway before relying on a certificate or rating.</span></div>

    <section className="assessment-section" aria-labelledby="assessment-pathways-title"><div className="guide-section-heading"><span>Choose the pathway</span><h2 id="assessment-pathways-title">New design, existing home or NSW BASIX</h2></div><div className="assessment-card-grid">{pathways.map((pathway) => <article className="assessment-card" key={pathway.title}><div><span>{pathway.label}</span><h3>{pathway.title}</h3><p>{pathway.description}</p></div><div className="assessment-boundary"><strong>Where it applies</strong><p>{pathway.boundary}</p></div><div className="assessment-evidence"><strong>Useful evidence to prepare</strong><ul>{pathway.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="assessment-output"><strong>Expected output</strong><p>{pathway.output}</p></div><a href={pathway.href} target="_blank" rel="noreferrer">Confirm with {pathway.source}</a></article>)}</div></section>

    <section className="assessment-section" aria-labelledby="assessment-process-title"><div className="guide-section-heading"><span>A controlled process</span><h2 id="assessment-process-title">Keep the model, certificate and project aligned</h2></div><ol className="assessment-process"><li><span>01</span><div><h3>Confirm the pathway</h3><p>Identify the state or territory, building stage, approval route and the decision the assessment must support.</p></div></li><li><span>02</span><div><h3>Gather current evidence</h3><p>Use coordinated plans and specifications for a design assessment, or the actual building and appliances for an existing home rating.</p></div></li><li><span>03</span><div><h3>Model and resolve gaps</h3><p>Record assumptions, flag missing details and test design changes before treating an indicative option as a project commitment.</p></div></li><li><span>04</span><div><h3>Issue the relevant evidence</h3><p>Provide the certificate, rating or project commitments required for the confirmed pathway, subject to complete and consistent inputs.</p></div></li><li><span>05</span><div><h3>Control later changes</h3><p>Keep the approved plans, specifications and commitments aligned when products, layouts or construction details change.</p></div></li></ol></section>

    <section className="assessment-two-column"><article><span>NatHERS boundary</span><h2>Assessment expertise does not replace the approval authority</h2><p>NatHERS assessments are delivered using accredited software and the relevant assessor pathway. The certifier, council, consent authority and current building rules determine what evidence the project must submit and accept.</p><a href="https://www.homeenergyrating.gov.au/about/about-us/nationwide-house-energy-rating-scheme-nathers" target="_blank" rel="noreferrer">Read the official NatHERS scheme overview</a></article><article><span>BASIX thermal methods</span><h2>Choose the method that fits the NSW project</h2><p>NSW guidance provides DIY, NatHERS simulation and Passive House methods for eligible project types. Complex and multi-dwelling projects may require simulation using NatHERS accredited software.</p><a href="https://www.planningportal.nsw.gov.au/basix-thermal-performance-section" target="_blank" rel="noreferrer">Confirm the official thermal performance methods</a></article></section>

    <section className="assessment-upload-boundary"><div><span>Future capability, not live today</span><h2>Secure online document review is not available yet</h2><p>Do not upload or place house plans, NatHERS certificates, BASIX files, addresses or identity documents into the public project brief. A future review tool would need controlled storage, access, retention and audit safeguards before document feedback could be offered safely.</p></div><a href="/direct-trade">Start a privacy-safe assessment brief</a></section>

    <SiteFooter>Assessment information is general until the project location, scope, evidence and approval pathway are confirmed. Requirements can change, and the relevant authority remains the source of truth.</SiteFooter>
  </main>;
}
