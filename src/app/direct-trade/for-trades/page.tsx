import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { JsonLd } from "@/components/JsonLd";
import { TLinkBrand } from "@/components/TLinkChrome";
import { buildPlatformMetadata, PUBLIC_SITE } from "@/lib/public-site";
import styles from "./page.module.css";

export const metadata = buildPlatformMetadata({
  path: "/direct-trade/for-trades",
  title: "TLink | Free trade business software",
  description: "Connect customers, quotes, jobs, scheduling, field evidence and your team with TLink. Free core software for approved trade businesses, with optional provider connections.",
});

const setupHref = "/direct-trade/dashboard?setup=1";
const features = [
  { title: "Customers with context", detail: "Keep customer records, service sites and their jobs together. Open the history when the next enquiry comes in.", benefit: "Start with what you already know." },
  { title: "Quotes worth saying yes to", detail: "Prepare products, quantities and optional packages. Share a secure review link and the matching issued PDF so customers can ask, accept or decline.", benefit: "Make the scope and next step clear." },
  { title: "A schedule your team can use", detail: "Create appointments, assign work and view the team schedule. Propose arrival windows for customers to review.", benefit: "Keep the office and the field in step." },
  { title: "The job, from desk to site", detail: "Bring forms, photos, files, tasks and saved answers into the job record. Give field staff access to the work they are assigned.", benefit: "Carry the job context into the field." },
  { title: "Your people, connected", detail: "Use team chats and calls in Connect. Set manager, office and field access, then adjust individual permissions to suit each role.", benefit: "Give people the access their work needs." },
  { title: "Finance follows the work", detail: "Track quotes, issued invoices and recorded payment status. Keep your product catalogue and pricing close to the commercial record.", benefit: "Follow the job through to the paperwork." },
];

function DemoDashboard() {
  return <figure className={styles.dashboardFigure}>
    <div className={styles.demoLabel}><span className={styles.liveDot} />Illustrative TLink workspace</div>
    <div className={styles.dashboard} aria-label="Illustration of the TLink dashboard with fictional jobs">
      <div className={styles.demoSidebar} aria-hidden="true">
        <strong className={styles.demoBrand}>T<span>Link</span></strong>
        <span className={styles.demoNavActive}>Home</span>
        <span>Jobs</span><span>Schedule</span><span>Customers</span><span>Sales</span><span>Connect</span><span>Finance</span>
      </div>
      <div className={styles.demoContent}>
        <div className={styles.demoTop}><span>YOUR WORK, CONNECTED</span><span className={styles.demoBadge}>Demo business</span></div>
        <h2>See the day. Keep it moving.</h2>
        <div className={styles.demoOverview}>
          <div><span>Next up</span><strong>Site visit</strong><small>Demo job 01</small></div>
          <div><span>Sales</span><strong>Quote review</strong><small>Demo job 02</small></div>
          <div><span>Finance</span><strong>Invoice issued</strong><small>Demo job 03</small></div>
        </div>
        <div className={styles.demoPanel}>
          <div className={styles.demoPanelHeading}><strong>Today&apos;s work</strong></div>
          <div className={styles.demoRow}><span className={styles.demoTime}>09:00</span><div><strong>Demo job 01</strong><small>Site visit · assigned to field team</small></div><span className={styles.statusMint}>Scheduled</span></div>
          <div className={styles.demoRow}><span className={styles.demoTime}>11:00</span><div><strong>Demo job 02</strong><small>Quote follow-up · office task</small></div><span className={styles.statusBlue}>Review</span></div>
        </div>
      </div>
    </div>
    <figcaption>Illustration of verified workflows, not a live dashboard. All records, times and statuses are fictional.</figcaption>
  </figure>;
}

