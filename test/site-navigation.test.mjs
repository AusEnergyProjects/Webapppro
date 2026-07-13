import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const home = read("../src/app/page.tsx");
const guide = read("../src/components/GettingStarted.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const electricity = read("../src/app/compare/page.tsx");
const gas = read("../src/app/gas-compare/page.tsx");
const styles = read("../src/app/globals.css");
const rebates = read("../src/components/RebatesHub.tsx");
const rebatesRoute = read("../src/app/rebates/page.tsx");

test("the homepage provides a getting-started journey instead of redirecting", () => {
  assert.match(home, /GettingStarted/);
  assert.doesNotMatch(home, /redirect\(/);
  assert.match(guide, /Make a confident energy decision/);
  assert.match(guide, /Bring a recent bill/);
  assert.match(guide, /Confirm before switching/);
});

test("shared navigation connects the start, electricity and gas journeys", () => {
  assert.match(chrome, /export function SiteHeader/);
  assert.match(chrome, /className="site-header"/);
  assert.match(chrome, /href: "\/getting-started"/);
  assert.match(chrome, /href: "\/compare"/);
  assert.match(chrome, /href: "\/gas-compare"/);
  assert.match(electricity, /SiteHeader active="electricity"/);
  assert.match(gas, /SiteHeader active="gas"/);
  assert.match(chrome, /href: "\/rebates"/);
  assert.match(rebatesRoute, /RebatesHub/);
  assert.match(rebates, /SiteHeader active="rebates"/);
});

test("shared visual foundation uses the polished responsive system", () => {
  assert.match(styles, /family=Manrope/);
  assert.match(styles, /family=Source\+Serif\+4/);
  assert.match(styles, /\.site-header \{/);
  assert.match(styles, /radial-gradient\(circle at 8% 0%/);
  assert.match(styles, /\.comparator-nav::-webkit-scrollbar \{ display: none; \}/);
  assert.match(styles, /a:focus-visible/);
});

test("rebates hub makes location boundaries and source confirmation visible", () => {
  assert.match(rebates, /Choose your state or territory/);
  assert.match(rebates, /Select a state or territory/);
  assert.match(rebates, /Federal certificates and programs/);
  assert.match(rebates, /State, territory and provider support/);
  assert.match(rebates, /Information checked 14 July 2026/);
  assert.match(rebates, /Official program pages remain the source of truth/);
  assert.match(rebates, /Open official source and confirm/);
  assert.match(rebates, /Solar PV, solar hot water and eligible heat pump hot water/);
  assert.match(rebates, /insulation and draught proofing/);
  assert.match(rebates, /Heating and cooling/);
  assert.match(rebates, /[A-Z][A-Za-z ]+ Government/);
});

test("rebates hub contains no prohibited dash characters", () => {
  assert.doesNotMatch(`${rebates}${rebatesRoute}`, /\u2013|\u2014/);
});

test("homepage hero actions keep visible text on distinct backgrounds", () => {
  assert.match(styles, /\.start-actions \.btn\.ghost \{ background: rgba\(255, 255, 255, \.08\);/);
  assert.match(styles, /\.start-actions \.btn\.ghost:hover, \.start-actions \.btn\.ghost:focus-visible \{ background: #fff; color: var\(--color-aea-ink\); \}/);
});

test("getting-started copy preserves comparison and privacy boundaries", () => {
  assert.match(guide, /Mains gas plans only, not LPG/);
  assert.match(guide, /Your meter file stays on your device/);
  assert.match(guide, /not included in saved comparison links or enquiry data/);
  assert.match(guide, /Estimates are indicative/);
  assert.doesNotMatch(guide, /[–—]/);
});
