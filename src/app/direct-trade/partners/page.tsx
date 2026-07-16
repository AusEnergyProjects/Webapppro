import type { Metadata } from "next";
import { DirectTradePartnerForm } from "@/components/DirectTradePartnerForm";

export const metadata: Metadata = {
  title: "Create a TLink trade account",
  description: "Create a TLink business profile, set service areas and prepare for subscription access without per-lead fees.",
};

export default function DirectTradePartnersPage() {
  return <DirectTradePartnerForm />;
}
