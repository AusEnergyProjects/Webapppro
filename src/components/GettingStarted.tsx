import { BrandBar, SiteNav } from "./ComparatorChrome";

const preparation = [
  { number: "1", title: "Bring a recent bill", text: "Your postcode, retailer, plan name and energy use help establish a useful comparison." },
  { number: "2", title: "Use the best evidence you have", text: "Electricity meter data gives the strongest time-of-use comparison. Annual or recent-bill usage can still provide an indicative result." },
  { number: "3", title: "Confirm before switching", text: "Check the final rates, eligibility, concessions, fees and contract terms directly with the retailer." },
];

export function GettingStarted() {
  return <main className="wrap start-page">
    <BrandBar />
    <SiteNav active="start" />
    <header className="start-hero">
      <div><span className="start-eyebrow">Independent energy comparison</span><h1>Make a confident energy decision</h1><p>Start with the energy bill you already have. We will help you choose the right comparison path, understand the assumptions and know what to confirm before changing plans.</p><div className="start-actions"><a className="btn" href="/compare">Compare electricity</a><a className="btn ghost" href="/gas-compare">Compare gas</a></div></div>
      <aside aria-label="What this service does"><strong>Clear evidence, not a sales ranking</strong><ul><li>Published retailer plan data</li><li>Your household usage where available</li><li>Visible assumptions and calculation audits</li><li>Retailer confirmation before switching</li></ul></aside>
    </header>

    <section className="start-section" aria-labelledby="choose-path-title"><div className="start-heading"><span>Choose your path</span><h2 id="choose-path-title">What would you like to assess?</h2><p>Electricity and gas use different data and pricing methods, so each has its own comparison journey.</p></div><div className="start-path-grid">
      <article className="start-path-card"><span className="start-path-tag">Electricity</span><h3>Compare electricity plans</h3><p>Use a postcode and annual usage, or add locally processed NEM12 meter data for a stronger time-of-use result.</p><ul><li>Residential and small-business options</li><li>Solar, battery and controlled-load scenarios</li><li>Charge-level calculation evidence</li></ul><a href="/compare">Start electricity comparison</a></article>
      <article className="start-path-card"><span className="start-path-tag">Mains gas</span><h3>Compare gas plans</h3><p>Use a full year of MJ or one recent bill. The tool accounts for seasonal heating use and published gas tariff blocks.</p><ul><li>Mains gas plans only, not LPG</li><li>Distributor confirmation where required</li><li>Concession and condition disclosures</li></ul><a href="/gas-compare">Start gas comparison</a></article>
    </div></section>

    <section className="start-section start-prepare" aria-labelledby="prepare-title"><div className="start-heading"><span>Before you begin</span><h2 id="prepare-title">Three steps to a reliable result</h2></div><div className="start-step-grid">{preparation.map((item) => <article key={item.number}><span>{item.number}</span><div><h3>{item.title}</h3><p>{item.text}</p></div></article>)}</div></section>

    <section className="start-privacy"><div><span>Privacy first</span><h2>Your meter file stays on your device</h2><p>Electricity interval files are processed locally in your browser. Meter identifiers, interval records and filenames are not included in saved comparison links or enquiry data.</p></div><a href="/compare">Use meter data safely</a></section>

    <section className="start-section" aria-labelledby="upgrade-guides-title"><div className="start-heading"><span>Plan an upgrade</span><h2 id="upgrade-guides-title">Home energy guides</h2><p>Understand the evidence, quote details, installer checks and assumptions before choosing equipment.</p></div><div className="start-guide-grid"><a href="/guides/solar"><span>Rooftop solar</span><strong>Match generation to your home</strong><small>Size, self-consumption, exports, quotes and installers</small></a><a href="/guides/batteries"><span>Home batteries</span><strong>Test storage against your load</strong><small>Capacity, power, backup, warranties and federal support</small></a><a href="/guides/heating"><span>Heating and cooling</span><strong>Reduce demand, then choose the system</strong><small>Climate-zone ratings, sizing, noise, comfort and quotes</small></a><a href="/guides/hot-water"><span>Hot water</span><strong>Match capacity and timing to your household</strong><small>Heat pumps, solar, tariffs, noise, backup and incentives</small></a></div></section>
    <footer><p>Estimates are indicative. Confirm current prices, eligibility, concessions and conditions with the retailer before switching.</p><p>Provided by <a href="https://www.ausenergyassessments.com/" target="_blank" rel="noreferrer">Australian Energy Assessments</a> | Independent energy assessments | 1300 241 149</p></footer>
  </main>;
}
