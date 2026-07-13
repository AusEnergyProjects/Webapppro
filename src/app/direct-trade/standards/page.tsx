import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";

export const metadata: Metadata = {
  title: "Direct Trade Standards | Australian Energy Assessments",
  description: "How Direct Trade Services reviews participants, matches projects and expects household upgrade quotes to be presented.",
};

const standards = [
  { number: "01", title: "Business and credential review", text: "Confirm the legal business identity, relevant trade licence or registration, service area and appropriate insurance before activating an installer for that work type." },
  { number: "02", title: "Scheme approval is checked separately", text: "Where a certificate, rebate or program requires a specific installer approval, that approval must be current and relevant to the proposed activity. Direct Trade membership does not replace it." },
  { number: "03", title: "Products need evidence and support", text: "Suppliers should identify product models, applicable compliance evidence, warranty terms, Australian support arrangements and any installation or commissioning requirements." },
  { number: "04", title: "Matching follows the project", text: "Location, work type, verified capability, service coverage and availability guide a connection. A subscription does not buy higher placement, exclusivity or a guaranteed volume of opportunities." },
  { number: "05", title: "Quotes make the scope visible", text: "Equipment, labour, electrical or building work, certificates, rebates, optional extras, exclusions, timing, payment terms and warranties should be distinguishable before acceptance." },
  { number: "06", title: "Households stay in control", text: "A connection is not an instruction to buy. Households can ask questions, compare quotes, confirm credentials with the issuing authority and decline without creating an installation contract." },
];

export default function DirectTradeStandardsPage() {
  return <main className="wrap direct-trade-standards-page">
    <SiteHeader active="direct-trade-standards" />
    <header className="guide-hero"><span>Direct Trade Services</span><h1>The rules behind a trustworthy connection</h1><p>These standards explain what Australian Energy Assessments checks, how projects are matched and what households should see before agreeing to work. They apply alongside every legal, licensing, safety, scheme and consumer obligation.</p></header>

    <section className="standards-intro" aria-labelledby="standards-principle-title"><div><span>Core principle</span><h2 id="standards-principle-title">The work should determine the trade, not the biggest sales margin</h2><p>Direct Trade Services is designed to shorten the path between a household, qualified installers and reputable product suppliers. Participation is reviewed, matching is based on project fit and the household receives the trade&apos;s own scope and quote.</p></div><aside><strong>Subscription is disclosed</strong><p>Participating installers fund access to the service through a subscription. It does not replace verification and it does not purchase a favourable ranking.</p></aside></section>

    <section className="guide-section" aria-labelledby="standards-list-title"><div className="guide-section-heading"><span>Marketplace standard</span><h2 id="standards-list-title">Six checks from participation to decision</h2></div><div className="standards-grid">{standards.map((standard) => <article key={standard.number}><span>{standard.number}</span><h3>{standard.title}</h3><p>{standard.text}</p></article>)}</div></section>

    <section className="guide-section" aria-labelledby="quote-standard-title"><div className="guide-section-heading"><span>Before acceptance</span><h2 id="quote-standard-title">What a useful written quote should let you confirm</h2></div><div className="standards-checklist"><article><h3>Who is responsible</h3><ul><li>Legal business name and contact details</li><li>The contracting party and the licensed trade performing regulated work</li><li>Licence, registration and scheme approval relevant to the job</li><li>Subcontracting arrangements where they affect responsibility</li></ul></article><article><h3>What is being supplied</h3><ul><li>Product brand, model, quantity and capacity</li><li>Design assumptions, site conditions and included labour</li><li>Electrical, plumbing, roofing or building work included or excluded</li><li>Commissioning, handover and monitoring arrangements</li></ul></article><article><h3>What changes the price</h3><ul><li>Equipment, labour and optional extras shown clearly</li><li>Certificate or rebate assumptions shown separately</li><li>Deposit, progress and final payment terms</li><li>Expiry, variation process and foreseeable extra charges</li></ul></article><article><h3>What happens afterwards</h3><ul><li>Product and workmanship warranty terms</li><li>Who handles faults, warranty claims and service</li><li>Required certificates, manuals and completion records</li><li>Complaint contact and escalation path</li></ul></article></div></section>

    <section className="standards-boundaries" aria-labelledby="standards-boundaries-title"><div><span>Ongoing review</span><h2 id="standards-boundaries-title">Participation can be paused or ended</h2><p>Expired or unverifiable credentials, misleading rebate or savings claims, pressure selling, repeated scope or warranty failures, privacy breaches and unresolved serious complaints can trigger review, suspension or removal.</p></div><div><span>Privacy boundary</span><h2>Share only what the next step needs</h2><p>The initial household and partner forms deliberately avoid meter files, bills, identity documents, licence files and confidential commercial records. Verification evidence can be requested through an appropriate controlled process when required.</p></div></section>

    <section className="standards-actions"><div><span>Choose your path</span><h2>Use the standards before making a connection</h2><p>Households can prepare a project brief. Installers and suppliers can submit an expression of interest for direct review.</p></div><div><a className="btn" href="/direct-trade">Start a household brief</a><a className="btn ghost" href="/direct-trade/partners">Trade and supplier participation</a></div></section>
    <SiteFooter>These marketplace standards do not replace Australian Consumer Law, trade licensing, safety rules, scheme requirements, product standards, contracts or independent legal advice.</SiteFooter>
  </main>;
}
