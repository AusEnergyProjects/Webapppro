import { DirectTradeProjectBrief } from "@/components/DirectTradeProjectBrief";
import { buildPlatformMetadata } from "@/lib/public-site";

export const metadata = buildPlatformMetadata({
  path: "/direct-trade",
  title: "Direct Trade Project Brief | Australian Energy Assessments",
  description: "Create a privacy-safe household energy-upgrade brief for every active verified trade whose service area and capability match the work.",
});

export default function DirectTradePage() {
  return <DirectTradeProjectBrief />;
}
