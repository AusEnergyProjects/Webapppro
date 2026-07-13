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

test("the homepage provides a getting-started journey instead of redirecting", () => {
  assert.match(home, /GettingStarted/);
  assert.doesNotMatch(home, /redirect\(/);
  assert.match(guide, /Make a confident energy decision/);
  assert.match(guide, /Bring a recent bill/);
  assert.match(guide, /Confirm before switching/);
});

test("shared navigation connects the start, electricity and gas journeys", () => {
  assert.match(chrome, /href: "\/getting-started"/);
  assert.match(chrome, /href: "\/compare"/);
  assert.match(chrome, /href: "\/gas-compare"/);
  assert.match(electricity, /SiteNav active="electricity"/);
  assert.match(gas, /SiteNav active="gas"/);
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
