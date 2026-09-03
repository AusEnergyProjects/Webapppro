import type { Metadata } from "next";
import { ProtectedWorkspaceStyles } from "@/components/ProtectedWorkspaceStyles";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
  },
};

export default function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><ProtectedWorkspaceStyles />{children}</>;
}
