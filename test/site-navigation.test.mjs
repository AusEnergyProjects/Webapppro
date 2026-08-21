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
const plannerJourney = read("../src/components/PlannerHomeJourney.tsx");
const holographicField = read("../src/components/HolographicEnergyField.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const responsiveNav = read("../src/components/ResponsiveSiteNav.tsx");
const surgeHeaderButton = read("../src/components/SurgeHeaderButton.tsx");
const surgeRoute = read("../src/app/surge/page.tsx");
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
const plannerStyles = read("../src/components/HomeEnergyPlanner.module.css");
const plannerIntakeStyles = read("../src/components/HomeFeatureIntake.module.css");
const plannerRoute = read("../src/app/plan/page.tsx");
const plannerPrintRoute = read("../src/app/plan/print/page.tsx");
const planPdfButton = read("../src/components/DownloadCustomerPlanPdfButton.tsx");
const planPdfClient = read("../src/lib/customer-plan-pdf-client.ts");
const newProjectRoute = read("../src/app/account/projects/new/page.tsx");
const gettingStartedRoute = read("../src/app/getting-started/page.tsx");
const layout = read("../src/app/layout.tsx");
const legacyComparator = read("../public/electricity-comparator.html");
const customerAndToolTypography = [
  "CustomerDraftDeleteDialog.module.css",
  "CustomerInstallerRequestDialog.module.css",
  "CustomerPlanHistoryProgress.module.css",
  "CustomerPlanReportPreviewDialog.module.css",
  "CustomerProjectPhotoCapture.module.css",
  "EnergyAssistantWidget.module.css",
  "HomeFeatureIntake.module.css",
  "JobInformationUpload.module.css",
  "TradeJobPacketWorkspace.module.css",
  "TradePhotoRequestPanel.module.css",
  "TradePhotoTemplateLibrary.module.css",
  "TradePriceBookWorkspace.module.css",
].map((file) => read(`../src/components/${file}`)).join("\n");
const robots = read("../src/app/robots.ts");
const sitemap = read("../src/app/sitemap.ts");
const manifest = read("../src/app/manifest.ts");
const socialAsset = path.resolve(directory, "../public/aea-home-energy-plan-og-v2.png");
const immersiveHomeAsset = path.resolve(directory, "../public/aea-immersive-home-journey.png");

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
  assert.match(chrome, /import \{ SurgeHeaderButton \} from "@\/components\/SurgeHeaderButton"/);
  assert.match(chrome, /<SurgeHeaderButton active=\{active === "surge"\} \/>/);
  assert.match(chrome, /href: "\/", label: "Start"/);
  assert.match(chrome, /href: "\/plan", label: "My energy plan"/);
  assert.match(chrome, /href: "\/calculator", label: "Rebate calculator"/);
  assert.match(chrome, /href: "\/compare", label: "Electricity compare"/);
  assert.match(chrome, /href: "\/gas-compare", label: "Gas compare"/);
  assert.match(chrome, /href: "\/guides", label: "Guides and rebates"/);
  assert.match(chrome, /href="\/direct-trade\/dashboard"[\s\S]*?aria-label="Open the TLink trade workspace"/);
  assert.match(chrome, /className="site-tlink-mark" src="\/tlink-icon-192\.png"/);
  assert.match(chrome, /className="site-tlink-copy"[\s\S]*<strong>TLink<\/strong>[\s\S]*<small>Trade workspace<\/small>/);
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

test("the futuristic header links to one dedicated always-present Surge AI page", () => {
  assert.equal(chrome.match(/<SurgeHeaderButton active=\{active === "surge"\} \/>/g)?.length, 1);
  assert.doesNotMatch(chrome, /EnergyAssistantWidget|requestSurgeOpen/);
  assert.match(surgeHeaderButton, /href="\/surge"/);
  assert.match(surgeHeaderButton, /active = false/);
  assert.match(surgeHeaderButton, /aria-current=\{active \? "page" : undefined\}/);
  assert.doesNotMatch(surgeHeaderButton, /requestSurgeOpen|onClick|aria-haspopup|aria-controls|type="button"/);
  assert.match(surgeHeaderButton, /aria-label="Open Surge AI energy guide"/);
  assert.match(surgeHeaderButton, /className=\{`site-surge-link\$\{active \? " active" : ""\}`\}/);
  assert.match(surgeHeaderButton, /className="site-surge-core"/);
  assert.match(surgeHeaderButton, /src="\/surge-mascot\.png"[\s\S]*?width="28" height="35"/);
  assert.match(surgeHeaderButton, /eslint-disable @next\/next\/no-img-element/);
  assert.match(surgeHeaderButton, /className="site-surge-copy"[\s\S]*?<strong>Surge AI<\/strong>/);
  assert.match(surgeHeaderButton, /className="site-surge-status"[\s\S]*?>AI guide<\/span>/);
  assert.match(surgeRoute, /SiteHeader active="surge"/);
  assert.match(surgeRoute, /Surge AI \| Australian Energy Assessments/);
  assert.match(styles, /\.site-surge-link \{[^}]*min-height: 44px;/);
  assert.match(styles, /\.site-surge-link\.active \{/);
  assert.match(styles, /\.site-surge-core \{[^}]*animation: site-surge-pulse/);
  assert.match(styles, /\.site-surge-core::before \{[^}]*animation: site-surge-spin/);
  assert.match(styles, /\.site-surge-core img \{[^}]*filter: drop-shadow/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.site-surge-link \{ min-height: 40px;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.site-header::before, \.site-header::after, \.site-surge-core, \.site-surge-core::before \{ animation: none !important; \}/);
  assert.match(styles, /@media \(forced-colors: active\) \{[\s\S]*?\.site-surge-link, \.site-tlink-link \{ border: 1px solid ButtonText;/);
});

test("public navigation keeps the TLink trade workspace clearly branded", () => {
  assert.match(chrome, /active === "account" \? \([\s\S]*?<a className="site-account-link active" href="\/account"/);
  assert.match(chrome, /href="\/direct-trade\/dashboard"[\s\S]*?aria-label="Open the TLink trade workspace"/);
  assert.match(chrome, /title="TLink trade workspace"/);
  assert.equal(chrome.match(/href="\/account"/g)?.length, 1);
  assert.match(guide, /No account is needed to build a plan or send an enquiry to matching trades/);
  assert.match(guide, /Ask matching trades/);
  assert.doesNotMatch(guide, /account is optional|Save or ask trades|Create an account after seeing your roadmap/);
});

test("desktop navigation shows every option while mobile keeps a compact scrollable row", () => {
  assert.match(chrome, /<ResponsiveSiteNav>/);
  assert.match(responsiveNav, /aria-label="Primary navigation"/);
  assert.doesNotMatch(responsiveNav, /Energy services|Scroll for more options|ResizeObserver|MutationObserver|hasHiddenOptions/);
  assert.match(
    styles,
    /\.comparator-nav \{[^}]*justify-content: flex-start;[^}]*overflow-x: auto;/,
  );
  assert.doesNotMatch(
    styles,
    /\.comparator-nav \{[^}]*justify-content: flex-end;/,
  );
  assert.doesNotMatch(styles, /site-nav-discovery|has-hidden-options/);
  assert.match(styles, /@media \(min-width: 721px\) \{[\s\S]*?\.site-header \.comparator-nav \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(8, minmax\(0, 1fr\)\);[^}]*overflow: visible;/);
  assert.match(
    styles,
    /\.site-header \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto; \}/,
  );
  assert.match(
    styles,
    /\.site-header \.site-nav-shell \{ grid-column: 1 \/ -1; grid-row: 2;[^}]*width: 100%; \}/,
  );
  assert.match(
    styles,
    /@media \(max-width: 520px\) \{[\s\S]*?\.site-header-actions \{[^}]*display: flex;[^}]*grid-column: 2;[^}]*grid-row: 1;/,
  );
  assert.match(
    styles,
    /\.site-header-actions \.site-account-link \{[^}]*grid-column: auto;[^}]*grid-row: auto;/,
  );
  assert.match(styles, /\.site-header-actions \.site-account-link \{[^}]*flex: 0 0 40px;[^}]*font-size: 0;[^}]*width: 40px;/);
  assert.match(styles, /\.site-header-actions \.site-account-link span \{ display: inline; font-size: \.62rem; \}/);
});

