import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const clientRoot = path.join(root, "dist", "client");
const manifestPath = path.join(clientRoot, ".vite", "manifest.json");
const rscManifestPath = path.join(root, "dist", "server", "__vite_rsc_assets_manifest.js");

function fail(message) {
  throw new Error(`Public performance budget failed: ${message}`);
}

function normalizeAsset(file) {
  return file.replace(/^\//, "");
}

function assetBytes(file) {
  const normalized = normalizeAsset(file);
  const target = path.join(clientRoot, normalized);
  if (!fs.existsSync(target)) fail(`missing built asset ${normalized}`);
  return fs.statSync(target).size;
}

function requireEntry(manifest, key) {
  const entry = manifest[key];
  if (!entry) fail(`missing manifest entry ${key}`);
  return entry;
}

function requireNamedEntryKey(manifest, name) {
  const normalizedName = name.toLowerCase();
  const matches = Object.entries(manifest)
    .filter(([, entry]) => entry?.name?.toLowerCase() === normalizedName)
    .map(([key]) => key);
  if (matches.length !== 1) {
    fail(`expected one ${name} manifest entry, found ${matches.length}`);
  }
  return matches[0];
}

function collectStaticGraph(manifest, key, seen = new Set()) {
  if (seen.has(key)) return seen;
  const entry = requireEntry(manifest, key);
  seen.add(key);
  for (const dependency of entry.imports || []) collectStaticGraph(manifest, dependency, seen);
  return seen;
}

function graphAssets(manifest, key) {
  const files = new Set();
  for (const dependency of collectStaticGraph(manifest, key)) {
    const entry = requireEntry(manifest, dependency);
    if (entry.file) files.add(normalizeAsset(entry.file));
    for (const stylesheet of entry.css || []) files.add(normalizeAsset(stylesheet));
    for (const asset of entry.assets || []) files.add(normalizeAsset(asset));
  }
  return files;
}

function graphBytes(manifest, key) {
  return [...graphAssets(manifest, key)].reduce((total, file) => total + assetBytes(file), 0);
}

function parseRscManifest() {
  if (!fs.existsSync(rscManifestPath)) fail("missing built RSC asset manifest");
  const source = fs.readFileSync(rscManifestPath, "utf8")
    .replace(/^export default\s+/, "")
    .replace(/;\s*$/, "");
  return JSON.parse(source);
}

function readSource(file) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) fail(`missing route ownership source ${file}`);
  return fs.readFileSync(target, "utf8");
}

function assertSourceBoundary(file, token) {
  if (!readSource(file).includes(token)) {
    fail(`${file} no longer owns expected route boundary ${token}`);
  }
}

function addEntryGraph(files, manifest, key) {
  for (const file of graphAssets(manifest, key)) files.add(file);
}

function addServerResource(files, rscManifest, key, required = false) {
  const resource = rscManifest.serverResources?.[key];
  if (!resource) {
    if (required) fail(`missing RSC server resource ${key}`);
    return;
  }
  for (const file of [...(resource.js || []), ...(resource.css || [])]) {
    files.add(normalizeAsset(file));
  }
}

function bootstrapAssets(rscManifest) {
  const files = new Set();
  for (const match of rscManifest.bootstrapScriptContent?.matchAll(/import\(["']([^"']+)["']\)/g) || []) {
    files.add(normalizeAsset(match[1]));
  }
  if (files.size === 0) fail("RSC bootstrap asset was not found");
  return files;
}

function routeGraph(manifest, rscManifest, definition) {
  const files = bootstrapAssets(rscManifest);
  addServerResource(files, rscManifest, "src/app/layout.tsx", true);
  addServerResource(files, rscManifest, definition.page);
  for (const entry of rootLayoutEntries) addEntryGraph(files, manifest, entry);
  for (const entry of definition.clientEntries) addEntryGraph(files, manifest, entry);

  const javascript = [...files].filter((file) => file.endsWith(".js"));
  const css = [...files].filter((file) => file.endsWith(".css"));
  const total = (assets) => assets.reduce((sum, file) => sum + assetBytes(file), 0);
  return { files, javascript: total(javascript), css: total(css) };
}

