import { APEX_SITEMAP_PATHS } from "../data/apex-url-snapshot.mjs";

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

const pending = (sourcePath, status, note) => ({
  sourcePath,
  targetPath: null,
  action: "review",
  status,
  canonicalOwner: "unresolved",
  indexable: null,
  sitemap: null,
  note,
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
// Blog articles are covered by the fail-closed wildcard below and remain held
// until each article receives a keep, merge, redirect or retire decision.
export const APEX_EXACT_ROUTE_CONTRACT = Object.freeze([
  pending("/", "pending_review", "The apex and parallel homepages need a final content, title and canonical ownership decision."),
  readyPage("/basix-nsw", "Current BASIX service page exists at the same path."),
  pending("/blog", "pending_content", "The article index needs a reviewed replacement before cutover."),
  readyPage("/book-an-assessment", "Simple five-minute call booking page exists at the same path."),
  pending("/commercial-and-industrial-assessments", "pending_content", "No equivalent reviewed service page exists yet."),
  pending("/communities-schools", "pending_content", "No equivalent reviewed audience page exists yet."),
  pending("/e-learning-resources", "pending_review", "Existing resources require a keep, merge or redirect decision."),
  pending("/email", "pending_review", "The legacy intent must be confirmed before choosing a destination."),
  pending("/energyupgradeinformation-2", "pending_review", "The legacy content must be compared with the current guides before mapping it."),
  readyPage("/faq", "Current terminology FAQ exists at the same path."),
  readyPage("/home-energy-rating-for-existing-homes", "Current existing-home Home Energy Rating page exists at the same path."),
  pending("/minimum-rental-standards", "pending_content", "The public information page is not equivalent to the current request workflow."),
  readyPage("/nathers-for-new-homes", "Nationwide plan-based NatHERS service page exists at the same path."),
  readyPage("/nathers-whole-of-home", "Current Whole of Home service page exists at the same path."),
  readyRedirect("/privacy-policy", "/privacy", "Consolidate the legacy privacy URL into the current privacy page."),
  pending("/referral-program", "pending_content", "No equivalent reviewed referral page exists yet."),
  readyPage("/residential-efficiency-scorecard", "Legacy search-term transition page exists at the same path."),
  readyRedirect("/schedule-call", "/book-an-assessment", "Consolidate the legacy call URL into the current booking page."),
  pending("/team", "pending_content", "Named people and credentials require verified business evidence before publication."),
  pending("/trusted-suppliers", "pending_review", "Supplier relationships and outbound links require current verification."),
]);

// These 26 source URLs share an exact title with their clean-slug target.
// They are recommendations only: no redirect becomes ready until the winner is
// rewritten, Search Console/backlink evidence is checked and any case-study
// claims are verified as genuine rather than duplicated generated content.
export const APEX_BLOG_CONSOLIDATION_CANDIDATES = Object.freeze([
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-2", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-3", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-4", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-5", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-6", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-7", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-8", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-9", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-10", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/case-study--successful-energy-upgrades-in-melbourne-homes-11", "/blog/case-study--successful-energy-upgrades-in-melbourne-homes"],
  ["/blog/debunking-common-myths-about-energy-assessments-in-australia-2", "/blog/debunking-common-myths-about-energy-assessments-in-australia"],
  ["/blog/debunking-common-myths-about-energy-assessments-in-australia-3", "/blog/debunking-common-myths-about-energy-assessments-in-australia"],
  ["/blog/debunking-common-myths-about-energy-assessments-in-victoria-2", "/blog/debunking-common-myths-about-energy-assessments-in-victoria"],
  ["/blog/expert-insights--common-misconceptions-about-energy-assessments-2", "/blog/expert-insights--common-misconceptions-about-energy-assessments"],
  ["/blog/expert-tips-for-navigating-building-standards-in-victoria-2", "/blog/expert-tips-for-navigating-building-standards-in-victoria"],
  ["/blog/how-to-prepare-your-melbourne-home-for-an-energy-assessment-2", "/blog/how-to-prepare-your-melbourne-home-for-an-energy-assessment"],
  ["/blog/how-to-prepare-your-melbourne-home-for-an-energy-audit-2", "/blog/how-to-prepare-your-melbourne-home-for-an-energy-audit"],
  ["/blog/seasonal-energy-efficiency-tips-for-melbourne-homeowners-2", "/blog/seasonal-energy-efficiency-tips-for-melbourne-homeowners"],
  ["/blog/seasonal-energy-efficiency-tips-for-melbourne-homes-3", "/blog/seasonal-energy-efficiency-tips-for-melbourne-homes"],
  ["/blog/seasonal-energy-efficiency-tips-for-melbourne-homes-4", "/blog/seasonal-energy-efficiency-tips-for-melbourne-homes"],
  ["/blog/the-ultimate-guide-to-energy-assessments-in-melbourne-2", "/blog/the-ultimate-guide-to-energy-assessments-in-melbourne"],
  ["/blog/the-ultimate-guide-to-energy-assessments-in-melbourne-3", "/blog/the-ultimate-guide-to-energy-assessments-in-melbourne"],
  ["/blog/top-5-myths-about-energy-assessments-in-victoria-debunked-2", "/blog/top-5-myths-about-energy-assessments-in-victoria-debunked"],
  ["/blog/top-myths-about-energy-assessments-debunked-2", "/blog/top-myths-about-energy-assessments-debunked"],
  ["/blog/understanding-australian-building-energy-standards--a-comprehensive-guide-2", "/blog/understanding-australian-building-energy-standards--a-comprehensive-guide"],
  ["/blog/understanding-property-efficiency-ratings-in-victoria--a-comprehensive-guide-2", "/blog/understanding-property-efficiency-ratings-in-victoria--a-comprehensive-guide"],
]);

const exactContractByPath = new Map(
  APEX_EXACT_ROUTE_CONTRACT.map((entry) => [entry.sourcePath, entry]),
);
const blogConsolidationByPath = new Map(APEX_BLOG_CONSOLIDATION_CANDIDATES);

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
    const proposedTarget = blogConsolidationByPath.get(sourcePath);
    if (proposedTarget) {
      return {
        sourcePath,
        targetPath: proposedTarget,
        action: "proposed_redirect",
        status: "pending_review",
        canonicalOwner: "unresolved",
        indexable: null,
        sitemap: null,
        note: "Exact-title duplicate candidate. Merge useful evidence, verify performance and claims, then approve a direct redirect.",
      };
    }

    return {
      sourcePath,
      targetPath: null,
      action: "review",
      status: "pending_review",
      canonicalOwner: "unresolved",
      indexable: null,
      sitemap: null,
      note: "Legacy article requires an evidence and intent review before a keep, merge, redirect or retire decision.",
    };
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
