import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { AEA_SERVICE_IDENTITIES, AEA_BUNDLE_IDENTITIES } from "../src/lib/aea-service-identity.mjs";
import { AEA_SERVICES, AEA_BUNDLES } from "../src/lib/aea-services.mjs";
import { ENERGY_SERVICE_LABELS } from "../src/lib/energy-service-catalogue.mjs";

test("service pages and enquiry choices use the same authoritative identities and prices", () => {
  const identities = [...Object.values(AEA_SERVICE_IDENTITIES), ...Object.values(AEA_BUNDLE_IDENTITIES)];
  const complete = [...AEA_SERVICES, ...AEA_BUNDLES];
  assert.equal(new Set(identities.map(({ id }) => id)).size, complete.length);
  for (const identity of identities) {
    const service = complete.find(({ id }) => id === identity.id);
    assert.ok(service, identity.id);
    assert.deepEqual(Object.fromEntries(Object.keys(identity).map((key) => [key, service[key]])), identity);
    assert.equal(ENERGY_SERVICE_LABELS[identity.id], `${identity.name}${"durationMonths" in identity ? " (2 years)" : ""}`);
    assert.ok(Object.isFrozen(identity));
  }
});

test("public search and enquiry dependencies exclude detailed service FAQs and legal sources", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: ["src/lib/public-site-search.ts", "src/lib/energy-service-catalogue.mjs", "src/lib/aea-service-identity.mjs"],
    bundle: true, write: false, metafile: true, platform: "browser", format: "esm", outdir: "unused-test-output",
  });
  assert.ok(Object.keys(bundled.metafile.inputs).some((file) => file.endsWith("aea-service-identity.mjs")));
  assert.equal(Object.keys(bundled.metafile.inputs).some((file) => file.endsWith("aea-services.mjs")), false);
  for (const output of bundled.outputFiles) {
    assert.doesNotMatch(output.text, /ElectricalSafetyChecklist_May2021\.pdf|ratingConsent|faqs:|inclusions:|legal:/);
  }
});
