import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Australian Energy Assessments | Independent Energy Comparison",
  description: "Independent electricity and mains gas plan comparisons with visible evidence and assumptions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
