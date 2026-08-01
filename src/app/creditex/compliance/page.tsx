import type { Metadata } from "next";
import { CreditexCompliancePortal } from "@/components/CreditexCompliancePortal";

export const metadata: Metadata = {
  title: "Creditex compliance workspace | TLink",
  description: "Restricted Creditex compliance case and activity governance workspace.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
  },
};

export default function CreditexCompliancePage() {
  return <CreditexCompliancePortal />;
}
