import Link from "next/link";
import { AnalyticsPrivacyControl } from "@/components/AnalyticsConsent";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { buildPlatformMetadata } from "@/lib/public-site";

export const metadata = buildPlatformMetadata({
  path: "/privacy",
  title: "Privacy notice | Australian Energy Assessments",
  description:
    "How Australian Energy Assessments collects, uses, protects and shares account, job, customer and integration information.",
});

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
    title: "Wattzun AI conversations",
    body: "Up to 40 recent messages, a small conversation summary and the home profile you choose to complete are kept in that browser for up to 30 days so Wattzun AI can continue the discussion across Australian Energy Assessments pages. For an answer, the browser sends the current question, a bounded set of recent conversation turns and a bounded home-profile summary to Australian Energy Assessments' stateless guide endpoint. If you have completed steps in the home energy planner in the same browser tab, it may also send a bounded list of those saved plan answers so you do not need to repeat them. Planner photos, document attachments and contact details are not included in that question context. A PDF or modern Word document deliberately attached for analysis is sent to a separate same-site endpoint, checked as an energy quote or electricity or gas bill, processed transiently and not saved to server storage or sent to an external AI provider. Its filename and extracted text are not added to local chat history, although the short analysis result is retained with that browser's chat until it is cleared or expires. Newer details you tell Wattzun AI override conflicting profile or saved-plan answers. The question endpoint securely sends bounded question context and relevant maintained energy guidance to an external AI processing provider with provider-side response storage disabled. It does not create or read a server-side conversation record, and conversation text is not placed in analytics. You can edit the home profile or clear the browser copy at any time. A random first-party security cookie and short-lived, one-way security counters are used to limit automated misuse. They do not contain conversation text, a raw network address or a cross-device identity and are not used for advertising or visitor analytics. Wattzun AI does not use a visitor fingerprint. The separate basic website analytics described below uses cookieless public-page measurement by default and never receives Wattzun AI content. Trade mode does not read a locally saved household profile or plan, another customer or job unless an authorised platform workflow explicitly supplies that context.",
  },
  {
    title: "Basic website analytics",
    body: "Australian Energy Assessments uses Google Analytics on public information pages to count visits and learn which information is useful. It receives the public page path and technical details such as browser, device and broad location. Analytics storage is always denied, so this setup does not create Google Analytics cookies. The site sends a manual page view when a public page path changes and turns off the tag's automatic initial page view. Measurement stays disabled on protected account, operations, job-link and report-link pages. We do not send Wattzun AI conversations, form answers, contact details, meter data or uploaded files to Google Analytics. Google signals, advertising storage and advertising personalisation are turned off. Google may process analytics data outside Australia, including in the United States. You can stop or restart this cookieless measurement below. A browser Do Not Track or Global Privacy Control request turns it off automatically.",
    analytics: true,
  },
  {
    title: "Optional Energy Guide contact requests",
    body: "Advice remains available without contact details. If a person explicitly asks Australian Energy Assessments to help with services, the guide creates a separate request containing only the contact, location, selected services, quote facts, explicit unknowns and consent choices entered in that form. It does not attach the raw conversation. Marketing consent is separate and off unless the person actively selects it. The request goes only to Australian Energy Assessments unless the person separately chooses trade sharing. A trade-sharing choice records exactly which fields may be disclosed and does not include uploaded files, bills, meter identifiers or raw conversation text.",
  },
  {
    title: "Protected leads and direct customers",
    body: "Australian Energy Assessments keeps the details entered in a household enquiry in a protected record. The quick upgrade options form shares the email, full property address, selected services and any message with every approved TLink trade business whose services and active service area match the request. Name and phone are shared only when the household ticks those choices. Other trade request forms may offer different sharing choices, which are shown before the person agrees and sends the form. Home plans, PDFs, bills, meter data and uploaded documents stay private. Wholesalers do not receive household lead details.",
  },
  {
    title: "Connected services",
    body: "A trade account owner chooses whether to connect Google Calendar, Outlook, Xero, MYOB or QuickBooks. The trade workspace sends only the information needed for the chosen action. The trade workspace remains the operational source of truth, and connected providers apply their own privacy terms. The trade workspace does not offer payment-provider connections or initiate customer payments. Account owners can disconnect a connected calendar or accounting provider from the integration workspace.",
  },
  {
    title: "Five-minute call bookings",
    body: "The public booking page embeds Calendly. When you choose a call time, Calendly receives the name, email address, booking answers and scheduling details you enter, creates the calendar event for Australian Energy Assessments and sends the related booking notifications. Calendly applies its own privacy terms. Do not enter identity documents, payment details, access codes or unrelated private information in the booking questions.",
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
          <span>Effective 3 September 2026</span>
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
              {section.analytics ? (
                <>
                  <p>
                    <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
                      Read Google&apos;s privacy policy
                    </a>
                  </p>
                  <AnalyticsPrivacyControl />
                </>
              ) : null}
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
