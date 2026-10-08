import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SECCCA_JOURNEY_DEMO_PATH } from "@/lib/council-public-branding";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function CouncilPublicJourneyDemoRedirect() {
  redirect(SECCCA_JOURNEY_DEMO_PATH);
}
