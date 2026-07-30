import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const dialog = read("../src/components/CustomerDraftDeleteDialog.tsx");
const styles = read("../src/components/CustomerDraftDeleteDialog.module.css");

test("draft deletion requires an accessible, safe confirmation dialog", () => {
  assert.match(dialog, /export function CustomerDraftDeleteDialog/);
  assert.match(dialog, /open: boolean/);
  assert.match(dialog, /projectTitle: string/);
  assert.match(dialog, /busy: boolean/);
  assert.match(dialog, /error: string/);
  assert.match(dialog, /recovery: boolean/);
  assert.match(dialog, /returnFocus: HTMLElement \| null/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby=\{titleId\}/);
  assert.match(dialog, /aria-describedby=\{descriptionId\}/);
  assert.match(dialog, /ref=\{keepButtonRef\}/);
  assert.match(dialog, /recovery \? "Not now" : "Keep draft"/);
  assert.match(
    dialog,
    /recovery[\s\S]*Finish secure deletion[\s\S]*Finish deleting/,
  );
  assert.match(dialog, /role="alert"/);
});

test("draft deletion traps focus and blocks dismissal while busy", () => {
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /if \(!busy\)/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /event\.shiftKey/);
  assert.match(dialog, /querySelectorAll<HTMLElement>/);
  assert.match(dialog, /event\.currentTarget === event\.target && !busy/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(dialog, /returnTarget\?\.isConnected/);
  assert.match(dialog, /returnTarget\.focus\(\)/);
  assert.match(dialog, /disabled=\{busy\}/);
  assert.match(
    dialog,
    /busy[\s\S]*"Deleting\.\.\."[\s\S]*recovery[\s\S]*"Finish deleting"[\s\S]*"Delete draft"/,
  );
  assert.match(styles, /min-height: 2\.75rem/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});
