import { ComparatorHero, SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { NativeElectricityComparator } from "@/components/electricity/NativeElectricityComparator";
import { buildPlatformMetadata } from "@/lib/public-site";

export const metadata = buildPlatformMetadata({
  path: "/compare",
  title: "Electricity Plan Comparison | Australian Energy Assessments",
  description: "Compare published electricity plans using your location, household load pattern and optional locally processed NEM12 interval data.",
});

export default function ElectricityComparisonPage() {
  return <main className="wrap electricity-comparison-page">
    <SiteHeader active="electricity" />
    <ComparatorHero title="Compare electricity plans"><p>Start with the property, add the best usage information you have, then review plans ranked on the same household assumptions.</p><div className="fresh"><span className="dot" /> Private, independent and evidence-backed</div></ComparatorHero>
    <NativeElectricityComparator />
    <SiteFooter>Estimates are indicative. Confirm current prices, eligibility and conditions with the retailer before switching.</SiteFooter>
  </main>;
}
