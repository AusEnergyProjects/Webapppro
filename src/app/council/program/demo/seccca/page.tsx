import type { Metadata } from "next";
import { CouncilProgramEntry } from "@/components/CouncilEntry";
import { SECCCA_DEMO_BRANDING, SECCCA_DEMO_POSTCODES } from "@/lib/council-public-branding";

export const metadata: Metadata = { title: { absolute: "SECCCA customer journey | TLink demonstration" }, robots: { index: false, follow: false } };

export default function CouncilPublicJourneyDemo() {
  return <CouncilProgramEntry demonstration campaign={{
    code: "demonstration", title: "Better energy for your home or business.", kind: "campaign", audience: "everyone",
    startsAt: null, location: null, meetingUrl: null, ...SECCCA_DEMO_BRANDING,
    primaryColor: SECCCA_DEMO_BRANDING.theme.primaryColor, accentColor: SECCCA_DEMO_BRANDING.theme.accentColor,
    state: "VIC", postcodes: [...SECCCA_DEMO_POSTCODES],
  }} />;
}
