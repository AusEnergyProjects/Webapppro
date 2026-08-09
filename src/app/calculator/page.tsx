import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PublicRebateCalculatorWorkspace } from "@/components/PublicRebateCalculatorWorkspace";

export const metadata: Metadata = {
  title: "Rebate Calculator | Australian Energy Assessments",
  description:
    "Calculate a fast Australian energy-upgrade rebate estimate using official program and approved-product data.",
};

export default function PublicRebateCalculatorPage() {
  return (
    <main className="wrap public-calculator-page">
      <SiteHeader active="calculator" />
      <PublicRebateCalculatorWorkspace />
      <SiteFooter>
        Estimates use the selected installation date and available official
        scheme data. Your installer confirms the final work and discount.
      </SiteFooter>
    </main>
  );
}
