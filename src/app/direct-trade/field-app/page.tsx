import type { Metadata } from "next";

import { FieldAppDownload } from "@/components/FieldAppDownload";

export const metadata: Metadata = {
  title: "TLink app",
  description: "Install and update the TLink field app for technicians, trades and assessors.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    noimageindex: true,
    nosnippet: true,
  },
};

export default function FieldAppPage() {
  return <main className="tlink-install-page">
    <header className="tlink-install-header"><span className="tlink-install-logo" aria-hidden="true" /><div><h1>Get TLink</h1><p>Your team and your work, together.</p></div></header>
    <FieldAppDownload />
    <p className="tlink-install-footer">Your business and saved permissions stay the same on every device.</p>
  </main>;
}
