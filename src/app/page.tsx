import type { Metadata } from "next";
import { GettingStarted } from "@/components/GettingStarted";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return <GettingStarted />;
}
