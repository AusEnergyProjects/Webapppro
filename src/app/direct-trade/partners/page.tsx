import type { Metadata } from "next";
import { DirectTradePartnerForm } from "@/components/DirectTradePartnerForm";

export const metadata: Metadata = {
  title: "Trade and supplier participation | Australian Energy Assessments",
  description: "Express interest in Direct Trade Services as a licensed installer or reputable energy-product supplier.",
};

export default function DirectTradePartnersPage() {
  return <DirectTradePartnerForm />;
}
