import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.resolve(here, relativePath), "utf8");

const landing = read("../src/components/GettingStarted.tsx");
const plannerJourneyPath = path.resolve(here, "../src/components/PlannerHomeJourney.tsx");
const styles = read("../src/components/GettingStarted.module.css");
const scene = read("../src/components/HomeHeroScene.tsx");
const renderer = read("../src/lib/home-energy-scene.ts");

test("the public journey defers real 3D while keeping a lightweight image fallback", () => {
  assert.match(scene, /aea-home-future\.webp/);
  assert.match(scene, /import\("@\/lib\/home-energy-scene"\)/);
  assert.match(renderer, /new WebGLRenderer/);
  assert.match(renderer, /document\.hidden/);
  assert.match(renderer, /renderer\.dispose\(\)/);
  assert.match(renderer, /motion\.matches \? 0 : turn/);
  assert.match(styles, /touch-action: pan-y/);
  assert.match(scene, /aria-label="Interactive 3D home/);
  assert.match(scene, /const progress = motion\.matches \? 0/);
  assert.match(scene, /canvas\.current\.tabIndex = progress < \.1 && controller\.current \? 0 : -1/);
  assert.doesNotMatch(landing, /HolographicEnergyField|<canvas|requestAnimationFrame|pointermove|onPointerMove|data-spatial-scene/);
  assert.doesNotMatch(styles, /customer-hologram-sweep|customer-scan-drop|spatial-route-breathe|spatial-nebula-breathe/);
  assert.doesNotMatch(styles, /\.customer-scene-home::before|\.planner-home-scan-plane|\.planner-home-energy-field/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
  assert.doesNotMatch(styles, /infinite/);
});

test("the retired planner scene and its global styles stay removed", () => {
  assert.equal(fs.existsSync(plannerJourneyPath), false);
  assert.match(styles, /\.modelBackdrop[\s\S]*position: fixed/);
  assert.doesNotMatch(styles, /\.planner-home-journey|\.planner-home-render-volume|\.planner-home-question-cue/);
});

test("landing and planner visuals retain meaningful semantic journey content", () => {
  assert.match(landing, /aria-label="How your request works"/);
  assert.match(landing, /Tell us what you need/);
  assert.match(landing, /Reach suitable trades/);
  assert.match(landing, /Choose your next step/);
});
