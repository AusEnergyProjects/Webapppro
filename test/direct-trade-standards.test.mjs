import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const standards = read("../src/app/direct-trade/standards/page.tsx");
const homepage = read("../src/components/GettingStarted.tsx");
const household = read("../src/components/DirectTradeProjectBrief.tsx");
const partners = read("../src/components/DirectTradePartnerForm.tsx");

test("Direct Trade standards are connected to every marketplace entry journey", () => {
  assert.match(homepage, /href="\/direct-trade\/standards">Read the marketplace standards/);
  assert.match(household, /href="\/direct-trade\/standards">See how matching, verification and quotes work/);
  assert.match(partners, /href="\/direct-trade\/standards">Read the marketplace and customer standards/);
});

test("standards separate membership from licensing and scheme approval", () => {
  assert.match(standards, /Direct Trade membership does not replace it/);
  assert.match(standards, /legal, licensing, safety, scheme and consumer obligation/);
  assert.match(standards, /marketplace standards do not replace Australian Consumer Law, trade licensing, safety rules, scheme requirements/);
});

test("matching and funding rules do not permit paid ranking claims", () => {
  assert.match(standards, /subscription does not buy higher placement, exclusivity or a guaranteed volume of opportunities/);
  assert.match(standards, /does not purchase a favourable ranking/);
  assert.match(standards, /Location, work type, verified capability, service coverage and availability guide a connection/);
});

test("standards cover quote evidence, customer choice and participant review", () => {
  assert.match(standards, /Product brand, model, quantity and capacity/);
  assert.match(standards, /Certificate or rebate assumptions shown separately/);
  assert.match(standards, /Households can ask questions, compare quotes, confirm credentials/);
  assert.match(standards, /review, suspension or removal/);
});

test("Direct Trade standards copy contains no prohibited dash characters", () => {
  assert.doesNotMatch(standards, /[—–]/);
});