if (!fs.existsSync(manifestPath)) fail("run the production build before this audit");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const rscManifest = parseRscManifest();
const lazyKey = "src/components/LazyEnergyAssistantWidget.tsx";
const assistantKey = "src/components/EnergyAssistantWidget.tsx";
const plannerKey = "src/components/HomeEnergyPlanner.tsx";
const planEnquiryKey = "src/components/PublicPlanEnquiryForm.tsx";
const adminKey = "src/components/AdminOperationsPortal.tsx";
const protectedStylesKey = "src/components/ProtectedWorkspaceStyles.tsx";
const adapterKey = "src/lib/energy-assistant-enquiry-adapter.mjs";
const publicSearchKey = requireNamedEntryKey(manifest, "PublicSiteSearch");
const linkKey = requireNamedEntryKey(manifest, "Link");
const imageKey = requireNamedEntryKey(manifest, "Image");
const teamStylesKey = requireNamedEntryKey(manifest, "TeamPageStyles");
const layoutSegmentKey = "node_modules/vinext/dist/shims/layout-segment-context.js";
const lazy = requireEntry(manifest, lazyKey);
const assistant = requireEntry(manifest, assistantKey);
const planner = requireEntry(manifest, plannerKey);
const planEnquiry = requireEntry(manifest, planEnquiryKey);
const admin = requireEntry(manifest, adminKey);
const protectedStyles = requireEntry(manifest, protectedStylesKey);
const tlinkStyles = requireEntry(
  manifest,
  requireNamedEntryKey(manifest, "TLinkChromeStyles"),
);
const teamStyles = requireEntry(manifest, teamStylesKey);
const rootLayoutEntries = [
  lazyKey,
  "src/components/SiteDatePicker.tsx",
  "src/components/AnalyticsConsent.tsx",
  publicSearchKey,
  linkKey,
  layoutSegmentKey,
];
const surfaceEntries = {
  public: lazyKey,
  customer: "src/components/CustomerDashboard.tsx",
  trade: "src/components/DirectTradeDashboard.tsx",
  creditex: "src/components/CreditexCompliancePortal.tsx",
  admin: adminKey,
};
const routeDefinitions = {
  home: {
    page: "src/app/page.tsx",
    clientEntries: [
      "src/components/SurgeOpenButton.tsx",
      "src/components/HomepageCalendlyEmbed.tsx",
      imageKey,
    ],
    boundaries: [
      ["src/app/page.tsx", "GettingStarted"],
      ["src/components/GettingStarted.tsx", "SurgeOpenButton"],
    ],
  },
  wattzun: {
    page: "src/app/wattzun/page.tsx",
    clientEntries: [],
    boundaries: [["src/app/wattzun/page.tsx", "surge-page.module.css"]],
  },
  plan: {
    page: "src/app/plan/page.tsx",
    clientEntries: [plannerKey],
    boundaries: [["src/app/plan/page.tsx", "HomeEnergyPlanner"]],
  },
  calculator: {
    page: "src/app/calculator/page.tsx",
    clientEntries: ["src/components/PublicRebateCalculatorWorkspace.tsx"],
    boundaries: [["src/app/calculator/page.tsx", "PublicRebateCalculatorWorkspace"]],
  },
  team: {
    page: "src/app/team/page.tsx",
    clientEntries: [teamStylesKey, imageKey],
    boundaries: [
      ["src/app/team/page.tsx", "TeamPageStyles"],
      ["src/app/team/page.tsx", "next/image"],
      ["src/app/team/TeamPageStyles.tsx", "team-page.css"],
    ],
  },
};
const routeBudgets = {
  home: { javascript: 395_000, css: 400_000 },
  wattzun: { javascript: 347_000, css: 400_000 },
  plan: { javascript: 509_000, css: 410_000 },
  calculator: { javascript: 625_000, css: 450_000 },
  team: { javascript: 395_000, css: 400_000 },
};

assertSourceBoundary("src/app/layout.tsx", "LazyEnergyAssistantWidget");
assertSourceBoundary("src/app/layout.tsx", "SiteDatePicker");
assertSourceBoundary("src/app/layout.tsx", "AnalyticsConsent");
for (const layout of [
  "src/app/account/layout.tsx",
  "src/app/direct-trade/layout.tsx",
  "src/app/operations/layout.tsx",
]) {
  assertSourceBoundary(layout, "ProtectedWorkspaceStyles");
}
assertSourceBoundary("src/components/TLinkChrome.tsx", "TLinkChromeStyles");
for (const definition of Object.values(routeDefinitions)) {
  readSource(definition.page);
  for (const [file, token] of definition.boundaries) assertSourceBoundary(file, token);
}

