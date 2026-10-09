import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { JsonLd } from "@/components/JsonLd";
import { buildPlatformMetadata, PUBLIC_SITE } from "@/lib/public-site";
import styles from "./page.module.css";

export const metadata = buildPlatformMetadata({
  path: "/case-studies",
  title: "Home Energy Savings Examples: Solar, Batteries and Gas | AEA",
  description: "Follow four worked examples of electricity plan costs, solar savings, extra battery value and leaving gas. See the numbers, assumptions and your next step.",
});

const examples = [
  { id: "electricity-timing", title: "Which electricity plan is cheaper?", label: "Electricity plans" },
  { id: "solar-self-use", title: "Why does using your own solar matter?", label: "Solar panels" },
  { id: "battery-value", title: "What does a battery add to solar?", label: "Solar + storage" },
  { id: "leaving-gas", title: "What could getting off gas save?", label: "Electrification" },
] as const;
const canonical = `${PUBLIC_SITE.apexUrl}/case-studies`;
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage", "@id": `${canonical}#webpage`, url: canonical,
      name: "Home energy savings worked examples", description: metadata.description,
      dateModified: "2026-10-09", inLanguage: "en-AU",
      isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId }, publisher: { "@id": PUBLIC_SITE.organizationId },
      mainEntity: { "@id": `${canonical}#examples` }, breadcrumb: { "@id": `${canonical}#breadcrumb` },
    },
    {
      "@type": "ItemList", "@id": `${canonical}#examples`, name: "Illustrative home energy decisions", numberOfItems: examples.length,
      itemListElement: examples.map((example, index) => ({ "@type": "ListItem", position: index + 1, name: example.title, url: `${canonical}#${example.id}` })),
    },
    {
      "@type": "BreadcrumbList", "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Energy savings examples", item: canonical },
      ],
    },
  ],
};

