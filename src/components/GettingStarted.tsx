import Link from "next/link";
import { CALENDLY_EMBED_URL } from "@/lib/assessment-booking";
import bookingStyles from "./AssessmentBooking.module.css";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";
import { CustomerJourneyScene } from "./CustomerJourneyScene";
import { SurgeOpenButton } from "./SurgeOpenButton";

const preparation = [
  { number: "1", title: "Bring a recent bill", text: "It shows your postcode, current plan and how much energy you use." },
  { number: "2", title: "Tell us what you want to improve", text: "You might want lower bills, a more comfortable home, new equipment or a plan for several upgrades." },
  { number: "3", title: "Check before committing", text: "Confirm the full price, available rebates, approvals, installer credentials and warranty before you sign." },
];

const upgradeLinks = [
  ["Insulation and draughts", "Insulation, draught sealing, windows and ventilation", "/guides/insulation-draught-proofing"],
  ["Heating and cooling", "Comfort, climate, correct sizing and noise", "/guides/heating"],
  ["Hot water", "How much you need, heat pumps, electricity plans and rebates", "/guides/hot-water"],
  ["Electric cooking", "Induction, circuits, ventilation and kitchen fit", "/guides/cooking"],
  ["Rooftop solar", "What your roof can produce, what you can use and what goes to the grid", "/guides/solar"],
  ["Home batteries", "Usable storage, power, backup and warranty", "/guides/batteries"],
  ["EV charging", "Driving needs, solar timing and site capacity", "/guides/ev-charging"],
] as const;

