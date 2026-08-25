import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = fileURLToPath(new URL("../scripts/rehearse-surge-browser-continuity.mjs", import.meta.url));

test("browser continuity rehearsal documents its installed-browser scenarios without loading Playwright", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /restart/);
  assert.match(result.stdout, /duplicate-tab/);
  assert.match(result.stdout, /fresh-profile/);
  assert.match(result.stdout, /corrupt-primary/);
  assert.match(result.stdout, /scroll-handoff/);
  assert.match(result.stdout, /No external model is called/);
});

test("browser continuity rehearsal uses a persistent installed browser and synthetic API route", () => {
  const source = readFileSync(scriptPath, "utf8");

  assert.match(source, /await import\("playwright-core"\)/);
  assert.match(source, /launchPersistentContext/);
  assert.match(source, /executablePath: options\.browserPath/);
  assert.match(source, /context\.route\("\*\*\/api\/energy-assistant"/);
  assert.match(source, /aea-energy-guide-v1/);
  assert.match(source, /aea-energy-guide-profile-backup-v1/);
  assert.match(source, /aggregateOnly: true/);
  assert.doesNotMatch(source, /chromium\.download|install chromium|npx playwright install/i);
});
