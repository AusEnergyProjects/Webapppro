import type { Metadata } from "next";
import { DirectTradeDashboard } from "@/components/DirectTradeDashboard";

export const metadata: Metadata = {
  title: "TLink trade dashboard",
  description: "Manage a TLink business profile, verification readiness, customers, jobs, products, orders and suitable project opportunities.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function DirectTradeDashboardPage() {
  return <DirectTradeDashboard />;
}
