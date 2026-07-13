import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/app/direct-trade/partners/page.tsx");
const form = read("../src/components/DirectTradePartnerForm.tsx");
const homepage = read("../src/components/GettingStarted.tsx");
const route = read("../src/app/api/leads/route.js");

test("the homepage connects installers and suppliers to a participation route", () => {
  assert.match(homepage, /href="\/direct-trade\/partners">Trade and supplier participation/);
  assert.match(homepage, /Product, warranty, support and supply evidence/);
  assert.match(page, /DirectTradePartnerForm/);
});

test("partner expressions use the protected same-origin lead route", () => {
  assert.match(form, /fetch\("\/api\/leads"/);
  assert.match(form, /enquiry: "direct-trade-partner"/);
  assert.match(form, /partnerType/);
  assert.match(form, /serviceStates/);
  assert.match(form, /projectCategories/);
  assert.match(form, /consent:/);
  assert.doesNotMatch(form, /script\.google\.com|no-cors/);
});

test("partner form avoids collecting sensitive verification documents", () => {
  assert.match(form, /Do not upload or paste licence documents, identity records, customer lists, wholesale price files or confidential contracts/);
  assert.match(form, /does not create membership, accreditation, exclusivity or guaranteed opportunity volume/);
});

test("unconfigured enquiry copy is suitable for any hosted environment", () => {
  assert.doesNotMatch(route, /local environment/);
  assert.match(route, /temporarily unavailable\. Please call 1300 241 149/);
});

test("new Direct Trade participation copy contains no prohibited dash characters", () => {
  assert.doesNotMatch(page + form, /[—–]/);
});
