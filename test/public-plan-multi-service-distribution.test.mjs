import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { selectEveryQualifiedTradeRecipient } from "../src/lib/direct-trade-matching.mjs";
import { matchedServiceCategories } from "../src/lib/trade-service-matching.mjs";
import { opportunityNotificationDraft } from "../src/lib/opportunity-notifications.ts";

const opportunityServer = fs.readFileSync("src/lib/opportunity-server.ts", "utf8");
const notificationMigration = fs.readFileSync("drizzle/0087_trade_opportunity_notifications.sql", "utf8");
const notificationRoute = fs.readFileSync("src/app/api/trade-job-notifications/route.ts", "utf8");

test("a multi-service public lead reaches every approved trade matching at least one selected service", () => {
  const selectedServices = ["solar", "battery", "heating-cooling", "hot-water"];
  const trades = [
    { firebaseUid: "solar-only", capabilities: ["solar"] },
    { firebaseUid: "storage-and-hvac", capabilities: ["battery", "heating-cooling"] },
    { firebaseUid: "hot-water-only", capabilities: ["hot-water"] },
    { firebaseUid: "unrelated", capabilities: ["insulation"] },
  ];
  const qualified = trades
    .map((trade) => ({
      ...trade,
      matchedCategories: matchedServiceCategories(selectedServices, trade.capabilities),
    }))
    .filter((trade) => trade.matchedCategories.length > 0);
  const recipients = selectEveryQualifiedTradeRecipient(qualified);
  assert.deepEqual(
    recipients.map((trade) => [trade.firebaseUid, trade.matchedCategories]),
    [
      ["solar-only", ["solar"]],
      ["storage-and-hvac", ["battery", "heating-cooling"]],
      ["hot-water-only", ["hot-water"]],
    ],
  );
  assert.equal(recipients.some((trade) => trade.firebaseUid === "unrelated"), false);
  assert.match(opportunityServer, /const matchedCategories = matchedServiceCategories\(categories, capabilities\)/);
  assert.match(opportunityServer, /if \(!serviceStates\.includes\(state\) \|\| !matchedCategories\.length\) return null/);
});

test("public lead distribution has no recipient cap and persists each match into CRM and notification delivery", () => {
  const qualified = Array.from({ length: 80 }, (_, index) => ({
    firebaseUid: `approved-${index}`,
    matchedCategories: ["solar"],
  }));
  assert.equal(selectEveryQualifiedTradeRecipient(qualified).length, 80);
  assert.match(opportunityServer, /selectEveryQualifiedTradeRecipient\(\s*candidates,\s*\)/);
  assert.match(opportunityServer, /await syncMarketplaceEnquiries\(db, opportunityId\)/);
  assert.match(opportunityServer, /INSERT INTO trade_crm_enquiries/);
  assert.match(opportunityServer, /service_categories = excluded\.service_categories/);
  assert.doesNotMatch(opportunityServer, /slice\(0,\s*6\)|MAX_(?:RECIPIENTS|MATCHES)\s*=\s*6/);
  assert.match(notificationMigration, /AFTER INSERT ON `trade_opportunity_matches`/);
  assert.match(notificationMigration, /INSERT OR IGNORE INTO `trade_opportunity_notification_deliveries`/);
  assert.match(notificationRoute, /targetKind: "opportunity" as const/);
});

test("each trade email names only that trade's matched services and no private plan or address", () => {
  const draft = opportunityNotificationDraft({
    businessName: "Solar Example",
    sourceKind: "public_plan_enquiry",
    customerName: "",
    customerMessage: "",
    suburb: "Private suburb",
    postcode: "3000",
    state: "VIC",
    matchedCategories: ["solar"],
    timing: "planning",
    expiresAt: "2026-09-09T00:00:00.000Z",
    customerSharedEvidenceCount: 0,
  });
  assert.match(draft.body, /Selected service: Rooftop solar/);
  assert.doesNotMatch(draft.body, /battery|heating and cooling|street|address|private suburb/i);
});
