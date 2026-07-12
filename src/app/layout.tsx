import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Electricity Plan Comparator | Australian Energy Assessments",
  description: "Independent energy plan comparisons and home-upgrade advice.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
