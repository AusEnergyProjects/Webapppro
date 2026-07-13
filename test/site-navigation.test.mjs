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
const layout = read("../src/app/layout.tsx");
const fastNavigation = read("../src/components/FastNavigation.tsx");
const heroAsset = path.resolve(directory, "../public/aea-energy-platform-hero.jpg");

test("the homepage provides a direct trade journey instead of redirecting", () => {
  assert.match(home, /GettingStarted/);
  assert.doesNotMatch(home, /redirect\(/);
  assert.match(guide, /Go direct to the licensed trades who do the work/);
  assert.match(guide, /Direct Trade Services/);
  assert.match(guide, /Bring a recent bill/);
  assert.match(guide, /Confirm before switching/);
});

test("shared navigation connects Direct Trade Services, electricity and gas journeys", () => {
  assert.match(chrome, /export function SiteHeader/);
  assert.match(chrome, /className="site-header"/);
  assert.match(chrome, /href: "\/", label: "Direct Trade Services"/);
  assert.match(chrome, /href: "\/compare"/);
  assert.match(chrome, /href: "\/gas-compare"/);
  assert.match(electricity, /SiteHeader active="electricity"/);
  assert.match(gas, /SiteHeader active="gas"/);
  assert.match(chrome, /href: "\/rebates"/);
  assert.match(rebatesRoute, /RebatesHub/);
  assert.match(rebates, /SiteHeader active="rebates"/);
});

test("direct trade proposition presents the trade network and subscription as live", () => {
  assert.match(guide, /Traditional upgrade channels can include sales, referral and administration businesses/);
  assert.match(guide, /Quotes should separate equipment, labour, certificates or rebates/);
  assert.match(guide, /through an active trade network/);
  assert.match(guide, /Participating installers fund the service through a current subscription/);
  assert.match(guide, /not a margin added to household equipment/);
  assert.doesNotMatch(guide, /planned revenue model|installer subscriptions and applications are in development|Future Direct Trade members/);
  assert.doesNotMatch(guide, /Live service, expanding tool|direct-trade-status/);
});

test("direct trade marketplace includes reputable wholesalers", () => {
  assert.match(guide, /For wholesalers/);
  assert.match(guide, /Quality products into customers’ homes/);
  assert.match(guide, /reputable suppliers to connect proven products with qualified trades and suitable households/);
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
  assert.doesNotMatch(`${chrome}${guide}${electricity}${gas}${rebates}${guideShell}${caseStudies}`, /Provided by/);
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
  assert.match(guide, /Your meter file stays on your device/);
  assert.match(guide, /not included in saved comparison links or enquiry data/);
  assert.match(guide, /Estimates are indicative/);
  assert.doesNotMatch(guide, /[–—]/);
});
