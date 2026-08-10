import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const standards = read("../src/app/direct-trade/standards/page.tsx");
const homepage = read("../src/components/GettingStarted.tsx");
const household = read("../src/components/DirectTradeProjectBrief.tsx");
const partners = read("../src/components/DirectTradePartnerForm.tsx");
const opportunities = read("../src/app/api/trade-opportunities/route.ts");

test("Direct Trade standards are connected to every marketplace entry journey", () => {
  assert.match(homepage, /href="\/direct-trade\/standards">Read the marketplace standards/);
  assert.match(
    household,
    /href="\/direct-trade\/standards"[\s\S]*Read the marketplace standards/,
  );
  assert.match(household, /href="\/account\/projects\/new"/);
  assert.match(partners, /href="\/direct-trade\/standards">Read the marketplace and customer standards/);
});

test("standards separate free platform access from licensing and scheme approval", () => {
  assert.match(standards, /TLink access does not replace it/);
  assert.match(
    standards,
    /legal, licensing, safety, scheme and\s+consumer obligation/,
  );
  assert.match(
    standards,
    /marketplace standards do not replace Australian Consumer Law,\s+trade licensing, safety rules, scheme requirements/,
  );
});

test("matching and funding rules do not permit paid ranking claims", () => {
  assert.match(
    standards,
    /Payment does not buy placement, exclusivity or guaranteed work/,
  );
  assert.match(
    standards,
    /does not replace\s+verification, purchase a favourable ranking or create a separate\s+charge for each opportunity/,
  );
  assert.match(
    standards,
    /every active platform-approved installer whose recorded services and active service area match/,
  );
});

test("standards enforce open qualified matching and household-controlled contact release", () => {
  assert.match(standards, /Households control what is shared/);
  assert.match(standards, /email, postcode, selected services and any written message to all approved matching trades/);
  assert.match(
    standards,
    /full home plan, PDF, bills, meter data and documents stay private/,
  );
  assert.match(standards, /chooses whether those trades also receive the name, phone or full property address/);
  assert.match(standards, /unit number, street address, suburb, state and postcode in the protected administration record/);
  assert.match(standards, /Property photos and documents are shared only when the household explicitly approves/);
  assert.match(standards, /Wholesalers manage products and pricing only/);
  assert.match(standards, /never see household opportunities or customer contact/);
  assert.match(opportunities, /suburb: matchingLocality\.suburb/);
  assert.match(opportunities, /postcode: matchingLocality\.postcode/);
  assert.match(opportunities, /notice_version = '\$\{CUSTOMER_MATCHING_NOTICE_VERSION\}'/);
  assert.match(opportunities, /distanceBand: distanceBand\(row\.distance_metres\)/);
  assert.match(opportunities, /public_trade_lead_contact_releases/);
  assert.match(opportunities, /public_contact\.status = 'active'/);
  assert.match(opportunities, /m\.firebase_uid = \?/);
  assert.match(opportunities, /Wholesalers cannot access or respond to household opportunities/);
});

test("standards cover structured quote evidence, customer choice and participant review", () => {
  assert.match(standards, /Product brand, model, quantity and capacity/);
  assert.match(standards, /Certificate or rebate assumptions shown separately/);
  assert.match(
    standards,
    /Submitting the enquiry releases only the contact fields named in the consent/,
  );
  assert.match(opportunities, /action === "submit_quote"/);
  assert.match(opportunities, /INSERT INTO customer_project_quotes/);
  assert.match(standards, /review, suspension or removal/);
});

test("Direct Trade standards copy contains no prohibited dash characters", () => {
  assert.doesNotMatch(standards, /[—–]/);
});
