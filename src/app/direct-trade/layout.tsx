import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/tlink-icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/tlink-icon-192.png", type: "image/png", sizes: "192x192" }],
  },
};

export default function DirectTradeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
