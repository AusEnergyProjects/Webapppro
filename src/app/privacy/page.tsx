import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";

export const metadata: Metadata = {
  title: "Privacy notice | Australian Energy Assessments",
  description:
    "How Australian Energy Assessments collects, uses, protects and shares account, job, customer and integration information.",
};

const sections = [
  {
    title: "Who this notice covers",
    body: "Australian Energy Assessments operates the public energy tools and trade workspace. This notice covers visitors, households, trade businesses, team members and customers using secure trade workspace links. It explains the information used to provide the service and the choices available to you.",
  },
  {
    title: "Information we collect",
    body: "Depending on the service, we may hold account and business details, authorised customer contacts, service addresses, job and appointment records, quotes, invoices, accounting status, support messages, audit events and files deliberately supplied for a job. We collect only the information needed for the selected workflow.",
  },
  {
    title: "How information is used",
    body: "Information is used to provide comparisons and assessments, operate authorised trade workflows, schedule work, prepare quotes and invoices, request evidence, send service messages, reconcile provider status, prevent misuse, meet legal obligations and support account owners. We do not sell personal information or sell household leads.",
  },
  {
    title: "Surge AI conversations",
    body: "Up to 40 recent messages and a small conversation summary are kept in that browser for up to 30 days so Surge AI can continue the discussion across Australian Energy Assessments pages. For an answer, the browser sends the current question, a bounded set of recent conversation turns and that summary to Australian Energy Assessments' stateless guide endpoint. If you have completed steps in the home energy planner in the same browser tab, it also sends a bounded list of those saved plan answers so you do not need to repeat them. Planner photos and contact details are not included. Newer details you tell Surge AI override a conflicting saved-plan answer. The endpoint securely sends this bounded question context and relevant maintained energy guidance to OpenAI for response generation with provider-side response storage disabled. It does not create or read a server-side conversation record, and conversation text is not placed in analytics. You can clear the browser copy at any time. A random first-party security cookie and short-lived, one-way security counters are used to limit automated misuse. They do not contain conversation text, a raw network address or a cross-device identity and are not used for advertising or visitor analytics. No third-party tracking cookie or fingerprint is used. Trade mode does not read a locally saved household plan, another customer or job unless an authorised platform workflow explicitly supplies that context.",
  },
  {
    title: "Optional Energy Guide contact requests",
    body: "Advice remains available without contact details. If a person explicitly asks Australian Energy Assessments to help with services, the guide creates a separate request containing only the contact, location, selected services, quote facts, explicit unknowns and consent choices entered in that form. It does not attach the raw conversation. Marketing consent is separate and off unless the person actively selects it. The request goes only to Australian Energy Assessments unless the person separately chooses trade sharing. A trade-sharing choice records exactly which fields may be disclosed and does not include uploaded files, bills, meter identifiers or raw conversation text.",
  },
  {
    title: "Protected leads and direct customers",
    body: "Australian Energy Assessments keeps the household name, email, phone, unit number, street address, suburb, state and postcode in the protected enquiry record. When a household submits a trade enquiry, every approved matched trade whose services and active service area match the selected work receives the email, postcode, selected services and any message the household writes. The household separately chooses whether those trades also receive the name, phone or full property address. The full home plan, PDF, bills, meter data and uploaded documents stay private. Wholesalers do not receive household lead details.",
  },
  {
    title: "Connected services",
    body: "A trade account owner chooses whether to connect Google Calendar, Outlook, Xero, MYOB or QuickBooks. The trade workspace sends only the information needed for the chosen action. The trade workspace remains the operational source of truth, and connected providers apply their own privacy terms. The trade workspace does not offer payment-provider connections or initiate customer payments. Account owners can disconnect a connected calendar or accounting provider from the integration workspace.",
  },
  {
    title: "Files, photos and meter information",
    body: "Job evidence is attached only to the authorised job and must not include people, identity documents, number plates, account paperwork or unrelated private information. Customer evidence must relate directly to the requested work and is available only through the authorised job workflow.",
  },
  {
    title: "Emailing a home energy plan",
    body: "A household can request its personalised plan by email without creating an account. The email address is sent to our delivery provider only for the requested delivery. The customer PDF stays private and is not attached to trade notifications or copied into trade CRM leads. The household must confirm that the email address and selected trade-sharing choices are correct before submitting.",
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
    <main className="wrap trade-information-page">
      <SiteHeader active="direct-trade-dashboard" />
      <header className="trade-information-hero">
        <div>
          <span>Effective 20 August 2026</span>
          <h1>Privacy notice</h1>
          <p>
            This notice explains what Australian Energy Assessments collects,
            why it is needed, who can access it and how to ask for a correction
            or review.
          </p>
          <div>
            <Link className="btn" href="/direct-trade/dashboard">
              Open trade workspace
            </Link>
            <Link className="btn ghost" href="/">
              Australian Energy Assessments home
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

      <section className="trade-information-section" aria-label="Privacy notice">
        <div className="trade-information-grid">
          {sections.map((section) => (
            <article key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trade-information-boundary">
        <div>
          <span>Need a privacy review?</span>
          <h2>Contact the Australian Energy Assessments privacy team</h2>
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
