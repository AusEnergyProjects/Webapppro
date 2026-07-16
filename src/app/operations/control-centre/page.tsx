import type { Metadata } from "next";
import { AdminOperationsPortal } from "@/components/AdminOperationsPortal";

export const metadata: Metadata = {
  title: "TLink operations control centre",
  description: "Restricted TLink platform operations workspace.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function OperationsControlCentrePage() {
  return <AdminOperationsPortal />;
}
