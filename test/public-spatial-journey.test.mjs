import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(here, relativePath), "utf8");

const landing = read("../src/components/CustomerJourneyScene.tsx");
const plannerJourneyPath = path.resolve(here, "../src/components/PlannerHomeJourney.tsx");
const styles = read("../src/app/globals.css");

test("the public journey scene uses a static image with no canvas or pointer loops", () => {
  assert.match(landing, /surge-command-centre-home\.webp/);
  assert.doesNotMatch(landing, /HolographicEnergyField|<canvas|requestAnimationFrame|pointermove|onPointerMove|data-spatial-scene/);
  assert.doesNotMatch(styles, /customer-hologram-sweep|customer-scan-drop|spatial-route-breathe|spatial-nebula-breathe/);
  assert.doesNotMatch(styles, /\.customer-scene-home::before|\.planner-home-scan-plane|\.planner-home-energy-field/);
  assert.match(styles, /@keyframes customer-surge-sweep[\s\S]*translate3d/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*\.customer-journey-scene::after \{ animation: none !important; \}/);
});

test("the retired planner scene and its global styles stay removed", () => {
  assert.equal(fs.existsSync(plannerJourneyPath), false);
  assert.match(styles, /\.start-hero-planner \{[\s\S]*overflow: hidden;/);
  assert.doesNotMatch(styles, /\.planner-home-journey|\.planner-home-render-volume|\.planner-home-question-cue/);
});

test("landing and planner visuals retain meaningful semantic journey content", () => {
  assert.match(landing, /aria-labelledby="customer-journey-title"/);
  assert.match(landing, /Understand/);
  assert.match(landing, /Prioritise/);
  assert.match(landing, /Take action/);
});
