import { SiteFooter, SiteHeader } from "./ComparatorChrome";

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
        <p>Not sure what comes first? Start here. We will ask one simple question at a time, then give you an ordered plan before you need an account or speak to anyone.</p>
        <div className="start-actions"><a className="btn start-primary-action" href="/plan">Build my home energy plan</a></div>
        <p className="start-hero-secondary">Already know what you need? <a href="#compare-energy-plans">Compare an electricity or gas plan</a> or <a href="/calculator">estimate a rebate</a>. An <a href="/account">account is optional</a> and only needed when you want to save a project or ask verified trades.</p>
        <aside aria-label="What the guided plan includes"><strong>About three minutes</strong><ul><li>No account to begin</li><li>Skip anything you do not know</li><li>See your roadmap first</li><li>Decide what happens next</li></ul></aside>
      </div>
      <div className="start-hero-visual start-spatial-home" role="img" aria-label="A layered home energy plan connecting comfort, hot water, solar and energy use">
        <span className="start-orbit start-orbit-one" aria-hidden="true" />
        <span className="start-orbit start-orbit-two" aria-hidden="true" />
        <div className="start-home-model" aria-hidden="true"><span className="start-home-roof" /><span className="start-home-body"><i>HOME</i></span><span className="start-home-base" /></div>
        <span className="start-scene-card start-scene-card-comfort" aria-hidden="true"><b>01</b> Comfort first</span>
        <span className="start-scene-card start-scene-card-energy" aria-hidden="true"><b>02</b> Energy use</span>
        <span className="start-scene-card start-scene-card-upgrades" aria-hidden="true"><b>03</b> Smart sequence</span>
      </div>
    </header>

    <section className="home-entry home-entry-guided" aria-labelledby="home-entry-title"><div className="start-heading"><span>Start where you are</span><h2 id="home-entry-title">What do you need today?</h2><p>If you are not certain, build the plan. It will tell you where comparison, upgrades, assessments or trade help fit.</p></div><div className="home-entry-explainers"><article><span>Recommended starting point</span><h3>Build the plan</h3><p>Choose this when you want guidance on the whole home or do not know what should come first.</p></article><article><span>Separate bill check</span><h3>Compare energy plans</h3><p>Choose comparison only when you specifically want to check the electricity or mains gas plan you pay for now.</p></article><article><span>Optional later step</span><h3>Save or ask trades</h3><p>Create an account after seeing your roadmap if you want to keep it or turn it into a private project brief.</p></article></div><a className="btn home-entry-primary" href="/plan">Start my guided home plan</a></section>

    <section className="start-section start-prepare" aria-labelledby="prepare-title"><div className="start-heading"><span>A simpler process</span><h2 id="prepare-title">From household evidence to a decision</h2></div><div className="start-step-grid">{preparation.map((item) => <article key={item.number}><span>{item.number}</span><div><h3>{item.title}</h3><p>{item.text}</p></div></article>)}</div></section>

    <section className="start-section" id="compare-energy-plans" aria-labelledby="choose-path-title"><div className="start-heading"><span>Compare what you pay now</span><h2 id="choose-path-title">Electricity and gas use separate evidence</h2><p>Each fuel keeps its own calculation method so seasonal gas use is not mixed with electricity timing.</p></div><div className="start-path-grid"><article className="start-path-card"><span className="start-path-tag">Electricity</span><h3>Compare electricity plans</h3><p>Use a postcode and annual usage, or add locally processed NEM12 meter data for a stronger time-of-use result.</p><ul><li>Residential and small-business options</li><li>Solar, battery and controlled-load scenarios</li><li>Charge-level calculation evidence</li></ul><a href="/compare">Start electricity comparison</a></article><article className="start-path-card"><span className="start-path-tag">Mains gas</span><h3>Compare gas plans</h3><p>Use a full year of MJ or one dated recent bill. The tool accounts for seasonal heating use and published gas tariff blocks.</p><ul><li>Mains gas plans only, not LPG</li><li>Distributor confirmation where required</li><li>Concession and condition disclosures</li></ul><a href="/gas-compare">Start gas comparison</a></article></div></section>

    <section className="start-section" aria-labelledby="upgrade-guides-title"><div className="start-heading"><span>Understand the upgrade</span><h2 id="upgrade-guides-title">One practical library for the whole home</h2><p>Start with comfort and demand, then coordinate equipment, solar, storage and transport around the home.</p></div><div className="home-upgrade-grid">{upgradeLinks.map(([title, text, href]) => <a href={href} key={title}><span>{title}</span><small>{text}</small></a>)}</div><a className="home-library-link" href="/guides">Open all guides, rebates and worked examples</a></section>

    <section className="home-support-grid" aria-label="Assessment, support and project pathways"><article><span>Official support</span><h2>Check rebates without treating them as guaranteed</h2><p>Choose a state or territory, distinguish certificates from rebates and loans, then confirm current rules at the official source.</p><a href="/rebates">Find rebates and assistance</a></article><article><span>Independent assessment</span><h2>Use NatHERS, BASIX or an existing-home rating where it fits</h2><p>Choose the correct pathway for a design, renovation, built home or NSW planning project before relying on a certificate.</p><a href="/assessments">Explore assessments</a></article><article><span>Direct Trade Services</span><h2>Turn a decision into a defined scope</h2><p>Through an active trade network, household briefs are manually reviewed against verified capability, service area and current evidence.</p><a href="/direct-trade">Prepare a project brief</a></article></section>

    <section className="start-privacy"><div><span>Privacy first</span><h2>Your plan and meter file stay on your device</h2><p>The roadmap needs no account. Electricity interval files are processed locally, and meter identifiers, interval records and filenames are not included in saved links or enquiry data.</p></div><a href="/plan">Plan privately</a></section>

    <section className="direct-trade-installer direct-trade-installer-compact" aria-labelledby="installer-title"><div><span>For licensed installers and reputable suppliers</span><h2 id="installer-title">Bring verified capability into the network</h2><p>Traditional upgrade channels can include sales and administration businesses before a licensed contractor performs the work. Direct Trade Services shortens that path. Quotes should separate equipment, labour, certificates or rebates, optional extras and warranty terms.</p><p>TLink gives approved trade businesses the core operating tools at A$0. Household details remain protected, individual leads are not sold and placement is not auctioned. Reputable suppliers can connect proven products with qualified trades and suitable households.</p><div className="direct-trade-partner-actions"><a className="btn" href="/platform">Explore the full platform</a><a className="btn ghost" href="/direct-trade/partners">Trade and supplier participation</a><a className="btn ghost" href="/direct-trade/access">Free trade access</a><a className="btn ghost" href="/direct-trade/standards">Read the marketplace standards</a></div></div><aside><strong>TLink approval is not a government accreditation</strong><p>Approval confirms that the submitted ABN and required business evidence passed the TLink review. It does not replace a trade licence, government accreditation or scheme-specific installer approval.</p><span>Every application is reviewed directly.</span></aside></section>

    <SiteFooter>Estimates are indicative. Confirm current prices, eligibility, concessions, approvals, products and complete installation conditions before committing.</SiteFooter>
  </main>;
}
