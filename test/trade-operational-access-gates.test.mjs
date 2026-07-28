import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const appointments = read("../src/lib/appointment-notification-server.ts");
const callback = read("../src/app/api/trade-integrations/callback/[provider]/route.ts");
const notifications = read("../src/lib/admin-notifications.ts");
const adminSession = read("../src/app/api/admin/session/route.ts");
const adminLookups = read("../src/app/api/admin/lookups/route.ts");
const usabilityPilot = read("../src/app/api/admin/usability-pilot/route.ts");

test("appointment messages are suppressed when the trade business loses reviewed access", () => {
  assert.match(appointments, /CASE WHEN \$\{verifiedTradeAccountPredicate\("trade"\)\} THEN 1 ELSE 0 END trade_access_approved/);
  assert.match(appointments, /Number\(context\.trade_access_approved\) !== 1/);
  assert.match(appointments, /does not currently have approved access/);
});

test("OAuth callbacks recheck reviewed access before exchange and when attaching credentials", () => {
  assert.ok((callback.match(/verifiedTradeAccountPredicate/g) || []).length >= 3);
  assert.match(callback, /if \(!approvedAccount\) throw new OAuthCallbackFailure\("TRADE_ACCESS_REVOKED"/);
  assert.match(callback, /SELECT \?, approved_account\.firebase_uid/);
  assert.match(callback, /if \(Number\(attached\.meta\.changes \|\| 0\) !== 1\)/);
});

test("admin metrics and operational candidates use exact reviewed trade access", () => {
  assert.ok((adminSession.match(/verifiedTradeAccountPredicate\("account"\)/g) || []).length >= 5);
  assert.match(adminLookups, /verifiedTradeAccountPredicate\("account"\)/);
  assert.match(adminLookups, /verifiedTradeAccountPredicate\("a"\)/);
  assert.ok((usabilityPilot.match(/verifiedTradeAccountPredicate\("account"\)/g) || []).length >= 2);
});

test("the v2 notification backfill reconciles legacy approved rows without granting access", () => {
  assert.match(notifications, /platform:notification-backfill:v2/);
  assert.match(notifications, /platform:notification-backfill:v1/);
  assert.match(notifications, /a\.verification_status = 'approved'/);
  assert.match(notifications, /NOT \(\$\{verifiedTradeAccountPredicate\("a"\)\}\)/);
  assert.match(notifications, /trade\.identity_review_required/);
  assert.match(notifications, /Access remains withheld until an authorised review is recorded/);
  assert.doesNotMatch(notifications, /UPDATE trade_accounts SET verification_status = 'approved'/);
});
