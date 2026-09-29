import type { Metadata } from "next";
import { TLinkPasswordReset } from "@/components/TLinkPasswordReset";

export const metadata: Metadata = {
  title: "Reset your TLink password",
  description: "Choose a new password for your TLink account.",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
  referrer: "no-referrer",
};

export default function TLinkPasswordResetPage() {
  return <TLinkPasswordReset />;
}
