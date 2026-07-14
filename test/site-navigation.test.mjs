import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const home = read("../src/app/page.tsx");
const guide = read("../src/components/GettingStarted.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const electricity = read("../src/app/compare/page.tsx");
const gas = read("../src/app/gas-compare/page.tsx");
const styles = read("../src/app/globals.css");
const rebates = read("../src/components/RebatesHub.tsx");
const rebatesRoute = read("../src/app/rebates/page.tsx");
const guideShell = read("../src/components/GuideShell.tsx");
const caseStudies = read("../src/app/case-studies/page.tsx");
const assessments = read("../src/app/assessments/page.tsx");
const planner = read("../src/components/HomeEnergyPlanner.tsx");
const plannerRoute = read("../src/app/plan/page.tsx");
const plannerPrintRoute = read("../src/app/plan/print/page.tsx");
const gettingStartedRoute = read("../src/app/getting-started/page.tsx");
const layout = read("../src/app/layout.tsx");
const fastNavigation = read("../src/components/FastNavigation.tsx");
const heroAsset = path.resolve(directory, "../public/aea-energy-platform-hero.jpg");
const socialAsset = path.resolve(directory, "../public/aea-home-energy-plan-og.png");

test("the homepage provides one clear starting journey instead of redirecting", () => {
  assert.match(home, /GettingStarted/);
  assert.doesNotMatch(home, /redirect\(/);
  assert.match(guide, /One clear plan for a more comfortable, lower-cost home/);
  assert.match(guide, /Build my home energy plan/);
  assert.match(guide, /What do you need today/);
  assert.match(guide, /Direct Trade Services/);
  assert.match(guide, /Bring a recent bill/);
  assert.match(guide, /Check before committing/);
});

test("shared navigation prioritises the planner, electricity and gas journeys", () => {
  assert.match(chrome, /export function SiteHeader/);
  assert.match(chrome, /className="site-header"/);
  assert.match(chrome, /href: "\/", label: "Start"/);
  assert.match(chrome, /href: "\/plan", label: "My energy plan"/);
  assert.match(chrome, /href: "\/compare", label: "Electricity compare"/);
  assert.match(chrome, /href: "\/gas-compare", label: "Gas compare"/);
  assert.match(chrome, /href: "\/guides", label: "Guides and rebates"/);
  assert.match(chrome, /href: "\/assessments", label: "Assessments"/);
  assert.match(assessments, /SiteHeader active="assessments"/);
  assert.match(electricity, /SiteHeader active="electricity"/);
  assert.match(gas, /SiteHeader active="gas"/);
  assert.match(plannerRoute, /SiteHeader active="plan"/);
  assert.match(plannerRoute, /HomeEnergyPlanner/);
  assert.match(rebatesRoute, /RebatesHub/);
  assert.match(rebates, /SiteHeader active="rebates"/);
  assert.match(guide, /href="\/rebates"/);
  assert.match(gettingStartedRoute, /redirect\("\/plan"\)/);
});

test("direct trade proposition presents the trade network and subscription as live", () => {
  assert.match(guide, /Traditional upgrade channels can include sales, referral and administration businesses/);
  assert.match(guide, /Quotes should separate equipment, labour, certificates or rebates/);
  assert.match(guide, /through an active trade network/i);
  assert.match(guide, /Participating installers fund the service through a current subscription/);
  assert.match(guide, /not a margin added to household equipment/);
  assert.doesNotMatch(guide, /planned revenue model|installer subscriptions and applications are in development|Future Direct Trade members/);
  assert.doesNotMatch(guide, /Live service, expanding tool|direct-trade-status/);
});

test("direct trade marketplace includes reputable wholesalers", () => {
  assert.match(guide, /For licensed installers and reputable suppliers/);
  assert.match(guide, /reputable suppliers (?:can|to) connect proven products with qualified trades and suitable households/i);
});

test("installer membership does not imply government accreditation", () => {
  assert.match(guide, /verified membership in the Australian Energy Assessments program/);
  assert.match(guide, /does not replace a trade licence, government accreditation or scheme-specific installer approval/);
  assert.doesNotMatch(guide, /accredited Direct Trade Specialist/i);
  assert.doesNotMatch(guide, /\u2013|\u2014/);
});

test("customer-facing pages use the shared powered-by footer", () => {
  assert.match(chrome, /export function SiteFooter/);
  assert.match(chrome, /Powered by/);
  assert.match(guide, /<SiteFooter>/);
  assert.match(electricity, /<SiteFooter>/);
  assert.match(gas, /<SiteFooter>/);
  assert.match(rebates, /<SiteFooter>/);
  assert.match(guideShell, /<SiteFooter>/);
  assert.match(caseStudies, /<SiteFooter>/);
  assert.match(assessments, /<SiteFooter>/);
  assert.match(plannerRoute, /<SiteFooter>/);
  assert.doesNotMatch(`${chrome}${guide}${electricity}${gas}${rebates}${guideShell}${caseStudies}${assessments}${planner}`, /Provided by/);
});

test("shared visual foundation uses the polished responsive system", () => {
  assert.match(layout, /family=Manrope/);
  assert.match(layout, /family=Source\+Serif\+4/);
  assert.match(layout, /display=swap/);
  assert.match(layout, /fonts\.gstatic\.com/);
  assert.match(styles, /\.site-header \{/);
  assert.match(styles, /radial-gradient\(circle at 8% -4%/);
  assert.match(styles, /\.comparator-nav::-webkit-scrollbar \{ display: none; \}/);
  assert.match(styles, /a:focus-visible/);
});

test("shared layout and component tokens prevent page-level visual drift", () => {
  assert.match(styles, /--layout-max: 1180px/);
  assert.match(styles, /\.wrap \{[^}]*max-width: var\(--layout-max\)/);
  assert.doesNotMatch(styles, /\.(?:start-page|guide-page) \{[^}]*max-width:/);
  assert.match(styles, /--radius-control: 11px/);
  assert.match(styles, /--radius-card: 18px/);
  assert.match(styles, /--action-primary: linear-gradient/);
  assert.match(styles, /\.btn \{[^}]*background: var\(--action-primary\)/);
  assert.match(styles, /\.guide-callout > a \{[^}]*background: var\(--action-primary\)/);
  assert.match(styles, /\.native-guidance-links a \{[^}]*background: var\(--action-primary\)/);
  assert.match(styles, /\.modal \.mclose \{[^}]*background: var\(--action-primary\)/);
  assert.match(styles, /\.start-path-card \{[^}]*border-radius: var\(--radius-card\)/);
});

test("homepage uses the original AEA energy platform artwork", () => {
  assert.match(guide, /className="start-hero-visual"/);
  assert.match(styles, /url\("\/aea-energy-platform-hero\.jpg"\)/);
  assert.equal(fs.existsSync(heroAsset), true);
  assert.ok(fs.statSync(heroAsset).size > 100_000);
  assert.ok(fs.statSync(heroAsset).size < 500_000);
});

test("social sharing metadata uses one launch-ready AEA energy card", () => {
  assert.match(layout, /openGraph:/);
  assert.match(layout, /twitter:/);
  assert.match(layout, /\/aea-home-energy-plan-og\.png/);
  assert.equal(fs.existsSync(socialAsset), true);
  assert.ok(fs.statSync(socialAsset).size > 100_000);
  assert.ok(fs.statSync(socialAsset).size < 3_000_000);
});

test("internal navigation prefetches and transitions without full document reloads", () => {
  assert.match(layout, /<FastNavigation \/>/);
  assert.match(fastNavigation, /router\.prefetch/);
  assert.match(fastNavigation, /router\.push/);
  assert.match(fastNavigation, /document\.addEventListener\("click"/);
  assert.match(fastNavigation, /route-loading/);
  assert.match(styles, /html\.route-loading body::before/);
});

test("rebates hub makes location boundaries and source confirmation visible", () => {
  assert.match(rebates, /Choose your state or territory/);
  assert.match(rebates, /Select a state or territory/);
  assert.match(rebates, /Federal certificates and programs/);
  assert.match(rebates, /State, territory and provider support/);
  assert.match(rebates, /Information checked 14 July 2026/);
  assert.match(rebates, /Official program pages remain the source of truth/);
  assert.match(rebates, /Open official source and confirm/);
  assert.match(rebates, /Solar PV, solar hot water and eligible heat pump hot water/);
  assert.match(rebates, /insulation and draught proofing/);
  assert.match(rebates, /Heating and cooling/);
  assert.match(rebates, /[A-Z][A-Za-z ]+ Government/);
});

test("rebates hub contains no prohibited dash characters", () => {
  assert.doesNotMatch(`${rebates}${rebatesRoute}`, /\u2013|\u2014/);
});

test("homepage hero actions keep visible text on distinct backgrounds", () => {
  assert.match(styles, /\.start-actions \.btn\.ghost \{ background: rgba\(255, 255, 255, \.08\);/);
  assert.match(styles, /\.start-actions \.btn\.ghost:hover, \.start-actions \.btn\.ghost:focus-visible \{ background: #fff; color: var\(--color-aea-ink\); \}/);
});

test("getting-started copy preserves comparison and privacy boundaries", () => {
  assert.match(guide, /Mains gas plans only, not LPG/);
  assert.match(guide, /Your plan and meter file stay on your device/);
  assert.match(guide, /not included in saved links or enquiry data/);
  assert.match(guide, /Estimates are indicative/);
  assert.doesNotMatch(guide, /[–—]/);
});

test("integrated planner is private, ordered and responsive", () => {
  assert.match(plannerRoute, /No account, address, bill, meter identifier or contact details are needed/);
  assert.match(planner, /aria-live="polite"/);
  assert.match(planner, /Before committing/);
  assert.match(planner, /Open fast print view/);
  assert.match(planner, /Start over/);
  assert.doesNotMatch(planner, /target="_blank"/);
  assert.doesNotMatch(planner, /window\.print/);
  assert.match(plannerPrintRoute, /PrintRoadmapButton/);
  assert.match(plannerPrintRoute, /robots: \{ index: false, follow: false \}/);
  assert.match(plannerRoute, /initialSelection=/);
  assert.match(plannerPrintRoute, /returnParams\.append\("feature", item\)/);
  assert.match(styles, /\.planner-layout \{[^}]*grid-template-columns:/);
  assert.match(styles, /\.planner-controls legend \{[^}]*background: #fff;[^}]*display: inline-flex;/);
  assert.match(styles, /\.planner-results-heading h2,[^}]*overflow-wrap: anywhere;/);
  assert.match(styles, /\.planner-results \.planner-result-actions button, \.planner-results \.planner-result-actions a \{[^}]*color: #fff;/);
  assert.doesNotMatch(styles, /background-attachment: fixed/);
  assert.match(styles, /@media print \{/);
  assert.match(styles, /@media \(max-width: 1080px\) \{[\s\S]*?\.planner-layout \{ grid-template-columns: 1fr; \}/);
});
