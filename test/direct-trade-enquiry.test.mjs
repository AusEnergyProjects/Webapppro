import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const route = read("../src/app/direct-trade/page.tsx");
const brief = read("../src/components/DirectTradeProjectBrief.tsx");
const homepage = read("../src/components/GettingStarted.tsx");
const upgradeModal = read("../src/components/UpgradeEnquiryModal.tsx");

test("Direct Trade household project brief is routed from the homepage", () => {
  assert.match(route, /DirectTradeProjectBrief/);
  assert.match(route, /Direct Trade Project Brief/);
  assert.match(homepage, /href="\/direct-trade">Start a project brief/);
  assert.doesNotMatch(homepage, /direct-trade-status|Live service, expanding tool/);
});

test("project brief uses the same-origin consented lead route", () => {
  assert.match(brief, /fetch\("\/api\/leads"/);
  assert.match(brief, /submissionType: "upgrade"/);
  assert.match(brief, /enquiry: "direct-trade-project"/);
  assert.match(brief, /Respond to this Direct Trade household project brief/);
  assert.match(brief, /projectCategories: selectedServices/);
  assert.match(brief, /Do not include your street address, NMI, meter file, energy bill/);
  assert.doesNotMatch(brief, /script\.google\.com|mode: "no-cors"/);
});

test("existing gas upgrade enquiries use the protected lead route and consent", () => {
  assert.match(upgradeModal, /fetch\("\/api\/leads"/);
  assert.match(upgradeModal, /consent: \{ accepted: true/);
  assert.doesNotMatch(upgradeModal, /script\.google\.com|mode: "no-cors"/);
});

test("Direct Trade project copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(route + brief, /\u2013|\u2014/);
});
