import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSolarEquipmentItem, normalizeSolarDesignEquipment, solarEquipmentUrl, solarEquipmentSummary, solarEquipmentDescription,
  DEFAULT_SOLAR_EQUIPMENT, customSolarPanelEquipment, SOLAR_STARTER_PANELS } from "../src/lib/trade-solar-equipment.ts";
import { buildSolarCrewSheetHtml } from "../src/lib/trade-solar-crew-sheet.ts";

const panel = { id: "test-panel", kind: "panel", name: "Test panel", manufacturer: "Example Solar", model: "P-440", quantity: 1, watts: 440, widthM: 1.134, lengthM: 1.762 };
const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=";

test("panel selection requires exact dimensions and watts with no named-model fallback", () => {
  assert.deepEqual(normalizeSolarEquipmentItem(panel), panel);
  for (const change of [{ watts: undefined }, { widthM: undefined }, { lengthM: undefined }, { watts: 0 }, { watts: NaN }, { watts: "440" }, { widthM: 4.01 }, { lengthM: 0.1 }, { model: "" }, { id: "../other-owner" }, { quantity: 1.5 }]) {
    assert.throws(() => normalizeSolarEquipmentItem({ ...panel, ...change }));
  }
  assert.deepEqual(normalizeSolarEquipmentItem({ ...panel, supplierCostCents: 500, sellPriceCents: 900, privateNote: "internal" }), panel);
  assert.throws(() => normalizeSolarDesignEquipment([panel, panel]), /unique/);
  assert.throws(() => normalizeSolarDesignEquipment(Array.from({ length: 21 }, (_, index) => ({ ...panel, id: String(index) }))), /20/);
});

test("equipment document and image links reject script, data, credential and local addresses", () => {
  assert.equal(solarEquipmentUrl("https://manufacturer.com/panel.pdf"), "https://manufacturer.com/panel.pdf");
  for (const value of ["javascript:alert(1)", "data:image/svg+xml,<svg>", "http://manufacturer.com/spec.pdf", "https://user:secret@manufacturer.com/spec.pdf", "https://localhost/test", "https://127.0.0.1/test", "https://[::1]/test", "https://host.local/test", "/private/file"]) {
    assert.throws(() => solarEquipmentUrl(value));
    assert.throws(() => normalizeSolarEquipmentItem({ ...panel, imageUrl: value }));
    assert.throws(() => normalizeSolarEquipmentItem({ ...panel, datasheetUrl: value }));
  }
});

test("starter variants use explicitly checked manufacturer values and links only", () => {
  assert.equal(SOLAR_STARTER_PANELS.length, 3);
  for (const item of SOLAR_STARTER_PANELS) {
    assert.deepEqual(normalizeSolarEquipmentItem(item), item);
    assert.equal(item.widthM, 1.134); assert.equal(item.lengthM, 1.762);
    assert.equal("imageUrl" in item, false); assert.equal("warrantyYears" in item, false);
    assert.match(item.datasheetUrl, /^https:\/\/(www\.jinkosolar\.com|static\.trinasolar\.com)\//);
  }
});

test("a generic editable panel works immediately without inventing manufacturer specifications", () => {
  assert.deepEqual(normalizeSolarEquipmentItem(DEFAULT_SOLAR_EQUIPMENT), DEFAULT_SOLAR_EQUIPMENT);
  assert.equal(DEFAULT_SOLAR_EQUIPMENT.manufacturer, "");
  assert.equal(DEFAULT_SOLAR_EQUIPMENT.model, "Generic 440 W panel");
  assert.equal(solarEquipmentSummary(Array.from({ length: 12 }, () => ({ equipment: DEFAULT_SOLAR_EQUIPMENT }))).systemKw, 5.28);
  const custom = customSolarPanelEquipment(450, 1.1, 1.8);
  assert.equal(custom.name, "Generic 450 W panel"); assert.equal(custom.manufacturer, "");
  assert.equal(custom.widthM, 1.1); assert.equal(custom.lengthM, 1.8);
  for (const item of [custom, DEFAULT_SOLAR_EQUIPMENT]) {
    assert.equal("warrantyYears" in item, false); assert.equal("datasheetUrl" in item, false); assert.equal("imageUrl" in item, false);
  }
  assert.throws(() => customSolarPanelEquipment(0, 1.1, 1.8));
});

test("system capacity sums the actual placed models and does not guess unknown panels", () => {
  const twelve = solarEquipmentSummary(Array.from({ length: 12 }, () => ({ equipment: panel })));
  assert.equal(twelve.systemKw, 5.28); assert.equal(twelve.knownPanelCount, 12);
  assert.equal(twelve.models.length, 1); assert.equal(twelve.models[0].quantity, 12);
  const mixed = solarEquipmentSummary([{ equipment: panel }, { equipment: panel }, { equipment: { ...panel, watts: 450 } }]);
  assert.equal(mixed.systemKw, 1.33); assert.equal(mixed.models.length, 2);
  assert.equal(new Set(mixed.models.map((item) => item.id)).size, 2, "revised favourite specs remain separate rows");
  assert.equal(normalizeSolarDesignEquipment(mixed.models).length, 2);
  assert.equal(solarEquipmentSummary([{ equipment: panel }, {}]).systemKw, null);
  assert.equal(solarEquipmentSummary([{ equipment: panel }, {}]).unknownPanelCount, 1);
  assert.equal(solarEquipmentSummary([]).systemKw, null);
  assert.equal(panel.quantity, 1, "aggregation never changes the original saved favourite");
  assert.equal(solarEquipmentDescription(panel), "440 W · 1.762 × 1.134 m");
});

test("installation sheet retains the full supplied image and includes only equipment and installation details", () => {
  const html = buildSolarCrewSheetHtml({ title: 'Roof <script>alert("x")</script>', address: "1 Example Street", imageDataUrl,
    panels: Array.from({ length: 12 }, () => ({ equipment: panel })), equipment: [panel, { id: "inv", kind: "inverter", name: "Inverter", manufacturer: "Example", model: "5K", quantity: 1, watts: 5000 }], installationNotes: "Keep clear of hatch\nConfirm access." });
  assert.ok(html.includes(`src="${imageDataUrl}"`), "map and embedded Google attribution stay intact");
  assert.ok(html.includes("12 panels")); assert.ok(html.includes("5.28 kW DC")); assert.ok(html.includes("5 kW"));
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes('<script>alert("x")'));
  assert.ok(html.includes("Keep clear of hatch\nConfirm access."));
  assert.equal((html.match(/Example Solar · P-440/g) || []).length, 1, "current panel preset is not repeated as spare equipment");
  assert.ok(!html.includes("supplierCost")); assert.ok(!html.includes("Rotate all")); assert.ok(!html.includes("copy-panel"));
});

test("installation sheet rejects non-PNG maps and unsafe equipment snapshots before opening content", () => {
  const input = { title: "Roof", imageDataUrl, panels: [{ equipment: panel }], equipment: [], installationNotes: "" };
  assert.throws(() => buildSolarCrewSheetHtml({ ...input, imageDataUrl: "data:image/svg+xml,<svg onload=alert(1)>" }));
  assert.throws(() => buildSolarCrewSheetHtml({ ...input, panels: [{ equipment: { ...panel, datasheetUrl: "javascript:alert(1)" } }] }));
  const unknown = buildSolarCrewSheetHtml({ ...input, panels: [{}] });
  assert.ok(unknown.includes("Panel power not fully specified")); assert.ok(unknown.includes("Model not specified"));
  assert.ok(!unknown.includes("0 kW DC"));
});
