import Link from "next/link";
import { GuideShell, GuideSection } from "@/components/GuideShell";
import { buildPlatformMetadata } from "@/lib/public-site";
import styles from "../page.module.css";

export const metadata = buildPlatformMetadata({
  path: "/guides/batteries",
  title: "Is a Home Battery Worth It? Savings and Quote Guide | Australian Energy Assessments",
  description: "Understand battery storage, usable kWh, power, backup and VPPs. Compare extra battery savings with the extra installed cost and check current support.",
});

export default function BatteryGuidePage() {
  return <GuideShell label="Home batteries, explained" title="What would a battery add to your solar?" introduction="A battery stores electricity for later. Its financial value depends on the energy available to charge it, the grid purchases it replaces and the extra price you pay.">
    <section className={styles.answerPanel} aria-labelledby="battery-answer">
      <h2 id="battery-answer">Compare the extra saving with the extra cost</h2>
      <p>Solar creates electricity. A battery moves some of that energy to another time, with losses. It can reduce later grid purchases, but the stored solar no longer earns an export credit.</p>
      <p>Start with solar-only costs and savings, then check what storage adds. Backup power can also matter to you, but it requires the right equipment and wiring.</p>
      <div className={styles.inlineLinks}><Link href="/compare">Model solar and battery options</Link><Link href="/case-studies#battery-value">See a battery worked example</Link><Link href="/guides/solar">Start with the solar guide</Link></div>
    </section>

    <nav className={styles.jumpNav} aria-label="In this battery guide">
      <a href="#battery-terms">What the terms mean</a><a href="#battery-value">What drives savings</a><a href="#battery-quotes">Using a quote</a><a href="#battery-backup">Backup and control</a><a href="#battery-support">Current support</a>
    </nav>

    <div id="battery-terms" className={styles.sectionAnchor}><GuideSection eyebrow="Read the specification with confidence" title="The battery terms that matter to your home">
      <dl className={styles.glossary}>
        <div><dt>Usable kWh: energy available to use</dt><dd>This is the storage you can draw on during normal operation. A battery labelled 10 kWh nominal may have less usable capacity. Compare the usable figure in your quote and any reserve settings.</dd></div>
        <div><dt>kW: how much it can power at once</dt><dd>Power output limits the appliances the battery can supply together. A large energy capacity does not automatically mean it can run every appliance at the same time.</dd></div>
        <div><dt>Round-trip efficiency: energy after losses</dt><dd>At an assumed 90% efficiency, 10 kWh sent into a battery delivers about 9 kWh back. Your equipment and operation determine the actual result.</dd></div>
        <div><dt>Backup reserve: energy kept aside</dt><dd>You may reserve some storage for an outage. That leaves less available for everyday bill savings. Ask what reserve the proposed saving estimate assumes.</dd></div>
        <div><dt>Cycles and throughput: how much it is used</dt><dd>A cycle describes charging and discharging. Throughput is the total energy processed over time. Check both alongside warranty years and the capacity promised at the warranty endpoint.</dd></div>
        <div><dt>VPP: shared control of batteries</dt><dd>A virtual power plant coordinates batteries across properties. A provider may offer benefits in return for some control. Check the contract, reserve, fees and electricity plan before joining.</dd></div>
      </dl>
    </GuideSection></div>

    <div id="battery-value" className={styles.sectionAnchor}><GuideSection eyebrow="Start with the energy flow" title="Three limits shape battery value"><div className="guide-principle-grid">
      <article><strong>Energy available to charge</strong><p>A solar-charged battery needs surplus generation after the home has used what it needs. A large battery can still have little energy to store in winter.</p></article>
      <article><strong>Later grid imports</strong><p>The useful saving comes from purchases replaced after charging. Storing energy you do not need later does not create an equivalent bill saving.</p></article>
      <article><strong>Losses and export value</strong><p>Account for charging losses and the export credits you give up. Compare the import rate at the time the battery discharges.</p></article>
    </div><div className={styles.formula}>Added battery bill benefit = avoided purchases from discharge - export credits given up for charging.</div><p className={styles.sectionIntro}>This solar-charging comparison does not assume VPP income or grid charging. Those require separate plan terms, controls and costs.</p><div className={styles.inlineLinks}><Link href="/case-studies#battery-value">Follow the additional-value calculation</Link><Link href="/case-studies#solar-self-use">See the solar-only starting point</Link></div></GuideSection></div>

    <div id="battery-quotes" className={styles.sectionAnchor}><GuideSection eyebrow="Make the price comparison meaningful" title="Use the price for the option you are actually buying">
      <div className="guide-two-column">
        <div><h3>Buying solar and a battery together</h3><p>Use the total combined installed quote in the solar-plus-battery field. Ask for a comparable solar-only quote to see the additional battery cost.</p></div>
        <div><h3>Adding a battery to existing solar</h3><p>Use the battery addition quote, including an inverter change, gateway, backup wiring or other required work. The old solar installation price is not a new battery cost.</p></div>
      </div><div className="guide-note"><strong>Replace the planning price with your quote</strong><p>Enter the final amount you would pay, including GST, after confirmed discounts. Prefilled figures are estimates, not supplier quotes. Do not subtract a rebate twice. Estimated payback divides that price by the relevant annual saving; it excludes finance, future tariff changes, degradation and replacement costs.</p></div>
      <h3 className={styles.checklistTitle}>Confirm the complete installed system</h3><ul className="guide-checklist"><li>Nominal and usable capacity plus continuous and peak power</li><li>Exact battery, inverter, gateway and backup hardware models</li><li>Approved equipment and an accredited, licensed battery installer</li><li>Site location, required clearances and existing solar compatibility</li><li>Backup circuits, reserve settings and outage behaviour</li><li>Warranty years, cycles, throughput, retained capacity and exclusions</li><li>Total installed price, GST and every confirmed incentive deduction</li><li>Saving assumptions, monitoring access, VPP terms and exit conditions</li></ul>
    </GuideSection></div>

    <div id="battery-backup" className={styles.sectionAnchor}><GuideSection eyebrow="Choose the benefits you need" title="Backup and outside control need clear answers"><div className="guide-two-column">
      <div><h3>Backup is not automatic</h3><p>Confirm whether the system works when the grid fails, which circuits it supports and what power it can deliver. Ask whether solar can recharge it during an outage.</p></div>
      <div><h3>Keep control choices separate</h3><p>Read VPP rules for reserve levels, battery access, credits, contract length and exit fees. VPP capability is required for eligible on-grid federal-supported systems; joining a VPP is not required.</p></div>
    </div></GuideSection></div>

    <div id="battery-support" className={styles.sectionAnchor}><GuideSection eyebrow="Federal support, checked 9 October 2026" title="How the Cheaper Home Batteries discount is structured"><div className="guide-program">
      <p>Eligible new batteries connected to new or existing rooftop solar can create small-scale technology certificates. These STCs can reduce the installed price, subject to program, product and installer rules.</p>
      <dl><div><dt>Eligible nominal capacity</dt><dd>5 to 100 kWh</dd></div><div><dt>Supported usable capacity</dt><dd>First 50 kWh</dd></div><div><dt>STC factor for May to December 2026</dt><dd>6.8 per supported kWh before size tapering</dd></div></dl>
      <p>The factor applies at 100% through 14 kWh, 60% above 14 through 28 kWh, and 15% above 28 through 50 kWh. The dollar discount depends on certificate value and assignment. Confirm the installation-date rules and deduction in the written quote.</p>
    </div><div className="guide-source-links"><a href="https://www.dcceew.gov.au/energy/programs/cheaper-home-batteries/eligibility-information" target="_blank" rel="noreferrer">Current program eligibility</a><a href="https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-batteries" target="_blank" rel="noreferrer">Clean Energy Regulator battery rules</a><a href="https://www.energy.gov.au/solar/get-know-solar-technology/batteries" target="_blank" rel="noreferrer">Australian Government battery guidance</a></div><p className={styles.reviewed}>Sources checked <time dateTime="2026-10-09">9 October 2026</time>. Eligibility and support depend on the installation; a planning estimate is not approval.</p></GuideSection></div>

    <section className="guide-callout guide-callout-primary"><div><h2>See whether storage fits your household</h2><p>Compare solar alone with added storage using your bill or meter data. Review the estimate and enquire about the option that fits.</p></div><Link href="/compare">Explore my battery options</Link></section>
  </GuideShell>;
}
