export const NETWORK_PAGE_SIZE = 50;
export const NETWORK_MAX_BODY_BYTES = 16_384;
export const NETWORK_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;
export const NETWORK_TRADES = ["Electrical", "Plumbing", "Solar", "Batteries", "Air conditioning", "Hot water", "Insulation", "Roofing", "Carpentry", "Building", "Painting", "Other"] as const;
export type NetworkKind = "work" | "available";
export type NetworkMinimumRates = { hour: number | null; day: number | null; job: number | null };
export type NetworkWorkPostAllowance = { limit: number; remaining: number; day: string; timeZone: "Australia/Sydney" };
export type NetworkAvailability = { openToWork: boolean; workTrades: string[]; minimumRates: NetworkMinimumRates; serviceAreas: { postcode: string; radiusKm: number }[]; serviceStates: string[]; paused: boolean };
export type NetworkContact = { name: string; email: string; phone: string };
export type NetworkPostInput = {
  kind: NetworkKind; title: string; trade: string; suburb: string; postcode: string; state: string;
  details: string; rateCents: number | null; rateUnit: "hour" | "day" | "job"; startsOn: string; endsOn: string;
};
export type NetworkPost = NetworkPostInput & {
  id: string; businessName: string; isOwn: boolean; status: "active" | "closed" | "expired";
  revision: number; expiresAt: string; createdAt: string; updatedAt: string; enquiryId: string;
};
export type NetworkEnquiry = {
  id: string; postId: string; postTitle: string; postKind: NetworkKind; businessName: string;
  direction: "incoming" | "outgoing"; message: string; senderContact: NetworkContact;
  recipientContact: NetworkContact | null; status: "pending" | "connected" | "closed";
  revision: number; createdAt: string; updatedAt: string;
};
export type NetworkWorkspace = {
  enabled: boolean; canManageMembership: boolean; posts: NetworkPost[]; myPosts: NetworkPost[];
  enquiries: NetworkEnquiry[]; hasMore: boolean; myHasMore: boolean; enquiriesHasMore: boolean;
  availability: NetworkAvailability; leads: NetworkLead[]; leadCount: number; leadsHasMore: boolean;
  workPostAllowance: NetworkWorkPostAllowance;
};
export type NetworkLead = NetworkPost & { leadStatus: "new" | "viewed" | "dismissed"; receivedAt: string };
export type NetworkLeadNotification = { id: string; title: string; summary: string; createdAt: string };
export class NetworkError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
export function networkInvalid(message = "Check the details and try again."): never { throw new NetworkError("NETWORK_INVALID", message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return networkInvalid();
  return value as Record<string, unknown>;
}
export function networkText(value: unknown, maximum: number, required = false, multiline = false): string {
  if (value === undefined || value === null) { if (required) return networkInvalid(); return ""; }
  if (typeof value !== "string" || value.length > maximum || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) return networkInvalid();
  const result = value.trim();
  if (required && !result) return networkInvalid();
  return result;
}
export function networkId(value: unknown): string {
  const result = networkText(value, 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) return networkInvalid();
  return result.toLowerCase();
}
export function networkRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return networkInvalid();
  return value;
}
function date(value: unknown): string {
  const result = networkText(value, 10);
  if (result && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result)) return networkInvalid("Choose a valid date.");
  return result;
}
export function normalizeNetworkPost(value: unknown): NetworkPostInput {
  const raw = object(value);
  const kind = raw.kind;
  if (kind !== "work" && kind !== "available") return networkInvalid();
  const title = networkText(raw.title, 120, true), trade = networkText(raw.trade, 60, true);
  if (!NETWORK_TRADES.some(item => item === trade)) return networkInvalid("Choose a trade.");
  const suburb = networkText(raw.suburb, 80, true), postcode = networkText(raw.postcode, 4, true), state = networkText(raw.state, 3, true);
  if (!/^\d{4}$/.test(postcode) || !NETWORK_STATES.some(item => item === state)) return networkInvalid("Add a four-digit postcode and state.");
  const details = networkText(raw.details, 2000, true, true);
  const rateCents = raw.rateCents;
  if (typeof rateCents !== "number" || !Number.isSafeInteger(rateCents) || rateCents < 1 || rateCents > 100_000_000) return networkInvalid("Enter a price greater than zero, excluding GST.");
  const rateUnit = raw.rateUnit;
  if (rateUnit !== "hour" && rateUnit !== "day" && rateUnit !== "job") return networkInvalid("Choose whether the price is per hour, day or job.");
  const startsOn = date(raw.startsOn), endsOn = date(raw.endsOn);
  if (startsOn && endsOn && endsOn < startsOn) return networkInvalid("The end date must be on or after the start date.");
  return { kind, title, trade, suburb, postcode, state, details, rateCents, rateUnit, startsOn, endsOn };
}
export function normalizeNetworkContact(value: unknown, confirmed: unknown): NetworkContact {
  if (confirmed !== true) return networkInvalid("Confirm you want to share these business contact details.");
  const raw = object(value), name = networkText(raw.name, 100, true), email = networkText(raw.email, 180).toLowerCase(), phone = networkText(raw.phone, 40);
  if (!email && !phone) return networkInvalid("Add a business email or phone number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return networkInvalid("Check the email address.");
  if (phone && (!/^[+\d()\s-]+$/.test(phone) || phone.replace(/\D/g, "").length < 8 || phone.replace(/\D/g, "").length > 15)) return networkInvalid("Check the phone number.");
  return { name, email, phone };
}
export function normalizeNetworkAvailability(openToWork: unknown, workTrades: unknown) {
  if (typeof openToWork !== "boolean" || !Array.isArray(workTrades) || workTrades.length > NETWORK_TRADES.length
    || !workTrades.every(trade => typeof trade === "string" && NETWORK_TRADES.some(known => known === trade))) return networkInvalid("Choose the trades you want work for.");
  const selected: string[] = [...new Set<string>(workTrades)].sort();
  if (openToWork && !selected.length) return networkInvalid("Choose at least one trade before turning on work leads.");
  return { openToWork, workTrades: selected };
}
export function normalizeNetworkMinimumRates(value: unknown): Partial<NetworkMinimumRates> {
  if (value === undefined) return {};
  const raw = object(value), result: Partial<NetworkMinimumRates> = {};
  if (Object.keys(raw).some(key => key !== "hour" && key !== "day" && key !== "job")) return networkInvalid("Choose a minimum per hour, day or job.");
  for (const unit of ["hour", "day", "job"] as const) {
    if (!Object.hasOwn(raw, unit)) continue;
    const minimum = raw[unit];
    if (minimum !== null && (typeof minimum !== "number" || !Number.isSafeInteger(minimum) || minimum < 1 || minimum > 100_000_000)) return networkInvalid("Enter a minimum greater than zero or leave it blank for any price.");
    result[unit] = minimum;
  }
  return result;
}
