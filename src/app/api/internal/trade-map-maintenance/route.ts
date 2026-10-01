import { handleTradeMapMaintenance } from "@/lib/trade-map-maintenance";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleTradeMapMaintenance(request, { secret: process.env.AEA_LEAD_WEBHOOK_TEST_TOKEN });
}
