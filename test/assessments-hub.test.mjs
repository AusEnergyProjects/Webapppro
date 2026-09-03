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
const navigation = read("../src/components/ResponsiveSiteNav.tsx");
const styles = read("../src/app/globals.css");

test("assessment services are first class routes across the site", () => {
  assert.match(navigation, /\["\/assessments", "Assessment types"\]/);
  assert.match(home, /Building or designing a new home\? NatHERS assesses the plans/);
  assert.match(home, /href="\/assessments"/);
  assert.match(guides, /Need a NatHERS or BASIX assessment/);
  assert.match(guides, /href="\/assessments"/);
});

test("the hub separates new homes, existing homes and NSW BASIX", () => {
  assert.match(page, /New homes and major renovations/);
  assert.match(page, /Still working from plans\? A NatHERS assessor models the proposed home before construction/);
  assert.match(page, /Homes that are already built/);
  assert.match(page, /Want to understand how your current home performs and what to improve first/);
  assert.match(page, /Home Energy Rating from 0 to 100\+/);
  assert.match(page, /Star Rating from 0 to 10/);
  assert.match(page, /not the certificate used to prove new-home building-code compliance/);
  assert.match(page, /Building or renovating in NSW\? BASIX is part of the planning process/);
  assert.match(page, /alterations and additions costing \$50,000 or more/);
  assert.match(page, /swimming pools of 40,000 litres or more/);
});

test("official sources, date and approval boundaries remain visible", () => {
  assert.match(page, /Official guidance checked 1 September 2026/);
  assert.match(page, /Requirements can change/);
  assert.match(page, /homeenergyrating\.gov\.au\/households\/new-homes/);
  assert.match(page, /homeenergyrating\.gov\.au\/households\/existing-homes/);
  assert.match(page, /planningportal\.nsw\.gov\.au\/development-and-assessment\/basix/);
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
  assert.match(page, /What is a home energy assessment\?/);
  assert.match(page, /How much does a home energy assessment cost\?/);
  assert.match(page, /"@type": "ItemList"/);
  assert.match(page, /assessmentServiceNodes/);
});

test("assessment cards align on desktop and stack on mobile", () => {
  assert.match(styles, /\.assessment-card-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.assessment-card \{[^}]*display: grid;[^}]*grid-row: span 5;[^}]*grid-template-rows: subgrid/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*\.assessment-card \{ display: flex; grid-row: auto; min-height: 0; \}/);
  assert.match(styles, /\.assessment-home-grid[^\n]*\.assessment-card-grid[^\n]*\.assessment-process[^\n]*\.assessment-two-column/);
});

test("assessment customer copy contains no prohibited dash characters", () => {
  assert.doesNotMatch(`${page}${home}${guides}`, /\u2013|\u2014/);
  assert.doesNotMatch(page, /\bAEA\b/);
  assert.match(page, /Choose the right home energy assessment/);
  assert.match(page, /Not sure where to start\?/);
});
