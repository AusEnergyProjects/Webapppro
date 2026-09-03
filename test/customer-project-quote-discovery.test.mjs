import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { customerProjectActivityDraft } from "../src/lib/customer-project-activity-notifications.ts";

const dashboard = fs.readFileSync(
  new URL("../src/components/CustomerDashboard.tsx", import.meta.url),
  "utf8",
);
const tradeDashboard = fs.readFileSync(
  new URL("../src/components/DirectTradeDashboard.tsx", import.meta.url),
  "utf8",
);
const activityNotifications = fs.readFileSync(
  new URL(
    "../src/lib/customer-project-activity-notifications.ts",
    import.meta.url,
  ),
  "utf8",
);
const activityNotificationServer = fs.readFileSync(
  new URL(
    "../src/lib/customer-project-activity-notification-server.ts",
    import.meta.url,
  ),
  "utf8",
);
const styles = [
  fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../src/app/protected-workspaces.css", import.meta.url), "utf8"),
].join("\n");

test("project installer quotes awaiting review drive the account quote count", () => {
  assert.match(
    dashboard,
    /projectQuotes\.filter\(\(\{ quote \}\) =>[\s\S]*?\["reviewing", "shortlisted"\]\.includes\(quote\.customerDecision\)/,
  );
  assert.match(
    dashboard,
    /className=\{`customer-nav-quote-link[\s\S]*?Quotes[\s\S]*?customer-nav-quote-badge/,
  );
  assert.doesNotMatch(dashboard, />\s*Direct quotes\s*</);
  assert.match(
    styles,
    /\.customer-nav-quote-badge\s*\{[^}]*height:\s*20px;[^}]*min-width:\s*20px;/s,
  );
});

test("the quote centre presents project responses before retained direct quote tools", () => {
  assert.match(dashboard, /className="customer-quote-centre"/);
  assert.match(
    dashboard,
    /projectQuotes\.map\([\s\S]*?projectTitle[\s\S]*?quote\.installerBusinessName[\s\S]*?quote\.totalCentsExGst[\s\S]*?quote\.submittedAt/,
  );
  assert.match(
    dashboard,
    /href=\{`\/account\/projects\/\$\{projectId\}#structured-quote-options`\}[\s\S]*?View connected business[\s\S]*?Finish contact request[\s\S]*?View quote history[\s\S]*?Review quote/,
  );
  assert.match(
    dashboard,
    /id="customer-direct-quotes-heading"[\s\S]*?Direct service quotes[\s\S]*?<CustomerTradeQuotes user=\{user\}/,
  );
});

test("overview and project cards lead customers straight to waiting quotes", () => {
  assert.match(
    dashboard,
    /className="customer-quote-ready-alert"[\s\S]*?href="\/account\/quotes"[\s\S]*?Review your quotes/,
  );
  assert.match(
    dashboard,
    /quoteReviewCountByProject\.get\(project\.id\)[\s\S]*?#structured-quote-options[\s\S]*?Review \$\{installerQuoteCount\} installer/,
  );
  assert.match(
    styles,
    /\.customer-quote-ready-alert\s*\{[^}]*background:\s*linear-gradient[^}]*display:\s*flex;/s,
  );
});

test("project quotes use one explicit direct-contact action instead of shortlist and acceptance steps", () => {
  assert.match(
    dashboard,
    /Get in touch with this business/,
  );
  assert.match(
    dashboard,
    /releases your account name, email, phone number and[\s\S]*?full service address only to this verified business/,
  );
  assert.match(
    dashboard,
    /does not accept the quote, create a contract or[\s\S]*?invoice, make a payment, or authorise any work/,
  );
  assert.match(
    dashboard,
    /action === "connect_installer"[\s\S]*?action: "quote_decision"[\s\S]*?decision: "accepted"[\s\S]*?confirmInstallerContact: true/,
  );
  assert.doesNotMatch(
    dashboard,
    /action === "connect_installer"[\s\S]{0,1200}action: "release_contact"/,
  );
  assert.doesNotMatch(
    dashboard,
    /Shortlist this option|Share details with this installer|Accept installer for next step/,
  );
});

test("quote deep links scroll and focus the structured response section", () => {
  assert.match(
    dashboard,
    /id="structured-quote-options"[\s\S]*?tabIndex=\{-1\}[\s\S]*?aria-labelledby="structured-quote-options-heading"/,
  );
  assert.match(
    dashboard,
    /window\.location\.hash !== "#structured-quote-options"[\s\S]*?getElementById\(\s*"structured-quote-options"[\s\S]*?scrollIntoView[\s\S]*?focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    styles,
    /#structured-quote-options\s*\{\s*scroll-margin-top:\s*24px;/,
  );
});

test("project quote state refreshes in the background without replacing editor state", () => {
  assert.match(
    dashboard,
    /const refreshProjects = useCallback\([\s\S]*?fetch\("\/api\/customer-projects"[\s\S]*?setProjects\(refreshedProjects\)/,
  );
  assert.match(
    dashboard,
    /document\.visibilityState !== "visible"[\s\S]*?window\.setInterval\(refreshWhenVisible,\s*30_000\)[\s\S]*?window\.addEventListener\("focus",\s*refreshWhenVisible\)/,
  );
  assert.match(
    dashboard,
    /action === "quote_decision" && user[\s\S]*?refreshProjects\(user\)/,
  );
  assert.doesNotMatch(
    dashboard,
    /const refreshWhenVisible[\s\S]{0,500}setLoading\(/,
  );
});

test("accepted quote emails and dashboard URLs open the exact owner-scoped lead", () => {
  const matchId = "154aee4d-3648-4c7c-b393-c6715c518b24";
  const email = customerProjectActivityDraft({
    eventType: "customer_installer_accepted",
    audience: "installer",
    opportunityMatchId: matchId,
  });
  assert.match(
    email.body,
    new RegExp(`workspace=leads&matchId=${matchId}#opportunity-inbox`),
  );
  assert.match(
    email.html,
    new RegExp(`workspace=leads&amp;matchId=${matchId}#opportunity-inbox`),
  );
  assert.match(
    activityNotificationServer,
    /opportunityMatchId: String\(context\.opportunity_match_id \|\| ""\)/,
  );
  assert.match(
    activityNotifications,
    /workspace=leads&matchId=\$\{encodeURIComponent\(String\(opportunityMatchId\)\)\}#opportunity-inbox/,
  );
  assert.match(
    tradeDashboard,
    /opportunityMatchFromSearch\(window\.location\.search\)/,
  );
  assert.match(
    tradeDashboard,
    /void openOpportunityNotification\(matchId\)/,
  );
  assert.match(
    tradeDashboard,
    /dashboard-opportunity-navigation-status/,
  );
  assert.match(
    styles,
    /\.dashboard-opportunity-card:focus[\s\S]*outline: 3px solid #12a66a/,
  );
});
