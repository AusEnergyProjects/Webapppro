import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const home = read("../src/app/page.tsx");
const guide = read("../src/components/GettingStarted.tsx");
const customerScene = read("../src/components/CustomerJourneyScene.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const brandAssets = read("../src/lib/aea-brand-assets.mjs");
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
const planPdfButton = read("../src/components/DownloadCustomerPlanPdfButton.tsx");
const planPdfClient = read("../src/lib/customer-plan-pdf-client.ts");
const newProjectRoute = read("../src/app/account/projects/new/page.tsx");
const gettingStartedRoute = read("../src/app/getting-started/page.tsx");
const layout = read("../src/app/layout.tsx");
const robots = read("../src/app/robots.ts");
const sitemap = read("../src/app/sitemap.ts");
const manifest = read("../src/app/manifest.ts");
const socialAsset = path.resolve(directory, "../public/aea-home-energy-plan-og-v2.png");

test("site navigation and customer reports share one exact AEA brandmark", () => {
  assert.match(
    chrome,
    /import \{ AEA_BRANDMARK_PNG_DATA_URI \} from "@\/lib\/aea-brand-assets\.mjs"/,
  );
  assert.doesNotMatch(chrome, /data:image\/png;base64/);
  assert.equal(
    brandAssets.match(/data:image\/png;base64/g)?.length,
    1,
  );
});

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
  assert.match(chrome, /href: "\/calculator", label: "Rebate calculator"/);
  assert.match(chrome, /href: "\/compare", label: "Electricity compare"/);
  assert.match(chrome, /href: "\/gas-compare", label: "Gas compare"/);
  assert.match(chrome, /href: "\/guides", label: "Guides and rebates"/);
  assert.match(chrome, /href="\/direct-trade\/dashboard" aria-label="Open TLink trade login"/);
  assert.match(chrome, /TLinkMark className="site-tlink-mark"/);
  assert.match(guide, /href="\/calculator"[\s\S]*estimate a rebate/);
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

test("shared navigation never clips its first destination and explains mobile overflow", () => {
  assert.match(chrome, /className="site-nav-shell"/);
  assert.match(chrome, /className="site-nav-discovery" id="site-nav-discovery"/);
  assert.match(chrome, /aria-describedby="site-nav-discovery"/);
  assert.match(chrome, /Energy services/);
  assert.match(chrome, /Scroll for more options/);
  assert.match(
    styles,
    /\.comparator-nav \{[^}]*justify-content: flex-start;[^}]*overflow-x: auto;/,
  );
  assert.doesNotMatch(
    styles,
    /\.comparator-nav \{[^}]*justify-content: flex-end;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1320px\) \{[\s\S]*?\.site-nav-discovery \{[^}]*display: flex;/,
  );
  assert.match(styles, /\.site-nav-shell::after \{[^}]*linear-gradient/);
  assert.match(styles, /\.comparator-nav \{[^}]*padding: 2px 34px 5px 2px;/);
  assert.match(styles, /scroll-snap-type: x proximity/);
  assert.match(styles, /\.comparator-nav a \{ scroll-snap-align: start; \}/);
});

test("direct trade proposition presents the free verified operating model honestly", () => {
  assert.match(guide, /Traditional upgrade channels can include sales and administration businesses/);
  assert.match(guide, /Quotes should separate equipment, labour, certificates or rebates/);
  assert.match(guide, /TLink gives approved trade businesses the core operating tools at A\$0/);
  assert.match(guide, /Household details remain protected, individual leads are not sold and placement is not auctioned/);
  assert.doesNotMatch(guide, /Live service, expanding tool|direct-trade-status/);
});

test("direct trade marketplace includes reputable wholesalers", () => {
  assert.match(guide, /For licensed installers and reputable suppliers/);
  assert.match(guide, /reputable suppliers (?:can|to) connect proven products with qualified trades and suitable households/i);
});

