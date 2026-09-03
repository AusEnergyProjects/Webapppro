import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) =>
  fs.readFileSync(new URL(path, import.meta.url), "utf8");

const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const quote = read("../src/components/InstallerPlatformQuote.tsx");
const styles = [
  read("../src/app/globals.css"),
  read("../src/app/protected-workspaces.css"),
].join("\n");

test("lead results default to compact accessible summaries with one expandable workflow", () => {
  assert.match(
    dashboard,
    /useState<Set<string>>\(\(\) => new Set\(\)\)/,
  );
  assert.match(dashboard, /dashboard-opportunity-compact-summary/);
  assert.match(dashboard, /dashboard-opportunity-details/);
  assert.match(dashboard, /hidden=\{!isExpanded\}/);
  assert.match(dashboard, /aria-expanded=\{isExpanded\}/);
  assert.match(
    dashboard,
    /releasedCustomerContact\s*\?\s*`\$\{customerIdentityId\} \$\{detailId\}`\s*:\s*detailId/,
  );
  assert.match(dashboard, /Collapse lead/);
  assert.match(dashboard, /Expand lead/);
  assert.match(dashboard, /opportunityNextAction\(opportunity\)/);
  assert.match(dashboard, /Customer contact ready/);
  assert.match(dashboard, /Prepare the quote/);
  assert.match(styles, /\.dashboard-opportunity-card\.collapsed/);
  assert.match(styles, /\.dashboard-opportunity-compact-summary dl/);
  assert.match(styles, /\.dashboard-opportunity-details\[hidden\]/);
});

test("exact notification links expand the matching card before scrolling and focus", () => {
  const navigation = dashboard.slice(
    dashboard.indexOf("const openOpportunityNotification"),
    dashboard.indexOf("async function saveSettings"),
  );
  assert.match(
    navigation,
    /setExpandedOpportunityMatchIds\(\(current\) =>/,
  );
  assert.match(navigation, /searchParams\.set\("workspace", "leads"\)/);
  assert.match(navigation, /searchParams\.set\("matchId", matchId\)/);
  assert.match(navigation, /nextUrl\.hash = "opportunity-inbox"/);
  assert.match(navigation, /Opening lead\.\.\./);
  assert.match(
    navigation,
    /if \(!expandedOpportunityMatchIds\.has\(focusedOpportunityMatchId\)\)[\s\S]*setExpandedOpportunityMatchIds[\s\S]*return;[\s\S]*scrollIntoView[\s\S]*focus\(\{ preventScroll: true \}\)/,
  );
  assert.doesNotMatch(navigation, /accepted lead/i);
});

test("structured quote fields form compact logical groups at wide and narrow widths", () => {
  assert.match(quote, /installer-quote-field-group/);
  assert.match(quote, /Quote setup/);
  assert.match(quote, /Price and timing/);
  assert.match(quote, /installer-quote-field-grid quote-setup/);
  assert.match(quote, /installer-quote-field-grid quote-price-timing/);
  assert.match(quote, /installer-quote-footer/);
  assert.match(styles, /\.installer-quote-field-grid\.quote-setup/);
  assert.match(
    styles,
    /\.installer-quote-field-grid\.quote-price-timing \{ grid-template-columns: repeat\(5, minmax\(120px, 1fr\)\)/,
  );
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.installer-quote-footer/);
  assert.match(
    styles,
    /\.installer-quote-field-grid\.quote-setup,[\s\S]*\.installer-quote-field-grid\.quote-price-timing \{ grid-template-columns: 1fr; \}/,
  );
});

test("trade-facing quote copy uses contact choice rather than purchase acceptance", () => {
  assert.match(quote, /customerDecision === "accepted"/);
  assert.match(quote, /Customer chose your business/);
  assert.match(quote, /With customer/);
  assert.doesNotMatch(quote, />Accepted for next step</);
  assert.doesNotMatch(quote, />Shortlisted</);
  assert.match(dashboard, /Customer account project contact and street details stay protected until the customer chooses this business/);
  assert.match(dashboard, /Waiting for the customer to choose a business/);
  assert.doesNotMatch(dashboard, /Waiting for customer acceptance/);
});
