import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const accessPage = fs.readFileSync(path.resolve(directory, "../src/app/direct-trade/access/page.tsx"), "utf8");

test("TLink publishes its Australia-wide digital rollout boundary", () => {
  assert.match(accessPage, /"@type": "Service"/);
  assert.match(accessPage, /"@type": "SoftwareApplication"/);
  assert.match(accessPage, /areaServed: \{ "@type": "Country", name: "Australia" \}/);
  assert.match(accessPage, /availability: "https:\/\/schema\.org\/LimitedAvailability"/);
  assert.match(accessPage, /designed for digital access by approved businesses/);
  assert.match(accessPage, /During rollout, access remains subject to/);
  assert.match(accessPage, /each business[\s\S]*controls the real service areas where it accepts work/);
});
