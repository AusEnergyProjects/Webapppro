import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(directory, relativePath), "utf8");
const page = read("../src/app/assessments/page.tsx");
const home = read("../src/components/GettingStarted.tsx");
const guides = read("../src/app/guides/page.tsx");
const chrome = read("../src/components/ComparatorChrome.tsx");
const styles = read("../src/app/globals.css");

test("assessment services are first class routes across the site", () => {
  assert.match(chrome, /href: "\/assessments", label: "NatHERS & ratings"/);
  assert.match(home, /Use NatHERS, BASIX or an existing-home rating where it fits/);
  assert.match(home, /href="\/assessments"/);
  assert.match(guides, /Need a NatHERS or BASIX assessment/);
  assert.match(guides, /href="\/assessments"/);
});

test("the hub separates new homes, existing homes and NSW BASIX", () => {
  assert.match(page, /New homes and major renovations/);
  assert.match(page, /uses plans and design documents before construction/);
  assert.match(page, /Homes that are already built/);
  assert.match(page, /assesses the home as it exists/);
  assert.match(page, /Home Energy Rating from 0 to 100\+/);
  assert.match(page, /Star Rating from 0 to 10/);
  assert.match(page, /cannot demonstrate National Construction Code compliance/);
  assert.match(page, /BASIX is a NSW planning requirement/);
  assert.match(page, /alterations and additions costing \$50,000 or more/);
  assert.match(page, /swimming pools of 40,000 litres or more/);
});

test("official sources, date and approval boundaries remain visible", () => {
  assert.match(page, /Official guidance checked 1 September 2026/);
  assert.match(page, /requirements can change/);
  assert.match(page, /homeenergyrating\.gov\.au\/households\/new-homes/);
  assert.match(page, /homeenergyrating\.gov\.au\/households\/existing-homes/);
  assert.match(page, /planningportal\.nsw\.gov\.au\/basix\/about-basix/);
  assert.match(page, /planningportal\.nsw\.gov\.au\/basix-thermal-performance-section/);
  assert.match(page, /does not replace the approval authority/);
  assert.doesNotMatch(page, /cdr\.|\/cds-au\/|\/api\//);
});

test("the hub explains the 2026 brand transition and provides a booking path", () => {
  assert.match(page, /Home Energy Rating is the new existing-home consumer brand/);
  assert.match(page, /Residential Efficiency Scorecard service closed on 23 June 2026/);
  assert.match(page, /Whole of Home is a new-home rating/);
  assert.match(page, /href="\/home-energy-rating-vs-nathers-vs-scorecard"/);
  assert.match(page, /href="\/residential-efficiency-scorecard"/);
  assert.match(page, /href="\/book-an-assessment"/);
  assert.doesNotMatch(page, /type="file"|<input/);
});

test("assessment cards align on desktop and stack on mobile", () => {
  assert.match(styles, /\.assessment-card-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.assessment-card \{[^}]*display: grid;[^}]*grid-row: span 5;[^}]*grid-template-rows: subgrid/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*\.assessment-card \{ display: flex; grid-row: auto; min-height: 0; \}/);
  assert.match(styles, /\.assessment-home-grid[^\n]*\.assessment-card-grid[^\n]*\.assessment-process[^\n]*\.assessment-two-column/);
});

test("assessment customer copy contains no prohibited dash characters", () => {
  assert.doesNotMatch(`${page}${home}${guides}`, /\u2013|\u2014/);
});