test("direct trade proposition presents the free verified operating model honestly", () => {
  assert.match(guide, /Traditional upgrade channels can include sales and administration businesses/);
  assert.match(guide, /Quotes should separate equipment, labour, certificates or rebates/);
  assert.match(guide, /Australian Energy Assessments gives approved trade businesses the core operating tools at A\$0/);
  assert.match(guide, /Household details remain protected, individual leads are not sold and placement is not auctioned/);
  assert.doesNotMatch(guide, /Live service, expanding tool|direct-trade-status/);
});

test("direct trade marketplace includes reputable wholesalers", () => {
  assert.match(guide, /For licensed installers and reputable suppliers/);
  assert.match(guide, /reputable suppliers (?:can|to) connect proven products with qualified trades and suitable households/i);
});

test("trade workspace approval does not imply government accreditation", () => {
  assert.match(guide, /Trade workspace approval is not a government accreditation/);
  assert.match(guide, /submitted ABN and required business evidence passed the Australian Energy Assessments review/);
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
  assert.doesNotMatch(layout, /fonts\.(?:googleapis|gstatic)\.com/);
  assert.match(styles, /--font-aea-body: Arial, "Helvetica Neue", Helvetica, system-ui, sans-serif/);
  assert.match(styles, /--font-aea-heading: Arial, "Helvetica Neue", Helvetica, system-ui, sans-serif/);
  assert.match(styles, /--font-aea-wordmark: Georgia, "Times New Roman", serif/);
  assert.match(styles, /\.brandname \{[^}]*font-family: var\(--font-aea-wordmark\)/);
  assert.equal(styles.match(/font-family: var\(--font-aea-wordmark\)/g)?.length, 1);
  assert.doesNotMatch(styles, /\.electricity-comparison-page \.brandname/);
  assert.doesNotMatch(`${styles}\n${customerAndToolTypography}\n${legacyComparator}`, /Source Serif|Georgia, serif|font-family:'Lato'/);
  assert.match(styles, /\.site-header \{/);
  assert.match(styles, /\.site-header \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.site-header \{ display: grid;[^}]*overflow: hidden;/);
  assert.match(styles, /\.site-header \.site-nav-shell \{[^}]*grid-column: 1 \/ -1; grid-row: 2;/);
  assert.match(styles, /@keyframes site-header-atmosphere/);
  assert.match(styles, /@keyframes site-header-sheen/);
  assert.match(styles, /@keyframes site-surge-pulse/);
  assert.match(styles, /@keyframes site-surge-spin/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.site-header::after \{ display: none; \}/);
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

test("homepage uses an accessible progressive holographic journey with a reduced-motion boundary", () => {
  assert.match(guide, /CustomerJourneyScene/);
  assert.match(customerScene, /aria-labelledby="customer-journey-title"/);
  assert.match(customerScene, /Understand/);
  assert.match(customerScene, /Prioritise/);
  assert.match(customerScene, /Take action/);
  assert.match(customerScene, /prefers-reduced-motion: reduce/);
  assert.match(customerScene, /HolographicEnergyField/);
  assert.match(holographicField, /<canvas/);
  assert.match(holographicField, /prefers-reduced-motion: reduce/);
  assert.match(holographicField, /ResizeObserver/);
  assert.match(holographicField, /devicePixelRatio/);
  assert.match(holographicField, /seededRandom\(0xa3e2026\)/);
  assert.match(holographicField, /data-spatial-scene/);
  assert.match(holographicField, /pointermove/);
  assert.match(holographicField, /addEventListener\("scroll"/);
  assert.match(customerScene, /density="rich"/);
  assert.match(customerScene, /mode="landing"/);
  assert.doesNotMatch(holographicField, /WebGL|from ["']three["']|video/i);
  assert.match(styles, /@supports \(animation-timeline: view\(\)\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.customer-scene-home/);
});

test("the generated whole-home scene is visible and drives the planner room journey", () => {
  assert.match(customerScene, /src="\/aea-immersive-home-journey\.png"/);
  assert.match(customerScene, /sizes="\(max-width: 720px\) 100vw, 55vw"/);
  assert.match(plannerJourney, /export function PlannerHomeJourney/);
  assert.match(plannerJourney, /stage: PlannerJourneyStage/);
  assert.match(plannerJourney, /focusKey\?: string/);
  assert.match(plannerJourney, /data-focus=\{activeFocus\}/);
  assert.match(plannerJourney, /sizes="\(max-width: 720px\) 110vw, 100vw"/);
  assert.match(plannerJourney, /ceiling-insulation|insulation/);
  assert.match(plannerJourney, /heating-cooling/);
  assert.match(plannerJourney, /hot-water/);
  assert.match(plannerJourney, /battery/);
  assert.match(plannerJourney, /aria-label="Home planning journey"/);
  assert.match(plannerJourney, /HolographicEnergyField/);
  assert.match(plannerJourney, /focusPositions/);
  assert.match(plannerJourney, /data-entry=\{safeProgress <= 5/);
  assert.match(plannerJourney, /density="rich"/);
  assert.match(plannerJourney, /mode=\{stage\}/);
  assert.match(plannerJourney, /Start with the question below/);
  assert.doesNotMatch(plannerJourney, /WebGL|from ["']three["']/);
  assert.match(styles, /\.planner-home-journey\[data-focus="insulation"\]/);
  assert.match(styles, /\.planner-home-journey\[data-focus="windows"\]/);
  assert.match(styles, /\.planner-home-journey\[data-focus="ventilation"\]/);
  assert.match(styles, /\.planner-home-journey\[data-focus="heating-cooling"\]/);
  assert.match(styles, /\.planner-home-journey\[data-focus="solar"\]/);
  assert.match(styles, /prefers-reduced-motion: reduce\)[\s\S]*\.planner-home-journey-depth/);
  assert.match(styles, /\.planner-home-journey\[data-entry="true"\] \{ min-height: clamp\(570px, 70svh, 780px\); \}/);
  assert.match(styles, /\.planner-home-journey\[data-stage="plan"\] \{ min-height: clamp\(540px, 62svh, 700px\); \}/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.planner-home-journey \{ min-height: 330px; \}/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.planner-home-journey\[data-entry="true"\] \{ min-height: 570px; \}/);
  assert.equal(fs.existsSync(immersiveHomeAsset), true);
  assert.ok(fs.statSync(immersiveHomeAsset).size > 100_000);
  assert.ok(fs.statSync(immersiveHomeAsset).size < 3_000_000);
  const immersiveImage = fs.readFileSync(immersiveHomeAsset);
  assert.equal(immersiveImage.toString("ascii", 1, 4), "PNG");
  assert.ok(immersiveImage.readUInt32BE(16) >= 1600);
  assert.ok(immersiveImage.readUInt32BE(20) >= 900);
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
  assert.match(sitemap, /\/surge/);
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
  assert.match(plannerRoute, /No account, address, bill, meter identifier or contact details/);
  assert.match(plannerRoute, /Four grouped steps use a postcode for local context/);
  assert.match(planner, /createCustomerProjectPlan/);
  assert.match(planner, /const PRIMARY_STAGE_COUNT = 4/);
  assert.match(planner, /Goal and household/);
  assert.match(planner, /Comfort and building/);
  assert.match(planner, /Current systems/);
  assert.match(planner, /Timing and review/);
  assert.match(planner, /Tell us about the household/);
  assert.match(planner, /How does the home feel and perform/);
  assert.match(planner, /What currently provides energy services/);
  assert.match(planner, /Choose timing, then review your answers/);
  assert.match(planner, /HomeFeatureIntake/);
  assert.match(planner, /questionId="comfort-concerns"/);
  assert.match(planner, /sectionId="hot-water-cooking"/);
  assert.match(planner, /Not sure is a valid answer/);
  assert.match(planner, /Home size and construction/);
  assert.match(planner, /Wall and floor insulation/);
  assert.match(planner, /Window coverings and shade/);
  assert.match(planner, /Draughts and ventilation/);
  assert.match(planner, /Electricity supply and other loads/);
  assert.doesNotMatch(planner, /Optional advanced home details/);
  assert.match(planner, /window\.sessionStorage\.getItem\(HOME_ENERGY_ASSESSMENT_STORAGE_KEY\)/);
  assert.match(planner, /window\.sessionStorage\.setItem\(HOME_ENERGY_ASSESSMENT_STORAGE_KEY/);
  assert.match(planner, /role="progressbar"/);
  assert.doesNotMatch(planner, /<PlannerHomeJourney/);
  assert.match(plannerStyles, /@media \(max-width: 720px\)/);
  assert.match(plannerStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(plannerStyles, /min-height: 3\.25rem/);
  assert.match(plannerStyles, /--home-feature-section-background: transparent/);
  assert.match(plannerStyles, /--home-feature-choice-background: #082431/);
  assert.match(plannerStyles, /--home-feature-choice-selected-background: #0b594e/);
  assert.match(plannerIntakeStyles, /background: var\(--home-feature-section-background/);
  assert.match(plannerIntakeStyles, /background: var\(--home-feature-choice-background/);
  assert.match(plannerIntakeStyles, /background: var\(--home-feature-choice-selected-background/);
  assert.doesNotMatch(planner, /\bAEA\b/);
  assert.match(planner, /className="planner-next-move"/);
  assert.match(planner, /Why this is in the plan/);
  assert.match(planner, /No dollar saving is invented without bill, tariff and equipment evidence/);
  assert.match(planner, /aria-live="polite"/);
  assert.match(planner, /Before committing/);
  assert.match(planner, /Start electricity comparison/);
  assert.match(planner, /Start gas comparison/);
  assert.match(planner, /Open rebate calculator/);
  assert.match(planner, /View rebates and assistance/);
  assert.match(planner, /Open my printable plan/);
  assert.match(planner, /Start over/);
  assert.doesNotMatch(planner, /createHomeEnergyPlan|homeEnergyPlanOptions/);
  assert.doesNotMatch(planner, /target="_blank"|window\.print/);
  assert.match(plannerPrintRoute, /DownloadCustomerPlanPdfButton/);
  assert.match(plannerPrintRoute, /<DownloadCustomerPlanPdfButton\s+report=\{report\}\s*\/>/);
  assert.doesNotMatch(plannerPrintRoute, /PrintRoadmapButton/);
  assert.match(planPdfButton, /await downloadCustomerPlanPdf\(report\)/);
  assert.match(planPdfButton, /Download PDF/);
  assert.match(planPdfClient, /export async function downloadCustomerPlanPdf\(/);
  assert.match(planPdfClient, /await fetch\("\/api\/customer-plan-pdf"/);
  assert.match(planPdfClient, /method: "POST"/);
  assert.match(planPdfClient, /application\/x-www-form-urlencoded/);
  assert.match(planPdfClient, /URL\.createObjectURL\(blob\)/);
  assert.match(planPdfClient, /link\.click\(\)/);
  assert.match(planPdfClient, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(plannerPrintRoute, /createCustomerProjectPlan/);
  assert.match(plannerPrintRoute, /robots: \{ index: false, follow: false \}/);
  assert.match(plannerRoute, /initialSelection=/);
  assert.match(plannerPrintRoute, /returnParams\.append\("feature", item\)/);
  assert.match(plannerPrintRoute, /returnParams\.append\("goal", item\)/);
  assert.match(plannerPrintRoute, /returnParams\.set\("postcode", suppliedPostcode\)/);
  assert.match(newProjectRoute, /goals = values\(query\.goal, 10\)/);
  assert.match(newProjectRoute, /MAX_HOME_FEATURE_SELECTIONS/);
  assert.match(newProjectRoute, /normalizeHomeFeatureSelections/);
  assert.match(newProjectRoute, /postcode: postcode &&/);
  assert.match(styles, /\.planner-results-heading h2,[^}]*overflow-wrap: anywhere;/);
  assert.match(styles, /@media print \{/);
  assert.match(styles, /\.planner-page \{ max-width: var\(--layout-max\);/);
  assert.match(styles, /\.planner-result-decision \{[^}]*grid-template-columns:/);
  assert.match(styles, /\.planner-quick-wins-grid \{[^}]*grid-template-columns:/);
});
