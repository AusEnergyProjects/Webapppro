/* eslint-disable @next/next/no-html-link-for-pages */
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";

export const metadata: Metadata = {
  title: "Direct Trade Standards | Australian Energy Assessments",
  description:
    "How Direct Trade Services reviews participants, matches projects and expects household upgrade quotes to be presented.",
};

const standards = [
  {
    number: "01",
    title: "Business and credential review",
    text: "Confirm the legal business identity, relevant trade licence or registration, service area and appropriate insurance before activating an installer for that work type.",
  },
  {
    number: "02",
    title: "Scheme approval is checked separately",
    text: "Where a certificate, rebate or program requires a specific installer approval, that approval must be current and relevant to the proposed activity. Direct Trade membership does not replace it.",
  },
  {
    number: "03",
    title: "Products need evidence and support",
    text: "Suppliers should identify product models, applicable compliance evidence, warranty terms, Australian support arrangements and any installation or commissioning requirements.",
  },
  {
    number: "04",
    title: "Matching is limited and fair",
    text: "An opportunity is shown to no more than six eligible installers. Postcode distance, the installer service radius, capability, verification, availability and recent allocation load guide the selection. A subscription does not buy higher placement, exclusivity or guaranteed work.",
  },
  {
    number: "05",
    title: "Household contact stays private",
    text: "Installers can review an anonymised scope and respond through structured platform controls. Customer names, emails, phone numbers, street addresses and direct messaging are not available to trade accounts.",
  },
  {
    number: "06",
    title: "Opportunities have a defined lifetime",
    text: "An active opportunity leaves installer dashboards after 30 days. It can close earlier when the household withdraws or the work is resolved, while the minimum operational audit record can be retained.",
  },
  {
    number: "07",
    title: "Quotes make the scope visible",
    text: "Equipment, labour, electrical or building work, certificates, rebates, optional extras, exclusions, timing, payment terms and warranties should be distinguishable before acceptance.",
  },
  {
    number: "08",
    title: "Households stay in control",
    text: "A response is not an instruction to buy. Households can compare structured options, confirm credentials with the issuing authority and decline without creating an installation contract or releasing contact details.",
  },
];

export default function DirectTradeStandardsPage() {
  return (
    <main className="wrap direct-trade-standards-page">
      <SiteHeader active="direct-trade-standards" />
      <header className="guide-hero">
        <span>Direct Trade Services</span>
        <h1>The rules behind a trustworthy connection</h1>
        <p>
          These standards explain what Australian Energy Assessments checks, how
          projects are matched and what households should see before agreeing to
          work. They apply alongside every legal, licensing, safety, scheme and
          consumer obligation.
        </p>
      </header>

      <section
        className="standards-intro"
        aria-labelledby="standards-principle-title"
      >
        <div>
          <span>Core principle</span>
          <h2 id="standards-principle-title">
            The work should determine the trade, not the biggest sales margin
          </h2>
          <p>
            Direct Trade Services is designed to shorten the path between a
            household, qualified installers and reputable product suppliers.
            Participation is reviewed, matching is based on project fit and the
            household receives structured scope and price options inside its
            private account.
          </p>
        </div>
        <aside>
          <strong>Subscription is disclosed</strong>
          <p>
            Paid membership will fund access to the service. It will not replace
            verification, purchase a favourable ranking or create a separate
            charge for each opportunity.
          </p>
        </aside>
      </section>

      <section className="guide-section" aria-labelledby="standards-list-title">
        <div className="guide-section-heading">
          <span>Marketplace standard</span>
          <h2 id="standards-list-title">
            Eight checks from participation to decision
          </h2>
        </div>
        <div className="standards-grid">
          {standards.map((standard) => (
            <article key={standard.number}>
              <span>{standard.number}</span>
              <h3>{standard.title}</h3>
              <p>{standard.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-section" aria-labelledby="quote-standard-title">
        <div className="guide-section-heading">
          <span>Before acceptance</span>
          <h2 id="quote-standard-title">
            What a useful written quote should let you confirm
          </h2>
        </div>
        <div className="standards-checklist">
          <article>
            <h3>Who is responsible</h3>
            <ul>
              <li>Legal business name and contact details</li>
              <li>
                The contracting party and the licensed trade performing
                regulated work
              </li>
              <li>
                Licence, registration and scheme approval relevant to the job
              </li>
              <li>
                Subcontracting arrangements where they affect responsibility
              </li>
            </ul>
          </article>
          <article>
            <h3>What is being supplied</h3>
            <ul>
              <li>Product brand, model, quantity and capacity</li>
              <li>Design assumptions, site conditions and included labour</li>
              <li>
                Electrical, plumbing, roofing or building work included or
                excluded
              </li>
              <li>Commissioning, handover and monitoring arrangements</li>
            </ul>
          </article>
          <article>
            <h3>What changes the price</h3>
            <ul>
              <li>Equipment, labour and optional extras shown clearly</li>
              <li>Certificate or rebate assumptions shown separately</li>
              <li>Deposit, progress and final payment terms</li>
              <li>Expiry, variation process and foreseeable extra charges</li>
            </ul>
          </article>
          <article>
            <h3>What happens afterwards</h3>
            <ul>
              <li>Product and workmanship warranty terms</li>
              <li>Who handles faults, warranty claims and service</li>
              <li>Required certificates, manuals and completion records</li>
              <li>Complaint contact and escalation path</li>
            </ul>
          </article>
        </div>
      </section>

      <section
        className="standards-boundaries"
        aria-labelledby="standards-boundaries-title"
      >
        <div>
          <span>Ongoing review</span>
          <h2 id="standards-boundaries-title">
            Participation can be paused or ended
          </h2>
          <p>
            Expired or unverifiable credentials, misleading rebate or savings
            claims, attempts to bypass the platform, hidden contact details,
            scope or warranty failures, privacy breaches and unresolved
            serious complaints can trigger review, suspension or removal.
          </p>
        </div>
        <div>
          <span>Privacy and role boundary</span>
          <h2>Share only what the next step needs</h2>
          <p>
            The initial household and partner forms deliberately avoid meter
            files, bills, identity documents, licence files and confidential
            commercial records. Wholesalers manage products and pricing only:
            they never see household opportunities or customer contact
            information.
          </p>
        </div>
      </section>

      <section className="standards-actions">
        <div>
          <span>Choose your path</span>
          <h2>Use the standards before making a connection</h2>
          <p>
            Households can create a free private project. Installers and
            suppliers can create a business profile for direct review.
          </p>
        </div>
        <div>
          <a className="btn" href="/account/projects/new">
            Create a private project
          </a>
          <a className="btn ghost" href="/direct-trade/partners">
            Trade and supplier participation
          </a>
          <a className="btn ghost" href="/direct-trade/membership">
            Membership and referrals
          </a>
        </div>
      </section>
      <SiteFooter>
        These marketplace standards do not replace Australian Consumer Law,
        trade licensing, safety rules, scheme requirements, product standards,
        contracts or independent legal advice.
      </SiteFooter>
    </main>
  );
}
