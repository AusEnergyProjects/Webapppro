import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { WholesaleElectricity } from "@/components/WholesaleElectricity";
import styles from "@/components/WholesaleElectricity.module.css";
import { buildPlatformMetadata } from "@/lib/public-site";
import { NEM_SOURCE_URL } from "@/lib/nem-wholesale";

const heatingExampleHeading = { color: "#e4f8fc", fontSize: "1rem", margin: "0 0 8px" } as const;

export const metadata = buildPlatformMetadata({
  path: "/wholesale-electricity",
  title: "Live Wholesale Energy Prices | Australian Energy Assessments",
  description: "Compare live wholesale electricity and gas energy prices in c/kWh, explore 24-hour regional charts and understand why household heating costs differ.",
});

export default function WholesaleElectricityPage() {
  return <main className="wrap">
    <SiteHeader active="wholesale" />
    <header className={styles.intro}><h1>What is energy worth right now?</h1><p>Compare wholesale electricity with the closest available wholesale gas market on the same c/kWh scale. <strong>These are energy market prices, not the rates on your household bills.</strong> Choose a region to explore the last 24 hours.</p></header>
    <WholesaleElectricity />
    <section className={styles.flows} style={{ marginTop: 28 }} aria-labelledby="heating-comparison-title">
      <h2 id="heating-comparison-title">A fair heating comparison</h2>
      <p>The two lines compare the wholesale price of energy. They do not show the final cost of heating a room, because different heaters turn energy into useful heat very differently.</p>
      <div className={styles.explainers} style={{ margin: "17px 0" }}>
        <div><h3 style={heatingExampleHeading}>Direct electric heater</h3><p>About 1 kWh of room heat from 1 kWh of electricity.</p></div>
        <div><h3 style={heatingExampleHeading}>Reverse-cycle heat pump</h3><p>About 3 to 6 kWh of room heat from 1 kWh of electricity.</p></div>
        <div><h3 style={heatingExampleHeading}>Example 85% gas heater</h3><p>About 0.85 kWh of room heat from 1 kWh of gas, before any duct losses.</p></div>
      </div>
      <p>For example, producing 4 kWh of room heat may take about 4 kWh with direct electric heating, 0.7 to 1.3 kWh with reverse-cycle heating, or 4.7 kWh of gas with an 85% efficient gas heater. Actual results depend on the appliance, weather, installation, ducts and the home. Retail rates, network charges, daily supply charges and rooftop solar are not included. <small className={styles.dataCredit}><a href="https://www.energy.gov.au/households/heating-and-cooling" target="_blank" rel="noopener noreferrer">Learn about heating efficiency</a></small>.</p>
    </section>
    <section className={styles.explainers} aria-label="Understanding wholesale energy prices">
      <div><h2>Why is my bill different?</h2><p>Household plans also cover networks, retail costs and other charges. They do not normally follow these wholesale prices directly. You can <Link href="/compare">compare electricity plans</Link> or <Link href="/gas-compare">compare gas plans</Link> using the rates that actually reach your bill.</p></div>
      <div><h2>Can the price go below zero?</h2><p>Electricity can. Sometimes there is more generation available than the market needs and the wholesale price becomes negative. That does not automatically mean free power, or a credit, on your household plan.</p></div>
      <div><h2>Which gas price is shown?</h2><p>NSW and the ACT use the Sydney gas hub as a nearby reference. Queensland uses Brisbane, South Australia uses Adelaide and Victoria has its own wholesale gas market. Tasmania has no equivalent gas price in this feed. Western Australia and the Northern Territory are outside the NEM and are not shown.</p></div>
    </section>
    <SiteFooter><small className={styles.dataCredit}>Market data: <a href={NEM_SOURCE_URL} target="_blank" rel="noopener noreferrer">AEMO</a>.</small></SiteFooter>
  </main>;
}
