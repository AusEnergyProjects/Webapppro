import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Direct Trade Services | Australian Energy Assessments",
  description: "Independent energy comparison and a developing direct-to-trade path connecting households with verified licensed installers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
