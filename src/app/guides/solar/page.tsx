import Link from "next/link";
import { GuideShell, GuideSection } from "@/components/GuideShell";
import { buildPlatformMetadata } from "@/lib/public-site";
import styles from "../page.module.css";

const quoteChecks = [
  "System size in kW and the exact panel and inverter models",
  "A site-specific layout showing panel placement, orientation and likely shading",
  "Expected annual generation and bill savings with the household use, rates and assumptions stated",
  "Network connection, export limits and any smart-meter work",
  "Switchboard, wiring, roof access and other work included in the total installed price",
  "GST and each confirmed certificate discount or rebate, showing the final amount you pay",
  "Product, performance and workmanship warranties plus local support details",
];

export const metadata = buildPlatformMetadata({
  path: "/guides/solar",
  title: "Is Rooftop Solar Worth It? Sizing and Quote Guide | Australian Energy Assessments",
  description: "Understand solar kW and kWh, self-use, feed-in tariffs, postcode estimates and written quotes. Compare solar alone with solar plus a battery.",
});

export default function SolarGuidePage() {
  return <GuideShell label="Rooftop solar, explained" title="Is rooftop solar worth it for your home?" introduction="Solar can reduce the electricity you buy. Its value depends on what your roof generates, how much you use at home and what your plan pays for the surplus.">
    <section className={styles.answerPanel} aria-labelledby="solar-answer">
      <h2 id="solar-answer">Start with solar generation and your daily use</h2>
      <p>Panels generate electricity during daylight. Your home uses what it needs at that moment; surplus can go to the grid or an optional battery. A battery stores energy for later and has its own extra cost.</p>
      <p>Compare solar alone first, then check how much more a battery saves. The best fit depends on your usage and roof, rather than the biggest system advertised.</p>
      <div className={styles.inlineLinks}><Link href="/compare">Compare plans and model solar</Link><Link href="/case-studies#solar-self-use">See a solar worked example</Link><Link href="/guides/batteries">Understand what a battery adds</Link></div>
    </section>

    <nav className={styles.jumpNav} aria-label="In this solar guide">
      <a href="#solar-terms">What the terms mean</a><a href="#postcode-estimate">Your postcode estimate</a><a href="#solar-quotes">Using a quote</a><a href="#solar-checks">Installer checks</a>
    </nav>

    <div id="solar-terms" className={styles.sectionAnchor}><GuideSection eyebrow="Know what you are comparing" title="Four terms that make solar easier to understand">
      <dl className={styles.glossary}>
        <div><dt>kW: the size of the solar system</dt><dd>Kilowatts describe power. A 5 kW panel system is a size rating, not a promise that it generates 5 kW all day. Use the panel size in your quote when comparing scenarios.</dd></div>
        <div><dt>kWh: the electricity generated or used</dt><dd>Kilowatt-hours measure energy over time. A 1 kW appliance running for one hour uses 1 kWh. Annual solar generation in kWh can be compared with annual bill usage, but timing still matters.</dd></div>
        <div><dt>Self-use: solar used inside your home</dt><dd>This is electricity you use as your panels generate it. It can replace grid purchases. Exports on a bill do not reveal this direct solar use; household and generation monitoring provide better evidence.</dd></div>
        <div><dt>Feed-in tariff: what exports earn</dt><dd>This is the amount your electricity plan pays per kWh sent to the grid. Check it alongside the price of imported electricity, the daily supply charge and any conditions.</dd></div>
      </dl>
    </GuideSection></div>

    <GuideSection eyebrow="The core calculation" title="Solar value has two different parts"><div className="guide-principle-grid">
      <article><strong>Solar used in the home</strong><p>It avoids purchases at the import rate that would otherwise apply. Running suitable appliances during generation can increase this value.</p></article>
      <article><strong>Solar exported to the grid</strong><p>Surplus earns the applicable feed-in tariff when exports are permitted. Network limits can restrict how much can be sent out.</p></article>
      <article><strong>Future electricity use</strong><p>An EV, heat-pump hot water or electric heating can change your demand. Include realistic plans when asking for a system design.</p></article>
    </div><div className={styles.formula}>Estimated solar bill benefit = avoided grid purchases + export credits.</div><div className={styles.inlineLinks}><Link href="/case-studies#solar-self-use">Follow the self-use calculation</Link><Link href="/case-studies#battery-value">Compare the extra value of storage</Link></div></GuideSection>

    <div id="postcode-estimate" className={styles.sectionAnchor}><GuideSection eyebrow="A useful starting point" title="Your postcode helps estimate generation, not your roof">
      <p className={styles.sectionIntro}>The calculator automatically uses a local annual climate estimate at your postcode centre. It uses PVGIS reference solar generation based on 2005 to 2023 weather, rather than treating every postcode in a state as identical. Nearby postcodes can share a climate grid cell.</p>
      <div className="guide-two-column">
        <div><h3>What it helps you explore</h3><p>An indicative annual output for a chosen panel size, matched to your measured or assumed household usage. You can then compare estimated imports, exports and bill costs.</p></div>
        <div><h3>What an installer must confirm</h3><p>Your actual roof direction, pitch, shade, panel layout, equipment and network limits. The climate reference assumes optimal tilt and is not a roof survey or a forecast for next year.</p></div>
      </div><div className="guide-note"><strong>A postcode estimate is not an installed quote</strong><p>Annual location data does not model your exact roof or seasonal weather. Ask for a site visit and a design showing expected monthly and annual output. If local data is unavailable, the calculator identifies its regional estimate.</p></div>
    </GuideSection></div>

    <div id="solar-quotes" className={styles.sectionAnchor}><GuideSection eyebrow="Put your own price into the comparison" title="Use the complete quote, after confirmed discounts">
      <div className="guide-two-column">
        <div><h3>Solar-only quote</h3><p>Enter the quoted panel size and final installed solar price, including GST and all required work. The prefilled amount is a planning estimate; replace it with your written quote when available.</p></div>
        <div><h3>Solar plus battery quote</h3><p>Enter the combined final price for the whole new solar and battery installation. Do not put a battery-only price in the combined field or add a rebate that has already been deducted.</p></div>
      </div><div className="guide-note"><strong>Compare the extra cost with the extra saving</strong><p>To assess adding storage to the same solar design, compare the combined quote with the solar-only quote. Compare the extra battery saving with that additional price. If you already have solar, ask for the battery addition price and any compatibility work.</p></div>
      <h3 className={styles.checklistTitle}>What every written solar quote should show</h3><ul className="guide-checklist">{quoteChecks.map((item) => <li key={item}>{item}</li>)}</ul>
      <div className="guide-note"><strong>Small-scale technology certificates</strong><p>Eligible solar installations may receive an upfront STC discount. Confirm the deduction and installation-date rules in your quote before relying on them.</p></div>
    </GuideSection></div>

    <div id="solar-checks" className={styles.sectionAnchor}><GuideSection eyebrow="Before you accept" title="Confirm the installer, equipment and site design">
      <div className="guide-two-column">
        <div><h3>Prepare useful evidence</h3><p>Bring about a year of bills, half-hour meter data where available, existing solar details and planned appliance changes. Ask for quotes that address the same scope.</p></div>
        <div><h3>Check who will do the work</h3><p>Verify the installer&apos;s Solar Accreditation Australia number, licensing and approved equipment. Confirm warranties and who handles local support.</p></div>
      </div><div className="guide-source-links"><a href="https://www.energy.gov.au/solar/use-your-solar-system/get-most-your-solar-system" target="_blank" rel="noreferrer">Australian Government solar guidance</a><a href="https://www.energy.gov.au/solar/solar-retailers-and-installation/choose-your-solar-retailer-and-installer" target="_blank" rel="noreferrer">Official installer and quote checklist</a><a href="https://data.jrc.ec.europa.eu/dataset/eef67979-e4a9-46f1-80f4-16fe2a266634" target="_blank" rel="noreferrer">PVGIS climate data source</a></div>
      <p className={styles.reviewed}>Sources checked <time dateTime="2026-10-09">9 October 2026</time>. Estimates are planning aids; your written design and quote should confirm the installation.</p>
    </GuideSection></div>

    <section className="guide-callout guide-callout-primary"><div><h2>See what solar could change for your home</h2><p>Use your bill or meter data to compare plans, solar alone and solar with storage. Review an option and enquire when you are ready.</p></div><Link href="/compare">Explore my solar options</Link></section>
  </GuideShell>;
}
