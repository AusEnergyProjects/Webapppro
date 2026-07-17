import type { Metadata } from "next";
import { SiteFooter } from "@/components/ComparatorChrome";
import { TLinkHeader } from "@/components/TLinkChrome";
import { directTradePortalLink } from "@/lib/direct-trade-billing";

export const metadata: Metadata = {
  title: "Free TLink trade access",
  description: "Verified trades receive TLink CRM, jobs, scheduling, marketplace, team, field and purchasing tools at no cost.",
};

const coreTools = [
  "Marketplace leads and privacy-safe opportunity responses",
  "CRM customers, jobs, quotes and scheduling",
  "Team access, field workflow, forms and handover",
  "Purchasing, catalogue and product selection",
  "Accounting integrations and customer portal foundations",
];

export default function DirectTradeMembershipPage() {
  return (
    <main className="wrap direct-trade-membership-page">
      <TLinkHeader active="membership" />
      <header className="membership-hero">
        <div>
          <span>TLink trade access</span>
          <h1>Run the core trade workflow for A$0</h1>
          <p>
            Verified installers and wholesalers receive the operating platform
            without a card, subscription, seat fee, job fee, quote fee or
            marketplace lead fee.
          </p>
          <div>
            <a className="btn" href="/direct-trade/partners">Create a business profile</a>
            <a className="btn ghost" href="/direct-trade/dashboard">Open the trade workspace</a>
          </div>
        </div>
        <aside>
          <strong>Verification remains mandatory</strong>
          <p>Licensing, insurance, role permissions and customer privacy remain the access controls.</p>
          <span>No paid ranking or preferred access</span>
        </aside>
      </header>

      <section className="membership-access" aria-labelledby="membership-access-title">
        <div className="guide-section-heading">
          <span>Included after verification</span>
          <h2 id="membership-access-title">One authoritative trade workspace</h2>
          <p>Free and previously paid businesses use the same core data, screens and workflow.</p>
        </div>
        <div className="membership-access-grid">
          <article>
            <header><span>A$0</span><h3>Verified trade access</h3></header>
            <strong>Core tools</strong>
            <ul>{coreTools.map((item) => <li key={item}>{item}</li>)}</ul>
            <strong>Boundaries</strong>
            <ul className="locked">
              <li>Wholesalers never receive household opportunities</li>
              <li>Protected customer details remain hidden until existing consent rules authorise release</li>
              <li>Payment never changes ranking, exclusivity or opportunity priority</li>
            </ul>
          </article>
          <article>
            <header><span>Existing customers</span><h3>Legacy subscription transition</h3></header>
            <p>No new subscription is required for core access. Businesses with an existing Stripe membership can still manage its billing state while the historical subscription model is retired.</p>
            <a className="btn ghost" href={directTradePortalLink} rel="noreferrer">Manage an existing Stripe membership</a>
          </article>
        </div>
      </section>

      <SiteFooter>
        Free TLink access does not replace licensing, accreditation, insurance,
        product compliance, marketplace verification or legal obligations.
      </SiteFooter>
    </main>
  );
}
