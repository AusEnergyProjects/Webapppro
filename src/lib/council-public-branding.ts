import type { CouncilTheme } from "./council-theme.ts";
import { SECCCA_DEMO_LOGO } from "../data/seccca-demo-logo.ts";

/** Only this deliberate public projection leaves the council workspace. */
export type CouncilPublicBranding = {
  councilName: string;
  logoDataUrl: string | null;
  homeUrl: string | null;
  theme: CouncilTheme;
};

export const COUNCIL_PUBLIC_REFERENCE_HEADER = "x-tlink-council-reference";

const platformHosts = new Set([
  "ausenergyassessments.com", "www.ausenergyassessments.com", "compare.ausenergyassessments.com",
  "aea-energy-comparison.info294029.chatgpt.site", "localhost", "127.0.0.1", "[::1]",
]);

export function isCouncilPlatformHost(url: string): boolean {
  return platformHosts.has(new URL(url).hostname);
}

export type CouncilPublicHostDecision = { kind: "platform" } | { kind: "deny" } | {
  kind: "council"; code: string; rewritePath: string | null;
};

/** Uses the actual request URL, never caller-supplied forwarded/Host headers.
 * Domain ownership and Sites activation are confirmed separately by the operator.
 * Every request rechecks that binding, including assets and public APIs.
 */
export async function resolveCouncilPublicHost(db: Pick<D1Database, "prepare">, requestUrl: string, method: string): Promise<CouncilPublicHostDecision> {
  const url = new URL(requestUrl);
  if (isCouncilPlatformHost(requestUrl)) return { kind: "platform" };
  if (url.protocol !== "https:" || url.port) return { kind: "deny" };
  const row = await db.prepare(`SELECT c.code FROM council_organisations o
    JOIN council_campaigns c ON c.id=o.public_campaign_id AND c.council_id=o.id AND c.status='active'
    WHERE o.status='active' AND o.public_journey_enabled=1 AND o.public_hostname=?
      AND o.public_hostname_verified_at IS NOT NULL AND o.public_home_url IS NOT NULL`)
    .bind(url.hostname).first<{ code: string }>();
  if (!row || !/^[a-f0-9]{32}$/.test(row.code)) return { kind: "deny" };
  const read = method === "GET" || method === "HEAD";
  const path = url.pathname;
  const sharePath = `/council/program/${row.code}`;
  if (read && path === "/") return { kind: "council", code: row.code, rewritePath: sharePath };
  const campaign = read && (path === sharePath || path === `${sharePath}/`);
  const assets = read && (path.startsWith("/assets/") || path.startsWith("/_next/") || /^\/tlink-(?:icon|mark)[a-z0-9.-]*\.(?:png|svg)$/.test(path) || path === "/favicon.ico");
  const address = read && ["/api/address-localities", "/api/address-suggestions"].includes(path);
  const lead = method === "POST" && path === "/api/leads";
  return campaign || assets || address || lead ? { kind: "council", code: row.code, rewritePath: null } : { kind: "deny" };
}

export const SECCCA_JOURNEY_DEMO_PATH = "/council/program/demo/seccca";
/** Selected representative postcodes, not a complete regional boundary. */
export const SECCCA_DEMO_POSTCODES = ["3182", "3186", "3194", "3805", "3810", "3931", "3995"];
export const SECCCA_DEMO_BRANDING: CouncilPublicBranding = {
  councilName: "SECCCA", logoDataUrl: SECCCA_DEMO_LOGO, homeUrl: "https://seccca.org.au/",
  theme: { primaryColor: "#00402f", accentColor: "#9e5330" },
};
