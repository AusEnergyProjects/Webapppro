import { createCouncilDemoState } from "./council-demo-state.ts";
import { loadCouncilDemo } from "./council-demo.ts";
import { communityReport } from "./council-community.ts";
import { bundledCommunitySnapshot } from "./council-community-server.ts";
import { councilVeuReport } from "./council-veu.ts";
import { councilVeuBaseline } from "./council-veu-server.ts";
import type { CouncilMonthlyReportBundle } from "./council-monthly-report.ts";

/** A fixed public demonstration. It never reads live council, customer or subscription records. */
export async function councilMonthlyDemoBundle(now = new Date()): Promise<CouncilMonthlyReportBundle> {
  const profile = createCouncilDemoState(now).profile;
  const communitySnapshot = await bundledCommunitySnapshot();
  const tlink = loadCouncilDemo("year", now, profile);
  const scope = { councilId: profile.councilId, name: profile.name, state: profile.state, postcodes: profile.postcodes };
  const baselines = await councilVeuBaseline();
  const snapshot = baselines.filter(item => item.period.key === "year" && profile.postcodes.every(code => item.postcodes.includes(code))).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0];
  return {
    profile, generatedAt: now.toISOString(), demonstration: true, tlink,
    community: communityReport(communitySnapshot, scope, "year", { checkedAt: communitySnapshot.fetchedAt, refreshFailed: false, dataOrigin: "baseline" }, now.getTime()),
    veu: snapshot ? councilVeuReport(snapshot, scope, { checkedAt: snapshot.fetchedAt, refreshFailed: false, dataOrigin: "baseline" }, now.getTime()) : null,
  };
}
