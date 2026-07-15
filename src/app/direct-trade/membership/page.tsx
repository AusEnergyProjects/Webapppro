import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";

export const metadata: Metadata = {
  title:
    "Direct Trade membership and referrals | Australian Energy Assessments",
  description:
    "Compare live installer and wholesaler membership pricing, cancellation terms, matching rules and the two-sided referral reward.",
};

const plans = [
  {
    audience: "Trades and installers",
    cadence: "Annual",
    monthly: "$99",
    billed: "$1,188 billed once per year",
    value: "Best value",
    term: "Prepaid 12-month term. Stop the next renewal before its annual charge.",
  },
  {
    audience: "Trades and installers",
    cadence: "Month to month",
    monthly: "$199",
    billed: "Charged monthly",
    value: "Flexible",
    term: "Cancel any time, effective at the end of the current paid month.",
  },
  {
    audience: "Suppliers and wholesalers",
    cadence: "Annual",
    monthly: "$199",
    billed: "$2,388 billed once per year",
    value: "Best value",
    term: "Prepaid 12-month term. Stop the next renewal before its annual charge.",
  },
  {
    audience: "Suppliers and wholesalers",
    cadence: "Month to month",
    monthly: "$399",
    billed: "Charged monthly",
    value: "Flexible",
    term: "Cancel any time, effective at the end of the current paid month.",
  },
];

const accessGroups = [
  {
    title: "Household account",
    badge: "Always free",
    included: ["Unlimited private projects", "Guided upgrade plans and saved comparisons", "Protected enquiries and structured quote comparison", "Asset, warranty, service and safety history"],
    locked: ["Nothing is locked behind a household subscription", "Household contact data is never sold as a lead"],
  },
  {
    title: "Installer profile",
    badge: "Free profile",
    included: ["Business profile and service coverage", "Verification preparation and evidence", "Availability and notification preferences", "Account readiness checklist"],
    locked: ["No household opportunities", "No installer CRM or platform job conversion", "No approved wholesale catalogue selection"],
  },
  {
    title: "Installer membership",
    badge: "Paid access",
    included: ["Protected opportunity responses", "Customers, jobs, schedule and reusable templates", "Tasks, issues, evidence and handovers", "Quotes, invoices, payments and integration pathways"],
    locked: ["Team access and advanced analytics require an admin grant", "Matching is never improved by paying more"],
  },
  {
    title: "Wholesaler profile",
    badge: "Free profile",
    included: ["Business profile and verification preparation", "Draft product records", "Account readiness checklist", "No household leads under any plan"],
    locked: ["Products stay invisible to installers", "No bulk catalogue or fulfilment workflow", "No platform product-request conversion"],
  },
  {
    title: "Wholesaler membership",
    badge: "Paid access",
    included: ["Approved catalogue visibility", "Bulk product maintenance", "Installer product enquiries", "Order and fulfilment workflow"],
    locked: ["Team access and advanced analytics require an admin grant", "No access to household contact data"],
  },
];

