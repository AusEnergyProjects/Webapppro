import type { Metadata, Viewport } from "next";
import { AnalyticsConsent } from "@/components/AnalyticsConsent";
import { JsonLd } from "@/components/JsonLd";
import { LazyEnergyAssistantWidget } from "@/components/LazyEnergyAssistantWidget";
import { SiteDatePicker } from "@/components/SiteDatePicker";
import { PUBLIC_SITE, publicOrganizationSchema } from "@/lib/public-site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_SITE.apexUrl),
  applicationName: "Australian Energy Assessments",
  title: "Home Energy Assessments & NatHERS | Australian Energy Assessments",
  description: "Independent home energy assessments, NatHERS and Home Energy Rating guidance, energy planning, rebates and comparison tools for Australian homes.",
  creator: "Australian Energy Assessments",
  publisher: "Australian Energy Assessments",
  category: "Home energy assessment",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "Home Energy Assessments and Planning",
    description: "Independent assessment guidance and practical tools for more comfortable, efficient Australian homes.",
    type: "website",
    url: "/",
    locale: "en_AU",
    siteName: "Australian Energy Assessments",
    images: [{ url: "/aea-home-energy-plan-og-v2.png", width: 1731, height: 909, alt: "An immersive home energy plan connecting solar, battery, efficient hot water, heating, cooling and EV charging" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Home Energy Assessments and Planning",
    description: "Independent assessment guidance and practical tools for more comfortable, efficient Australian homes.",
    images: ["/aea-home-energy-plan-og-v2.png"],
  },
  icons: {
    icon: [{ url: PUBLIC_SITE.logo, type: "image/svg+xml", sizes: "any" }],
  },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#03192d",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body className="aea-platform">
        <JsonLd data={publicOrganizationSchema} />
        <a className="skip-link" href="#site-content">Skip to main content</a>
        {children}
        <SiteDatePicker />
        <LazyEnergyAssistantWidget />
        <AnalyticsConsent />
      </body>
    </html>
  );
}
