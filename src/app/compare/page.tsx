import { BrandBar, ComparatorHero, SiteNav } from "@/components/ComparatorChrome";
import { NativeElectricityComparator } from "@/components/electricity/NativeElectricityComparator";

export const metadata = {
  title: "Electricity Plan Comparison | Australian Energy Assessments",
  description: "Compare published electricity plans using your location, household load pattern and optional locally processed NEM12 interval data.",
};

export default function ElectricityComparisonPage() {
  return <main className="wrap">
    <BrandBar />
    <SiteNav active="electricity" />
    <ComparatorHero title="Electricity plan comparison"><p>Compare published plans using your location and actual half-hour load pattern when you provide NEM12 meter data.</p><div className="fresh"><span className="dot" /> Independent, evidence-backed comparison</div></ComparatorHero>
    <NativeElectricityComparator />
    <footer><p>Estimates are indicative. Confirm current prices, eligibility and conditions with the retailer before switching.</p></footer>
  </main>;
}
