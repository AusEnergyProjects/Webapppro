import type { Metadata } from "next";
import { DirectTradeDashboard } from "@/components/DirectTradeDashboard";
import { TLINK_COLOUR_MODE_STORAGE_KEY } from "@/lib/tlink-colour-mode";

export const metadata: Metadata = {
  title: "TLink trade dashboard",
  description: "Manage a TLink business profile, verification readiness, customers, jobs, products, orders and suitable project opportunities.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function DirectTradeDashboardPage() {
  const colourModeBootstrap = `try{var mode=window.localStorage.getItem(${JSON.stringify(TLINK_COLOUR_MODE_STORAGE_KEY)});document.documentElement.dataset.tlinkColourMode=mode==="night"?"night":"day"}catch{document.documentElement.dataset.tlinkColourMode="day"}`;

  return (
    <>
      <script
        id="tlink-colour-mode-bootstrap"
        dangerouslySetInnerHTML={{ __html: colourModeBootstrap }}
      />
      <DirectTradeDashboard />
    </>
  );
}
