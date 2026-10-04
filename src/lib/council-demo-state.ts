import { parseCouncilCampaignInput, type CouncilCampaign } from "./council-campaigns.ts";
import { COUNCIL_DEFAULT_THEME, parseCouncilProfileInput, type CouncilProfile } from "./council-profile.ts";
import { loadCouncilDemo } from "./council-demo.ts";
import type { CouncilPeriodKey, CouncilReport } from "./council-reporting.ts";

export const COUNCIL_DEMO_STORAGE_KEY = "tlink.council.demonstration.v1";
export type CouncilDemoState = { version: 1; profile: CouncilProfile; campaigns: CouncilCampaign[]; period: CouncilPeriodKey };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

export function createCouncilDemoState(now = new Date()): CouncilDemoState {
  const report = loadCouncilDemo("year",now);
  return {
    version: 1, period: "year",
    profile: { councilId: "demonstration", name: report.scope.name, state: "VIC", postcodes: report.scope.postcodes, logoDataUrl: null, theme: {...COUNCIL_DEFAULT_THEME}, updatedAt: now.toISOString() },
    campaigns: report.campaigns.map((row,index) => ({ id: row.id, councilId: "demonstration", code: row.referenceCode, title: row.name,
      kind: index === 2 ? "session" : "campaign", audience: index === 1 ? "businesses" : "everyone", status: "active",
      startsAt: index === 2 ? "2026-10-08T07:00:00.000Z" : null, location: index === 2 ? "Demonstration community centre" : null,
      meetingUrl: null, opens: 0, createdAt: report.generatedAt, updatedAt: report.generatedAt, shareUrl: `/council/demo?campaign=${encodeURIComponent(row.id)}` })),
  };
}

/** Only local practice state is restored. Never store tokens, live council data or customer records. */
export function readCouncilDemoState(raw: string | null): CouncilDemoState | null {
  if (!raw || raw.length > 750_000) return null;
  try {
    const saved = record(JSON.parse(raw));
    const savedProfile = record(saved?.profile);
    if (!saved || saved.version !== 1 || !savedProfile || savedProfile.councilId !== "demonstration" || savedProfile.state !== "VIC"
      || (saved.period !== "quarter" && saved.period !== "year" && saved.period !== "all") || !Array.isArray(saved.campaigns) || saved.campaigns.length > 100) return null;
    const profile = parseCouncilProfileInput({ name: savedProfile.name, postcodes: savedProfile.postcodes, logoDataUrl: savedProfile.logoDataUrl, theme: savedProfile.theme },"VIC");
    if (typeof savedProfile.updatedAt !== "string" || !Number.isFinite(Date.parse(savedProfile.updatedAt))) return null;
    const ids = new Set<string>();
    const campaigns: CouncilCampaign[] = saved.campaigns.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid demo campaign");
      const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
      if (typeof row.id !== "string" || !/^demo-[a-z0-9-]{1,64}$/.test(row.id) || ids.has(row.id)
        || typeof row.code !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(row.code)
        || (row.status !== "active" && row.status !== "paused")
        || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))
        || typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error("Invalid demo campaign");
      ids.add(row.id);
      return { ...parseCouncilCampaignInput(row), id: row.id, code: row.code, status: row.status, councilId: "demonstration", opens: 0,
        createdAt: row.createdAt, updatedAt: row.updatedAt, shareUrl: `/council/demo?campaign=${encodeURIComponent(row.id)}` };
    });
    if (loadCouncilDemo().campaigns.some(campaign => !ids.has(campaign.id))) return null;
    return { version: 1, period: saved.period, profile: {...profile,councilId:"demonstration",state:"VIC",updatedAt:savedProfile.updatedAt},campaigns };
  } catch { return null; }
}

export function councilDemoReport(state: CouncilDemoState, now = new Date()): CouncilReport {
  const report = loadCouncilDemo(state.period,now,state.profile);
  return {...report, campaigns: state.campaigns.map(campaign => {
    const outcome = report.campaigns.find(row=>row.id===campaign.id);
    return { id: campaign.id, name: campaign.title, referenceCode: campaign.code, channel: campaign.kind === "session" ? "Information session" : "Council campaign",
      enquiries: outcome?.enquiries || 0, completedJobs: outcome?.completedJobs || 0, completedValueCents: outcome?.completedValueCents || 0 };
  })};
}
