import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addIsoDays, buildCalendarMonth, formatDateForDisplay, parseIsoDate } from "../src/lib/date-picker.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));

test("calendar month always renders a six-week grid with adjacent dates", () => {
  const days = buildCalendarMonth(2025, 2);
  assert.equal(days.length, 42);
  assert.equal(days[0].iso, "2025-02-23");
  assert.equal(days.find((day) => day.iso === "2025-03-07")?.inCurrentMonth, true);
});

test("calendar date parsing rejects impossible dates and enforces bounds", () => {
  assert.equal(parseIsoDate("2025-02-29"), null);
  const days = buildCalendarMonth(2025, 2, "2025-03-07", "2025-03-14");
  assert.equal(days.find((day) => day.iso === "2025-03-06")?.disabled, true);
  assert.equal(days.find((day) => day.iso === "2025-03-07")?.disabled, false);
  assert.equal(days.find((day) => day.iso === "2025-03-15")?.disabled, true);
});

test("calendar formatting and keyboard date movement use Australian labels", () => {
  assert.equal(formatDateForDisplay("2025-03-07"), "7 Mar 2025");
  assert.equal(addIsoDays("2025-03-07", 7), "2025-03-14");
});

test("the root layout installs one delegated picker for current and future date inputs", () => {
  const layout = fs.readFileSync(path.join(root, "src", "app", "layout.tsx"), "utf8");
  const picker = fs.readFileSync(path.join(root, "src", "components", "SiteDatePicker.tsx"), "utf8");
  assert.match(layout, /<SiteDatePicker \/>/);
  assert.match(picker, /target\.type === "date" \|\| target\.type === "datetime-local"/);
  assert.match(picker, /data-date-range-group/);
  assert.match(picker, />Apply<\/button>/);
  assert.match(picker, /event\.key === "Escape"/);
  assert.match(picker, /event\.key === "ArrowLeft"/);
});
