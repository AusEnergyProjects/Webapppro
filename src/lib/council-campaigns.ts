export type CouncilCampaignKind = "campaign" | "session";
export type CouncilAudience = "everyone" | "households" | "businesses" | "trades";
export type CouncilCampaignInput = {
  title: string;
  kind: CouncilCampaignKind;
  audience: CouncilAudience;
  startsAt: string | null;
  location: string | null;
  meetingUrl: string | null;
};
export type CouncilCampaign = CouncilCampaignInput & {
  id: string; councilId: string; code: string; status: "active" | "paused";
  opens: number; createdAt: string; updatedAt: string; shareUrl: string;
};
export type CouncilScopeRequest = { id: string; postcodes: string[]; status: "pending" | "approved" | "rejected"; createdAt: string };

export class CouncilCampaignInputError extends Error {}

export function councilReferenceCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value) ? value : null;
}

export function parseCouncilCampaignInput(value: unknown): CouncilCampaignInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CouncilCampaignInputError("Enter campaign details.");
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const title = typeof fields.title === "string" ? fields.title.trim() : "";
  if (title.length < 3 || title.length > 120 || /[\u0000-\u001f]/.test(title)) throw new CouncilCampaignInputError("Use a campaign title between 3 and 120 characters.");
  if (fields.kind !== "campaign" && fields.kind !== "session") throw new CouncilCampaignInputError("Choose a campaign or information session.");
  if (fields.audience !== "everyone" && fields.audience !== "households" && fields.audience !== "businesses" && fields.audience !== "trades") throw new CouncilCampaignInputError("Choose who this campaign is for.");
  let startsAt: string | null = null;
  if (fields.startsAt) {
    if (typeof fields.startsAt !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(fields.startsAt) || !Number.isFinite(Date.parse(fields.startsAt))) throw new CouncilCampaignInputError("Choose a valid session date and time, including its time zone.");
    startsAt = new Date(fields.startsAt).toISOString();
  }
  const location = typeof fields.location === "string" ? fields.location.trim() : "";
  if (location.length > 240 || /[\u0000-\u001f]/.test(location)) throw new CouncilCampaignInputError("Use a venue of up to 240 characters.");
  let meetingUrl: string | null = null;
  if (fields.meetingUrl) {
    if (typeof fields.meetingUrl !== "string" || fields.meetingUrl.length > 1000) throw new CouncilCampaignInputError("Use a valid HTTPS session link.");
    let url: URL;
    try { url = new URL(fields.meetingUrl); } catch { throw new CouncilCampaignInputError("Use a valid HTTPS session link."); }
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) throw new CouncilCampaignInputError("Use a valid HTTPS session link.");
    meetingUrl = url.href;
  }
  if (fields.kind === "session" && (!startsAt || (!location && !meetingUrl))) throw new CouncilCampaignInputError("Add a session time and a venue or online link.");
  return { title, kind: fields.kind, audience: fields.audience, startsAt: fields.kind === "session" ? startsAt : null, location: fields.kind === "session" ? location || null : null, meetingUrl: fields.kind === "session" ? meetingUrl : null };
}

export function campaignSharePath(code: string) { return `/council/program/${encodeURIComponent(code)}`; }
