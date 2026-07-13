import { ComparatorHero, SiteHeader } from "@/components/ComparatorChrome";
import { GasComparator } from "@/components/GasComparator";

export const metadata = {
  title: "Compare Gas Plans | Australian Energy Assessments",
  description: "Compare current gas plans using your annual gas use.",
};

export default function GasComparisonPage() {
  return (
    <main className="wrap">
      <SiteHeader active="gas" />
      <ComparatorHero title="Gas Plan Comparator">
        <p>Compare current gas offers using your location, annual MJ and seasonal household pattern.</p>
        <div className="fresh"><span className="dot" /> Current CDR gas plan records, retrieved for each comparison</div>
      </ComparatorHero>
      <GasComparator />
      <footer>
        <p>Estimates are indicative only, are not financial advice and use the tariff data retailers publish under the Consumer Data Right. Always confirm rates, eligibility and conditions with the retailer before switching.</p>
        <p>Provided by <a href="https://www.ausenergyassessments.com/" target="_blank" rel="noreferrer">Australian Energy Assessments</a> | Independent energy assessments | 1300 241 149</p>
      </footer>
    </main>
  );
}
