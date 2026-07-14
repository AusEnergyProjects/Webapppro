import type { Metadata } from "next";
import { CustomerDashboard } from "@/components/CustomerDashboard";

export const metadata: Metadata = {
  title: "Household Privacy and Profile | Australian Energy Assessments",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function CustomerProfilePage() {
  return <CustomerDashboard initialView="profile" />;
}
