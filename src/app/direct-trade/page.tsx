import type { Metadata } from "next";
import { DirectTradeProjectBrief } from "@/components/DirectTradeProjectBrief";

export const metadata: Metadata = {
  title: "Direct Trade Project Brief | Australian Energy Assessments",
  description: "Create a privacy-safe household energy-upgrade brief for every active verified trade whose service area and capability match the work.",
};

export default function DirectTradePage() {
  return <DirectTradeProjectBrief />;
}
