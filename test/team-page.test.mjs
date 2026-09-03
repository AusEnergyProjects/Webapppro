import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/app/team/page.tsx");
const styleBoundary = read("../src/app/team/TeamPageStyles.tsx");
const styles = read("../src/app/team/team-page.css");

test("team portraits use one compact professional crop and tone", () => {
  assert.match(page, /<TeamPageStyles \/>/);
  assert.match(styleBoundary, /"use client"/);
  assert.match(styleBoundary, /import "\.\/team-page\.css"/);
  assert.match(page, /className="team-page-portrait"/);
  assert.match(page, /--portrait-position/);
  assert.match(page, /--portrait-scale/);
  assert.match(page, /sizes="\(max-width: 420px\) 44vw, 220px"/);
  assert.match(styles, /grid-template-columns: repeat\(auto-fit, minmax\(160px, 180px\)\)/);
  assert.match(styles, /aspect-ratio: 4 \/ 5/);
  assert.match(styles, /filter: saturate\(\.78\) contrast\(\.96\) brightness\(\.94\)/);
  assert.match(styles, /max-width: none/);
  assert.match(styles, /height: 130%[\s\S]*width: 130%/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});
