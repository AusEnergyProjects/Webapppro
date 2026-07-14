import type { Metadata } from "next";
import { AdminOperationsPortal } from "@/components/AdminOperationsPortal";

export const metadata: Metadata = {
  title: "Operations control centre | Australian Energy Assessments",
  description: "Restricted Australian Energy Assessments operations workspace.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function OperationsControlCentrePage() {
  return <AdminOperationsPortal />;
}
