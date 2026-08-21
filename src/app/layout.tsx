import type { Metadata, Viewport } from "next";
import { LazyEnergyAssistantWidget } from "@/components/LazyEnergyAssistantWidget";
import { SiteDatePicker } from "@/components/SiteDatePicker";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://compare.ausenergyassessments.com"),
  applicationName: "Australian Energy Assessments",
  title: "Home Energy Planning | Australian Energy Assessments",
  description: "Build a private home energy roadmap, compare electricity and gas plans, understand upgrades, check support and prepare a clear scope for licensed trades.",
  openGraph: {
    title: "One Clear Home Energy Plan",
    description: "Build a private roadmap, compare electricity and gas, understand upgrades and prepare a clear project scope.",
    type: "website",
    siteName: "Australian Energy Assessments",
    images: [{ url: "/aea-home-energy-plan-og-v2.png", width: 1731, height: 909, alt: "An immersive home energy plan connecting solar, battery, efficient hot water, heating, cooling and EV charging" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "One Clear Home Energy Plan",
    description: "Build a private roadmap, compare electricity and gas, understand upgrades and prepare a clear project scope.",
    images: ["/aea-home-energy-plan-og-v2.png"],
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/tlink-icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/tlink-icon-192.png", type: "image/png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#03192d",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className="aea-platform"><a className="skip-link" href="#site-content">Skip to main content</a>{children}<SiteDatePicker /><LazyEnergyAssistantWidget /></body></html>;
}
