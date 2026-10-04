import { getD1 } from "../../../../../db";
import { loadPublicCouncilCampaign } from "@/lib/council-campaign-server";
import { CouncilProgramEntry } from "@/components/CouncilEntry";

export const dynamic = "force-dynamic";
export default async function CouncilProgramPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let campaign: Awaited<ReturnType<typeof loadPublicCouncilCampaign>> = null;
  let unavailable = false;
  try {
    campaign = await loadPublicCouncilCampaign(getD1(), code);
  } catch {
    unavailable = true;
  }
  return <CouncilProgramEntry campaign={campaign ? { ...campaign, postcodes: JSON.parse(campaign.postcodes) } : null} unavailable={unavailable} />;
}
