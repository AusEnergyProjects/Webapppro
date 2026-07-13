import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("the application uses one fixed deep-blue gradient canvas", () => {
  assert.match(css, /--surface-page: #020b18/);
  assert.match(css, /body \{ background: radial-gradient\(circle at 8% -4%, rgba\(18, 126, 167, \.38\)/);
  assert.match(css, /linear-gradient\(155deg, #020713 0%, #031529 42%, #061d30 70%, #020b18 100%\)/);
  assert.match(css, /background-attachment: fixed/);
});

test("canvas headings and footer remain readable on the dark background", () => {
  assert.match(css, /--canvas-text: #f4fbff/);
  assert.match(css, /--canvas-muted: #b9ccd7/);
  assert.match(css, /\.guide-section-heading h2 \{ color: var\(--canvas-text\)/);
  assert.match(css, /footer \{ border-top: 1px solid rgba\(132, 190, 202, \.26\); color: #a9c2ce/);
  assert.match(css, /footer a \{ color: #6ee7b7/);
});

test("light content surfaces retain contrast and stronger depth", () => {
  assert.match(css, /--color-aea-card: #ffffff/);
  assert.match(css, /--shadow-card: 0 18px 46px rgba\(0, 5, 14, \.38\)/);
  assert.match(css, /--shadow-card-hover: 0 24px 56px rgba\(0, 5, 14, \.5\)/);
  assert.match(css, /\.start-prepare \.start-heading h2 \{ color: var\(--color-aea-ink\)/);
});
