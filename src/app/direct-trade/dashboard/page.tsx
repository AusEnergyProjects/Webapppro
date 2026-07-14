import type { Metadata } from "next";
import { DirectTradeDashboard } from "@/components/DirectTradeDashboard";

export const metadata: Metadata = {
  title: "Direct Trade dashboard | Australian Energy Assessments",
  description: "Review a Direct Trade business profile, verification readiness, membership options and suitable project opportunities.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function DirectTradeDashboardPage() {
  return <DirectTradeDashboard />;
}
