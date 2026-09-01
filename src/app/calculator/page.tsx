import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PublicRebateCalculatorWorkspace } from "@/components/PublicRebateCalculatorWorkspace";
import { buildPlatformMetadata } from "@/lib/public-site";

export const metadata = buildPlatformMetadata({
  path: "/calculator",
  title: "Rebate Calculator | Australian Energy Assessments",
  description:
    "Calculate Australian energy-upgrade rebate results using official program and approved-product data, with exact provenance for governed programs.",
});

export default function PublicRebateCalculatorPage() {
  return (
    <main className="wrap public-calculator-page">
      <SiteHeader active="calculator" />
      <PublicRebateCalculatorWorkspace />
      <SiteFooter>
        Governed results are exact for the selected inputs and dated source and
        product snapshots. Eligibility, certificate creation and provider
        acceptance remain separate workflows.
      </SiteFooter>
    </main>
  );
}
