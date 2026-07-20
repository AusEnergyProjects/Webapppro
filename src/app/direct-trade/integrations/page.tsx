import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/ComparatorChrome";
import { TLinkHeader } from "@/components/TLinkChrome";

export const metadata: Metadata = {
  title: "TLink business integrations",
  applicationName: "TLink",
  description:
    "Connect TLink to Google Calendar, accounting and payment providers so trade businesses can schedule work, prepare invoices and reconcile payments from one workspace.",
  alternates: {
    canonical: "/direct-trade/integrations",
  },
  openGraph: {
    title: "TLink business integrations",
    description:
      "Connect TLink to business calendars, accounting platforms and payment providers through secure provider sign-in.",
    siteName: "TLink",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "TLink business integrations",
    description:
      "Connect TLink to business calendars, accounting platforms and payment providers through secure provider sign-in.",
  },
};

const integrationPurposes = [
  {
    title: "Calendar scheduling",
    body: "An installer can connect Google Calendar or Outlook so TLink appointments are mirrored to that business calendar. TLink remains authoritative and does not read unrelated calendar events.",
  },
  {
    title: "Accounting",
    body: "An installer can connect Xero, MYOB or QuickBooks to create an accounting draft from an accepted TLink quote or invoice. The connected accounting system keeps its own final ledger and tax controls.",
  },
  {
    title: "Customer payments",
    body: "An installer can connect Stripe or Square to create a secure customer checkout link. Card details stay with the payment provider and do not enter TLink.",
  },
  {
    title: "Business-owned access",
    body: "Every installer business connects its own provider account through that provider's secure sign-in. TLink never asks the installer to share a provider password.",
  },
];

export default function DirectTradeIntegrationsPage() {
  return (
    <main className="wrap direct-trade-membership-page">
      <TLinkHeader active="dashboard" />
      <header className="membership-hero">
        <div>
          <span>TLink connected services</span>
          <h1>Connect your business tools to TLink</h1>
          <p>
            TLink is a trade business workspace operated by Australian Energy
            Assessments. It helps installers manage their own customers, jobs,
            appointments, quotes, invoices and payment requests without
            re-entering the same information in each provider.
          </p>
          <div>
            <Link className="btn" href="/direct-trade/dashboard">
              Open TLink integrations
            </Link>
            <Link className="btn ghost" href="/privacy">
              Read the privacy notice
            </Link>
          </div>
        </div>
        <aside>
          <strong>Installer-controlled connections</strong>
          <p>
            A connection starts only when an authorised installer presses
            Connect and approves access on the provider&apos;s own website.
          </p>
          <span>Disconnect at any time</span>
        </aside>
      </header>

      <section className="membership-plan-section" aria-labelledby="integration-purpose-title">
        <div className="guide-section-heading">
          <span>Application purpose</span>
          <h2 id="integration-purpose-title">What TLink integrations do</h2>
          <p>
            Each connection is limited to the action selected by the installer
            business and keeps TLink as the operational source of truth.
          </p>
        </div>
        <div className="membership-terms-grid">
          {integrationPurposes.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="membership-launch-boundary">
        <div>
          <span>Google Calendar access</span>
          <h2>One-way appointment mirroring</h2>
          <p>
            When an installer connects Google Calendar, TLink uses the
            calendar.events permission to create and update only the TLink
            appointment events mirrored into that business&apos;s primary calendar.
            It does not read Gmail, contacts or unrelated calendar events.
          </p>
        </div>
        <Link className="btn" href="/direct-trade/dashboard">
          Manage connections
        </Link>
      </section>

      <SiteFooter>
        Questions about provider access can be sent to
        {" "}
        <a href="mailto:info@ausenergyassessments.com">info@ausenergyassessments.com</a>.
      </SiteFooter>
    </main>
  );
}