export default function DirectTradeMembershipPage() {
  return (
    <main className="wrap direct-trade-membership-page">
      <SiteHeader active="direct-trade-membership" />
      <header className="membership-hero">
        <div>
          <span>Direct Trade membership</span>
          <h1>One subscription, no per-lead fees</h1>
          <p>
            Membership supports verification, role-specific dashboards and
            fair matching. It does not buy ranking, guarantee opportunities or
            add a separate charge each time a project is assigned.
          </p>
          <div>
            <a className="btn" href="/direct-trade/partners">
              Create a business profile
            </a>
            <a className="btn ghost" href="/direct-trade/dashboard">
              Sign in to subscribe
            </a>
          </div>
        </div>
        <aside>
          <strong>Secure Stripe billing is live</strong>
          <p>
            Subscribe from a signed-in dashboard so each payment is matched to
            the correct installer or wholesaler account.
          </p>
          <span>All prices include GST</span>
        </aside>
      </header>

      <section
        className="membership-plan-section"
        aria-labelledby="membership-plan-title"
      >
        <div className="guide-section-heading">
          <span>Live pricing</span>
          <h2 id="membership-plan-title">
            Choose the role and billing cadence
          </h2>
          <p>
            Annual plans show the monthly equivalent but are charged once for
            the full 12-month term.
          </p>
        </div>
        <div className="membership-plan-grid">
          {plans.map((plan) => (
            <article
              className={plan.cadence === "Annual" ? "recommended" : ""}
              key={`${plan.audience}-${plan.cadence}`}
            >
              <span>{plan.value}</span>
              <small>{plan.audience}</small>
              <h3>{plan.cadence}</h3>
              <strong>
                {plan.monthly}
                <em>/month</em>
              </strong>
              <p>{plan.billed}, including GST.</p>
              <ul>
                <li>Role-specific dashboard access after approval</li>
                <li>Verification pathway for the business role</li>
                <li>{plan.audience === "Trades and installers" ? "Installer CRM for customers, jobs, scheduling, tasks, issues and financial progress" : "Catalogue, installer enquiries and fulfilment workflow in one Business Hub"}</li>
                <li>No individual lead fee or paid placement</li>
                <li>{plan.term}</li>
              </ul>
              <a className="billing-checkout-link" href="/direct-trade/dashboard#membership">
                Sign in to choose this plan
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="membership-access" aria-labelledby="membership-access-title">
        <div className="guide-section-heading">
          <span>Know what is included</span>
          <h2 id="membership-access-title">Free profiles are useful, paid access operates the platform</h2>
          <p>Customers never pay. Business profiles can be created and prepared for free, while leads, marketplace visibility and operating tools remain behind the membership boundary.</p>
        </div>
        <div className="membership-access-grid">
          {accessGroups.map((group) => <article key={group.title}>
            <header><span>{group.badge}</span><h3>{group.title}</h3></header>
            <strong>Included</strong>
            <ul>{group.included.map((item) => <li key={item}>{item}</li>)}</ul>
            <strong>Boundaries</strong>
            <ul className="locked">{group.locked.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>)}
        </div>
        <a className="platform-pricing-link" href="/platform">See how all four workspaces connect</a>
      </section>

      <section
        className="membership-included"
        aria-labelledby="membership-included-title"
      >
        <div>
          <span>Same marketplace rules</span>
          <h2 id="membership-included-title">
            Price does not change matching priority
          </h2>
          <p>
            Annual and month-to-month members follow the same verification and
            matching rules. Location, work type, verified capability, service
            coverage and availability guide a connection.
          </p>
        </div>
        <div className="membership-rule-grid">
          <article>
            <strong>No lead auction</strong>
            <p>Businesses do not bid against each other to receive a brief.</p>
          </article>
          <article>
            <strong>No paid ranking</strong>
            <p>
              A higher payment does not move a business ahead of a better fit.
            </p>
          </article>
          <article>
            <strong>No volume promise</strong>
            <p>
              Membership cannot guarantee how many suitable opportunities
              exist in a location.
            </p>
          </article>
          <article>
            <strong>Role boundaries</strong>
            <p>
              Wholesalers manage catalogues and never receive household leads.
            </p>
          </article>
        </div>
      </section>

      <section
        className="membership-referral"
        aria-labelledby="membership-referral-title"
      >
        <div>
          <span>Live referral reward</span>
          <h2 id="membership-referral-title">
            A month of membership credit for both businesses
          </h2>
          <p>
            Active paying members can generate a unique link in the dashboard.
            A reward is earned after a new eligible business creates its first
            profile with that link, starts a paid membership and its first
            payment clears. A monthly member receives the second month free;
            an annual member receives month 13 free.
          </p>
        </div>
        <aside>
          <strong>Before a credit is issued</strong>
          <ul>
            <li>The referred business must be new and independently eligible</li>
            <li>The first paid invoice must clear and remain valid</li>
            <li>Self-referrals and duplicate businesses are excluded</li>
            <li>Each renewal date moves forward by one calendar month</li>
            <li>Rewards are membership time and are not cash</li>
          </ul>
        </aside>
      </section>

      <section className="membership-launch-boundary">
        <div>
          <span>Clear billing boundary</span>
          <h2>Monthly flexibility and annual value are different commitments</h2>
          <p>
            Monthly plans can be cancelled at any time and finish at the end of
            the paid month. Annual plans are prepaid for 12 months, do not allow
            early cancellation or refund except where Australian Consumer Law
            requires it, and can have the next renewal stopped before it is
            charged.
          </p>
        </div>
        <a className="btn" href="/direct-trade/membership/terms">
          Read full membership terms
        </a>
      </section>
      <SiteFooter>
        Membership pricing does not replace licensing, accreditation,
        insurance, product compliance, marketplace verification or each
        participant&apos;s legal obligations.
      </SiteFooter>
    </main>
  );
}
