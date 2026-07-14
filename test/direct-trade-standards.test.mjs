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

test("standards separate membership from licensing and scheme approval", () => {
  assert.match(standards, /Direct Trade membership does not replace it/);
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
    /subscription does not buy higher placement, exclusivity or\s+guaranteed work/,
  );
  assert.match(
    standards,
    /will not replace\s+verification, purchase a favourable ranking or create a separate\s+charge for each opportunity/,
  );
  assert.match(
    standards,
    /Postcode distance, the installer service radius, capability, verification, availability and recent allocation load guide the selection/,
  );
});

test("standards enforce private accounts and platform-only installer responses", () => {
  assert.match(standards, /Household contact stays private/);
  assert.match(standards, /respond through structured platform controls/);
  assert.match(
    standards,
    /Customer names, emails, phone numbers, street addresses and direct messaging are not available to trade accounts/,
  );
  assert.match(standards, /Wholesalers manage products and pricing only/);
  assert.match(standards, /never see household opportunities or customer contact/);
  assert.match(opportunities, /postcode: ""/);
  assert.match(opportunities, /distanceBand: distanceBand\(row\.distance_metres\)/);
  assert.match(opportunities, /Direct customer contact is not available\. Respond through the structured platform workflow/);
  assert.match(opportunities, /Wholesalers cannot access or respond to household opportunities/);
});

test("standards cover structured quote evidence, customer choice and participant review", () => {
  assert.match(standards, /Product brand, model, quantity and capacity/);
  assert.match(standards, /Certificate or rebate assumptions shown separately/);
  assert.match(
    standards,
    /Households can compare structured options, confirm credentials with the issuing authority and decline without creating an installation contract or releasing contact details/,
  );
  assert.match(opportunities, /action === "submit_quote"/);
  assert.match(opportunities, /INSERT INTO customer_project_quotes/);
  assert.match(standards, /review, suspension or removal/);
});

test("Direct Trade standards copy contains no prohibited dash characters", () => {
  assert.doesNotMatch(standards, /[—–]/);
});
