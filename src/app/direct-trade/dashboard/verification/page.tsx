import type { Metadata } from "next";
import { DirectTradeVerificationCentre } from "@/components/DirectTradeVerificationCentre";

export const metadata: Metadata = {
  title: "Direct Trade verification centre | Australian Energy Assessments",
  description: "Review the role-specific business, licence, insurance, product and warranty evidence pathway for Direct Trade membership.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function DirectTradeVerificationPage() {
  return <DirectTradeVerificationCentre />;
}
