import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/ComparatorChrome";
import { TLinkHeader } from "@/components/TLinkChrome";

export const metadata: Metadata = {
  title: "TLink business integrations",
  applicationName: "TLink",
  description:
    "Understand TLink's optional calendar, accounting and business email connections, provider availability and separate SMS charges.",
  alternates: {
    canonical: "/direct-trade/integrations",
  },
  openGraph: {
    title: "TLink business integrations",
    description:
      "Connect available business calendars, accounting accounts and a business sending address through secure provider sign-in.",
    siteName: "TLink",
    type: "website",
    url: "/direct-trade/integrations",
  },
  twitter: {
    card: "summary",
    title: "TLink business integrations",
    description:
      "Connect available business calendars, accounting accounts and a business sending address through secure provider sign-in.",
  },
};

const integrationPurposes = [
  {
    title: "Calendar scheduling",
    body: "When available and connected, Google Calendar or Outlook can receive TLink appointments. The business owner can also view accepted external calendar events privately in Schedule, including supported meeting links. TLink remains authoritative for its own schedule.",
  },
  {
    title: "Accounting",
    body: "Connect an available Xero, MYOB or QuickBooks account, then choose the required income account or sales product. Eligible issued invoices can sync to that account, including automatic sync after quote acceptance when setup is complete. Downloading a TLink PDF exports the document; it does not create an accounting connection.",
  },
  {
    title: "Business email",
    body: "The owner can connect one Google or Microsoft business sending address when the provider is available. Authorised staff can use it for customer emails, quotes and invoices. This send-only connection does not import an inbox.",
  },
  {
    title: "Optional SMS",
    body: "Customer SMS requires an available and configured messaging service. SMS parts, number rental and setup can have separate charges shown before purchase. Sender registration, provider approval and credit requirements apply.",
  },
  {
    title: "Payment boundary",
    body: "TLink records invoice amounts, due dates and payment status. The trade business collects customer payments using its own payment arrangements. Paying for optional SMS credit is separate from collecting payment for a job.",
  },
  {
    title: "Business-owned access",
    body: "Every installer business connects its own provider account through that provider's secure sign-in. TLink never asks the installer to share a provider password.",
  },
];

export default function DirectTradeIntegrationsPage() {
  return (
    <main className="wrap trade-information-page">
      <TLinkHeader active="dashboard" />
      <header className="trade-information-hero">
        <div>
          <span>TLink connected services</span>
          <h1>Connect your business tools to TLink</h1>
          <p>
            TLink is a trade business workspace operated by Australian Energy
            Assessments. It helps installers manage their own customers, jobs,
            appointments, quotes and invoices. Optional connections can carry
            eligible information into the tools the business chooses to use.
          </p>
          <div>
            <a className="btn" href="/direct-trade/dashboard">
              Open your business workspace
            </a>
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
            Calendar, accounting and business email options show their current
            availability and connection status inside the workspace.
          </p>
          <span>Disconnect at any time</span>
        </aside>
      </header>

      <section className="trade-information-section" aria-labelledby="integration-purpose-title">
        <div className="guide-section-heading">
          <span>Application purpose</span>
          <h2 id="integration-purpose-title">What TLink integrations do</h2>
          <p>
            Core TLink software remains A$0. Optional messaging and third-party
            services can have separate charges. Connections require provider
            availability, business sign-in, permissions and completed setup.
          </p>
        </div>
        <div className="trade-information-grid">
          {integrationPurposes.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trade-information-boundary">
        <div>
          <span>Calendar and email access</span>
          <h2>Your schedule and sending address, connected by choice</h2>
          <p>
            Calendar permission supports creating and updating TLink appointment
            events and reading accepted external events in the displayed schedule
            period. That external calendar view is private to the business owner.
            Protected marketplace customer identity and exact locations remain
            withheld from mirrored appointment details.
          </p>
          <p>
            Business email is a separate sending connection. Google or Microsoft
            sign-in authorises sending from the connected address; TLink does not
            ask for your mailbox password or read your inbox through this connection.
          </p>
        </div>
        <a className="btn" href="/direct-trade/dashboard">
          Open your business workspace
        </a>
      </section>

      <SiteFooter>
        Questions about provider access can be sent to
        {" "}
        <a href="mailto:info@ausenergyassessments.com">info@ausenergyassessments.com</a>.
      </SiteFooter>
    </main>
  );
}
