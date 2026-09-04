import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");

const identity = read("../src/lib/public-site.ts");
const jsonLd = read("../src/components/JsonLd.tsx");
const layout = read("../src/app/layout.tsx");
const home = read("../src/app/page.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const siteFooter = read("../src/components/SiteFooter.tsx");
const styles = read("../src/app/globals.css");
const accountLayout = read("../src/app/account/layout.tsx");
const robots = read("../src/app/robots.ts");
const sitemap = read("../src/app/sitemap.ts");
const gasAlias = read("../src/app/compare/gas/page.tsx");
const startAlias = read("../src/app/getting-started/page.tsx");
const legacyNewHomeAlias = read("../src/app/nathers-new-homes/page.tsx");
const legacyExistingHomeAlias = read("../src/app/nathers-existing-homes/page.tsx");
const legacyPrivacyAlias = read("../src/app/privacy-policy/page.tsx");
const fieldApp = read("../src/app/direct-trade/field-app/page.tsx");
const platformMetadataRoutes = [
  "plan",
  "wattzun",
  "calculator",
  "compare",
  "gas-compare",
  "guides",
  "guides/certificate-prices",
  "guides/solar",
  "guides/batteries",
  "guides/heating",
  "guides/hot-water",
  "guides/cooking",
  "guides/ev-charging",
  "guides/insulation-draught-proofing",
  "guides/project-preparation",
  "rebates",
  "case-studies",
  "platform",
  "privacy",
  "rental-assessment/request",
  "direct-trade",
  "direct-trade/partners",
  "direct-trade/access",
  "direct-trade/standards",
];
const guideMetadataRoutes = [
  "blower-door-thermal-imaging",
  "guides/heat-pumps",
  "guides/ncc-nathers-basix",
  "guides/free-home-energy-assessments",
  "guides/home-energy-upgrades",
  "guides/prepare-for-home-energy-assessment",
  "guides/home-energy-assessment-myths",
];

test("one verified public identity graph links the business and canonical website", () => {
  assert.match(identity, /legalName: "Australian Energy Assessments Pty Ltd"/);
  assert.match(identity, /abn: "73 675 233 557"/);
  assert.match(identity, /telephone: "\+61-1300-241-149"/);
  assert.match(identity, /ChIJS2WVhrVD1moRFxEPRjRPxtE/);
  assert.match(identity, /facebook\.com\/ausenergyassessments/);
  assert.match(identity, /instagram\.com\/ausenergyassessments/);
  assert.match(identity, /linkedin\.com\/company\/australian-energy-assessments/);
  assert.match(identity, /twitter\.com\/AusEnergyAssess/);
  assert.match(identity, /"@type": "ProfessionalService"/);
  assert.match(identity, /"@type": "WebSite"/);
  assert.match(identity, /websiteId: APEX_WEBSITE_ID/);
  assert.doesNotMatch(identity, /url: `\$\{PUBLIC_SITE\.platformUrl\}/);
  assert.doesNotMatch(identity, /aggregateRating|SearchAction|speakable/);
});

test("JSON-LD is server rendered and escapes markup-sensitive characters", () => {
  assert.match(jsonLd, /JSON\.stringify\(data\)\.replace\(\/<\/g, "\\\\u003c"\)/);
  assert.match(jsonLd, /type="application\/ld\+json"/);
  assert.match(layout, /<JsonLd data=\{publicOrganizationSchema\} \/>/);
  assert.match(layout, /<html lang="en-AU">/);
  assert.match(layout, /"max-image-preview": "large"/);
  assert.match(layout, /url: PUBLIC_SITE\.logo/);
  assert.doesNotMatch(layout, /tlink-icon-192\.png/);
  assert.match(home, /buildApexMetadata\(\{/);
  assert.match(home, /path: "\/"/);
  assert.match(home, /Home Energy Assessments Australia/);
  assert.match(home, /#home-energy-assessment-service/);
  assert.match(home, /"@type": "ItemList"/);
  assert.match(home, /\/nathers-for-new-homes/);
  assert.match(home, /\/home-energy-rating-for-existing-homes/);
  assert.match(layout, /metadataBase: new URL\(PUBLIC_SITE\.apexUrl\)/);
  assert.match(sitemap, /PUBLIC_SITE\.apexUrl/);
  assert.match(robots, /PUBLIC_SITE\.apexUrl/);
});

test("public platform pages receive unique canonical and social metadata", () => {
  assert.match(identity, /export function buildPlatformMetadata/);
  assert.match(identity, /export function buildGuideMetadata/);
  assert.match(identity, /alternates: \{ canonical \}/);
  assert.match(identity, /openGraph:/);
  assert.match(identity, /twitter:/);
  for (const route of platformMetadataRoutes) {
    const page = read(`../src/app/${route}/page.tsx`);
    assert.match(page, /buildPlatformMetadata\(\{/);
    assert.match(page, new RegExp(`path: "\\/${route.replaceAll("/", "\\/")}"`));
  }
  for (const route of guideMetadataRoutes) {
    const page = read(`../src/app/${route}/page.tsx`);
    assert.match(page, /buildGuideMetadata\(\{/);
    assert.match(page, new RegExp(`path: "\\/${route.replaceAll("/", "\\/")}"`));
  }
});

test("header and footer expose assessment conversion and verified profiles", () => {
  assert.match(chrome, /<SurgeHeaderButton/);
  assert.match(chrome, /href="\/direct-trade\/dashboard"/);
  assert.match(chrome, /className="site-book-link"[\s\S]*href="\/book-an-assessment"/);
  assert.match(chrome, /className="site-call-link"[\s\S]*href=\{PUBLIC_SITE\.phoneHref\}/);
  assert.match(siteFooter, /Google Business Profile/);
  assert.match(siteFooter, />Home energy assessments<\/Link>/);
  assert.match(siteFooter, />Home Energy Rating<\/Link>/);
  assert.match(siteFooter, /href="\/faq"/);
  assert.match(siteFooter, /Facebook/);
  assert.match(siteFooter, /Instagram/);
  assert.match(siteFooter, /LinkedIn/);
  assert.match(siteFooter, /PUBLIC_SITE\.legalName/);
  assert.match(siteFooter, /PUBLIC_SITE\.address\.streetAddress/);
  assert.match(styles, /\.site-book-link, \.site-call-link/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*grid-row: 3/);
});

test("crawl controls exclude private surfaces and publish only verified sitemap dates", () => {
  assert.match(accountLayout, /index: false/);
  assert.match(accountLayout, /noimageindex: true/);
  assert.match(robots, /"\/account"/);
  assert.match(robots, /"\/quote-review\/"/);
  assert.match(robots, /"\/trade-photo\/"/);
  assert.match(sitemap, /"\/calculator"/);
  assert.match(sitemap, /"\/guides\/project-preparation"/);
  for (const route of guideMetadataRoutes) {
    assert.match(sitemap, new RegExp(`"\\/${route.replaceAll("/", "\\/")}"`));
  }
  assert.match(sitemap, /"\/home-energy-rating-vs-nathers-vs-scorecard"/);
  assert.match(sitemap, /"\/residential-efficiency-scorecard"/);
  assert.match(sitemap, /"\/rental-assessment\/request"/);
  assert.match(sitemap, /lastModifiedByRoute/);
  assert.match(sitemap, /\["\/assessments", "2026-09-04"\]/);
  assert.match(sitemap, /\["\/blower-door-thermal-imaging", "2026-09-04"\]/);
  assert.match(sitemap, /\["\/guides\/home-energy-upgrades", "2026-09-04"\]/);
  assert.match(sitemap, /new URL\(route \|\| "\/", `\$\{PUBLIC_SITE\.apexUrl\}\/`\)\.toString\(\)/);
  assert.doesNotMatch(sitemap, /changeFrequency|priority:/);
  assert.match(gasAlias, /permanentRedirect\("\/gas-compare"\)/);
  assert.match(startAlias, /permanentRedirect\("\/plan"\)/);
  assert.match(legacyNewHomeAlias, /permanentRedirect\("\/nathers-for-new-homes"\)/);
  assert.match(legacyExistingHomeAlias, /permanentRedirect\("\/home-energy-rating-for-existing-homes"\)/);
  assert.match(legacyPrivacyAlias, /permanentRedirect\("\/privacy"\)/);
  assert.match(fieldApp, /index: false/);
  assert.match(fieldApp, /noarchive: true/);
});
