import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { customerProjectActivityDraft } from "../src/lib/customer-project-activity-notifications.ts";
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

test("quote deep links scroll and focus the structured response section", () => {
  assert.match(
    styles,
    /#structured-quote-options\s*\{\s*scroll-margin-top:\s*24px;/,
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