test("TLink approval does not imply government accreditation", () => {
  assert.match(guide, /TLink approval is not a government accreditation/);
  assert.match(guide, /submitted ABN and required business evidence passed the TLink review/);
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

test("radios and checkboxes use one accessible site wide control language", () => {
  assert.match(styles, /body input\[type="radio"\],[\s\S]*body input\[type="checkbox"\] \{[\s\S]*appearance: none/);
  assert.match(styles, /body input\[type="radio"\] \{ border-radius: 50%; \}/);
  assert.match(styles, /body input\[type="checkbox"\] \{ border-radius: 5px; \}/);
  assert.match(styles, /body input\[type="radio"\]:checked,[\s\S]*background-color: var\(--color-aea-green\)/);
  assert.match(styles, /body input\[type="checkbox"\]:focus-visible/);
  assert.match(styles, /@media \(forced-colors: active\)/);
});

test("number fields avoid browser-specific black stepper controls", () => {
  assert.match(styles, /body input\[type="number"\] \{[\s\S]*appearance: textfield/);
  assert.match(styles, /body input\[type="number"\]::\-webkit-inner-spin-button,[\s\S]*\-webkit-appearance: none/);
});

test("homepage uses an accessible lightweight spatial journey with a reduced-motion boundary", () => {
  assert.match(guide, /CustomerJourneyScene/);
  assert.match(customerScene, /aria-labelledby="customer-journey-title"/);
  assert.match(customerScene, /Understand/);
  assert.match(customerScene, /Prioritise/);
  assert.match(customerScene, /Take action/);
  assert.match(customerScene, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(customerScene, /<canvas|WebGL|from ["']three["']/);
  assert.match(styles, /@supports \(animation-timeline: view\(\)\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.customer-scene-home/);
});

test("social sharing metadata uses one launch-ready AEA energy card", () => {
  assert.match(layout, /openGraph:/);
  assert.match(layout, /twitter:/);
  assert.match(layout, /\/aea-home-energy-plan-og-v2\.png/);
  assert.equal(fs.existsSync(socialAsset), true);
  assert.ok(fs.statSync(socialAsset).size > 100_000);
  assert.ok(fs.statSync(socialAsset).size < 3_000_000);
});

test("public discovery metadata is complete and private operations stay excluded", () => {
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /themeColor: "#03192d"/);
  assert.match(robots, /\/operations\//);
  assert.match(robots, /\/api\//);
  assert.match(robots, /sitemap\.xml/);
  assert.match(sitemap, /\/direct-trade\/access/);
  assert.doesNotMatch(sitemap, /\/operations/);
  assert.match(manifest, /display: "standalone"/);
});

test("static pages avoid a global client navigation bundle", () => {
  assert.doesNotMatch(layout, /FastNavigation/);
  assert.doesNotMatch(styles, /route-loading/);
  assert.match(styles, /content-visibility: auto/);
  assert.match(styles, /contain-intrinsic-size: auto 520px/);
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

test("homepage makes the guided plan the only dominant hero action", () => {
  const heroActions = guide.match(/<div className="start-actions">([\s\S]*?)<\/div>/)?.[1] || "";
  assert.equal(heroActions.match(/<a\b/g)?.length, 1);
  assert.match(heroActions, /start-primary-action[\s\S]*Build my home energy plan/);
  assert.doesNotMatch(heroActions, /ghost|Compare energy plans/);
  assert.match(guide, /className="start-hero-secondary"/);
});

test("getting-started copy preserves comparison and privacy boundaries", () => {
  assert.match(guide, /Mains gas plans only, not LPG/);
  assert.match(guide, /Your plan and meter file stay on your device/);
  assert.match(guide, /not included in saved links or enquiry data/);
  assert.match(guide, /Estimates are indicative/);
  assert.doesNotMatch(guide, /[–—]/);
});

test("integrated planner is private, ordered and responsive", () => {
  assert.match(plannerRoute, /No account, address, bill, postcode, meter identifier or contact/);
  assert.match(plannerRoute, /createCustomerProjectPlan/);
  assert.match(planner, /createCustomerProjectPlan/);
  assert.match(planner, /Do you own or rent the home\?/);
  assert.match(planner, /Questions that could change the order/);
  assert.match(planner, /Why this is in the plan/);
  assert.match(planner, /What would make the biggest difference/);
  assert.match(planner, /type="checkbox"/);
  assert.match(planner, /Do you own or rent the home/);
  assert.match(planner, /Do you live in an apartment complex\?/);
  assert.match(planner, /body corporate or owners corporation approval/);
  assert.match(planner, /What investment range feels comfortable for the first stage/);
  assert.match(plannerRoute, /One question at a time/);
  assert.match(planner, /HomeFeatureIntake/);
  assert.match(planner, /sectionId=\{currentStep\.featureSection\}/);
  assert.match(planner, /questionId=\{currentStep\.featureQuestion\}/);
  assert.match(planner, /Skip remaining home details/);
  assert.match(planner, /role="progressbar"/);
  assert.match(planner, /className="planner-stage-nav" aria-label="Planning stages"/);
  assert.match(planner, /className="planner-next-move"/);
  assert.match(planner, /Start here/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.planner-stage-nav \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); min-width: 0; \}/);
  assert.match(planner, /initialPlannerStep\(initialSelection\)/);
  assert.match(planner, /aria-live="polite"/);
  assert.match(planner, /Before committing/);
  assert.match(planner, /Open my printable plan/);
  assert.match(planner, /Start over/);
  assert.doesNotMatch(planner, /createHomeEnergyPlan|homeEnergyPlanOptions/);
  assert.doesNotMatch(planner, /params\.(?:set|append)\("postcode"/);
  assert.doesNotMatch(planner, /target="_blank"/);
  assert.doesNotMatch(planner, /window\.print/);
  assert.match(plannerPrintRoute, /DownloadCustomerPlanPdfButton/);
  assert.match(
    plannerPrintRoute,
    /<DownloadCustomerPlanPdfButton\s+report=\{report\}\s*\/>/,
  );
  assert.doesNotMatch(plannerPrintRoute, /PrintRoadmapButton/);
  assert.match(planPdfButton, /downloadCustomerPlanPdf\(report\)/);
  assert.match(planPdfButton, /Download PDF/);
  assert.doesNotMatch(planPdfButton, /window\.print/);
  assert.doesNotMatch(planPdfClient, /window\.print/);
  assert.doesNotMatch(planPdfClient, /createElement\("iframe"\)|srcdoc/);
  assert.match(plannerPrintRoute, /createCustomerProjectPlan/);
  assert.match(plannerPrintRoute, /robots: \{ index: false, follow: false \}/);
  assert.match(plannerRoute, /initialSelection=/);
  assert.match(plannerPrintRoute, /returnParams\.append\("feature", item\)/);
  assert.match(plannerPrintRoute, /returnParams\.append\("goal", item\)/);
  assert.doesNotMatch(plannerPrintRoute, /params\.postcode|params\.room|params\.evidence/);
  assert.match(newProjectRoute, /goals = values\(query\.goal, 10\)/);
  assert.match(newProjectRoute, /MAX_HOME_FEATURE_SELECTIONS/);
  assert.match(newProjectRoute, /normalizeHomeFeatureSelections/);
  assert.match(newProjectRoute, /approvalContext: controlledValue\(/);
  assert.match(newProjectRoute, /budgetRange: controlledValue\(/);
  assert.match(newProjectRoute, /addressState: controlledValue\(/);
  assert.match(newProjectRoute, /postcode: postcode &&/);
  assert.match(styles, /\.planner-layout \{[^}]*grid-template-columns:/);
  assert.match(styles, /\.planner-progress-shell \{[^}]*position: sticky;/);
  assert.match(styles, /\.planner-step-card \{[^}]*min-height:/);
  assert.match(styles, /\.planner-results-heading h2,[^}]*overflow-wrap: anywhere;/);
  assert.match(styles, /\.planner-results \.planner-result-actions button, \.planner-results \.planner-result-actions a \{[^}]*color: #fff;/);
  assert.doesNotMatch(styles, /background-attachment: fixed/);
  assert.match(styles, /@media print \{/);
  assert.match(styles, /@media \(max-width: 1080px\) \{[\s\S]*?\.planner-layout \{ grid-template-columns: 1fr; \}/);
});
