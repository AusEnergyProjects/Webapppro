import Link from "next/link";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";
import { CustomerJourneyScene } from "./CustomerJourneyScene";
import { SurgeOpenButton } from "./SurgeOpenButton";

const preparation = [
  { number: "1", title: "Bring a recent bill", text: "Your postcode, plan and energy use establish the starting point." },
  { number: "2", title: "Choose the decision", text: "Lower bills, improve comfort, replace equipment or coordinate a larger upgrade." },
  { number: "3", title: "Check before committing", text: "Confirm the complete quote, official support, approvals, credentials and warranty." },
];

const upgradeLinks = [
  ["Building fabric", "Draughts, insulation, windows and ventilation", "/guides/insulation-draught-proofing"],
  ["Heating and cooling", "Comfort, climate performance, sizing and noise", "/guides/heating"],
  ["Hot water", "Capacity, heat pumps, tariffs and incentives", "/guides/hot-water"],
  ["Electric cooking", "Induction, circuits, ventilation and kitchen fit", "/guides/cooking"],
  ["Rooftop solar", "Roof-specific generation, self-use and exports", "/guides/solar"],
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
        <p>Not sure what comes first? Start here. We will guide you through one clear step at a time, then give you an ordered plan before you need an account or speak to anyone.</p>
        <div className="start-actions"><Link className="btn start-primary-action" href="/plan">Build my home energy plan</Link><SurgeOpenButton label="Ask Wattzun AI first" description="Talk through the first decision in plain English." draft="I am not sure where to start with my home energy upgrades. Help me work out the first decision." /></div>
        <p className="start-hero-secondary">Already know what you need? <Link href="#compare-energy-plans" prefetch={false}>Compare an electricity or gas plan</Link> or <Link href="/calculator" prefetch={false}>estimate a rebate</Link>. No account is needed to build a plan or send an enquiry to matching trades.</p>
        <aside aria-label="What the guided plan includes"><strong>About three minutes</strong><ul><li>No account to begin</li><li>Skip anything you do not know</li><li>See your roadmap first</li><li>Decide what happens next</li></ul></aside>
      </div>
      <CustomerJourneyScene />
    </header>

    <section className="home-entry home-entry-guided" aria-labelledby="home-entry-title"><div className="start-heading"><span>Start where you are</span><h2 id="home-entry-title">What do you need today?</h2><p>If you are not certain, build the plan. It will tell you where comparison, upgrades, assessments or trade help fit.</p></div><div className="home-entry-explainers"><article><span>Recommended starting point</span><h3>Build the plan</h3><p>Choose this when you want guidance on the whole home or do not know what should come first.</p></article><article><span>Separate bill check</span><h3>Compare energy plans</h3><p>Choose comparison only when you specifically want to check the electricity or mains gas plan you pay for now.</p></article><article><span>Optional next step</span><h3>Ask matching trades</h3><p>After your roadmap, send one no-account enquiry and choose which private contact details matching trades may see.</p></article></div><Link className="btn home-entry-primary" href="/plan" prefetch={false}>Start my guided home plan</Link></section>

    <section className="start-section start-prepare" aria-labelledby="prepare-title"><div className="start-heading"><span>A simpler process</span><h2 id="prepare-title">From household evidence to a decision</h2></div><div className="start-step-grid">{preparation.map((item) => <article key={item.number}><span>{item.number}</span><div><h3>{item.title}</h3><p>{item.text}</p></div></article>)}</div></section>

    <section className="start-section" id="compare-energy-plans" aria-labelledby="choose-path-title"><div className="start-heading"><span>Compare what you pay now</span><h2 id="choose-path-title">Electricity and gas use separate evidence</h2><p>Each fuel keeps its own calculation method so seasonal gas use is not mixed with electricity timing.</p></div><div className="start-path-grid"><article className="start-path-card"><span className="start-path-tag">Electricity</span><h3>Compare electricity plans</h3><p>Use a postcode and annual usage, or add locally processed NEM12 meter data for a stronger time-of-use result.</p><ul><li>Residential and small-business options</li><li>Solar, battery and controlled-load scenarios</li><li>Charge-level calculation evidence</li></ul><Link href="/compare" prefetch={false}>Start electricity comparison</Link></article><article className="start-path-card"><span className="start-path-tag">Mains gas</span><h3>Compare gas plans</h3><p>Use a full year of MJ or one dated recent bill. The tool accounts for seasonal heating use and published gas tariff blocks.</p><ul><li>Mains gas plans only, not LPG</li><li>Distributor confirmation where required</li><li>Concession and condition disclosures</li></ul><Link href="/gas-compare" prefetch={false}>Start gas comparison</Link></article></div></section>

    <section className="start-section" aria-labelledby="upgrade-guides-title"><div className="start-heading"><span>Understand the upgrade</span><h2 id="upgrade-guides-title">One practical library for the whole home</h2><p>Start with comfort and demand, then coordinate equipment, solar, storage and transport around the home.</p></div><div className="home-upgrade-grid">{upgradeLinks.map(([title, text, href]) => <Link href={href} prefetch={false} key={title}><span>{title}</span><small>{text}</small></Link>)}</div><Link className="home-library-link" href="/guides" prefetch={false}>Open all guides, rebates and worked examples</Link></section>

    <section className="home-support-grid" aria-label="Assessment, support and project pathways"><article><span>Official support</span><h2>Check rebates without treating them as guaranteed</h2><p>Choose a state or territory, distinguish certificates from rebates and loans, then confirm current rules at the official source.</p><Link href="/rebates" prefetch={false}>Find rebates and assistance</Link></article><article><span>Independent assessment</span><h2>Use NatHERS, BASIX or an existing-home rating where it fits</h2><p>Choose the correct pathway for a design, renovation, built home or NSW planning project before relying on a certificate.</p><Link href="/assessments" prefetch={false}>Explore assessments</Link></article><article><span>Direct Trade Services</span><h2>Turn a decision into a defined scope</h2><p>With your clear consent, the selected enquiry details go to every active verified trade whose recorded capability and service area match the work.</p><Link href="/direct-trade" prefetch={false}>Prepare a project brief</Link></article></section>

    <section className="start-privacy"><div><span>Privacy first</span><h2>Your plan and meter file stay on your device</h2><p>The roadmap needs no account. Electricity interval files are processed locally, and meter identifiers, interval records and filenames are not included in saved links or enquiry data.</p></div><Link href="/plan" prefetch={false}>Plan privately</Link></section>

    <section className="direct-trade-installer direct-trade-installer-compact" aria-labelledby="installer-title"><div><span>For licensed installers and reputable suppliers</span><h2 id="installer-title">Bring verified capability into the network</h2><p>Traditional upgrade channels can include sales and administration businesses before a licensed contractor performs the work. Direct Trade Services shortens that path. Quotes should separate equipment, labour, certificates or rebates, optional extras and warranty terms.</p><p>Australian Energy Assessments gives approved trade businesses the core operating tools at A$0. Household details remain protected, individual leads are not sold and placement is not auctioned. Reputable suppliers can connect proven products with qualified trades and suitable households.</p><div className="direct-trade-partner-actions"><Link className="btn" href="/platform">Explore the full platform</Link><Link className="btn ghost" href="/direct-trade/partners">Trade and supplier participation</Link><Link className="btn ghost" href="/direct-trade/access">Free trade access</Link><Link className="btn ghost" href="/direct-trade/standards">Read the marketplace standards</Link></div></div><aside><strong>Trade workspace approval is not a government accreditation</strong><p>Approval confirms that the submitted ABN and required business evidence passed the Australian Energy Assessments review. It does not replace a trade licence, government accreditation or scheme-specific installer approval.</p><span>Every application is reviewed directly.</span></aside></section>

    <SiteFooter>Estimates are indicative. Confirm current prices, eligibility, concessions, approvals, products and complete installation conditions before committing.</SiteFooter>
  </main>;
}
