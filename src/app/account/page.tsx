import type { Metadata } from "next";
import { CustomerDashboard } from "@/components/CustomerDashboard";

export const metadata: Metadata = {
  title: "My Home Energy Account | Australian Energy Assessments",
  description: "Create free private home projects, save guided electrification roadmaps and review anonymised installer responses.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function CustomerAccountPage() {
  return <CustomerDashboard />;
}
