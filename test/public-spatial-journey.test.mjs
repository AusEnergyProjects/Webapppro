import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(here, relativePath), "utf8");

const landing = read("../src/components/CustomerJourneyScene.tsx");
const planner = read("../src/components/PlannerHomeJourney.tsx");
const styles = read("../src/app/globals.css");

test("public journey scenes are static images without permanent canvas or pointer loops", () => {
  for (const source of [landing, planner]) {
    assert.match(source, /aea-immersive-home-journey\.webp/);
    assert.doesNotMatch(source, /HolographicEnergyField|<canvas|requestAnimationFrame|pointermove|onPointerMove|data-spatial-scene/);
  }
  assert.doesNotMatch(styles, /customer-hologram-sweep|customer-scan-drop|spatial-route-breathe|spatial-nebula-breathe/);
  assert.doesNotMatch(styles, /\.customer-scene-home::before|\.planner-home-scan-plane|\.planner-home-energy-field/);
});

test("planner focus changes preserve a bounded static crop and semantic progress", () => {
  assert.match(planner, /data-entry=\{safeProgress <= 5/);
  assert.match(planner, /data-stage=\{stage\}/);
  assert.match(planner, /data-focus=\{activeFocus\}/);
  assert.match(planner, /focusPositions/);
  assert.match(planner, /aria-label="Home planning journey"/);
  assert.match(styles, /\.planner-home-journey \{[\s\S]*min-height: 390px;/);
  assert.match(styles, /\.planner-home-journey\[data-entry="true"\] \{ min-height: clamp\(570px, 70svh, 780px\); \}/);
  assert.match(styles, /\.planner-home-journey\[data-stage="plan"\] \{ min-height: clamp\(540px, 62svh, 700px\); \}/);
  assert.match(styles, /\.planner-home-journey\[data-focus="solar"\] \.planner-home-render-volume img/);
  assert.match(planner, /Start with the question below/);
  assert.doesNotMatch(planner, /planner-home-telemetry|Live focus transition|Comfort<|Systems<|Action</);
});

test("mobile scenes stay clipped and compact", () => {
  assert.match(styles, /\.start-hero-planner \{[\s\S]*overflow: hidden;/);
  assert.match(styles, /\.planner-home-journey \{[\s\S]*overflow: hidden;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.planner-home-journey \{ min-height: 330px; \}/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.planner-home-journey\[data-entry="true"\] \{ min-height: 570px; \}/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.planner-home-journey \{ min-height: 315px; \}/);
});

test("landing and planner visuals retain meaningful semantic journey content", () => {
  assert.match(landing, /aria-labelledby="customer-journey-title"/);
  assert.match(landing, /Understand/);
  assert.match(landing, /Prioritise/);
  assert.match(landing, /Take action/);
  assert.match(planner, /aria-labelledby="planner-home-journey-title"/);
  assert.match(planner, /aria-describedby="planner-home-journey-detail"/);
});
