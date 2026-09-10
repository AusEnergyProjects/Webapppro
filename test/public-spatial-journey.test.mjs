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
const packageJson = JSON.parse(read("../package.json"));

test("the public journey uses a responsive architectural image without a 3D runtime", () => {
  assert.match(scene, /<picture\b/);
  assert.match(scene, /<source\b[^>]*media=[^>]*aea-home-architecture-mobile\.webp/);
  assert.match(scene, /<img\b[^>]*src="\/aea-home-architecture\.webp"/);
  assert.match(scene, /<img\b[^>]*alt="[^"]+"/);
  assert.doesNotMatch(scene, /<canvas|home-energy-scene|home-energy-model|WebGLRenderer|pointerdown|pointermove|setPointerCapture|onPointer\w+/);
  assert.doesNotMatch(scene, /<button|modelControls|onKeyDown/);
  assert.doesNotMatch(styles, /cursor:\s*(?:grab|grabbing)\b|touch-action:\s*pan-y|\.modelCanvas|\.modelControls/);
  assert.equal(packageJson.dependencies?.three, undefined);
  assert.equal(packageJson.devDependencies?.["@types/three"], undefined);
  assert.equal(fs.existsSync(path.resolve(here, "../src/lib/home-energy-model.ts")), false);
  assert.equal(fs.existsSync(path.resolve(here, "../src/lib/home-energy-scene.ts")), false);
});

test("the decorative aurora follows scrolling without intercepting input or ignoring reduced motion", () => {
  assert.match(scene, /className=\{styles\.auroraBackdrop\}[^>]*aria-hidden="true"|aria-hidden="true"[^>]*className=\{styles\.auroraBackdrop\}/);
  assert.match(styles, /\.auroraBackdrop\s*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.auroraBackdrop\s*\{[^}]*pointer-events:\s*none/);
  assert.match(scene, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(scene, /\.matches/);
  assert.match(scene, /\.style\.setProperty\("--/);
  assert.match(scene, /addEventListener\("scroll",[^\n]*passive:\s*true/);
  assert.match(scene, /removeEventListener\("scroll"/);
  assert.match(scene, /removeEventListener\("resize"/);
  assert.match(scene, /removeEventListener\("change"/);
  assert.match(scene, /cancelAnimationFrame/);
  assert.doesNotMatch(landing, /HolographicEnergyField|<canvas|requestAnimationFrame|pointermove|onPointerMove|data-spatial-scene/);
  assert.doesNotMatch(styles, /customer-hologram-sweep|customer-scan-drop|spatial-route-breathe|spatial-nebula-breathe/);
  assert.doesNotMatch(styles, /\.customer-scene-home::before|\.planner-home-scan-plane|\.planner-home-energy-field/);
  assert.match(styles, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
  assert.doesNotMatch(styles, /infinite/);
});

test("the retired planner scene and its global styles stay removed", () => {
  assert.equal(fs.existsSync(plannerJourneyPath), false);
  assert.doesNotMatch(styles, /\.modelBackdrop/);
  assert.doesNotMatch(styles, /\.planner-home-journey|\.planner-home-render-volume|\.planner-home-question-cue/);
});

test("landing and planner visuals retain meaningful semantic journey content", () => {
  assert.match(landing, /aria-label="How your request works"/);
  assert.match(landing, /Tell us what you need/);
  assert.match(landing, /Reach suitable trades/);
  assert.match(landing, /Choose your next step/);
});
