import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const page = read("../src/app/case-studies/page.tsx");
const start = read("../src/components/GettingStarted.tsx");
const guides = read("../src/app/guides/page.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");

test("worked examples are connected to the shared journey", () => {
  assert.match(chrome, /"case-studies"/);
  assert.match(page, /SiteHeader active="case-studies"/);
  assert.match(guides, /href="\/case-studies"/);
  assert.match(start, /Open all guides, rebates and worked examples/);
});

test("worked examples expose evidence, method, lessons and limitations", () => {
  assert.match(page, /Illustrative scenarios, not customer case studies/);
  assert.match(page, /Evidence used/);
  assert.match(page, /Method/);
  assert.match(page, /Decision lesson/);
  assert.match(page, /Important limitation/);
  assert.match(page, /same annual usage can produce a different plan ranking/);
  assert.match(page, /Exports do not show how much solar the home used directly/);
  assert.match(page, /winter gas bill should not be multiplied as if usage were flat/);
});

test("future customer publication boundaries protect privacy and credibility", () => {
  assert.match(page, /explicitly consented to publication/);
  assert.match(page, /NMI details, filenames and contact data are removed/);
  assert.match(page, /Before and after periods are long enough and genuinely comparable/);
  assert.match(page, /Costs, savings and payback remain indicative/);
  assert.doesNotMatch(page, /\u2013|\u2014/);
});
