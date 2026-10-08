import { canonicalAustralianState, residentialStateFromPostcode } from "./australian-postcodes.mjs";
import { hasAllowedSignature, privateImageDimensions, sanitiseQuotingPhoto } from "./private-image-evidence.ts";

export const COUNCIL_DEFAULT_THEME = { primaryColor: "#032733", accentColor: "#0b765d" } as const;
export const COUNCIL_LOGO_MAX_BYTES = 256 * 1024;
export const COUNCIL_PROFILE_MAX_BODY_BYTES = 360 * 1024;

export type CouncilPublicJourneyInput = { enabled: boolean; homeUrl: string | null; requestedHostname: string | null };
export type CouncilPublicJourney = CouncilPublicJourneyInput & {
  domainStatus: "not_requested" | "pending" | "verified";
  sharePath: string | null;
  customDomainUrl: string | null;
};

export type CouncilProfile = {
  councilId: string;
  name: string;
  state: string;
  postcodes: string[];
  logoDataUrl: string | null;
  theme: { primaryColor: string; accentColor: string };
  publicJourney?: CouncilPublicJourney;
  updatedAt: string;
};
export type CouncilProfileInput = Pick<CouncilProfile, "name" | "postcodes" | "logoDataUrl" | "theme"> & { publicJourney?: CouncilPublicJourneyInput };

export class CouncilProfileInputError extends Error {
  constructor(message: string) { super(message); this.name = "CouncilProfileInputError"; }
}

function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CouncilProfileInputError("Send valid council profile settings.");
  const result = Object.fromEntries(Object.entries(value));
  if (Object.keys(result).length !== allowed.length || Object.keys(result).some(key => !allowed.includes(key))) {
    throw new CouncilProfileInputError("The council profile contains missing or unsupported fields.");
  }
  return result;
}

function colour(value: unknown): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new CouncilProfileInputError("Choose six digit hex colours, such as #032733.");
  return value.toLowerCase();
}

export function councilPublicHostname(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new CouncilProfileInputError("Enter a public hostname, such as energy.yourcouncil.vic.gov.au.");
  const host = value.trim().toLowerCase();
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".test") || host.endsWith(".invalid")
    || host === "ausenergyassessments.com" || host.endsWith(".ausenergyassessments.com")
    || host === "chatgpt.site" || host.endsWith(".chatgpt.site")) {
    throw new CouncilProfileInputError("Use your council's public hostname only, without https://, a path or a port.");
  }
  return host;
}

export function councilHomeUrl(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000 || /[\u0000-\u0020\u007f\\]/.test(value)) throw new CouncilProfileInputError("Enter your council's full HTTPS website address.");
  let url: URL;
  try { url = new URL(value); } catch { throw new CouncilProfileInputError("Enter your council's full HTTPS website address."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)
    || /\.(?:localhost|local|test|invalid)$/.test(url.hostname)) throw new CouncilProfileInputError("Use a public HTTPS council website without embedded credentials or a port.");
  return url.href;
}

function publicJourney(value: unknown): CouncilPublicJourneyInput {
  const raw = fields(value, ["enabled", "homeUrl", "requestedHostname"]);
  if (typeof raw.enabled !== "boolean") throw new CouncilProfileInputError("Choose whether to enable your public council journey.");
  const homeUrl = councilHomeUrl(raw.homeUrl);
  if (raw.enabled && !homeUrl) throw new CouncilProfileInputError("Add your council's website so customers can return home.");
  return { enabled: raw.enabled, homeUrl, requestedHostname: councilPublicHostname(raw.requestedHostname) };
}

function logo(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > Math.ceil(COUNCIL_LOGO_MAX_BYTES / 3) * 4 + 32) throw new CouncilProfileInputError("Choose a PNG, JPEG or WebP logo up to 256 KiB.");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) throw new CouncilProfileInputError("Choose a PNG, JPEG or WebP image file. Links and SVG images are not supported.");
  let binary: string;
  try { binary = atob(match[2]); }
  catch { throw new CouncilProfileInputError("The logo image could not be read."); }
  if (binary.length > COUNCIL_LOGO_MAX_BYTES || btoa(binary) !== match[2]) throw new CouncilProfileInputError("The logo must be valid base64 and no larger than 256 KiB.");
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const dimensions = privateImageDimensions(bytes, match[1]);
  if (!hasAllowedSignature(bytes, match[1], false) || !dimensions || dimensions.width > 4096 || dimensions.height > 4096) {
    throw new CouncilProfileInputError("Choose a valid PNG, JPEG or WebP logo with dimensions up to 4096 pixels.");
  }
  const clean = sanitiseQuotingPhoto(bytes, match[1]);
  if (!clean || !privateImageDimensions(clean, match[1])) throw new CouncilProfileInputError("The logo image is incomplete or unsupported.");
  let encoded = "";
  for (const byte of clean) encoded += String.fromCharCode(byte);
  return `data:${match[1]};base64,${btoa(encoded)}`;
}

/** Browser-safe structural validation. The server also verifies canonical Delivery Area postcode/state tuples. */
export function parseCouncilProfileInput(value: unknown, state: string): CouncilProfileInput {
  const hasPublicJourney = value !== null && typeof value === "object" && Object.hasOwn(value, "publicJourney");
  const raw = fields(value, ["name", "postcodes", "logoDataUrl", "theme", ...(hasPublicJourney ? ["publicJourney"] : [])]);
  if (typeof raw.name !== "string" || raw.name.trim().length < 2 || raw.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(raw.name)) {
    throw new CouncilProfileInputError("Enter a council name between 2 and 120 characters.");
  }
  if (!canonicalAustralianState(state) || !Array.isArray(raw.postcodes) || raw.postcodes.length < 1 || raw.postcodes.length > 100
    || raw.postcodes.some(postcode => typeof postcode !== "string" || !/^\d{4}$/.test(postcode) || residentialStateFromPostcode(postcode) !== state)) {
    throw new CouncilProfileInputError(`Choose between 1 and 100 residential postcodes in ${state}.`);
  }
  const postcodes = raw.postcodes.filter((postcode): postcode is string => typeof postcode === "string");
  if (new Set(postcodes).size !== postcodes.length) throw new CouncilProfileInputError("Include each postcode only once.");
  const theme = fields(raw.theme, ["primaryColor", "accentColor"]);
  return { name: raw.name.trim(), postcodes: postcodes.sort(), logoDataUrl: logo(raw.logoDataUrl),
    theme: { primaryColor: colour(theme.primaryColor), accentColor: colour(theme.accentColor) },
    ...(hasPublicJourney ? { publicJourney: publicJourney(raw.publicJourney) } : {}) };
}
