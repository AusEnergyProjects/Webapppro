import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) =>
  fs.readFileSync(new URL(path, import.meta.url), "utf8");

const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const opportunityRoute = read("../src/app/api/trade-opportunities/route.ts");
const quote = read("../src/components/InstallerPlatformQuote.tsx");
const styles = [
  read("../src/app/globals.css"),
  read("../src/app/protected-workspaces.css"),
].join("\n");

test("the permanent Leads tab uses an accessible list and full selected preview", () => {
  assert.match(dashboard, /const \[selectedOpportunityMatchId, setSelectedOpportunityMatchId\] = useState\(\(\) =>[\s\S]*opportunityMatchFromSearch\(window\.location\.search\)\)/);
  assert.match(dashboard, /const selectedLeadOpportunity = visibleLeadOpportunities\.find\(\(item\) => item\.matchId === selectedOpportunityMatchId\)[\s\S]*\|\| visibleLeadOpportunities\[0\]/);
  assert.match(dashboard, /dashboard-lead-workspace/);
  assert.match(dashboard, /<nav className="dashboard-lead-list" aria-label="Available leads">/);
  assert.match(dashboard, /aria-current=\{selected \? "true" : undefined\}/);
  assert.match(dashboard, /onClick=\{\(\) => setSelectedOpportunityMatchId\(opportunity\.matchId\)\}/);
  assert.match(dashboard, /nextUrl\.searchParams\.set\("matchId", selectedOpportunityMatchId\)/);
  assert.match(dashboard, /setSelectedOpportunityMatchId\(nextMatchId\)/);
  assert.match(dashboard, /dashboard-opportunity-compact-summary/);
  assert.match(dashboard, /dashboard-opportunity-details/);
  assert.match(dashboard, /hidden=\{!isExpanded\}/);
  assert.match(dashboard, /opportunityNextAction\(opportunity\)/);
  assert.match(dashboard, /<EnquiryPack/);
  assert.match(dashboard, /<PublicQuotePreparation/);
  assert.match(dashboard, /dashboard-connected-customer-contact-grid/);
  assert.match(dashboard, /dashboard-property-context/);
  assert.match(dashboard, /className="dashboard-lead-dismiss"/);
  assert.match(dashboard, /\["offered", "viewed"\]\.includes\(opportunity\.matchStatus\)[\s\S]*opportunity\.platformOnly && opportunity\.matchStatus === "interested"/);
  assert.match(dashboard, /Remove .* from this business's leads/);
  assert.match(dashboard, /This does not remove it for other matched trades/);
  assert.match(dashboard, /dashboard-lead-preview-actions/);
  assert.match(dashboard, /\["offered", "viewed", "interested", "connected"\]\.map\(\(value\) => <option/);
  assert.match(dashboard, /: "Quote"/);
  assert.match(dashboard, /async function openPublicLeadQuote\(opportunity: DashboardOpportunity\)/);
  assert.match(dashboard, /action: "open_public_quote", matchId: opportunity\.matchId/);
  assert.match(dashboard, /opportunity\.matchStatus !== "connected" \|\| !opportunity\.platformOnly/);
  assert.match(dashboard, /!opportunity\.platformOnly && \["interested", "connected"\]\.includes\(opportunity\.matchStatus\)/);
  assert.match(dashboard, /opportunity\.quote\?\.customerDecision === "accepted" \? "View quote" : "Edit quote"/);
  assert.match(styles, /\.dashboard-lead-workspace/);
  assert.match(styles, /\.dashboard-lead-list > button\.active/);
  assert.match(styles, /\.dashboard-lead-preview/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.dashboard-lead-workspace/);
});

test("exact notification links select the matching lead before scrolling and focus", () => {
  const navigation = dashboard.slice(
    dashboard.indexOf("const openOpportunityNotification"),
    dashboard.indexOf("async function saveSettings"),
  );
  assert.match(navigation, /setSelectedOpportunityMatchId\(matchId\)/);
  assert.match(navigation, /setActiveWorkView\("leads"\)/);
  assert.match(navigation, /searchParams\.set\("workspace", "leads"\)/);
  assert.match(navigation, /searchParams\.set\("matchId", matchId\)/);
  assert.match(navigation, /nextUrl\.hash = "opportunity-inbox"/);
  assert.match(navigation, /Opening lead\.\.\./);
  assert.match(dashboard, /const exactOpportunityMatchId = useRef\([\s\S]*opportunityMatchFromSearch\(window\.location\.search\)/);
  assert.match(dashboard, /const exactOpportunity = requestedMatchId[\s\S]*current\.find\(\(item\) => item\.matchId === requestedMatchId\)[\s\S]*\[exactOpportunity, \.\.\.loadedOpportunities\]/);
  assert.match(dashboard, /const exactMatchIsLoading = Boolean\([\s\S]*exactOpportunityMatchId\.current === selectedOpportunityMatchId[\s\S]*if \(exactMatchIsLoading\) return/);
  assert.match(dashboard, /activeWorkView !== "leads" \|\| !focusedOpportunityMatchId/);
  assert.match(dashboard, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)[\s\S]*focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(navigation, /accepted lead/i);
});

test("removing a lead is owner scoped, reversible only through allocation, and leaves other matches untouched", () => {
  assert.match(opportunityRoute, /const PARTNER_STATUSES = new Set\(\["viewed", "interested", "declined"\]\)/);
  assert.match(opportunityRoute, /WHERE m\.id = \? AND m\.firebase_uid = \?/);
  assert.match(opportunityRoute, /UPDATE trade_opportunity_matches[\s\S]*WHERE id = \? AND firebase_uid = \? AND status = \? AND opportunity_id = \?/);
  assert.match(opportunityRoute, /bounded_match\.status IN \('offered', 'viewed', 'interested', 'connected'\)/);
  assert.match(opportunityRoute, /if \(status === "declined"\)[\s\S]*allocateNearestInstallers\([\s\S]*"automatic-decline-refill"/);
  assert.match(opportunityRoute, /status === "declined" && currentProjectConsent[\s\S]*await db\.batch\(\[[\s\S]*UPDATE customer_project_quotes[\s\S]*status = 'withdrawn'[\s\S]*customer_decision != 'accepted'[\s\S]*declined_match\.status = 'declined'/);
  assert.match(opportunityRoute, /customer_project_quotes accepted_quote[\s\S]*accepted_quote\.opportunity_match_id = \?[\s\S]*accepted_quote\.installer_uid = \?[\s\S]*accepted_quote\.customer_decision = 'accepted'/);
  assert.match(opportunityRoute, /action === "open_public_quote"[\s\S]*\["interested", "connected"\]\.includes\(currentStatus\)[\s\S]*publicLeadQuoteWorkflowOutcome\(db, user\.uid, matchId, now, currentStatus\)/);
  assert.match(opportunityRoute, /status === "declined" && currentPublicContact && currentStatus === "interested"[\s\S]*already stored as a customer and job/);
  assert.match(opportunityRoute, /PLATFORM_QUOTE_STATE_CHANGED[\s\S]*INSERT INTO customer_project_quotes/);
  assert.match(opportunityRoute, /guarded_match\.status IN \('interested', 'connected'\)[\s\S]*guarded_consent\.withdrawn_at = ''/);
  assert.match(opportunityRoute, /mutationResults\[1\]\?\.meta\.changes/);
  assert.match(opportunityRoute, /code: "LEAD_STATE_CHANGED"/);
  assert.doesNotMatch(opportunityRoute, /DELETE FROM trade_opportunit(?:y|ies)_matches/);
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