export default function CaseStudiesPage() {
  return <main className={`wrap guide-page ${styles.page}`}>
    <SiteHeader active="case-studies" /><JsonLd data={structuredData} />
    <header className="guide-hero"><span>Energy savings, explained</span><h1>See what changes the numbers before you spend</h1><p>A cheaper plan, solar panels, a battery or moving away from gas? Follow the money in four simple examples, then try the decision with your own home.</p></header>
    <aside className={styles.disclosure}><strong>Worked examples, not customer case studies</strong><p>The prices and usage below are deliberately assumed to explain the maths. They are not current offers, installation quotes, measured customer outcomes or guaranteed savings. Each example isolates one decision.</p></aside>
    <nav className={styles.jumpLinks} aria-label="Choose an energy savings example">{examples.map((example) => <a href={`#${example.id}`} key={example.id}>{example.label}<span aria-hidden="true">↗</span></a>)}</nav>

    <article className={styles.example} id="electricity-timing" aria-labelledby="electricity-title">
      <header><span>01 / Electricity plans</span><h2 id="electricity-title">Which electricity plan is cheaper?</h2><p>A lower off-peak price helps only when you use electricity at that time. The same yearly usage can favour a different plan.</p></header>
      <div className={styles.assumptions}><strong>Our assumed prices</strong><p>4,000 kWh of electricity over 365 days. Plan A charges 30c/kWh at all times. Plan B charges 45c in peak periods and 20c off-peak. Both charge $1 a day to stay connected. No solar, discounts, separate hot-water tariff or demand charge.</p></div>
      <div className={styles.tableWrap}><table><caption>Same usage, different timing</caption><thead><tr><th scope="col">When electricity is used</th><th scope="col">Plan A: one rate</th><th scope="col">Plan B: peak + off-peak</th><th scope="col">Cheaper choice</th></tr></thead><tbody><tr><th scope="row">25% peak, 75% off-peak</th><td>$1,565/year</td><td>$1,415/year</td><td>Plan B by $150/year</td></tr><tr><th scope="row">60% peak, 40% off-peak</th><td>$1,565/year</td><td>$1,765/year</td><td>Plan A by $200/year</td></tr></tbody></table></div>
      <p className={styles.calculation}><strong>Check the first row:</strong> Plan A is 4,000 × $0.30 + $365 = $1,565. Plan B is 1,000 × $0.45 + 3,000 × $0.20 + $365 = $1,415.</p>
      <div className={styles.takeaway}><strong>Your next decision</strong><p>Use a full year of smart-meter readings when available. Otherwise start with a bill and treat the assumed timing as an estimate. An optional plan ID from your bill can match a published offer; confirm its rates against your latest bill.</p></div>
      <Link className={styles.action} href="/compare">Compare plans with my usage <span aria-hidden="true">↗</span></Link>
    </article>

    <article className={styles.example} id="solar-self-use" aria-labelledby="solar-title">
      <header><span>02 / Solar panels</span><h2 id="solar-title">Why does using your own solar matter?</h2><p>Solar can save money in two ways: using it at home avoids buying electricity, while sending the surplus to the grid earns a feed-in payment.</p></header>
      <div className={styles.assumptions}><strong>Our assumed prices</strong><p>Panels generate 5,000 kWh in a year. Buying electricity costs 30c/kWh; exports earn 5c/kWh. The daily connection charge stays the same. There is no battery in this example.</p></div>
      <div className={styles.tableWrap}><table><caption>Same generation, different use at home</caption><thead><tr><th scope="col">Solar energy</th><th scope="col">Less daytime use</th><th scope="col">More daytime use</th></tr></thead><tbody><tr><th scope="row">Used directly at home</th><td>2,000 kWh</td><td>3,500 kWh</td></tr><tr><th scope="row">Sent to the grid</th><td>3,000 kWh</td><td>1,500 kWh</td></tr><tr><th scope="row">Avoided purchases + export payments</th><td>$600 + $150</td><td>$1,050 + $75</td></tr><tr className={styles.total}><th scope="row">Yearly bill reduction</th><td>$750</td><td>$1,125</td></tr></tbody></table></div>
      <div className={styles.takeaway}><strong>$375 more value from the same solar generation</strong><p>The second pattern shifts 1,500 kWh of existing demand into sunny hours. Each shifted kWh saves 30c but gives up a 5c export payment: 1,500 × 25c = $375. It assumes that much demand can actually move into those hours; adding unnecessary use would not create the same saving.</p></div>
      <p className={styles.limitation}>A postcode gives a useful local climate starting point. Roof direction, shade, panel layout and export limits still need an installer&apos;s assessment. Annual sunshine alone does not tell us when the home can use the generation.</p>
      <div className={styles.actions}><Link className={styles.action} href="/compare">Explore my solar savings <span aria-hidden="true">↗</span></Link><Link href="/guides/solar">Check what a solar quote should include</Link></div>
    </article>

    <article className={styles.example} id="battery-value" aria-labelledby="battery-title">
      <header><span>03 / Solar + storage</span><h2 id="battery-title">What does a battery add to solar?</h2><p>Compare a battery with keeping solar alone. The battery&apos;s extra value is the electricity it helps you avoid buying, after accounting for lost export payments and energy lost in storage.</p></header>
      <div className={styles.assumptions}><strong>Our assumed day</strong><p>8 kWh of spare solar can charge the battery. It returns 7.2 kWh later, when the home needs that much electricity. Buying power costs 30c/kWh; exports earn 5c/kWh. This happens on 250 days a year. On the other days we assume no extra battery saving.</p></div>
      <ol className={styles.mathSteps}><li><strong>$2.16 avoided purchases per useful day</strong><span>7.2 kWh delivered × 30c.</span></li><li><strong>Minus 40c in export payments</strong><span>8 kWh used to charge × 5c that solar alone would have earned.</span></li><li><strong>$1.76 extra daily value, or $440 a year</strong><span>($2.16 − $0.40) × 250 useful days.</span></li></ol>
      <div className={styles.takeaway}><strong>A $6,600 extra installed cost would take 15 years to recover in this example</strong><p>$6,600 ÷ $440 = 15 years of unchanged savings. Use the additional battery cost after confirmed discounts, rather than counting the solar panels again. A different tariff, more useful days or a lower quote would change the result.</p></div>
      <p className={styles.limitation}>This simple payback excludes finance, maintenance, degradation, replacement, price changes and VPP payments. It does not value backup during outages. Backup needs specific equipment and wiring, and keeping energy in reserve can reduce everyday bill savings.</p>
      <div className={styles.actions}><Link className={styles.action} href="/compare">Compare solar with solar + storage <span aria-hidden="true">↗</span></Link><Link href="/guides/batteries">Check battery sizing, backup and quotes</Link></div>
    </article>

    <article className={styles.example} id="leaving-gas" aria-labelledby="gas-title">
      <header><span>04 / Electrification</span><h2 id="gas-title">What could getting off gas save?</h2><p>Count the extra electricity as well as the gas you stop buying. Replacing the last gas appliance can also remove the daily gas connection charge.</p></header>
      <div className={styles.assumptions}><strong>Our assumed year</strong><p>The gas appliances use $1,200 of gas, plus a $300 connection charge. Efficient electric replacements providing the same heating, hot water and cooking add $900 to the electricity bill. These are teaching figures, not an appliance performance forecast.</p></div>
      <div className={styles.tableWrap}><table><caption>Ongoing energy costs before and after replacing all gas appliances</caption><thead><tr><th scope="col">Yearly cost</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody><tr><th scope="row">Gas used by appliances</th><td>$1,200</td><td>$0</td></tr><tr><th scope="row">Gas connection</th><td>$300</td><td>$0 after disconnection</td></tr><tr><th scope="row">Extra electricity for replacements</th><td>$0</td><td>$900</td></tr><tr className={styles.total}><th scope="row">Costs being compared</th><td>$1,500/year</td><td>$900/year</td></tr></tbody></table></div>
      <div className={styles.takeaway}><strong>$600 a year saved in this example</strong><p>$1,200 gas + $300 connection − $900 extra electricity = $600. If the gas connection stays active, the $300 charge remains and this assumed saving falls to $300. Your other electricity use is unchanged and excluded from both columns.</p></div>
      <p className={styles.limitation}>Ask about installation, circuits, switchboard work and gas disconnection or abolishment fees before deciding. Change appliances in a practical order; the supply-charge saving comes only when the connection is ended. Actual use depends on the building, weather, equipment and habits.</p>
      <div className={styles.actions}><Link className={styles.action} href="/gas-compare">Estimate my move away from gas <span aria-hidden="true">↗</span></Link><Link href="/guides/home-energy-upgrades">Plan which appliance to replace first</Link></div>
    </article>

    <section className="guide-section" aria-labelledby="example-sources"><div className="guide-section-heading"><span>Keep learning</span><h2 id="example-sources">Official guidance behind the decisions</h2></div><p>These sources explain bill comparisons, solar, storage and electrification. The assumed figures above are our educational examples, not figures quoted from these sources.</p><div className="guide-source-links"><a href="https://www.energymadeeasy.gov.au/" target="_blank" rel="noreferrer">Australian Energy Regulator: Energy Made Easy</a><a href="https://www.energy.gov.au/households/solar-pv-and-batteries" target="_blank" rel="noreferrer">Australian Government: solar and batteries</a><a href="https://www.energy.gov.au/households/electrification" target="_blank" rel="noreferrer">Australian Government: electrification</a></div></section>
    <section className="guide-callout"><div><h2>Not sure which decision comes first?</h2><p>Build a home energy plan around your comfort, equipment, budget and timing. Start with the evidence you have and work out what to confirm next.</p></div><Link href="/plan">Build my home energy plan</Link></section>
    <SiteFooter>All worked-example prices and savings are illustrative. Use your own bills and written quotes, and confirm eligibility and site suitability before switching plans or buying equipment.</SiteFooter>
  </main>;
}
