import { APEX_SITEMAP_PATHS } from "../data/apex-url-snapshot.mjs";
import { resolveLegacyBlogRedirect } from "../../src/lib/legacy-blog-redirects.mjs";
import { isLegacyBlogRetirement } from "../../src/lib/legacy-blog-retirements.mjs";

const readyPage = (sourcePath, note) => ({
  sourcePath,
  targetPath: sourcePath,
  action: "preserve",
  status: "ready",
  canonicalOwner: "apex",
  indexable: true,
  sitemap: true,
  note,
});

const readyRedirect = (sourcePath, targetPath, note) => ({
  sourcePath,
  targetPath,
  action: "permanent_redirect",
  status: "ready",
  canonicalOwner: "target",
  indexable: false,
  sitemap: false,
  note,
});

const readyRetirement = (sourcePath) => ({
  sourcePath,
  targetPath: null,
  action: "retire",
  status: "ready",
  canonicalOwner: "none",
  indexable: false,
  sitemap: false,
  note: "Return HTTP 404 because the reviewed legacy article has no honest equivalent destination.",
});

export const EXPECTED_APEX_SITEMAP = Object.freeze({
  url: "https://ausenergyassessments.com/sitemap",
  capturedAt: "2026-09-01",
  totalPaths: 249,
  blogArticlePaths: 229,
  nonBlogPaths: 20,
  sortedPathSha256: "a3fc7a87df1ffdf46929d6d814b0d01eb2bd5a835a1ae0330471219dc53809d5",
});

// Every non-blog URL in the captured apex sitemap has an explicit decision.
// Every captured blog URL is also listed explicitly as either a direct
// redirect or a retirement. New, uncaptured URLs remain blocked by default.
export const APEX_EXACT_ROUTE_CONTRACT = Object.freeze([
  readyPage("/", "The current homepage keeps the established root URL and canonical ownership."),
  readyPage("/basix-nsw", "Current BASIX service page exists at the same path."),
  readyRedirect("/blog", "/guides", "Replace the legacy article index with the reviewed consumer guide library."),
  readyPage("/book-an-assessment", "Simple five-minute call booking page exists at the same path."),
  readyPage("/commercial-and-industrial-assessments", "Reviewed commercial energy assessment scope exists at the same path."),
  readyPage("/communities-schools", "Reviewed community and school energy education page exists at the same path."),
  readyRedirect("/e-learning-resources", "/guides", "Replace the thin third-party resource widget with the reviewed guide library."),
  readyRedirect("/email", "/book-an-assessment", "The booking page provides the current call, phone and email contact routes with privacy notices."),
  readyRedirect("/energyupgradeinformation-2", "/guides/home-energy-upgrades", "Consolidate the legacy upgrade and finance copy into the reviewed home upgrade guide."),
  readyPage("/faq", "Current terminology FAQ exists at the same path."),
  readyPage("/home-energy-rating-for-existing-homes", "Current existing-home Home Energy Rating page exists at the same path."),
  readyPage("/minimum-rental-standards", "Reviewed Victorian rental minimum energy standards guide exists at the same path."),
  readyPage("/nathers-for-new-homes", "Nationwide plan-based NatHERS service page exists at the same path."),
  readyPage("/nathers-whole-of-home", "Current Whole of Home service page exists at the same path."),
  readyRedirect("/privacy-policy", "/privacy", "Consolidate the legacy privacy URL into the current privacy page."),
  readyRetirement("/referral-program"),
  readyPage("/residential-efficiency-scorecard", "Legacy search-term transition page exists at the same path."),
  readyRedirect("/schedule-call", "/book-an-assessment", "Consolidate the legacy call URL into the current booking page."),
  readyPage("/team", "The published team roster and business-owned portraits are preserved without invented credentials."),
  readyPage("/trusted-suppliers", "The same path now provides independent sources and transparent supplier-selection checks without unverified endorsements."),
]);

const exactContractByPath = new Map(
  APEX_EXACT_ROUTE_CONTRACT.map((entry) => [entry.sourcePath, entry]),
);

export function normaliseApexPath(value) {
  const rawPath = value instanceof URL
    ? value.pathname
    : value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value).pathname
      : value;

  if (!rawPath.startsWith("/")) throw new Error(`Apex path must start with /: ${value}`);
  if (rawPath === "/") return rawPath;
  return rawPath.replace(/\/+$/, "");
}

export function resolveApexMigrationPath(value) {
  const sourcePath = normaliseApexPath(value);
  const exact = exactContractByPath.get(sourcePath);
  if (exact) return exact;

  if (sourcePath.startsWith("/blog/")) {
    const approvedTarget = resolveLegacyBlogRedirect(sourcePath);
    if (approvedTarget) {
      return readyRedirect(
        sourcePath,
        approvedTarget,
        "Consolidate the legacy article into a reviewed guide with matching search intent.",
      );
    }

    if (isLegacyBlogRetirement(sourcePath)) return readyRetirement(sourcePath);
  }

  return {
    sourcePath,
    targetPath: null,
    action: "unmapped",
    status: "blocked",
    canonicalOwner: "unresolved",
    indexable: null,
    sitemap: null,
    note: "URL is outside the captured contract and must be mapped before cutover.",
  };
}

export function buildApexMigrationInventory(values) {
  const sourcePaths = [...new Set(values.map(normaliseApexPath))].sort();
  return sourcePaths.map(resolveApexMigrationPath);
}

export const APEX_URL_MIGRATION_CONTRACT = Object.freeze(
  APEX_SITEMAP_PATHS.map(resolveApexMigrationPath),
);

export function summariseApexMigrationInventory(inventory) {
  return inventory.reduce((summary, entry) => {
    summary.total += 1;
    summary[entry.status] = (summary[entry.status] ?? 0) + 1;
    summary[entry.action] = (summary[entry.action] ?? 0) + 1;
    return summary;
  }, { total: 0 });
}

export function assertApexCutoverReady(inventory) {
  const blockers = inventory.filter((entry) => entry.status !== "ready");
  if (blockers.length > 0) {
    const counts = summariseApexMigrationInventory(blockers);
    throw new Error(
      `Apex cutover is blocked by ${blockers.length} unresolved URLs: ${JSON.stringify(counts)}`,
    );
  }
  return true;
}
