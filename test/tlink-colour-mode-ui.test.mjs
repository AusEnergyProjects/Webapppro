import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const dashboardPage = read("../src/app/direct-trade/dashboard/page.tsx");
const rootLayout = read("../src/app/layout.tsx");
const colourModeBoundary = read("../src/lib/tlink-colour-mode.ts");
const colourModeStyles = read("../src/app/tlink-colour-mode.css");
const teamStyles = read("../src/components/TradeTeamSettings.module.css");
const protectedWorkspaceStyles = read(
  "../src/components/ProtectedWorkspaceStyles.tsx",
);

function extractBalancedBlock(source, anchor) {
  const anchorIndex = source.indexOf(anchor);
  assert.notEqual(anchorIndex, -1, `Missing source block anchored by: ${anchor}`);

  const openIndex = source.indexOf("{", anchorIndex);
  assert.notEqual(openIndex, -1, `Missing opening brace after: ${anchor}`);

  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(anchorIndex, index + 1);
      }
    }
  }

  assert.fail(`Missing closing brace for: ${anchor}`);
}

function extractJsxElement(source, marker, closingTag) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing JSX marker: ${marker}`);

  const openIndex = source.lastIndexOf("<", markerIndex);
  const closeIndex = source.indexOf(closingTag, markerIndex);
  assert.notEqual(closeIndex, -1, `Missing JSX closing tag: ${closingTag}`);

  return source.slice(openIndex, closeIndex + closingTag.length);
}

function pixelDeclaration(block, property) {
  const match = block.match(
    new RegExp(`(?:^|[;{]\\s*)${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px\\s*;`),
  );
  assert.ok(match, `Missing pixel declaration for ${property}`);
  return Number(match[1]);
}

test("the permanent TLink header control is a native accessible sun and moon toggle", () => {
  const header = extractJsxElement(
    dashboard,
    'className="dashboard-hero"',
    "</header>",
  );
  const toggle = extractJsxElement(
    header,
    'className="tlink-colour-mode-toggle"',
    "</button>",
  );

  assert.match(toggle, /^<button[\s\S]*\btype="button"/);
  assert.match(toggle, /\baria-pressed=\{colourMode === "night"\}/);
  assert.match(toggle, /\baria-label="Night mode"/);
  assert.match(toggle, /\bonClick=\{toggleColourMode\}/);
  assert.match(toggle, /className="tlink-colour-mode-sun" aria-hidden="true"/);
  assert.match(toggle, /className="tlink-colour-mode-moon" aria-hidden="true"/);
  assert.equal(
    [...header.matchAll(/className="tlink-colour-mode-toggle"/g)].length,
    1,
  );
  assert.ok(
    header.indexOf('className="tlink-colour-mode-toggle"')
      < header.indexOf('className="dashboard-account-actions"'),
    "The mode toggle should remain a direct part of the portal header controls",
  );
});

test("portal colour mode is orthogonal to the saved business colour theme", () => {
  const shellTagStart = dashboard.lastIndexOf(
    "<div",
    dashboard.indexOf("data-trade-theme="),
  );
  const shellTagEnd = dashboard.indexOf(">", shellTagStart);
  const shellTag = dashboard.slice(shellTagStart, shellTagEnd + 1);

  assert.match(shellTag, /className=\{`trade-portal-shell/);
  assert.match(
    shellTag,
    /data-trade-theme=\{profile\.brandThemeKey \|\| DEFAULT_TRADE_BRAND_THEME\}/,
  );
  assert.match(shellTag, /data-trade-colour-mode=\{colourMode\}/);
  assert.match(
    dashboard,
    /background:\s*tradeBusinessThemeGradient\(profile\.brandThemeKey\)/,
  );
});

test("the stable preference key is wired through early bootstrap and live portal sync", () => {
  assert.match(
    colourModeBoundary,
    /export const TLINK_COLOUR_MODE_STORAGE_KEY\s*=\s*"tlink-colour-mode";/,
  );
  assert.match(
    dashboardPage,
    /import \{ TLINK_COLOUR_MODE_STORAGE_KEY \} from "@\/lib\/tlink-colour-mode";/,
  );
  assert.match(
    dashboardPage,
    /window\.localStorage\.getItem\(\$\{JSON\.stringify\(TLINK_COLOUR_MODE_STORAGE_KEY\)\}\)/,
  );
  assert.match(
    dashboardPage,
    /document\.documentElement\.dataset\.tlinkColourMode=mode==="night"\?"night":"day"/,
  );
  assert.match(dashboardPage, /id="tlink-colour-mode-bootstrap"/);
  assert.ok(
    dashboardPage.indexOf('id="tlink-colour-mode-bootstrap"')
      < dashboardPage.indexOf("<DirectTradeDashboard />"),
    "The preference bootstrap must run before the client dashboard renders",
  );

  for (const contract of [
    /readTLinkColourMode\(window\.localStorage\)/,
    /writeTLinkColourMode\(window\.localStorage, nextMode\)/,
    /event\.key === TLINK_COLOUR_MODE_STORAGE_KEY/,
    /document\.documentElement\.dataset\.tlinkColourMode = nextMode/,
  ]) {
    assert.match(dashboard, contract);
  }
  assert.match(
    protectedWorkspaceStyles,
    /import "\.\.\/app\/tlink-colour-mode\.css";/,
  );
  assert.match(rootLayout, /<html lang="en-AU" suppressHydrationWarning>/);
  assert.match(
    teamStyles,
    /:global\(html\[data-tlink-colour-mode="night"\] \.trade-portal-shell\)/,
    "Module surfaces must react to the pre-hydration html mode without a white flash",
  );
});

