import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/ComparatorChrome";
import { TLinkHeader } from "@/components/TLinkChrome";

export const metadata: Metadata = {
  title: "Privacy notice | Australian Energy Assessments and TLink",
  description:
    "How Australian Energy Assessments and TLink collect, use, protect and share account, job, customer and integration information.",
};

const sections = [
  {
    title: "Who this notice covers",
    body: "Australian Energy Assessments operates the public energy tools and TLink trade workspace. This notice covers visitors, households, trade businesses, team members and customers using secure TLink links. It explains the information used to provide the service and the choices available to you.",
  },
  {
    title: "Information we collect",
    body: "Depending on the service, we may hold account and business details, authorised customer contacts, service addresses, job and appointment records, quotes, invoices, payment status, support messages, audit events and files deliberately supplied for a job. We collect only the information needed for the selected workflow.",
  },
  {
    title: "How information is used",
    body: "Information is used to provide comparisons and assessments, operate authorised trade workflows, schedule work, prepare quotes and invoices, request evidence, send service messages, reconcile provider status, prevent misuse, meet legal obligations and support account owners. We do not sell personal information or sell household leads.",
  },
  {
    title: "Protected leads and direct customers",
    body: "AEA protected opportunities keep household identity and exact address behind the authorised marketplace boundary. A trade business receives direct customer contact information only when the customer contacted that business directly or an authorised workflow permits the handoff. Wholesalers do not receive household lead details.",
  },
  {
    title: "Connected services",
    body: "A trade account owner chooses whether to connect Google Calendar, Outlook, Xero, MYOB, QuickBooks, Stripe or Square. TLink sends only the information needed for the chosen action. TLink remains the operational source of truth, and connected providers apply their own privacy terms. Account owners can disconnect a provider from the TLink integration workspace.",
  },
  {
    title: "Files, photos and meter information",
    body: "Job evidence is attached only to the authorised job and must not include people, identity documents, number plates, account paperwork or unrelated private information. Electricity interval files selected in the comparison tool are processed in the browser unless the page clearly asks for a deliberate upload or save action.",
  },
  {
    title: "Storage, security and retention",
    body: "Access is limited by account role and job ownership. Sensitive provider credentials are encrypted or stored as protected runtime secrets and are not placed in customer records. Information is retained only while needed for the service, security, dispute, accounting and legal obligations, then deleted or de-identified where practical.",
  },
  {
    title: "Your choices and contact",
    body: "You can request access to or correction of personal information, withdraw optional communication consent, disconnect a provider or ask a privacy question. Some records must be retained for security, accounting or legal reasons. Contact info@ausenergyassessments.com or call 1300 241 149 so the request can be verified and handled safely.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="wrap direct-trade-membership-page">
      <TLinkHeader active="dashboard" />
      <header className="membership-hero">
        <div>
          <span>Effective 20 July 2026</span>
          <h1>Privacy notice</h1>
          <p>
            This notice explains what Australian Energy Assessments and TLink
            collect, why it is needed, who can access it and how to ask for a
            correction or review.
          </p>
          <div>
            <Link className="btn" href="/direct-trade/dashboard">
              Open TLink
            </Link>
            <Link className="btn ghost" href="/">
              AEA home
            </Link>
          </div>
        </div>
        <aside>
          <strong>Privacy by workflow</strong>
          <p>
            Household details, trade records and connected provider data stay
            within the account and purpose that authorised their use.
          </p>
          <span>No sale of personal information</span>
        </aside>
      </header>

      <section className="membership-plan-section" aria-label="Privacy notice">
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
          <span>Need a privacy review?</span>
          <h2>Contact the AEA privacy team</h2>
          <p>
            Email info@ausenergyassessments.com with enough context to locate
            the relevant account or record. Do not email passwords, payment
            card details, identity documents or provider access tokens.
          </p>
        </div>
        <a className="btn" href="mailto:info@ausenergyassessments.com">
          Email privacy support
        </a>
      </section>

      <SiteFooter>
        This notice supports transparent handling under applicable Australian
        privacy law and does not reduce any right that cannot lawfully be
        excluded.
      </SiteFooter>
    </main>
  );
}
