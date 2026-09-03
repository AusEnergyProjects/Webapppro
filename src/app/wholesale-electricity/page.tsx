import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { WholesaleElectricity } from "@/components/WholesaleElectricity";
import styles from "@/components/WholesaleElectricity.module.css";
import { buildPlatformMetadata } from "@/lib/public-site";
import { NEM_SOURCE_URL } from "@/lib/nem-wholesale";

export const metadata = buildPlatformMetadata({
  path: "/wholesale-electricity",
  title: "Live Wholesale Electricity Prices | Australian Energy Assessments",
  description: "Explore five-minute wholesale electricity prices, 24-hour regional charts and power flows. Understand how wholesale prices differ from your electricity bill.",
});

export default function WholesaleElectricityPage() {
  return <main className="wrap">
    <SiteHeader active="wholesale" />
    <header className={styles.intro}><h1>What is electricity worth right now?</h1><p>See the wholesale spot price across the National Electricity Market. <strong>This is the market price, not the rate on your household bill.</strong> Choose your region to explore the last 24 hours.</p></header>
    <WholesaleElectricity />
    <section className={styles.explainers} aria-label="Understanding wholesale electricity">
      <div><h2>Why is my bill different?</h2><p>Your electricity plan also covers network charges, retail costs and other charges. Most household plans do not follow these five-minute prices directly. <Link href="/compare">Compare your electricity plan</Link> to see the rates available to you.</p></div>
      <div><h2>Can the price go below zero?</h2><p>Yes. Sometimes there is more generation available than the market needs and the wholesale price becomes negative. That does not automatically mean free power, or a credit, on your household plan.</p></div>
      <div><h2>Which areas are included?</h2><p>NSW and the ACT share a price region. Queensland, Victoria, South Australia and Tasmania each have their own. Western Australia and the Northern Territory are outside the NEM and are not shown in this feed.</p></div>
    </section>
    <SiteFooter><small className={styles.dataCredit}>Market data: <a href={NEM_SOURCE_URL} target="_blank" rel="noopener noreferrer">AEMO</a>.</small></SiteFooter>
  </main>;
}