if (!lazy.dynamicImports?.includes(assistantKey)) {
  fail("the root launcher no longer defers the full Surge assistant");
}
if (lazy.imports?.includes(assistantKey)) {
  fail("the full Surge assistant returned to the initial root dependency graph");
}
if (!assistant.dynamicImports?.includes(adapterKey) || assistant.imports?.includes(adapterKey)) {
  fail("the postcode-backed enquiry adapter must load only when an enquiry is submitted");
}
if (!planner.dynamicImports?.includes(planEnquiryKey) || planner.imports?.includes(planEnquiryKey)) {
  fail("the public plan enquiry form must load only after the visitor opens it");
}

const surfaceEntryFiles = Object.fromEntries(
  Object.entries(surfaceEntries).map(([surface, key]) => [surface, requireEntry(manifest, key).file]),
);
if (new Set(Object.values(surfaceEntryFiles)).size !== Object.keys(surfaceEntryFiles).length) {
  fail("public, customer, trade, Creditex and admin surfaces must keep separate entry chunks");
}

const publicGraph = collectStaticGraph(manifest, surfaceEntries.public);
for (const protectedKey of [
  surfaceEntries.customer,
  surfaceEntries.trade,
  surfaceEntries.creditex,
  surfaceEntries.admin,
]) {
  if (publicGraph.has(protectedKey)) {
    fail(`the public launcher statically includes protected surface ${protectedKey}`);
  }
}

const lazyBytes = assetBytes(lazy.file)
  + (lazy.css || []).reduce((total, file) => total + assetBytes(file), 0);
if (lazyBytes > 5_000) fail(`root Surge launcher is ${lazyBytes} bytes; budget is 5000`);

const assistantBytes = assetBytes(assistant.file);
if (assistantBytes > 89_000) fail(`deferred Surge assistant is ${assistantBytes} bytes; budget is 89000`);

const rootGlobalCss = rscManifest.serverResources?.["src/app/layout.tsx"]?.css?.map(normalizeAsset) || [];
if (rootGlobalCss.length !== 1) fail(`expected one root layout stylesheet, found ${rootGlobalCss.length}`);
const globalCss = { file: rootGlobalCss[0], bytes: assetBytes(rootGlobalCss[0]) };
if (globalCss.bytes > 395_000) fail(`global stylesheet is ${globalCss.bytes} bytes; budget is 395000`);

const protectedCss = (protectedStyles.css || []).map(normalizeAsset);
if (protectedCss.length !== 1) {
  fail(`expected one protected-workspace stylesheet, found ${protectedCss.length}`);
}
const tlinkCss = (tlinkStyles.css || []).map(normalizeAsset);
if (tlinkCss.length !== 1) {
  fail(`expected one TLink chrome stylesheet, found ${tlinkCss.length}`);
}
const rootCssSource = fs.readFileSync(path.join(clientRoot, globalCss.file), "utf8");
for (const selector of [
  ".enquiry-workspace",
  ".customer-account-page",
  ".trade-portal-shell",
  ".tlink-site-header",
]) {
  if (rootCssSource.includes(selector)) {
    fail(`root stylesheet contains route-owned selector ${selector}`);
  }
}
const protectedCssSource = fs.readFileSync(path.join(clientRoot, protectedCss[0]), "utf8");
for (const selector of [
  ".enquiry-workspace",
  ".customer-account-page",
  ".trade-portal-shell",
]) {
  if (!protectedCssSource.includes(selector)) {
    fail(`protected-workspace stylesheet is missing ${selector}`);
  }
}
const tlinkCssSource = fs.readFileSync(path.join(clientRoot, tlinkCss[0]), "utf8");
if (!tlinkCssSource.includes(".tlink-site-header")) {
  fail("TLink chrome stylesheet is missing its site-header styles");
}
const teamCss = (teamStyles.css || []).map(normalizeAsset);
if (teamCss.length !== 1) {
  fail(`expected one team-page stylesheet, found ${teamCss.length}`);
}
const teamCssSource = fs.readFileSync(path.join(clientRoot, teamCss[0]), "utf8");
if (!teamCssSource.includes(".team-page-section")) {
  fail("team-page stylesheet is missing its route-owned styles");
}
if (rootCssSource.includes(".team-page-section")) {
  fail("team-page styles returned to root globals");
}

