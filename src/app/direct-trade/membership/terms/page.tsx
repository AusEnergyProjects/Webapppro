import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { directTradePortalLink } from "@/lib/direct-trade-billing";

export const metadata: Metadata = {
  title: "Direct Trade membership terms | Australian Energy Assessments",
  description:
    "Review Direct Trade subscription, cancellation, renewal and marketplace terms.",
};

const sections = [
  {
    title: "Monthly membership",
    body: "Month-to-month membership is charged in advance each month and can be cancelled at any time. Cancellation takes effect at the end of the current paid monthly billing period, so access continues until that date. There is no separate early cancellation fee.",
  },
  {
    title: "Annual membership",
    body: "Annual membership is prepaid for a 12-month term. It cannot be cancelled early and is not refundable for a change of mind, except where a refund or other remedy is required by Australian Consumer Law. Members can stop automatic renewal before the next annual charge; access then continues until the prepaid term ends.",
  },
  {
    title: "Renewal and payment",
    body: "Subscriptions renew using the saved payment method unless renewal is stopped before the next charge. Stripe securely processes payment and provides invoices. Failed or reversed payment can place access into a processing, past-due, paused or ended state while the account is resolved.",
  },
  {
    title: "Marketplace access",
    body: "Membership does not guarantee lead volume, project value, sales, ranking or customer selection. It does not replace business verification, licensing, accreditation, insurance or product compliance. Installers receive only suitable allocations under the published matching rules. Wholesalers never receive household leads.",
  },
  {
    title: "Pricing and changes",
    body: "Displayed membership prices include GST. A pricing change applies only from a future renewal and will be communicated before that renewal where required. No plan permits paid ranking or a per-lead charge unless the member expressly agrees to a separately published future service.",
  },
  {
    title: "Referral credits",
    body: "An active paying member may generate one unique referral link. If a new eligible business first creates its profile with that link and its first paid membership payment clears, the referred business and the referrer each receive one calendar month added to the end of their current membership term. For a monthly membership this makes the second month free; for an annual membership it moves the next renewal to month 13. Each referred business can create one reward only. The referring membership must be active when the profile is created and when payment clears. Rewards are not cash, cannot be transferred, and may be withheld or reversed for self-referrals, existing subscribers, duplicate businesses, refunds, chargebacks, fraud or misuse. Australian Energy Assessments may review eligibility before applying a reward.",
  },
];

export default function DirectTradeMembershipTermsPage() {
  return (
    <main className="wrap direct-trade-membership-page">
      <SiteHeader active="direct-trade-membership" />
      <header className="membership-hero">
        <div>
          <span>Effective 14 July 2026</span>
          <h1>Direct Trade membership terms</h1>
          <p>
            These terms explain the billing commitment and marketplace boundary
            for installer and wholesaler memberships. Nothing here limits rights
            or remedies that cannot be excluded under Australian Consumer Law.
          </p>
          <div>
            <a className="btn" href="/direct-trade/dashboard#membership">
              Return to membership
            </a>
            <a className="btn ghost" href={directTradePortalLink}>
              Manage an existing subscription
            </a>
          </div>
        </div>
        <aside>
          <strong>Short version</strong>
          <p>
            Monthly is cancel-any-time at period end. Annual is a prepaid
            12-month commitment with renewal control for the next term.
          </p>
          <span>Prices include GST</span>
        </aside>
      </header>

      <section className="membership-plan-section" aria-label="Membership terms">
        <div className="membership-terms-grid">
          {sections.map((section) => (
            <article key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="membership-launch-boundary">
        <div>
          <span>Account matching</span>
          <h2>Subscribe from the signed-in business dashboard</h2>
          <p>
            Checkout uses the signed-in account reference and email so Stripe
            events can update the correct Direct Trade profile. Do not create a
            second subscription for the same business if a payment is still
            processing; use the billing portal or account support pathway first.
          </p>
        </div>
        <a className="btn" href="/direct-trade/dashboard#membership">
          Open dashboard
        </a>
      </section>
      <SiteFooter>
        Membership remains subject to applicable Australian law and the
        marketplace standards published on this site.
      </SiteFooter>
    </main>
  );
}
