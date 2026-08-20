import { NextResponse } from "next/server";
import { energyAssistantKnowledgeHealth } from "@/lib/energy-assistant";

export const dynamic = "force-dynamic";

export function GET() {
  const checkedAt = new Date();
  const energyAssistantKnowledge = energyAssistantKnowledgeHealth(checkedAt);
  return NextResponse.json(
    {
      ok: energyAssistantKnowledge.ready,
      service: "aea-energy",
      checkedAt: checkedAt.toISOString(),
      energyAssistantKnowledge,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
