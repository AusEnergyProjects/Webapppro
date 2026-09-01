import { DirectTradePartnerForm } from "@/components/DirectTradePartnerForm";
import { buildPlatformMetadata } from "@/lib/public-site";

export const metadata = buildPlatformMetadata({
  path: "/direct-trade/partners",
  title: "Create a TLink trade account",
  description: "Create a TLink business profile, set service areas and prepare for free verified access to the trade operating platform.",
});

export default function DirectTradePartnersPage() {
  return <DirectTradePartnerForm />;
}
