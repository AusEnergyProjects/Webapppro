import type { Metadata } from "next";
import { TradeTeamPortal } from "@/components/TradeTeamPortal";

export const metadata: Metadata = {
  title: "Installer team portal | Australian Energy Assessments",
  description: "Secure assigned work, job checklists and field records for installer teams.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function TradeTeamPage() {
  return <TradeTeamPortal />;
}
