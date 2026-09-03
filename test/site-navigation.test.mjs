import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const home = read("../src/app/page.tsx");
const guide = read("../src/components/GettingStarted.tsx");
const guideStyles = read("../src/components/AssessmentBooking.module.css");
const homepageCalendly = read("../src/components/HomepageCalendlyEmbed.tsx");
const customerScene = read("../src/components/CustomerJourneyScene.tsx");
const plannerJourneyPath = path.resolve(directory, "../src/components/PlannerHomeJourney.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const publicSiteSearch = read("../src/components/PublicSiteSearch.tsx");
const publicSiteSearchStyles = read("../src/components/PublicSiteSearch.module.css");
const publicSiteSearchIndex = read("../src/lib/public-site-search.ts");
const responsiveNav = read("../src/components/ResponsiveSiteNav.tsx");
const surgeHeaderButton = read("../src/components/SurgeHeaderButton.tsx");
const wattzunRoute = read("../src/app/wattzun/page.tsx");
const legacySurgeRoute = read("../src/app/surge/page.tsx");
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
const plannerSchema = read("../src/lib/home-energy-planner-schema.ts");
const plannerStyles = read("../src/components/HomeEnergyPlanner.module.css");
const plannerIntakeStyles = read("../src/components/HomeFeatureIntake.module.css");
const plannerRoute = read("../src/app/plan/page.tsx");
const plannerPrintRoute = read("../src/app/plan/print/page.tsx");
const planPdfButton = read("../src/components/DownloadCustomerPlanPdfButton.tsx");
const planPdfClient = read("../src/lib/customer-plan-pdf-client.ts");
const newProjectRoute = read("../src/app/account/projects/new/page.tsx");
const gettingStartedRoute = read("../src/app/getting-started/page.tsx");
const layout = read("../src/app/layout.tsx");
const directTradeLayout = read("../src/app/direct-trade/layout.tsx");
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
const surgeHomeAsset = path.resolve(directory, "../public/surge-command-centre-home.webp");

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
  assert.match(chrome, /href: "\/", label: "Home"/);
  assert.match(chrome, /href: "\/plan", label: "My energy plan"/);
  assert.match(chrome, /href: "\/calculator", label: "Rebate calculator"/);
  assert.match(chrome, /href: "\/compare", label: "Electricity compare"/);
  assert.match(chrome, /href: "\/gas-compare", label: "Gas compare"/);
  assert.match(chrome, /href: "\/guides", label: "Guides and rebates"/);
  assert.match(chrome, /href="\/direct-trade\/dashboard"[\s\S]*?aria-label="Open TLink"/);
  assert.match(chrome, /className="site-tlink-mark" src="\/tlink-icon-192\.png"/);
  assert.match(chrome, /className="site-tlink-copy"><strong>TLink<\/strong><\/span>/);
  assert.doesNotMatch(chrome, /Trade workspace/);
  assert.match(guide, /href="\/calculator"[\s\S]*estimate a rebate/);
  assert.match(chrome, /href: "\/assessments", label: "NatHERS & ratings"/);
  assert.match(assessments, /SiteHeader active="assessments"/);
  assert.match(electricity, /SiteHeader active="electricity"/);
  assert.match(gas, /SiteHeader active="gas"/);
  assert.match(plannerRoute, /SiteHeader active="plan"/);
  assert.match(plannerRoute, /HomeEnergyPlanner/);
  assert.match(rebatesRoute, /RebatesHub/);
  assert.match(rebates, /SiteHeader active="rebates"/);
  assert.match(guide, /href="\/rebates"/);
  assert.match(gettingStartedRoute, /permanentRedirect\("\/plan"\)/);
});

