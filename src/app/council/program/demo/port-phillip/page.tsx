import type { Metadata } from "next";
import { CouncilProgramEntry } from "@/components/CouncilEntry";
import { PORT_PHILLIP_DEMO_BRANDING } from "@/lib/council-public-branding";

export const metadata: Metadata = { title: { absolute: "City of Port Phillip customer journey | TLink demonstration" }, robots: { index: false, follow: false } };

export default function CouncilPublicJourneyDemo() {
  return <CouncilProgramEntry demonstration campaign={{
    code: "demonstration", title: "Better energy for your home or business.", kind: "campaign", audience: "everyone",
    startsAt: null, location: null, meetingUrl: null, ...PORT_PHILLIP_DEMO_BRANDING,
    primaryColor: PORT_PHILLIP_DEMO_BRANDING.theme.primaryColor, accentColor: PORT_PHILLIP_DEMO_BRANDING.theme.accentColor,
    state: "VIC", postcodes: ["3004", "3006", "3181", "3182", "3183", "3184", "3185", "3205", "3206", "3207"],
  }} />;
}
