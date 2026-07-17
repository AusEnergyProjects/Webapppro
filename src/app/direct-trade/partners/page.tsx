import type { Metadata } from "next";
import { DirectTradePartnerForm } from "@/components/DirectTradePartnerForm";

export const metadata: Metadata = {
  title: "Create a TLink trade account",
  description: "Create a TLink business profile, set service areas and prepare for free verified access to the trade operating platform.",
};

export default function DirectTradePartnersPage() {
  return <DirectTradePartnerForm />;
}