const surfaceBytes = Object.fromEntries(
  Object.entries(surfaceEntries).map(([surface, key]) => [surface, graphBytes(manifest, key)]),
);
for (const [surface, maximum] of Object.entries({
  public: 305_000,
  customer: 960_000,
  trade: 1_000_000,
  creditex: 1_850_000,
  admin: 1_400_000,
})) {
  if (surfaceBytes[surface] > maximum) {
    fail(`${surface} static graph is ${surfaceBytes[surface]} bytes; budget is ${maximum}`);
  }
}

const routeGraphs = Object.fromEntries(
  Object.entries(routeDefinitions).map(([route, definition]) => [route, routeGraph(manifest, rscManifest, definition)]),
);
for (const [route, budgets] of Object.entries(routeBudgets)) {
  for (const assetType of ["javascript", "css"]) {
    if (routeGraphs[route][assetType] > budgets[assetType]) {
      fail(`${route} ${assetType} graph is ${routeGraphs[route][assetType]} bytes; budget is ${budgets[assetType]}`);
    }
  }
}
for (const [route, graph] of Object.entries(routeGraphs)) {
  for (const stylesheet of protectedCss) {
    if (graph.files.has(stylesheet)) {
      fail(`${route} initial graph includes protected-workspace stylesheet ${stylesheet}`);
    }
  }
  for (const stylesheet of tlinkCss) {
    if (graph.files.has(stylesheet)) {
      fail(`${route} initial graph includes TLink chrome stylesheet ${stylesheet}`);
    }
  }
  if (route !== "team") {
    for (const stylesheet of teamCss) {
      if (graph.files.has(stylesheet)) {
        fail(`${route} initial graph includes team-page stylesheet ${stylesheet}`);
      }
    }
  }
}

const planInitialFiles = routeGraphs.plan.files;
for (const deferredFile of [planEnquiry.file, ...(planEnquiry.css || [])].map(normalizeAsset)) {
  if (planInitialFiles.has(deferredFile)) {
    fail(`plan initial graph includes deferred enquiry asset ${deferredFile}`);
  }
}

const adminCss = (admin.css || []).map(normalizeAsset);
if (adminCss.length === 0) fail("admin operations CSS was not emitted as an owned stylesheet");
if (!readSource("src/components/AdminOperationsPortal.css").includes("Restricted operations control centre")) {
  fail("admin operations stylesheet no longer owns its restricted shell styles");
}
if (readSource("src/app/globals.css").includes("Restricted operations control centre")) {
  fail("restricted admin shell styles returned to root globals");
}
for (const [route, graph] of Object.entries(routeGraphs)) {
  for (const stylesheet of adminCss) {
    if (graph.files.has(stylesheet)) {
      fail(`${route} initial graph includes foreign admin stylesheet ${stylesheet}`);
    }
  }
}

for (const [file, maximum] of [
  ["surge-mascot.webp", 100_000],
]) {
  const bytes = assetBytes(file);
  if (bytes > maximum) fail(`${file} is ${bytes} bytes; budget is ${maximum}`);
}

for (const retiredAsset of [
  "aea-home-energy-plan-og.png",
  "aea-immersive-home-journey.webp",
  "file.svg",
  "globe.svg",
  "next.svg",
  "vercel.svg",
  "window.svg",
]) {
  if (fs.existsSync(path.join(clientRoot, retiredAsset))) {
    fail(`retired public asset returned to the Sites package: ${retiredAsset}`);
  }
}

const routeSummary = Object.entries(routeGraphs)
  .map(([route, graph]) => `${route} JS ${graph.javascript}, CSS ${graph.css}`)
  .join("; ");

console.log(
  `Public performance budgets passed: root launcher ${lazyBytes} bytes, deferred assistant ${assistantBytes} bytes, root layout CSS ${globalCss.bytes} bytes. Surface graphs: public ${surfaceBytes.public}, customer ${surfaceBytes.customer}, trade ${surfaceBytes.trade}, Creditex ${surfaceBytes.creditex}, admin ${surfaceBytes.admin} bytes.`,
  `Actual route graphs (page + root layout): ${routeSummary}.`,
);
