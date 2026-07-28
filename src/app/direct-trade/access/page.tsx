import type { Metadata } from "next";
import { SiteFooter } from "@/components/ComparatorChrome";
import { TLinkHeader } from "@/components/TLinkChrome";

export const metadata: Metadata = {
  title: "Free TLink trade access",
  description:
    "Approved trades receive TLink CRM, jobs, scheduling, marketplace, team, field and purchasing tools at no cost.",
};

const coreTools = [
  "Marketplace leads and privacy-safe opportunity responses",
  "CRM customers, jobs, quotes and scheduling",
  "Team access, field workflow, forms and handover",
  "Purchasing, catalogue and product selection",
  "Accounting integrations and customer portal foundations",
];

export default function DirectTradeAccessPage() {
  return (
    <main className="wrap trade-information-page">
      <TLinkHeader active="access" />
      <header className="trade-information-hero">
        <div>
          <span>Free TLink trade access</span>
          <h1>Run the core trade workflow for A$0</h1>
          <p>
            Approved installers and wholesalers receive the role-appropriate
            operating tools with no card details, seat fee, job fee, quote fee
            or marketplace lead fee.
          </p>
          <div>
            <a className="btn" href="/direct-trade/partners">
              Create a business profile
            </a>
            <a className="btn ghost" href="/direct-trade/dashboard">
              Open the trade workspace
            </a>
          </div>
        </div>
        <aside>
          <strong>Approval remains mandatory</strong>
          <p>
            A valid ABN and the required business evidence must be supplied,
            reviewed and approved before protected trade tools become available.
          </p>
          <span>Access follows verified role and capability</span>
        </aside>
      </header>

      <section
        className="trade-access-overview"
        aria-labelledby="trade-access-title"
      >
        <div className="guide-section-heading">
          <span>Included after approval</span>
          <h2 id="trade-access-title">One authoritative trade workspace</h2>
          <p>
            Approved businesses use the same core data, screens and workflow
            for their role.
          </p>
        </div>
        <div className="trade-access-grid">
          <article>
            <header>
              <span>A$0</span>
              <h3>Approved trade access</h3>
            </header>
            <strong>Core tools</strong>
            <ul>
              {coreTools.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article>
            <header>
              <span>Access controls</span>
              <h3>Safety and privacy remain enforced</h3>
            </header>
            <ul>
              <li>
                Wholesalers never receive household opportunities
              </li>
              <li>
                Protected customer details remain hidden until consent rules
                authorise release
              </li>
              <li>
                Matching follows approved capability, service coverage and
                availability
              </li>
              <li>
                Licensing, insurance and account approval can be reviewed or
                suspended
              </li>
            </ul>
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
