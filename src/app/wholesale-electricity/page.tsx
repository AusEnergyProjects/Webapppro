import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { WholesaleElectricity } from "@/components/WholesaleElectricity";
import styles from "@/components/WholesaleElectricity.module.css";
import { buildPlatformMetadata } from "@/lib/public-site";
import { NEM_SOURCE_URL } from "@/lib/nem-wholesale";

export const metadata = buildPlatformMetadata({
  path: "/wholesale-electricity",
  title: "Live Wholesale Energy Prices | Australian Energy Assessments",
  description: "Compare wholesale electricity and gas prices in c/kWh, then explore illustrative room-heating and hot-water examples using 24-hour average wholesale prices.",
});

export default function WholesaleElectricityPage() {
  return <main className="wrap">
    <SiteHeader active="wholesale" />
    <header className={styles.intro}><h1>What is energy worth right now?</h1><p>Compare wholesale electricity with the closest available wholesale gas market on the same c/kWh scale. <strong>These are energy market prices, not the rates on your household bills.</strong> Choose a region to explore the last 24 hours.</p></header>
    <WholesaleElectricity />
    <section className={styles.explainers} aria-label="Understanding wholesale energy prices">
      <div><h2>Why is my bill different?</h2><p>Household plans also cover networks, retail costs and other charges. They do not normally follow these wholesale prices directly. You can <Link href="/compare">compare electricity plans</Link> or <Link href="/gas-compare">compare gas plans</Link> using the rates that actually reach your bill.</p></div>
      <div><h2>Can the price go below zero?</h2><p>Electricity can. Sometimes there is more generation available than the market needs and the wholesale price becomes negative. That does not automatically mean free power, or a credit, on your household plan.</p></div>
      <div><h2>Which gas price is shown?</h2><p>NSW and the ACT use the Sydney gas hub as a nearby reference. Queensland uses Brisbane, South Australia uses Adelaide and Victoria has its own wholesale gas market. Tasmania has no equivalent gas price in this feed. Western Australia and the Northern Territory are outside the NEM and are not shown.</p></div>
    </section>
    <SiteFooter><small style={{ color: "#adc6d2", fontSize: ".7rem" }}>Market data: <a href={NEM_SOURCE_URL} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 3 }}>AEMO</a>.</small></SiteFooter>
  </main>;
}
