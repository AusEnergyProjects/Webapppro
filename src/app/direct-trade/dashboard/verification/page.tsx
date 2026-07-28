import type { Metadata } from "next";
import { DirectTradeVerificationCentre } from "@/components/DirectTradeVerificationCentre";

export const metadata: Metadata = {
  title: "TLink verification centre",
  description: "Review the role-specific business, ABN, licence, insurance, product and warranty evidence pathway for TLink access.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function DirectTradeVerificationPage() {
  return <DirectTradeVerificationCentre />;
}
