import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(here, relativePath), "utf8");

const field = read("../src/components/HolographicEnergyField.tsx");
const landing = read("../src/components/CustomerJourneyScene.tsx");
const planner = read("../src/components/PlannerHomeJourney.tsx");
const styles = read("../src/app/globals.css");

test("public spatial scenes use deterministic progressive rendering without a heavy 3D runtime", () => {
  assert.match(field, /seededRandom\(0xa3e2026\)/);
  assert.match(field, /density === "rich"/);
  assert.match(field, /requestAnimationFrame/);
  assert.match(field, /visibilitychange/);
  assert.match(field, /ResizeObserver/);
  assert.match(field, /IntersectionObserver/);
  assert.doesNotMatch(field, /WebGL|from ["']three["']|<video/i);
});

test("pointer depth and scroll continuity have touch and reduced-motion boundaries", () => {
  assert.match(field, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(field, /event\.pointerType === "touch"/);
  assert.match(field, /prefers-reduced-motion: reduce/);
  assert.match(field, /addEventListener\("scroll"/);
  assert.match(landing, /event\.pointerType === "touch"/);
  assert.match(planner, /event\.pointerType === "touch"/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.planner-home-render-volume/);
});

test("the planner is cinematic on entry and results without blocking every active question", () => {
  assert.match(planner, /data-entry=\{safeProgress <= 5/);
  assert.match(planner, /data-stage=\{stage\}/);
  assert.match(planner, /mode=\{stage\}/);
  assert.match(planner, /focusX=\{focusX\}/);
  assert.match(planner, /progress=\{safeProgress\}/);
  assert.match(styles, /\.planner-home-journey \{[\s\S]*min-height: 390px;/);
  assert.match(styles, /\.planner-home-journey\[data-entry="true"\] \{ min-height: clamp\(570px, 70svh, 780px\); \}/);
  assert.match(styles, /\.planner-home-journey\[data-stage="plan"\] \{ min-height: clamp\(540px, 62svh, 700px\); \}/);
  assert.match(planner, /Start with the question below/);
});

test("mobile scenes stay clipped, compact after entry and free of mouse-only telemetry", () => {
  assert.match(styles, /\.start-hero-planner \{[\s\S]*overflow: hidden;/);
  assert.match(styles, /\.planner-home-journey \{[\s\S]*overflow: hidden;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.planner-home-journey \{ min-height: 330px; \}/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.planner-home-journey\[data-entry="true"\] \{ min-height: 570px; \}/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.planner-home-telemetry \{ display: none; \}/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.planner-home-journey \{ min-height: 315px; \}/);
});

test("landing and planner visuals retain meaningful semantic journey content", () => {
  assert.match(landing, /aria-labelledby="customer-journey-title"/);
  assert.match(landing, /data-spatial-scene="landing"/);
  assert.match(planner, /aria-labelledby="planner-home-journey-title"/);
  assert.match(planner, /aria-describedby="planner-home-journey-detail"/);
  assert.match(planner, /aria-label="Home planning journey"/);
});
