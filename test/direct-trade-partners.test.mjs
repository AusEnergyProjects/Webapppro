import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/app/direct-trade/partners/page.tsx");
const form = read("../src/components/DirectTradePartnerForm.tsx");
const homepage = read("../src/components/GettingStarted.tsx");
const route = read("../src/app/api/leads/route.js");
const profileRoute = read("../src/app/api/trade-profile/route.ts");
const firebaseClient = read("../src/lib/firebase-client.ts");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const dashboardPage = read("../src/app/direct-trade/dashboard/page.tsx");

test("the homepage connects installers and suppliers to a participation route", () => {
  assert.match(homepage, /href="\/direct-trade\/partners">Trade and supplier participation/);
  assert.match(homepage, /reputable suppliers/i);
  assert.match(form, /Create your free TLink account/);
  assert.match(form, /No card or subscription/i);
  assert.doesNotMatch(form, /free lead|included lead|paid lead/i);
  assert.match(page, /DirectTradePartnerForm/);
});

test("trade accounts use Firebase identity and protected same-origin profile storage", () => {
  assert.match(form, /createUserWithEmailAndPassword/);
  assert.match(form, /signInWithPopup/);
  assert.match(firebaseClient, /australian-energy-assessments\.firebaseapp\.com/);
  assert.match(form, /fetch\("\/api\/trade-profile"/);
  assert.match(form, /Authorization: `Bearer \$\{token\}`/);
  assert.match(profileRoute, /requireFirebaseIdentity/);
  assert.match(profileRoute, /sameOrigin/);
  assert.match(form, /partnerType/);
  assert.match(form, /serviceStates/);
  assert.match(form, /capabilities/);
  assert.match(form, /addressLine1/);
  assert.match(form, /addressState/);
  assert.match(form, /postcode/);
  assert.match(form, /consent: true/);
  assert.match(profileRoute, /Enter the business street address/);
  assert.match(profileRoute, /Enter a four digit business postcode/);
  assert.match(profileRoute, /billingStatus: "not_connected"/);
  assert.doesNotMatch(profileRoute, /free_leads_remaining|try_one_lead/);
  assert.doesNotMatch(form, /script\.google\.com|no-cors/);
});

test("Google sign in uses the official identity mark rather than a simulated badge", () => {
  assert.match(form, /www\.gstatic\.com\/firebasejs\/ui\/2\.0\.0\/images\/auth\/google\.svg/);
  assert.doesNotMatch(form, /aria-hidden="true">G<\/span>/);
});

test("the starter dashboard makes verified core access free", () => {
  assert.match(dashboardPage, /DirectTradeDashboard/);
  assert.match(dashboard, /No opportunities assigned/);
  assert.match(dashboard, /Core trade operations cost A\$0/);
  assert.match(dashboard, /No card or subscription is required/);
  assert.doesNotMatch(dashboard, /Start annual membership with Stripe|including GST/);
  assert.match(form, /Referral recorded/);
  assert.match(form, /referralCode/);
  assert.match(dashboard, /partnerType === "supplier"/);
});

test("partner form avoids collecting sensitive verification documents", () => {
  assert.match(form, /Do not upload or paste licence documents, identity records, customer lists, wholesale price files or confidential contracts/);
  assert.match(form, /does not replace licensing, accreditation, insurance or scheme requirements/);
});

test("partner form uses visible shared controls and required address fields", () => {
  const css = read("../src/app/globals.css");
  assert.match(form, /Business name"[\s\S]{0,80}<input required type="text"/);
  assert.match(form, /Business website" optional="optional"[\s\S]{0,80}<input type="url"/);
  assert.match(form, /Business street address"[\s\S]{0,80}<input required type="text"/);
  assert.match(form, /State or territory"[\s\S]{0,80}<select required/);
  assert.match(form, /Contact name"[\s\S]{0,80}<input required type="text"/);
  assert.match(css, /--color-aea-line-strong: #a9c9bd/);
  assert.match(css, /\.direct-trade-form-section \.field-control > input/);
  assert.match(css, /\.direct-trade-form-section \.field-control > select/);
  assert.match(css, /\.partner-type-grid label:focus-within/);
});

test("unconfigured enquiry copy is suitable for any hosted environment", () => {
  assert.doesNotMatch(route, /local environment/);
  assert.match(route, /temporarily unavailable\. Please call 1300 241 149/);
});

test("new Direct Trade account and dashboard copy contains no prohibited dash characters", () => {
  assert.doesNotMatch(page + form + dashboard + dashboardPage, /[\u2013\u2014]/);
});
