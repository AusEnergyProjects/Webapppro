import type { Metadata } from "next";
import { CustomerDashboard } from "@/components/CustomerDashboard";

export const metadata: Metadata = {
  title: "My Home Asset Passport | Australian Energy Assessments",
  description: "Access approved home products, protected handover documents, lifecycle records and private ownership transfers.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function CustomerAssetsPage() {
  return <CustomerDashboard initialView="assets" />;
}
