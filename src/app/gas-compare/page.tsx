import { ComparatorHero, SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { GasComparator } from "@/components/GasComparator";

export const metadata = {
  title: "Compare Gas Plans | Australian Energy Assessments",
  description: "Compare current gas plans using your annual gas use.",
};

export default function GasComparisonPage() {
  return (
    <main className="wrap gas-comparison-page">
      <SiteHeader active="gas" />
      <ComparatorHero title="Compare gas plans">
        <p>Start with your postcode and gas use. We will guide you to comparable current offers and explain what to check before switching.</p>
        <div className="fresh"><span className="dot" /> Current published gas plan records</div>
      </ComparatorHero>
      <GasComparator />
      <SiteFooter>Estimates are indicative only, are not financial advice and use the tariff data retailers publish under the Consumer Data Right. Always confirm rates, eligibility and conditions with the retailer before switching.</SiteFooter>
    </main>
  );
}