test("the shared header includes private, typo-tolerant predictive page search", () => {
  assert.match(chrome, /import \{ PublicSiteSearch \} from "@\/components\/PublicSiteSearch"/);
  assert.match(chrome, /<BrandBar \/>[\s\S]*?<PublicSiteSearch \/>[\s\S]*?<SiteNav active=\{active\} \/>/);
  assert.match(publicSiteSearch, /^"use client";/);
  assert.match(publicSiteSearch, /role="search"/);
  assert.match(publicSiteSearch, /type="search"/);
  assert.match(publicSiteSearch, /role="combobox"/);
  assert.match(publicSiteSearch, /aria-label="Search Australian Energy Assessments"/);
  assert.match(publicSiteSearch, /aria-autocomplete="list"/);
  assert.match(publicSiteSearch, /aria-activedescendant=/);
  assert.match(publicSiteSearch, /role="listbox"/);
  assert.match(publicSiteSearch, /role="option"/);
  assert.match(publicSiteSearch, /event\.key === "ArrowDown"/);
  assert.match(publicSiteSearch, /event\.key === "ArrowUp"/);
  assert.match(publicSiteSearch, /event\.key === "Enter"/);
  assert.match(publicSiteSearch, /event\.key === "Escape"/);
  assert.match(publicSiteSearch, /router\.prefetch\(results\[activeIndex >= 0 \? activeIndex : 0\]\.path\)/);
  assert.match(publicSiteSearch, /onFocus=\{\(\) => router\.prefetch\(result\.path\)\}/);
  assert.match(publicSiteSearchIndex, /damerauLevenshtein/);
  assert.match(publicSiteSearchIndex, /path: "\/nathers-for-new-homes"/);
  assert.match(publicSiteSearchIndex, /path: "\/home-energy-rating-for-existing-homes"/);
  assert.doesNotMatch(publicSiteSearchIndex, /path: "\/(?:account|operations|creditex|direct-trade\/dashboard)/);
  assert.doesNotMatch(publicSiteSearch, /\bfetch\(|localStorage|sessionStorage|gtag|dataLayer/);
  assert.match(styles, /\.site-header \{ display: grid; grid-template-columns: auto minmax\(150px, 1fr\) auto;[^}]*overflow: visible;[^}]*z-index: 40;/);
  assert.match(styles, /\.public-site-search \{ grid-column: 2; grid-row: 1; \}/);
  assert.match(publicSiteSearchStyles, /\.root \{[^}]*max-width: 360px;/);
  assert.match(styles, /\.site-header-actions \{[^}]*grid-column: 3; grid-row: 1;/);
  assert.match(styles, /\.site-header > \.public-site-search \{ z-index: 4; \}/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.public-site-search \{[^}]*grid-column: 2; grid-row: 1;[\s\S]*?\.site-header-actions \{[^}]*grid-column: 1 \/ -1; grid-row: 2;[\s\S]*?\.site-header \.site-nav-shell \{[^}]*grid-column: 1 \/ -1; grid-row: 3;/);
  assert.match(publicSiteSearchStyles, /@media \(max-width: 360px\) \{[\s\S]*?\.root \{[^}]*max-width: 44px;[\s\S]*?\.root:focus-within/);
  assert.match(publicSiteSearchStyles, /@media \(forced-colors: active\) \{[\s\S]*?\.field,[\s\S]*?\.results \{[\s\S]*?border: 1px solid ButtonText;/);
});

test("the futuristic header links to one dedicated always-present Wattzun AI page", () => {
  assert.equal(chrome.match(/<SurgeHeaderButton active=\{active === "surge"\} \/>/g)?.length, 1);
  assert.doesNotMatch(chrome, /EnergyAssistantWidget|requestSurgeOpen/);
  assert.match(surgeHeaderButton, /href="\/wattzun"/);
  assert.match(surgeHeaderButton, /active = false/);
  assert.match(surgeHeaderButton, /aria-current=\{active \? "page" : undefined\}/);
  assert.doesNotMatch(surgeHeaderButton, /requestSurgeOpen|onClick|aria-haspopup|aria-controls|type="button"/);
  assert.match(surgeHeaderButton, /aria-label="Open Wattzun AI energy guide"/);
  assert.match(surgeHeaderButton, /className=\{`site-surge-link\$\{active \? " active" : ""\}`\}/);
  assert.match(surgeHeaderButton, /className="site-surge-core"/);
  assert.match(surgeHeaderButton, /src="\/surge-mascot\.webp"[\s\S]*?width="28" height="35"/);
  assert.doesNotMatch(surgeHeaderButton, /prefetch=\{false\}/);
  assert.match(surgeHeaderButton, /eslint-disable @next\/next\/no-img-element/);
  assert.match(surgeHeaderButton, /className="site-surge-copy"[\s\S]*?<strong>Wattzun AI<\/strong>/);
  assert.doesNotMatch(surgeHeaderButton, /Energy upgrade guide|site-surge-copy"[\s\S]{0,120}<small>/);
  assert.doesNotMatch(surgeHeaderButton, /site-surge-status|AI guide/);
  assert.match(wattzunRoute, /SiteHeader active="surge"/);
  assert.match(wattzunRoute, /Wattzun AI \| Australian Energy Assessments/);
  assert.match(wattzunRoute, /buildPlatformMetadata\(\{[\s\S]*?path: "\/wattzun"/);
  assert.match(legacySurgeRoute, /permanentRedirect\("\/wattzun"\)/);
  assert.match(styles, /\.site-surge-link, \.site-tlink-link, \.site-book-link, \.site-call-link \{[^}]*flex: 0 0 116px;[^}]*min-height: 44px;/);
  assert.match(styles, /\.site-surge-link\.active \{/);
  assert.match(styles, /\.site-surge-core \{[^}]*box-shadow:/);
  assert.doesNotMatch(styles, /animation: site-surge-(?:pulse|spin)/);
  assert.doesNotMatch(styles, /\.site-surge-core::before \{/);
  assert.match(styles, /\.site-surge-core img \{[^}]*filter: drop-shadow/);
  assert.match(styles, /\.site-surge-copy \{[^}]*flex: none;/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.site-surge-link, \.site-tlink-link, \.site-book-link, \.site-call-link \{[^}]*flex: 1 1 0;[^}]*min-height: 40px;[\s\S]*?\.site-surge-link \{[^}]*flex-grow: 1\.2;/);
  assert.match(styles, /@media \(max-width: 720px\) \{[\s\S]*?\.site-surge-core img \{[^}]*height: 31px;[^}]*width: auto;/);
  assert.match(styles, /@media \(max-width: 520px\) \{[\s\S]*?\.site-surge-link \{[^}]*flex-basis: 96px;[\s\S]*?\.site-tlink-link \{[^}]*flex-basis: 74px;[\s\S]*?\.site-book-link, \.site-call-link \{[^}]*flex-basis: 55px;/);
  assert.match(styles, /@media \(max-width: 360px\) \{[\s\S]*?\.site-header-actions \{[^}]*display: grid;[^}]*grid-template-columns: 1fr 1fr;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.site-header::before, \.site-surge-core, \.customer-journey-scene::after \{ animation: none !important; \}/);
  assert.match(styles, /@media \(forced-colors: active\) \{[\s\S]*?\.site-surge-link, \.site-tlink-link, \.site-book-link, \.site-call-link \{ border: 1px solid ButtonText;/);
});

test("public header pages are prepared before a click while private workspaces stay on demand", () => {
  const primaryNav = chrome.slice(chrome.indexOf("export function SiteNav"), chrome.indexOf("export function SiteHeader"));
  const bookLink = chrome.match(/<Link\s+className="site-book-link"[\s\S]*?<\/Link>/)?.[0] || "";
  const tlinkLink = chrome.match(/<Link\s+className="site-tlink-link"[\s\S]*?<\/Link>/)?.[0] || "";
  assert.doesNotMatch(primaryNav, /prefetch=\{false\}/);
  assert.doesNotMatch(bookLink, /prefetch=\{false\}/);
  assert.doesNotMatch(surgeHeaderButton, /prefetch=\{false\}/);
  assert.match(tlinkLink, /prefetch=\{false\}/);
  assert.match(chrome, /className="site-account-link active" href="\/account" prefetch=\{false\}/);
});

test("public navigation keeps TLink clearly branded", () => {
  assert.match(chrome, /active === "account" \? \([\s\S]*?<Link className="site-account-link active" href="\/account"/);
  assert.match(chrome, /href="\/direct-trade\/dashboard"[\s\S]*?aria-label="Open TLink"/);
  assert.match(chrome, /title="TLink"/);
  assert.match(styles, /\.site-tlink-mark \{[^}]*flex: 0 0 34px;[^}]*object-fit: contain;[^}]*width: 34px;/);
  assert.equal(chrome.match(/href="\/account"/g)?.length, 1);
  assert.match(guide, /contact matching trades without creating an account/);
  assert.match(guide, /Find matching trades/);
  assert.doesNotMatch(guide, /account is optional|Save or ask trades|Create an account after seeing your roadmap/);
});

test("header actions use the requested order, equal sizing and energy backdrop", () => {
  assert.match(chrome, /className="site-book-link"[\s\S]*?className="site-call-link"[\s\S]*?<SurgeHeaderButton[\s\S]*?className="site-tlink-link"/);
  assert.match(styles, /\.site-book-link \{[^}]*booking-energy-hero\.webp/);
  assert.match(styles, /\.site-call-link \{[^}]*booking-energy-hero\.webp/);
  assert.match(chrome, /href="\/book-an-assessment"[^>]*>[\s\S]*?Book now/);
  assert.doesNotMatch(chrome, />Book a 5-minute call<\/Link>/);
});

test("desktop navigation shows every option and mobile restores the compact swipe strip", () => {
  assert.match(chrome, /<ResponsiveSiteNav>/);
  assert.match(responsiveNav, /aria-label="Primary navigation"/);
  assert.match(responsiveNav, /className="site-nav-scroll-cue"[^>]*>Swipe/);
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
  assert.match(styles, /body\.aea-platform \.site-header \.site-nav-shell::after \{[^}]*linear-gradient/);
  assert.match(styles, /body\.aea-platform \.site-header \.site-nav-scroll-cue \{[^}]*display: flex;/);
  assert.match(styles, /@media \(min-width: 721px\) \{[\s\S]*?\.site-header \.comparator-nav \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(8, minmax\(0, 1fr\)\);[^}]*overflow: visible;/);
  assert.match(styles, /@media screen and \(max-width: 720px\) \{[\s\S]*?body\.aea-platform \.site-header \.comparator-nav \{[^}]*display: flex;[^}]*overflow-x: auto;[^}]*scroll-snap-type: x proximity;/);
  assert.match(styles, /body\.aea-platform \.site-header \.comparator-nav a \{[^}]*flex: 0 0 auto;[^}]*scroll-snap-align: start;[^}]*white-space: nowrap;/);
  assert.match(styles, /\.start-hero-planner \.start-hero-secondary \{[^}]*background: rgba\(2, 18, 34, \.94\);[^}]*padding: 10px 12px;/);
  assert.match(
    styles,
    /\.site-header \{ display: grid; grid-template-columns: auto minmax\(150px, 1fr\) auto;/,
  );
  assert.match(
    styles,
    /\.site-header \.site-nav-shell \{ grid-column: 1 \/ -1; grid-row: 2;[^}]*width: 100%; \}/,
  );
  assert.match(
    styles,
    /@media \(max-width: 720px\) \{[\s\S]*?\.site-header-actions \{[^}]*gap: 6px;[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;/,
  );
  assert.match(
    styles,
    /\.site-header-actions \.site-account-link \{[^}]*grid-column: auto;[^}]*grid-row: auto;/,
  );
  assert.match(styles, /\.site-header-actions \.site-account-link \{[^}]*flex: 0 0 40px;[^}]*font-size: 0;[^}]*width: 40px;/);
  assert.match(styles, /\.site-header-actions \.site-account-link span \{ display: inline; font-size: \.62rem; \}/);
});

test("direct trade proposition presents the free verified operating model honestly", () => {
  assert.match(guide, /Approved trade businesses can use the core TLink workspace free of charge/);
  assert.match(guide, /Household details stay private, leads are not sold and placement is not auctioned/);
  assert.doesNotMatch(guide, /sales and administration businesses|Bring verified capability/);
  assert.doesNotMatch(guide, /Live service, expanding tool|direct-trade-status/);
});

test("direct trade marketplace includes reputable wholesalers", () => {
  assert.match(guide, /For trades and suppliers/);
  assert.match(guide, /Reputable suppliers can show proven products to suitable trades and households/);
});

test("trade workspace approval does not imply government accreditation", () => {
  assert.match(guide, /Approval is not a licence or government accreditation/);
  assert.match(guide, /We review the ABN and business information provided by each applicant/);
  assert.match(guide, /Trades still need the licences, insurance, accreditations and scheme approvals required for each job/);
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

test("shared visual foundation uses the polished responsive system without persistent compositor effects", () => {
  assert.doesNotMatch(layout, /fonts\.(?:googleapis|gstatic)\.com/);
  assert.match(layout, /<body className="aea-platform">/);
  assert.match(styles, /--font-aea-body: Arial, "Helvetica Neue", Helvetica, system-ui, sans-serif/);
  assert.match(styles, /--font-aea-heading: Arial, "Helvetica Neue", Helvetica, system-ui, sans-serif/);
  assert.match(styles, /--font-aea-wordmark: Georgia, "Times New Roman", serif/);
  assert.match(styles, /\.brandname \{[^}]*font-family: var\(--font-aea-wordmark\)/);
  assert.equal(styles.match(/font-family: var\(--font-aea-wordmark\)/g)?.length, 1);
  assert.doesNotMatch(styles, /\.electricity-comparison-page \.brandname/);
  assert.doesNotMatch(`${styles}\n${customerAndToolTypography}\n${legacyComparator}`, /Source Serif|Georgia, serif|font-family:'Lato'/);
  assert.match(styles, /\.site-header \{/);
  assert.match(styles, /\.site-header \{ display: grid; grid-template-columns: auto minmax\(150px, 1fr\) auto;/);
  assert.match(styles, /\.site-header \{ display: grid;[^}]*overflow: visible;/);
  assert.match(styles, /\.site-header \.site-nav-shell \{[^}]*grid-column: 1 \/ -1; grid-row: 2;/);
  assert.doesNotMatch(styles, /@keyframes site-header-(?:atmosphere|sheen)/);
  assert.doesNotMatch(styles, /@keyframes site-surge-(?:pulse|spin)/);
  assert.doesNotMatch(styles, /\.site-header \{[^}]*backdrop-filter: blur/);
  assert.doesNotMatch(styles, /\.site-header::after \{/);
  assert.match(styles, /radial-gradient\(circle at 8% -4%/);
  assert.match(styles, /\.comparator-nav::-webkit-scrollbar \{ display: none; \}/);
  assert.match(styles, /a:focus-visible/);
});

test("the customer platform uses one deliberate seven-role typography scale", () => {
  for (const token of [
    "--type-display", "--type-page-title", "--type-section-title", "--type-card-title",
    "--type-body", "--type-label", "--type-action",
  ]) assert.match(styles, new RegExp(`${token}:`));
  assert.match(styles, /\.aea-platform \.wrap :where\(h1\)/);
  assert.match(styles, /\.aea-platform \.wrap :where\(h2\)/);
  assert.match(styles, /\.aea-platform \.wrap :where\(h3, h4\)/);
  assert.match(styles, /body\.aea-platform main\.wrap p,/);
  assert.match(styles, /body\.aea-platform main\.wrap button,/);
  assert.match(styles, /body\.aea-platform main\.wrap small \{/);
  assert.match(styles, /body\.aea-platform main\.wrap label,/);
  assert.match(styles, /text-rendering: optimizeLegibility/);
});

test("shared layout and component tokens prevent page-level visual drift", () => {
  assert.match(styles, /--layout-max: 1760px/);
  assert.match(styles, /\.wrap \{[^}]*max-width: var\(--layout-max\)/);
  assert.doesNotMatch(styles, /\.(?:start-page|guide-page) \{[^}]*max-width:/);
  assert.match(styles, /--radius-control: 8px/);
  assert.match(styles, /--radius-card: 14px/);
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

test("homepage uses an accessible static journey without persistent rendering work", () => {
  assert.match(guide, /CustomerJourneyScene/);
  assert.match(customerScene, /aria-labelledby="customer-journey-title"/);
  assert.match(customerScene, /Understand/);
  assert.match(customerScene, /Prioritise/);
  assert.match(customerScene, /Take action/);
  assert.match(customerScene, /priority/);
  assert.match(customerScene, /width="1920"/);
  assert.match(customerScene, /height="1080"/);
  assert.doesNotMatch(customerScene, /use client|HolographicEnergyField|<canvas|pointermove|onPointerMove|Comfort<|Energy<|Action</);
  assert.doesNotMatch(styles, /\.customer-scene-home::before|customer-hologram-sweep/);
});

test("the optimised whole-home scene is visible and the retired planner scene stays removed", () => {
  assert.match(customerScene, /src="\/surge-command-centre-home\.webp"/);
  assert.match(customerScene, /sizes="\(max-width: 720px\) 100vw, \(max-width: 1800px\) 100vw, 1760px"/);
  assert.equal(fs.existsSync(plannerJourneyPath), false);
  assert.doesNotMatch(styles, /\.planner-home-journey|\.planner-home-render-volume|\.planner-home-question-cue/);
  assert.equal(fs.existsSync(surgeHomeAsset), true);
  assert.ok(fs.statSync(surgeHomeAsset).size > 50_000);
  assert.ok(fs.statSync(surgeHomeAsset).size < 100_000);
  const surgeHomeImage = fs.readFileSync(surgeHomeAsset);
  assert.equal(surgeHomeImage.toString("ascii", 0, 4), "RIFF");
  assert.equal(surgeHomeImage.toString("ascii", 8, 12), "WEBP");
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
  assert.doesNotMatch(layout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(directTradeLayout, /manifest: "\/manifest\.webmanifest"/);
  assert.match(layout, /themeColor: "#03192d"/);
  assert.match(robots, /\/operations\//);
  assert.match(robots, /\/api\//);
  assert.match(robots, /sitemap\.xml/);
  assert.match(sitemap, /\/direct-trade\/access/);
  assert.match(sitemap, /\/wattzun/);
  assert.doesNotMatch(sitemap, /url: `\$\{SITE_URL\}\/surge`/);
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
  assert.equal(heroActions.match(/<Link\b/g)?.length, 1);
  assert.match(heroActions, /start-primary-action[\s\S]*Build my home energy plan/);
  assert.doesNotMatch(heroActions, /ghost|Compare energy plans/);
  assert.match(guide, /className="start-hero-secondary"/);
});

test("homepage keeps booking directly below the hero and loads Calendly only when requested", () => {
  const sceneIndex = guide.indexOf("<CustomerJourneyScene />");
  const bookingIndex = guide.indexOf('id="home-booking"');
  const guidedEntryIndex = guide.indexOf('className="home-entry home-entry-guided"');
  assert.ok(sceneIndex >= 0 && bookingIndex > sceneIndex && guidedEntryIndex > bookingIndex);
  assert.equal(guide.match(/<iframe/g)?.length || 0, 0);
  assert.match(guide, /className=\{bookingStyles\.bookingCard\}[\s\S]*?aria-labelledby="home-booking-title"/);
  assert.match(guide, /<h2 id="home-booking-title"[^>]*>Book a five-minute call<\/h2>/);
  assert.match(guide, /<HomepageCalendlyEmbed \/>/);
  assert.match(homepageCalendly, /^"use client";/);
  assert.match(homepageCalendly, /const \[opened, setOpened\] = useState\(false\)/);
  assert.match(homepageCalendly, />Choose a time<\/button>/);
  assert.equal(homepageCalendly.match(/<iframe/g)?.length, 1);
  assert.match(homepageCalendly, /title="Choose a five-minute call time with Australian Energy Assessments"/);
  assert.match(homepageCalendly, /loading="eager"/);
  assert.match(homepageCalendly, /referrerPolicy="strict-origin-when-cross-origin"/);
  assert.match(guide, /This call is not the assessment itself/);
  assert.match(guide, /Calendly adds the call to our calendar and emails the booking details to you/);
  assert.doesNotMatch(`${guide}${homepageCalendly}`, /CalendlyInlineWidget|Open Calendly separately/);
  assert.match(homepageCalendly, /minHeight: 112/);
  assert.match(guideStyles, /\.embed \{[\s\S]*?border: 0;[\s\S]*?height: 720px;[\s\S]*?width: 100%;/);
  assert.match(guideStyles, /@media \(max-width: 720px\) \{[\s\S]*?\.embed \{[\s\S]*?height: 760px;/);
});

test("getting-started copy preserves comparison and privacy boundaries", () => {
  assert.match(guide, /Mains gas plans only, not bottled LPG/);
  assert.match(guide, /Start privately, without an account/);
  assert.match(guide, /not added to saved links or trade enquiries/);
  assert.match(guide, /Prices, rebates and rules can change/);
  assert.match(guide, /detailed meter-data file, called a NEM12 file/);
  assert.doesNotMatch(guide, /household evidence|Charge-level calculation evidence|recorded capability|confirmed NSW approval pathway/i);
  assert.doesNotMatch(guide, /\bAEA\b/);
  assert.doesNotMatch(guide, /[–—]/);
});

test("integrated planner is private, ordered and responsive", () => {
  assert.match(plannerRoute, /No account, address, bill, meter identifier or contact details/);
  assert.match(plannerRoute, /Four grouped steps use a postcode for local context/);
  assert.match(plannerSchema, /createCustomerProjectPlan/);
  assert.match(plannerSchema, /HOME_ENERGY_PLANNER_STAGE_COUNT = 4/);
  assert.match(planner, /const PRIMARY_STAGE_COUNT = HOME_ENERGY_PLANNER_STAGE_COUNT/);
  assert.match(plannerSchema, /Goal and household/);
  assert.match(plannerSchema, /Comfort and building/);
  assert.match(plannerSchema, /Current systems/);
  assert.match(plannerSchema, /Timing and review/);
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
  assert.doesNotMatch(planner, /\bcreateHomeEnergyPlan\(|\bhomeEnergyPlanOptions\b/);
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
