import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEGACY_BLOG_REDIRECT_ENTRIES,
  resolveLegacyBlogRedirect,
} from "../src/lib/legacy-blog-redirects.mjs";
import { LEGACY_BLOG_RETIREMENT_PATHS } from "../src/lib/legacy-blog-retirements.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const guideRoutes = [
  "heat-pumps",
  "ncc-nathers-basix",
  "free-home-energy-assessments",
  "home-energy-upgrades",
  "prepare-for-home-energy-assessment",
  "home-energy-assessment-myths",
];
const guideSources = guideRoutes.map((route) => read(`../src/app/guides/${route}/page.tsx`));
const combinedGuideSource = guideSources.join("\n");
const guideTemplate = read("../src/components/AuthoritativeGuidePage.tsx");
const guideIndex = read("../src/app/guides/page.tsx");
const sitemap = read("../src/app/sitemap.ts");
const legacyRoute = read("../src/app/blog/[slug]/page.tsx");
const certificationGuide = read("../src/app/guides/green-building-certifications-australia/page.tsx");
const notFoundPage = read("../src/app/not-found.tsx");

test("reviewed guides publish honest article metadata and source-backed schema", () => {
  assert.match(guideTemplate, /"@type": "Article"/);
  assert.match(guideTemplate, /"@type": "WebPage"/);
  assert.match(guideTemplate, /"@type": "BreadcrumbList"/);
  assert.match(guideTemplate, /datePublished: publishedIso/);
  assert.match(guideTemplate, /dateModified: reviewedIso/);
  assert.match(guideTemplate, /author: \{ "@id": PUBLIC_SITE\.organizationId \}/);
  assert.match(guideTemplate, /publisher: \{ "@id": PUBLIC_SITE\.organizationId \}/);
  assert.match(guideTemplate, /citation: sources\.map/);
  assert.match(guideTemplate, /isAccessibleForFree: true/);

  for (let index = 0; index < guideRoutes.length; index += 1) {
    const route = guideRoutes[index];
    const source = guideSources[index];
    const expectedReviewedIso = route === "home-energy-upgrades" ? "2026-09-04" : "2026-09-01";
    assert.match(source, /buildGuideMetadata\(\{/);
    assert.match(source, new RegExp(`path: "\\/guides\\/${route}"`));
    assert.match(source, /publishedIso: "2026-09-01"/);
    assert.match(source, new RegExp(`reviewedIso: "${expectedReviewedIso}"`));
    assert.match(guideIndex, new RegExp(`href="\\/guides\\/${route}"`));
    assert.match(sitemap, new RegExp(`"\\/guides\\/${route}"`));
  }

  assert.match(combinedGuideSource, /homeenergyrating\.gov\.au/);
  assert.match(combinedGuideSource, /energy\.gov\.au/);
  assert.match(combinedGuideSource, /planningportal\.nsw\.gov\.au/);
});

test("new consumer copy avoids the legacy site's unsupported claims and abbreviation", () => {
  assert.doesNotMatch(combinedGuideSource, /\bAEA\b/);
  assert.doesNotMatch(combinedGuideSource, /largest government-accredited|only assessment route|free in-home assessment|#1|number one|guaranteed savings/i);
  assert.match(combinedGuideSource, /does not make every assessment free/i);
  assert.match(combinedGuideSource, /does not guarantee a bill/i);
  assert.match(combinedGuideSource, /plain-English/i);
});

test("approved legacy redirects preserve high-value intent without a blanket fallback", () => {
  assert.equal(LEGACY_BLOG_REDIRECT_ENTRIES.length, 168);
  assert.equal(LEGACY_BLOG_RETIREMENT_PATHS.length, 61);
  assert.equal(
    resolveLegacyBlogRedirect("/blog/the-role-of-insulation-in-creating-an-efficient-thermal-envelope"),
    "/guides/insulation-draught-proofing",
  );
  assert.equal(
    resolveLegacyBlogRedirect("/blog/heat-pumps-in-australia--a-comprehensive-guide-for-homeowners"),
    "/guides/heat-pumps",
  );
  assert.equal(resolveLegacyBlogRedirect("/blog/home-energy-savings"), "/guides/home-energy-upgrades");
  assert.equal(
    resolveLegacyBlogRedirect("/blog/understanding-nathers--a-comprehensive-guide-for-melbourne-homeowners"),
    "/nathers-for-new-homes",
  );
  assert.equal(
    resolveLegacyBlogRedirect("/blog/case-study--successful-energy-upgrades-in-melbourne-homes"),
    null,
  );
  assert.equal(resolveLegacyBlogRedirect("/blog/unreviewed-generated-article"), null);
  assert.match(legacyRoute, /if \(destination\) permanentRedirect\(destination\)/);
  assert.match(legacyRoute, /notFound\(\)/);
  assert.doesNotMatch(legacyRoute, /permanentRedirect\("\/guides"\)/);
  assert.doesNotMatch(sitemap, /["']\/blog(?:\/|["'])/);
});

test("every approved legacy destination is a local page and redirects stay one hop", () => {
  const sourcePaths = new Set(LEGACY_BLOG_REDIRECT_ENTRIES.map((entry) => entry.sourcePath));
  assert.equal(sourcePaths.size, LEGACY_BLOG_REDIRECT_ENTRIES.length);
  for (const { sourcePath, targetPath } of LEGACY_BLOG_REDIRECT_ENTRIES) {
    const targetFile = path.join(root, "src", "app", ...targetPath.slice(1).split("/"), "page.tsx");
    assert.equal(fs.existsSync(targetFile), true, `Missing local target for ${sourcePath}`);
    assert.notEqual(targetPath, "/");
    assert.equal(sourcePaths.has(targetPath), false, `Redirect chain starts at ${sourcePath}`);
  }
});

test("the replacement certification guide is source-backed and clearly bounded", () => {
  assert.match(certificationGuide, /buildGuideMetadata\(\{/);
  assert.match(certificationGuide, /path: "\/guides\/green-building-certifications-australia"/);
  assert.match(certificationGuide, /publishedIso: "2026-09-02"/);
  assert.match(certificationGuide, /reviewedIso: "2026-09-02"/);
  assert.match(certificationGuide, /ncc\.abcb\.gov\.au/);
  assert.match(certificationGuide, /homeenergyrating\.gov\.au/);
  assert.match(certificationGuide, /planningportal\.nsw\.gov\.au/);
  assert.match(certificationGuide, /new\.gbca\.org\.au/);
  assert.match(certificationGuide, /nabers\.gov\.au/);
  assert.match(certificationGuide, /Designed assessment is not final certification/i);
  assert.match(certificationGuide, /exclude energy used inside individual residences/i);
  assert.doesNotMatch(certificationGuide, /\bAEA\b|guaranteed savings|property-value increase|government-accredited Green Star/i);
  assert.match(guideIndex, /href="\/guides\/green-building-certifications-australia"/);
  assert.match(sitemap, /"\/guides\/green-building-certifications-australia"/);
});

test("retired articles render a useful noindex 404 destination", () => {
  assert.match(notFoundPage, /robots: \{ index: false, follow: true \}/);
  assert.match(notFoundPage, /That page is no longer available/);
  assert.match(notFoundPage, /did not meet our current evidence standards/);
  assert.match(notFoundPage, /href="\/guides"/);
  assert.match(notFoundPage, /href="\/assessments"/);
});
