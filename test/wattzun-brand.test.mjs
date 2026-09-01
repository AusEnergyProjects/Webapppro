import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeEnergyAssistantBrandText } from "../src/lib/energy-assistant-brand.ts";

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(directory, "../src");
const intentionalLegacySources = new Set([
  path.resolve(sourceRoot, "data/surge-industry-library.generated.json"),
  path.resolve(sourceRoot, "lib/energy-assistant-brand.ts"),
]);

function runtimeSourceFiles(current) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(absolute);
    return /\.(?:css|json|mjs|ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

test("the legacy public product name is isolated to the compatibility adapter", () => {
  for (const file of runtimeSourceFiles(sourceRoot)) {
    if (intentionalLegacySources.has(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\bSurge AI\b/, path.relative(sourceRoot, file));
  }
});

test("Wattzun owns the canonical public route and Surge remains only a permanent redirect", () => {
  const wattzun = fs.readFileSync(path.resolve(sourceRoot, "app/wattzun/page.tsx"), "utf8");
  const legacy = fs.readFileSync(path.resolve(sourceRoot, "app/surge/page.tsx"), "utf8");
  const sitemap = fs.readFileSync(path.resolve(sourceRoot, "app/sitemap.ts"), "utf8");

  assert.match(wattzun, /title: "Wattzun AI \| Australian Energy Assessments"/);
  assert.match(wattzun, /canonical: "\/wattzun"/);
  assert.match(legacy, /permanentRedirect\("\/wattzun"\)/);
  assert.doesNotMatch(legacy, /export const metadata|SiteHeader/);
  assert.match(sitemap, /"\/wattzun"/);
  assert.doesNotMatch(sitemap, /"\/surge"/);
});

test("legacy assistant references migrate without changing electrical surge terminology", () => {
  const legacyAssistantText = [
    "Surge AI answered the question.",
    "Surge's next check can help.",
    "Ask Surge for a comparison.",
    "The previous Surge answer explained the trade-off.",
    "Surge said the postcode changes the answer.",
    "What should Surge check next?",
  ].join(" ");
  const migrated = normalizeEnergyAssistantBrandText(legacyAssistantText);

  assert.doesNotMatch(migrated, /\bSurge(?: AI)?\b/);
  assert.equal((migrated.match(/Wattzun AI/g) || []).length, 6);

  for (const technicalText of [
    "Surge control devices need the correct rating.",
    "Surge energy rating is a technical phrase.",
    "Surge immunity matters for this equipment.",
    "Surge protection should be specified by an electrician.",
    "Surge power can damage sensitive electronics.",
    "Surge voltage is measured at the equipment.",
  ]) {
    assert.equal(normalizeEnergyAssistantBrandText(technicalText), technicalText);
  }
});
