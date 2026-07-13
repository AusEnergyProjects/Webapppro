"use client";

import { useState } from "react";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";

type Program = { title: string; locations: string[]; categories: string; administrator: string; caveat: string; href: string };

const locations = [
  ["ACT", "Australian Capital Territory"], ["NSW", "New South Wales"], ["NT", "Northern Territory"],
  ["Qld", "Queensland"], ["SA", "South Australia"], ["Tas", "Tasmania"], ["Vic", "Victoria"], ["WA", "Western Australia"],
] as const;

const nationalPrograms: Program[] = [
  { title: "Small-scale Renewable Energy Scheme", locations: ["ALL"], categories: "Solar PV, solar hot water and eligible heat pump hot water", administrator: "Australian Government, Clean Energy Regulator", caveat: "Certificates are conditional on system, product, installer and installation requirements. The benefit is normally arranged through an installer or retailer.", href: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems" },
  { title: "Cheaper Home Batteries Program", locations: ["ALL"], categories: "Eligible small-scale batteries connected to new or existing rooftop solar", administrator: "Australian Government, Clean Energy Regulator", caveat: "Eligibility depends on the battery, inverter, installer, connection and certificate rules. Ask for the certificate assumption in the written quote.", href: "https://www.energy.gov.au/households/solar-pv-and-batteries" },
  { title: "Household Energy Upgrades Fund", locations: ["ALL"], categories: "Solar, batteries, insulation, glazing and modern energy-efficient appliances", administrator: "Australian Government, Clean Energy Finance Corporation and participating lenders", caveat: "This is discounted finance, not a universal rebate. Lenders set their own product, property, evidence and eligibility requirements.", href: "https://www.energy.gov.au/rebates/household-energy-upgrades-fund" },
];

const localPrograms: Program[] = [
  { title: "Sustainable Household Scheme", locations: ["ACT"], categories: "Battery storage, heating and cooling, heat pump or solar hot water, ceiling insulation", administrator: "ACT Government", caveat: "An eligible ACT resident may apply for a government-supported loan. Confirm residency, product and repayment requirements before signing a quote.", href: "https://www.energy.gov.au/rebates/home-energy-efficiency-advice" },
  { title: "Home Energy Saver", locations: ["NSW"], categories: "Solar, batteries, heat pump or solar hot water, heating, insulation and draught proofing", administrator: "NSW Government", caveat: "Eligibility and the available discount or loan depend on the current program rules, applicant type and upgrade. Check the official application path.", href: "https://www.energy.gov.au/rebates/home-energy-saver" },
  { title: "Victorian Energy Upgrades", locations: ["Vic"], categories: "Heating and cooling, heat pump or solar hot water, efficient appliances and draught sealing", administrator: "Victorian Government", caveat: "Discounts usually require an approved product and an accredited provider. The discount is not a cash payment to every household.", href: "https://www.energy.vic.gov.au/victorian-energy-upgrades/homes" },
  { title: "Solar Homes Program", locations: ["Vic"], categories: "Rooftop solar, solar hot water and eligible heat pump hot water", administrator: "Solar Victoria", caveat: "Product, property, applicant and installation rules apply. Check current availability and the approved product or provider requirements before relying on a quote.", href: "https://www.solar.vic.gov.au/" },
  { title: "South Australian energy assistance", locations: ["SA"], categories: "Energy advice, bill concessions and energy efficiency support", administrator: "Government of South Australia", caveat: "Support varies by household circumstances and program. Use the official assistance pages to check your eligibility and the current application process.", href: "https://www.energy.gov.au/state/sa" },
  { title: "Queensland energy assistance", locations: ["Qld"], categories: "Energy bill rebates, emergency assistance and household support", administrator: "Queensland Government", caveat: "Some assistance is for bills or emergencies rather than equipment upgrades. Concession, retailer, property and hardship rules apply.", href: "https://www.energy.gov.au/state/qld" },
  { title: "Western Australia energy assistance", locations: ["WA"], categories: "Solar export support, bill assistance and household energy information", administrator: "Western Australian Government", caveat: "Export payments and concessions are separate from an equipment rebate. Check the current network, retailer and household eligibility rules.", href: "https://www.energy.gov.au/state/wa" },
  { title: "Tasmania energy assistance", locations: ["Tas"], categories: "Energy concessions and household energy support", administrator: "Tasmanian Government", caveat: "The available help depends on concession status, residence and the type of support. Confirm the current state program before making an upgrade decision.", href: "https://www.energy.gov.au/state/tas" },
  { title: "Northern Territory energy assistance", locations: ["NT"], categories: "Electricity concessions, solar export information and household support", administrator: "Northern Territory Government", caveat: "Remote area, tariff, concession and system rules may apply. Confirm the current terms with the official program or your retailer.", href: "https://www.energy.gov.au/state/nt" },
];

function ProgramCard({ program }: { program: Program }) {
  return <article className="rebate-card"><div className="rebate-card-top"><span>Official program</span><small>{program.administrator}</small></div><h3>{program.title}</h3><p className="rebate-categories"><strong>May relate to:</strong> {program.categories}</p><p>{program.caveat}</p><a href={program.href} target="_blank" rel="noreferrer">Open official source and confirm</a></article>;
}

export function RebatesHub() {
  const [location, setLocation] = useState("");
  const selectedName = locations.find(([code]) => code === location)?.[1];
  const visibleLocal = localPrograms.filter((program) => program.locations.includes(location));

  return <main className="wrap guide-page rebates-page">
    <SiteHeader active="rebates" />
    <header className="guide-hero"><span>Rebates and assistance</span><h1>Find the support that may apply to your home</h1><p>Programs change by location, household circumstances, product and installer. Use this hub to find the official source, then confirm the current rules before relying on a discount in a quote.</p></header>

    <section className="rebate-asat" aria-label="Information date"><strong>Information checked 14 July 2026</strong><span>Official program pages remain the source of truth. Availability, funding and eligibility can change.</span></section>

    <section className="guide-section" aria-labelledby="location-title"><div className="guide-section-heading"><span>Step 1</span><h2 id="location-title">Choose your state or territory</h2></div><div className="rebate-location-panel"><label htmlFor="rebate-location">Where is the home located?<select id="rebate-location" value={location} onChange={(event) => setLocation(event.target.value)}><option value="">Select a state or territory</option>{locations.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>{location ? <p><strong>{selectedName}</strong> selected. National programs are shown below, followed by support identified for this location.</p> : <p>Select a location to reveal local programs. A national program does not mean every household or every product qualifies.</p>}</div></section>

    <section className="guide-section" aria-labelledby="national-title"><div className="guide-section-heading"><span>Step 2</span><h2 id="national-title">Federal certificates and programs</h2></div><p className="rebate-intro">These programs can apply across Australia, subject to their own rules. They are not automatically available for every installation.</p><div className="rebate-card-grid">{nationalPrograms.map((program) => <ProgramCard key={program.title} program={program} />)}</div></section>

    <section className="guide-section" aria-labelledby="local-title"><div className="guide-section-heading"><span>Step 3</span><h2 id="local-title">State, territory and provider support</h2></div>{location ? <><p className="rebate-intro">Showing support identified for {selectedName}. The official page is the confirmation link for each item.</p><div className="rebate-card-grid">{visibleLocal.map((program) => <ProgramCard key={program.title} program={program} />)}</div><div className="guide-note"><strong>Nothing here is a national promise.</strong><p>Some local support is a concession, loan, provider discount or bill assistance rather than an equipment rebate. Ask the administering body whether it can be combined with a federal certificate or another offer.</p></div></> : <div className="rebate-empty">Choose a state or territory above to see location-specific support.</div>}</section>

    <section className="guide-callout"><div><h2>Before you accept a rebate claim</h2><p>Ask for the program name, official administrator, as-at date, eligible product model, installer status, certificate or discount calculation, and every condition that could change the quoted price.</p></div><a href="/guides">Read the upgrade guides</a></section>
    <SiteFooter>Rebates and assistance are indicative starting points. Confirm current eligibility, funding, product rules, installer requirements and final pricing with the official administrator before committing.</SiteFooter>
  </main>;
}