function DemoMap() {
  return <figure className={styles.mapFigure}>
    <div className={styles.mapHeading}><div><span>JOBS + CUSTOMERS</span><strong>Put the work in view.</strong></div><span className={styles.demoBadge}>Illustrative map</span></div>
    <div className={styles.mapCanvas}>
      <svg viewBox="0 0 600 360" className={styles.mapDrawing} aria-hidden="true">
        <path className={styles.mapWater} d="M0 225C85 160 88 313 170 226S258 117 319 188 391 341 451 236 543 178 600 209V360H0Z" />
        <g className={styles.mapBlocks}>
          <path d="M32 30h88v60H32zM158 29h91v56h-91zM289 27h92v58h-92zM425 32h128v56H425zM41 122h87v61H41zM167 122h84v45h-84zM319 124h61v45h-61zM432 122h115v62H432zM53 285h78v48H53zM240 278h92v51h-92zM463 281h82v45h-82z" />
        </g>
        <g className={styles.mapRoads}>
          <path d="M0 105H600M0 258H600M142 0V360M269 0V360M408 0V360M566 0V360M0 202L600 27" />
        </g>
        <g className={styles.mapPin}><circle cx="106" cy="147" r="14" /><circle cx="307" cy="139" r="14" fill="#5085a5" /><circle cx="482" cy="112" r="14" /></g>
        <g className={styles.mapPinCore}><circle cx="106" cy="147" r="4" /><circle cx="307" cy="139" r="4" /><circle cx="482" cy="112" r="4" /></g>
      </svg>
      <div className={styles.mapRecord}><span className={styles.mapRecordIcon} aria-hidden="true">01</span><div><strong>Demo job 01</strong><small>Open the linked job record</small></div></div>
      <div className={styles.mapLegend}><span><i className={styles.legendJob} />Jobs</span><span><i className={styles.legendCustomer} />Customers</span></div>
    </div>
    <figcaption>Fictional map and pins. TLink&apos;s record map requires map availability and usable saved locations.</figcaption>
  </figure>;
}

