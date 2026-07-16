/* The App Router root layout is the document-level font loading surface. */
/* eslint-disable @next/next/no-page-custom-font */
import type { Metadata, Viewport } from "next";
import { SiteDatePicker } from "@/components/SiteDatePicker";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://aea-energy-comparison.info294029.chatgpt.site"),
  applicationName: "Australian Energy Assessments",
  title: "Home Energy Planning | Australian Energy Assessments",
  description: "Build a private home energy roadmap, compare electricity and gas plans, understand upgrades, check support and prepare a clear scope for licensed trades.",
  openGraph: {
    title: "One Clear Home Energy Plan",
    description: "Build a private roadmap, compare electricity and gas, understand upgrades and prepare a clear project scope.",
    type: "website",
    siteName: "Australian Energy Assessments",
    images: [{ url: "/aea-home-energy-plan-og.png", width: 1736, height: 907, alt: "One clear home energy plan with coordinated solar, battery, efficient appliances and EV charging" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "One Clear Home Energy Plan",
    description: "Build a private roadmap, compare electricity and gas, understand upgrades and prepare a clear project scope.",
    images: ["/aea-home-energy-plan-og.png"],
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
  return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap" /></head><body><a className="skip-link" href="#site-content">Skip to main content</a>{children}<SiteDatePicker /></body></html>;
}
