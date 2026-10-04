import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "TLink | Council workspace" },
  description: "Local upgrade outcomes, local business participation and council campaign reporting.",
  applicationName: "TLink",
  icons: {
    icon: [{ url: "/tlink-icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/tlink-icon-192.png", type: "image/png", sizes: "192x192" }],
  },
  openGraph: { title: "TLink | Council workspace", siteName: "TLink", description: "Local outcomes, local businesses and council programs in one workspace." },
  twitter: { title: "TLink | Council workspace", description: "Local outcomes, local businesses and council programs in one workspace." },
  robots: { index: false, follow: false },
};
export default function CouncilLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
