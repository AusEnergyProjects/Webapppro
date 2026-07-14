import type { Metadata } from "next";
import { DirectTradePartnerForm } from "@/components/DirectTradePartnerForm";

export const metadata: Metadata = {
  title: "Create a trade account | Australian Energy Assessments",
  description: "Create a free Direct Trade account, set your service areas and try the network with one included lead.",
};

export default function DirectTradePartnersPage() {
  return <DirectTradePartnerForm />;
}
