import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const verification = read("../src/components/DirectTradeVerificationCentre.tsx");
const membership = read("../src/app/direct-trade/membership/page.tsx");
const profileRoute = read("../src/app/api/trade-profile/route.ts");
const schema = read("../db/schema.ts");
const standards = read("../src/app/direct-trade/standards/page.tsx");
const partners = read("../src/components/DirectTradePartnerForm.tsx");

test("dashboard availability and email preferences are durable and owner protected", () => {
  assert.match(schema, /availabilityStatus: text\("availability_status"\)/);
  assert.match(schema, /emailOpportunities: integer\("email_opportunities"/);
  assert.match(schema, /emailWeeklySummary: integer\("email_weekly_summary"/);
  assert.match(profileRoute, /export async function PATCH/);
  assert.match(profileRoute, /requireFirebaseIdentity/);
  assert.match(profileRoute, /sameOrigin/);
  assert.match(profileRoute, /\["open", "limited", "paused"\]/);
  assert.match(profileRoute, /WHERE firebase_uid = \?/);
  assert.match(dashboard, /Save dashboard preferences/);
  assert.match(dashboard, /Matching remains inactive until verification and paid membership launch/);
});

test("verification centre changes evidence guidance by business role", () => {
  assert.match(verification, /const installerChecks/);
  assert.match(verification, /const supplierChecks/);
  assert.match(verification, /profile\?\.partnerType === "supplier"/);
  assert.match(verification, /Trade licence or registration/);
  assert.match(verification, /Product compliance evidence/);
  assert.match(verification, /Document upload is not open yet/);
  assert.match(verification, /private, access-controlled storage/);
  assert.doesNotMatch(verification, /type="file"|FormData|R2/);
});

test("membership page presents all approved prices and no per-lead model", () => {
  assert.match(membership, /\$99/);
  assert.match(membership, /\$1,188 billed once per year/);
  assert.match(membership, /\$199/);
  assert.match(membership, /\$2,388 billed once per year/);
  assert.match(membership, /\$399/);
  assert.match(membership, /All prices include GST/);
  assert.match(membership, /One subscription, no per-lead fees/);
  assert.match(membership, /Stripe is not connected/);
  assert.match(membership, /both businesses receive one month of membership credit/);
  assert.match(membership, /Self-referrals and duplicate businesses are excluded/);
});

test("membership and verification routes are connected across the account journey", () => {
  assert.match(dashboard, /href="\/direct-trade\/dashboard\/verification"/);
  assert.match(dashboard, /href="\/direct-trade\/membership"/);
  assert.match(partners, /View membership pricing/);
  assert.match(standards, /Membership and referrals/);
});

test("new dashboard, verification and membership copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(dashboard + verification + membership, /[\u2013\u2014]/);
});
