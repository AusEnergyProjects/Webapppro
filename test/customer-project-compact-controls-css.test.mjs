import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const styles = fs.readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("project detail controls stay compact beside a tall project plan", () => {
  assert.match(
    styles,
    /\.customer-project-detail-grid\s*\{[^}]*align-items:\s*start;/s,
  );
  assert.match(
    styles,
    /\.customer-project-sidebar\s*\{[^}]*align-content:\s*start;[^}]*align-self:\s*start;/s,
  );
  assert.match(
    styles,
    /\.customer-project-controls\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s,
  );
  assert.match(
    styles,
    /\.customer-project-controls button\s*\{[^}]*align-items:\s*center;[^}]*display:\s*flex;[^}]*min-height:\s*44px;/s,
  );
  assert.match(
    styles,
    /\.customer-project-controls button\.primary\s*\{[^}]*justify-content:\s*center;/s,
  );
});

test("project cards expose a compact desktop action row and equal mobile controls", () => {
  assert.match(
    styles,
    /\.customer-project-card-actions\s*\{[^}]*display:\s*flex;[^}]*gap:\s*8px;/s,
  );
  assert.match(
    styles,
    /\.customer-project-card-actions > a,\s*\.customer-project-card-actions > button\s*\{[^}]*border-radius:\s*10px;[^}]*min-height:\s*44px;/s,
  );
  assert.match(
    styles,
    /\.customer-project-card-actions > button,\s*\.customer-project-card-delete\s*\{[^}]*border:\s*1px solid #d9a7a2;[^}]*color:\s*#8b342c;/s,
  );
  assert.match(
    styles,
    /\.customer-project-card-actions > a,\s*\.customer-project-card-open\s*\{[^}]*background:\s*#08794c;[^}]*color:\s*#fff;/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*560px\)[\s\S]*?\.customer-project-card-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*width:\s*100%;/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*560px\)[\s\S]*?\.customer-project-card-actions > a,\s*\.customer-project-card-actions > button\s*\{[^}]*min-height:\s*44px;[^}]*width:\s*100%;/s,
  );
});
