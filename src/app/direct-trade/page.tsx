import type { Metadata } from "next";
import { DirectTradeProjectBrief } from "@/components/DirectTradeProjectBrief";

export const metadata: Metadata = {
  title: "Direct Trade Project Brief | Australian Energy Assessments",
  description: "Create a privacy-safe household energy-upgrade brief for review by Australian Energy Assessments and suitable licensed trades.",
};

export default function DirectTradePage() {
  return <DirectTradeProjectBrief />;
}
