import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ACTIVE_REFERRAL_BILLING_STATUSES,
  addCalendarMonthUnix,
  generateReferralCode,
  normalizeReferralCode,
} from "../src/lib/direct-trade-referrals.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const referralRoute = read("../src/app/api/trade-referrals/route.ts");
const profileRoute = read("../src/app/api/trade-profile/route.ts");
const webhookRoute = read("../src/app/api/stripe/webhook/route.ts");
const stripeServer = read("../src/lib/stripe-referral-server.ts");

test("referral codes are high-entropy, normalised and unambiguous", () => {
  const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const code = generateReferralCode(bytes);
  assert.equal(code, "AEA-23456789AB");
  assert.equal(normalizeReferralCode(code.toLowerCase()), code);
  assert.equal(normalizeReferralCode("AEA 2345 6789 AB"), code);
  assert.equal(normalizeReferralCode("not-a-referral"), "");
  assert.equal(ACTIVE_REFERRAL_BILLING_STATUSES.has("active"), true);
  assert.equal(ACTIVE_REFERRAL_BILLING_STATUSES.has("past_due"), false);
});

test("one calendar month clamps safely at month end", () => {
  const unix = (value) => Math.floor(new Date(value).getTime() / 1000);
  const iso = (value) => new Date(value * 1000).toISOString();
  assert.equal(
    iso(addCalendarMonthUnix(unix("2026-01-31T10:15:00.000Z"))),
    "2026-02-28T10:15:00.000Z",
  );
  assert.equal(
    iso(addCalendarMonthUnix(unix("2028-01-31T10:15:00.000Z"))),
    "2028-02-29T10:15:00.000Z",
  );
  assert.equal(
    iso(addCalendarMonthUnix(unix("2026-12-15T10:15:00.000Z"))),
    "2027-01-15T10:15:00.000Z",
  );
});

test("referrals are durable, owner scoped and one reward per new business", () => {
  assert.match(schema, /sqliteTable\("trade_referral_codes"/);
  assert.match(schema, /sqliteTable\("trade_referrals"/);
  assert.match(schema, /sqliteTable\("trade_membership_credits"/);
  assert.match(schema, /trade_referrals_referred_idx/);
  assert.match(schema, /trade_membership_credits_beneficiary_idx/);
  assert.match(referralRoute, /requireFirebaseIdentity/);
  assert.match(referralRoute, /sameOrigin/);
  assert.match(referralRoute, /WHERE r\.referrer_uid = \?/);
  assert.match(profileRoute, /A business cannot refer its own account/);
  assert.match(profileRoute, /existing business profile has the same business name and postcode/i);
});

test("the first paid checkout applies two exact subscription extensions idempotently", () => {
  assert.match(webhookRoute, /qualifyReferralFromFirstPayment/);
  assert.match(stripeServer, /proration_behavior/);
  assert.match(stripeServer, /trial_end/);
  assert.match(stripeServer, /Idempotency-Key/);
  assert.match(stripeServer, /aea-referral-\$\{credit\.id\}/);
  assert.match(stripeServer, /Number\(applied\?\.count \|\| 0\) === 2/);
  assert.match(stripeServer, /STRIPE_REFERRAL_SECRET_KEY/);
  assert.doesNotMatch(stripeServer, /rk_live_|sk_live_/);
});