export default function ForTradesPage() {
  return <main className={`wrap ${styles.page}`}>
    <SiteHeader active="direct-trade-access" />
    <JsonLd data={{ "@context": "https://schema.org", "@type": "WebPage", "@id": `${PUBLIC_SITE.apexUrl}/direct-trade/for-trades#webpage`, url: `${PUBLIC_SITE.apexUrl}/direct-trade/for-trades`, name: "TLink free trade business software", description: metadata.description, dateModified: "2026-10-10", inLanguage: "en-AU", isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId }, publisher: { "@id": PUBLIC_SITE.organizationId } }} />

    <section className={styles.hero} aria-labelledby="trades-title">
      <div className={styles.heroCopy}>
        <div className={styles.heroBrand}><TLinkBrand context="Trades and service businesses" /><Link href="/direct-trade/dashboard" className={styles.signIn}>Sign in <span aria-hidden="true">↗</span></Link></div>
        <span className={styles.eyebrow}>FREE CORE SOFTWARE. YOUR WORK, CONNECTED.</span>
        <h1 id="trades-title">Run the business.<br /><span>Keep work moving.</span></h1>
        <p className={styles.heroLead}>Your customers, quotes, jobs, schedule and team. Together in TLink.</p>
        <p className={styles.heroDetail}>From the first enquiry to the final invoice. Bring the office, the field and the customer journey into the same story.</p>
        <div className={styles.actions}><Link href={setupHref} className={styles.primary}>Set up your free business <span aria-hidden="true">↗</span></Link><a href="#features" className={styles.secondary}>Explore TLink <span aria-hidden="true">↓</span></a></div>
        <p className={styles.heroNote}>A valid ABN and business approval are required before workspace access.</p>
      </div>
      <div className={styles.heroVisual}><div className={styles.visualHeading}><span>FROM FIRST HELLO TO JOB WELL DONE</span><strong>The whole job. In view.</strong></div><DemoDashboard /><div className={styles.workflow} aria-label="Connected TLink job workflow"><span>Enquiry</span><span aria-hidden="true">↗</span><span>Quote</span><span aria-hidden="true">↗</span><span>Job</span><span aria-hidden="true">↗</span><span>Invoice</span></div></div>
    </section>

    <nav className={styles.topicNav} aria-label="TLink trades page topics"><a href="#features">Why TLink</a><a href="#trade-map">Jobs on the map</a><a href="#customer-experience">Your customers</a><a href="#connections">Your connections</a><a href="#getting-started">Get started</a></nav>

    <div className={styles.valueStrip} aria-label="TLink at a glance"><div><strong>A$0</strong><span>Core trade software</span></div><div><strong>One job journey</strong><span>Customers, quotes, field work and finance</span></div><div><strong>Your team, your access</strong><span>Role presets and individual permissions</span></div></div>

    <section id="features" className={styles.section} aria-labelledby="features-title">
      <div className={styles.sectionHeading}><span className={styles.eyebrow}>WHY TLINK</span><h2 id="features-title">Less hunting around.<br /><span>More context where you work.</span></h2><p>A customer record should lead to their job. A quote should lead to the agreed work. The office and field team should be able to pick up the same story.</p></div>
      <div className={styles.featureGrid}>{features.map((feature, index) => <article key={feature.title} className={styles.feature}><span className={styles.featureNumber} aria-hidden="true">0{index + 1}</span><h3>{feature.title}</h3><p>{feature.detail}</p><strong>{feature.benefit}</strong></article>)}</div>
    </section>

    <section className={styles.mapSection} id="trade-map" aria-labelledby="map-title">
      <div className={styles.mapCopy}><span className={styles.eyebrow}>FROM RECORDS TO THE REAL WORLD</span><h2 id="map-title">See where your<br /><span>work comes together.</span></h2><p>View jobs and customers on a map, then open the linked record. Keep location, customer context and the work itself within reach.</p><p>Design and measurement tools can also support quote preparation. Check site conditions and measurements before relying on a proposed layout.</p></div>
      <DemoMap />
    </section>

    <section className={styles.customerSection} id="customer-experience" aria-labelledby="customer-title">
      <div><span className={styles.eyebrow}>BETTER FOR THE PEOPLE YOU SERVE</span><h2 id="customer-title">Clear decisions.<br /><span>A clearer next step.</span></h2><p>Good business software should make the customer&apos;s journey easier too.</p></div>
      <div className={styles.customerBenefits}><article><span aria-hidden="true">↗</span><div><h3>A quote they can understand</h3><p>Put scope, options and equipment in one secure review link, with a matching PDF. Customers can respond without creating an account.</p></div></article><article><span aria-hidden="true">◷</span><div><h3>Arrival times they can review</h3><p>Propose appointment windows and let the customer review the next step before work starts.</p></div></article><article><span aria-hidden="true">✓</span><div><h3>Their sharing choices matter</h3><p>Marketplace enquiries follow recorded service areas, capabilities and household consent. Private plans and documents are not opened up to every trade.</p></div></article></div>
    </section>

    <section className={styles.connections} id="connections" aria-labelledby="connections-title">
      <div className={styles.sectionHeading}><span className={styles.eyebrow}>CONNECT ON YOUR TERMS</span><h2 id="connections-title">Keep the tools<br /><span>that work for you.</span></h2><p>TLink has optional connections for accounting, calendars and business email. Availability and setup are shown inside your business workspace.</p></div>
      <div className={styles.connectionGrid}>
        <article><span>ACCOUNTING</span><h3>Xero · MYOB · QuickBooks</h3><p>Sync eligible issued invoices to your connected accounting account. A PDF download is a document export; accounting sync requires a configured connection and account setup.</p></article>
        <article><span>CALENDARS</span><h3>Google · Outlook</h3><p>Send TLink appointments to a connected calendar. The business owner can privately view accepted external events in Schedule. Provider availability, sign-in and permissions are required.</p></article>
        <article><span>BUSINESS EMAIL</span><h3>Google · Microsoft</h3><p>Connect one business sending address and let authorised staff send from it. Outgoing email only; replies remain in your business mailbox. Provider sign-in, availability and connection status apply.</p></article>
      </div>
      <p className={styles.connectionNote}>Customer payment collection stays with your business and chosen payment arrangements. TLink records payment status. Optional SMS and number rental have separate charges shown before purchase; third-party services can have their own fees.</p>
    </section>

    <section id="getting-started" className={styles.startSection} aria-labelledby="start-title">
      <div className={styles.startHeading}><span className={styles.eyebrow}>FREE SOFTWARE. VERIFIED BUSINESSES.</span><h2 id="start-title">Make TLink<br /><span>part of your working day.</span></h2><p>Core software is A$0, with no seat, lead, job or quote access charge. Your licences, insurance and business responsibilities still apply.</p><Link href={setupHref} className={styles.primary}>Set up your free business <span aria-hidden="true">↗</span></Link></div>
      <ol className={styles.steps}><li><span>01</span><div><h3>Create your business account</h3><p>Provide a valid ABN, business details, service areas and capabilities.</p></div></li><li><span>02</span><div><h3>Complete business review</h3><p>Supply the required evidence. An authorised reviewer must approve the business before workspace access.</p></div></li><li><span>03</span><div><h3>Bring your team and work together</h3><p>Set permissions, add customers and jobs, and configure the optional connections you choose.</p></div></li></ol>
    </section>

    <div className={styles.finalLinks}><p>Marketplace matching gives eligible approved trades access to consented enquiries. It does not guarantee leads, exclusive placement or booked work.</p><Link href="/direct-trade/standards">Read the TLink standards <span aria-hidden="true">↗</span></Link><Link href="/direct-trade/integrations">How optional connections work <span aria-hidden="true">↗</span></Link><Link href="/direct-trade/for-councils">TLink for councils <span aria-hidden="true">↗</span></Link><Link href="/">AEA home <span aria-hidden="true">↗</span></Link></div>
    <SiteFooter>TLink is a product of Australian Energy Assessments. Business approval does not replace trade licensing, insurance or scheme eligibility.</SiteFooter>
  </main>;
}
