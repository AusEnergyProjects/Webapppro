/* The App Router root layout is the document-level font loading surface. */
/* eslint-disable @next/next/no-page-custom-font */
import type { Metadata } from "next";
import { FastNavigation } from "@/components/FastNavigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "Direct Trade Services | Australian Energy Assessments",
  description: "Independent energy comparison and a direct-to-trade service connecting households, licensed installers and reputable energy-product wholesalers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap" /></head><body><FastNavigation />{children}</body></html>;
}