export function GettingStarted() {
  return <main className="wrap start-page">
    <SiteHeader active="start" />
    <header className="start-hero start-hero-planner">
      <div className="start-hero-copy">
        <span className="start-eyebrow">Independent home energy planning</span>
        <h1>One clear plan for a more comfortable, lower-cost home</h1>
        <p>Not sure what comes first? Answer a few simple questions and skip anything you do not know. We will put the next steps in order, and you can see your plan before creating an account or speaking to anyone.</p>
        <div className="start-actions"><Link className="btn start-primary-action" href="/plan">Build my home energy plan</Link><SurgeOpenButton label="Ask Wattzun AI first" description="Talk through the first decision in plain English." draft="I am not sure where to start with my home energy upgrades. Help me work out the first decision." /></div>
        <p className="start-hero-secondary">Already know what you need? <Link href="#compare-energy-plans" prefetch={false}>Compare electricity or gas</Link>, <Link href="/calculator" prefetch={false}>estimate a rebate</Link> or <Link href="#home-booking" prefetch={false}>book a quick call</Link>. You can build a plan or contact matching trades without creating an account.</p>
        <aside aria-label="What the guided plan includes"><strong>About three minutes</strong><ul><li>No account to begin</li><li>Skip anything you do not know</li><li>See your roadmap first</li><li>Decide what happens next</li></ul></aside>
      </div>
      <CustomerJourneyScene />
    </header>

    <section id="home-booking" className={bookingStyles.bookingCard} style={{ marginBottom: "38px" }} aria-labelledby="home-booking-title">
      <div style={{ padding: "22px 24px" }}>
        <span className="start-eyebrow" style={{ color: "#087f73" }}>Need a little help?</span>
        <h2 id="home-booking-title" style={{ color: "#092c38", margin: "4px 0 0" }}>Book a five-minute call</h2>
        <p style={{ color: "#496961", lineHeight: 1.55, margin: "8px 0 0", maxWidth: "850px" }}>Not sure which home energy assessment you need? Pick a time that suits you. We will ask about your home, location and what you need, then explain the next step. This call is not the assessment itself.</p>
      </div>
      <div className={bookingStyles.embedShell}>
        <iframe
          className={bookingStyles.embed}
          src={CALENDLY_EMBED_URL}
          title="Choose a five-minute call time with Australian Energy Assessments"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <p className={bookingStyles.privacyNote}>Calendly adds the call to our calendar and emails the booking details to you. Calendly handles the booking details. Read our <Link href="/privacy" style={{ color: "#087f73", fontWeight: 800 }}>privacy notice</Link>.</p>
    </section>

    <section className="home-entry home-entry-guided" aria-labelledby="home-entry-title"><div className="start-heading"><span>Start where you are</span><h2 id="home-entry-title">What do you need today?</h2><p>Not sure? Start with the home plan. It will show whether you should compare energy plans, look at upgrades, book an assessment or speak with a trade.</p></div><div className="home-entry-explainers"><article><span>Best place to start</span><h3>Build my home energy plan</h3><p>Answer a few simple questions to see which upgrades or assessments could help and what to do first.</p></article><article><span>Only checking your bill?</span><h3>Compare energy plans</h3><p>Use this when you only want to check your current electricity or mains gas plan.</p></article><article><span>Ready to ask for help?</span><h3>Find matching trades</h3><p>Send one enquiry without creating an account. You choose which contact details are shared with matching trades.</p></article></div><Link className="btn home-entry-primary" href="/plan" prefetch={false}>Build my home energy plan</Link></section>

    <section className="start-section start-prepare" aria-labelledby="prepare-title"><div className="start-heading"><span>Before you decide</span><h2 id="prepare-title">Get ready in three simple steps</h2></div><div className="start-step-grid">{preparation.map((item) => <article key={item.number}><span>{item.number}</span><div><h3>{item.title}</h3><p>{item.text}</p></div></article>)}</div></section>

    <section className="start-section" id="compare-energy-plans" aria-labelledby="choose-path-title"><div className="start-heading"><span>Compare what you pay now</span><h2 id="choose-path-title">Compare electricity and gas separately</h2><p>Electricity and gas bills work differently, so each comparison uses the right information for that fuel.</p></div><div className="start-path-grid"><article className="start-path-card"><span className="start-path-tag">Electricity</span><h3>Compare electricity plans</h3><p>Enter your postcode and yearly electricity use. For a more detailed result, add a detailed meter-data file, called a NEM12 file. It is processed on your device.</p><ul><li>Household and small business plans</li><li>Include solar, battery and controlled load use</li><li>See how each estimated cost was calculated</li></ul><Link href="/compare" prefetch={false}>Start electricity comparison</Link></article><article className="start-path-card"><span className="start-path-tag">Mains gas</span><h3>Compare gas plans</h3><p>Enter a full year of gas use in megajoules (MJ), or use a recent bill with the billing dates. We adjust the estimate for seasonal heating and the pricing published for each plan.</p><ul><li>Mains gas plans only, not bottled LPG</li><li>We may ask which gas network supplies your home</li><li>See important concessions and plan conditions</li></ul><Link href="/gas-compare" prefetch={false}>Start gas comparison</Link></article></div></section>

    <section className="start-section" aria-labelledby="upgrade-guides-title"><div className="start-heading"><span>Understand each upgrade</span><h2 id="upgrade-guides-title">Simple guides for each part of your home</h2><p>Learn how insulation and draught sealing can reduce the energy your home needs, then compare heating, hot water, solar, batteries and EV charging.</p></div><div className="home-upgrade-grid">{upgradeLinks.map(([title, text, href]) => <Link href={href} prefetch={false} key={title}><span>{title}</span><small>{text}</small></Link>)}</div><Link className="home-library-link" href="/guides" prefetch={false}>Browse all guides, rebates and examples</Link></section>

    <section className="start-section" aria-labelledby="home-assessment-pathways-title"><div className="start-heading"><span>Home energy assessments</span><h2 id="home-assessment-pathways-title">Which assessment is right for your home?</h2><p>Building or designing a new home? NatHERS assesses the plans. Already living in the home? An assessor can visit the property. Some New South Wales projects also need BASIX.</p></div><div className="home-entry-grid home-assessment-grid"><article><span>New homes across Australia</span><h3>NatHERS design assessment</h3><p>We assess the plans before construction to estimate the home&apos;s thermal performance. Where required, we also complete the NatHERS Whole of Home rating.</p><Link href="/nathers-for-new-homes">Explore new-home NatHERS</Link></article><article><span>Completed homes</span><h3>Home Energy Rating</h3><p>An assessor visits the finished home and completes the current Home Energy Rating. Our on-site coverage is currently strongest in New South Wales and Victoria.</p><Link href="/home-energy-rating-for-existing-homes">Explore existing-home ratings</Link></article><article><span>New-home certificate</span><h3>Whole of Home rating</h3><p>See how heating, cooling, hot water, lighting, solar and batteries affect the home&apos;s 0 to 100+ Whole of Home rating. It is reported alongside the NatHERS star rating.</p><Link href="/nathers-whole-of-home">Understand Whole of Home</Link></article><article><span>New South Wales planning</span><h3>BASIX assessment support</h3><p>Some New South Wales projects need a BASIX certificate. We help bring the water, energy and thermal performance requirements together for the application.</p><Link href="/basix-nsw">Explore BASIX support</Link></article></div></section>

    <section className="home-support-grid" aria-label="Assessment, support and project help"><article><span>Official support</span><h2>Find rebates, loans and certificate schemes</h2><p>Choose your state or territory, then check eligibility on the official program website before you buy or sign anything.</p><Link href="/rebates" prefetch={false}>Find rebates and assistance</Link></article><article><span>Independent assessment</span><h2>Find the right assessment for your home or project</h2><p>Tell us whether you are designing, renovating or assessing an existing home. We will show you which assessment applies and what the result can be used for.</p><Link href="/assessments" prefetch={false}>Explore assessments</Link></article><article><span>Direct Trade Services</span><h2>Get your project ready for quotes</h2><p>With your permission, we can share the details you choose with approved trades that do this type of work and service your area.</p><Link href="/direct-trade" prefetch={false}>Prepare a project brief</Link><Link style={{ marginTop: 8 }} href="/direct-trade/standards">Read the marketplace standards</Link></article></section>

    <section className="start-privacy"><div><span>Privacy first</span><h2>Start privately, without an account</h2><p>If you add a detailed electricity meter file, called a NEM12 file, it is processed on your device. The file, meter number and detailed readings are not added to saved links or trade enquiries.</p></div><Link href="/plan" prefetch={false}>Build my private plan</Link></section>

    <section className="direct-trade-installer direct-trade-installer-compact" aria-labelledby="installer-title"><div><span>For trades and suppliers</span><h2 id="installer-title">Join the Australian Energy Assessments trade network</h2><p>Approved trade businesses can use the core TLink workspace free of charge. Household details stay private, leads are not sold and placement is not auctioned.</p><p>Reputable suppliers can show proven products to suitable trades and households without adding another sales layer.</p><div className="direct-trade-partner-actions"><Link className="btn" href="/platform">See how TLink works</Link><Link className="btn ghost" href="/direct-trade/partners">Trade and supplier participation</Link></div></div><aside><strong>Approval is not a licence or government accreditation</strong><p>We review the ABN and business information provided by each applicant. Trades still need the licences, insurance, accreditations and scheme approvals required for each job.</p><span>Every application is reviewed by a person.</span></aside></section>

    <SiteFooter>Prices, rebates and rules can change. Check the latest details, full quote, products, approvals and installation conditions before you commit.</SiteFooter>
  </main>;
}
