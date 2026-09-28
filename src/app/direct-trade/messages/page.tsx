import type { Metadata } from "next";
import TradeCommunicationPage from "@/components/TradeCommunicationPage";

export const metadata: Metadata = {
  title: "TLink team messages",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
  referrer: "no-referrer",
};
export default function TeamMessagesPage() { return <TradeCommunicationPage />; }