test("night mode changes portal surfaces without replacing business brand and rail tokens", () => {
  const dayRoot = extractBalancedBlock(
    colourModeStyles,
    ".trade-portal-shell {",
  );
  const nightRoot = extractBalancedBlock(
    colourModeStyles,
    'html[data-tlink-colour-mode="night"] .trade-portal-shell {',
  );

  assert.match(dayRoot, /--trade-accent-readable:\s*var\(--trade-accent\);/);
  for (const portalSurface of [
    "--trade-page",
    "--trade-surface",
    "--trade-field",
    "--trade-ink",
    "--trade-muted",
  ]) {
    assert.match(nightRoot, new RegExp(`${portalSurface}\\s*:`));
  }
  assert.doesNotMatch(
    nightRoot,
    /--trade-(?:gradient|dark|header-control(?:-[a-z0-9-]+)?|rail-[a-z0-9-]+)\s*:/i,
    "Night mode must inherit the business gradient, dark header, header controls, and rail palette",
  );

  const activeCommandFilter = extractBalancedBlock(
    colourModeStyles,
    'html[data-tlink-colour-mode="night"] .trade-portal-shell .tlink-command-filters button.active {',
  );
  assert.match(activeCommandFilter, /background:\s*var\(--trade-accent-soft\);/);
  assert.match(activeCommandFilter, /color:\s*var\(--trade-accent-soft-ink\);/);
});

test("the toggle has a visible keyboard focus and a mobile-safe accessible target", () => {
  const toggleRule = extractBalancedBlock(
    colourModeStyles,
    ".tlink-colour-mode-toggle {",
  );
  const width = pixelDeclaration(toggleRule, "width");
  const height = pixelDeclaration(toggleRule, "height");

  assert.ok(width * height >= 44 * 44, "Toggle target area must equal or exceed 44px by 44px");
  assert.ok(Math.min(width, height) >= 24, "Neither target dimension may fall below 24px");

  const focusRule = extractBalancedBlock(
    colourModeStyles,
    ".tlink-colour-mode-toggle:focus-visible {",
  );
  assert.match(focusRule, /outline:\s*[1-9][\d.]*px\s+solid\s+[^;]+;/);
  assert.match(focusRule, /outline-offset:\s*[1-9][\d.]*px;/);

  const mobileRule = extractBalancedBlock(
    colourModeStyles,
    "@media (max-width: 780px) {",
  );
  assert.match(
    mobileRule,
    /\.trade-portal-shell \.tlink-colour-mode-toggle\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*70px;[\s\S]*top:\s*16px;/,
  );
  assert.match(
    mobileRule,
    /\.trade-portal-shell\.is-supplier \.tlink-colour-mode-toggle\s*\{[\s\S]*right:\s*16px;/,
  );
  assert.doesNotMatch(mobileRule, /display:\s*none/);
});

test("customer-facing document previews remain explicitly light in night mode", () => {
  const documentReset = extractBalancedBlock(
    colourModeStyles,
    "/* These canvases represent customer-facing documents and intentionally stay in day mode. */",
  );

  for (const documentSelector of [
    ".business-settings-document-preview",
    ".crm-invoice-preview",
    ".trade-quote-document-sheet",
  ]) {
    assert.match(
      documentReset,
      new RegExp(documentSelector.replaceAll(".", "\\.")),
    );
  }
  assert.match(
    documentReset,
    /\.crm-invoice-preview-dialog:not\(\.schedule-appointment-dialog\):not\(:has\(\.crm-retake-review-dialog\)\)/,
  );
  for (const lightDeclaration of [
    /--trade-ink:\s*#0c3738;/,
    /--trade-surface:\s*#ffffff;/,
    /--trade-field:\s*#ffffff;/,
    /background:\s*#ffffff;/,
    /color:\s*#0c3738;/,
    /color-scheme:\s*light;/,
  ]) {
    assert.match(documentReset, lightDeclaration);
  }
});

test("night mode covers detailed job, task, and commercial handoff surfaces", () => {
  for (const selector of [
    ".crm-pipeline-board > section",
    ".crm-pipeline-board > section > div > button",
    ".crm-task-list li",
    ".crm-commercial-handoff",
    ".crm-deposit-choice",
  ]) {
    assert.match(
      colourModeStyles,
      new RegExp(selector.replaceAll(".", "\\.")),
      `Missing night surface coverage for ${selector}`,
    );
  }

  const depositRule = extractBalancedBlock(
    colourModeStyles,
    'html[data-tlink-colour-mode="night"] .trade-portal-shell .crm-deposit-choice {',
  );
  assert.match(depositRule, /background:\s*#[0-3][0-9a-f]{5};/i);
  assert.match(depositRule, /color:\s*var\(--trade-ink\);/);
});

test("night mode keeps consent-released lead contact details readable", () => {
  const contactDetailRule = extractBalancedBlock(
    colourModeStyles,
    'html[data-tlink-colour-mode="night"] .trade-portal-shell .dashboard-connected-customer-contact-grid dd {',
  );
  const contactLinkRule = extractBalancedBlock(
    colourModeStyles,
    'html[data-tlink-colour-mode="night"] .trade-portal-shell .dashboard-connected-customer-contact-grid a {',
  );

  assert.match(contactDetailRule, /color:\s*var\(--trade-ink\);/);
  assert.match(contactLinkRule, /color:\s*var\(--trade-accent-readable\);/);
  assert.match(
    colourModeStyles,
    /\.dashboard-connected-customer-intro > p,[\s\S]*\.dashboard-connected-customer-contact-grid dt[\s\S]*color:\s*var\(--trade-muted\);/,
  );
});
