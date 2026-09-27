import test from "node:test";
import assert from "node:assert/strict";
import { solarQuotePackages } from "../src/lib/trade-solar-quote-packages.ts";
import { normaliseQuoteEquipment, quoteEquipmentForChoices } from "../src/lib/trade-quote-equipment.ts";
import { mapQuoteLine } from "../src/lib/trade-map-quote.ts";
import { normaliseQuoteChoices, calculateQuoteSelection } from "../src/lib/trade-quote-options.ts";
import { normaliseTradeQuoteLineGroup } from "../src/lib/trade-quote.ts";

const panel = { id: "panel-1", kind: "panel", name: "Selected panel", manufacturer: "Manufacturer", model: "P440", quantity: 12, watts: 440, widthM: 1.134, lengthM: 1.762 };
const battery = { id: "battery-1", kind: "battery", name: "Selected battery", manufacturer: "Manufacturer", model: "B10", quantity: 1, capacityKwh: 10 };
const hotWater = { id: "hot-water-1", kind: "hot_water", name: "Selected hot water", manufacturer: "Manufacturer", model: "H270", quantity: 1, capacityLitres: 270 };
const equipment = { common: [panel, battery, hotWater], choices: [] };
const solar = { ...mapQuoteLine({ kind: "solar", quantity: 12 }), unitPrice: "5000.00" };

test("package presets create whole-system alternatives without inventing equipment, rates or extra prices", () => {
  const next = solarQuotePackages([solar], equipment, 3, "solar-pack");
  assert.deepEqual(next.lines, []);
  assert.deepEqual(next.choices.map((choice) => choice.name), ["Solar", "Solar + battery", "Solar + battery + hot water"]);
  assert.deepEqual(next.choices.map((choice) => choice.lines[0].quantity), ["1", "1", "1"]);
  assert.deepEqual(next.choices.map((choice) => choice.lines[0].unitPrice), ["5000.00", "", ""]);
  assert.deepEqual(next.equipment.common, [panel]);
  assert.deepEqual(next.equipment.choices.map((group) => group.items), [[battery], [battery, hotWater]]);
  assert.deepEqual(equipment.common, [panel, battery, hotWater]);
  assert.deepEqual(solarQuotePackages([solar], { common: [], choices: [] }, 2, "solar-pack").equipment, { common: [], choices: [] });
});

test("packages use canonical choose-one totals, retain other included items and preserve legacy total once", () => {
  const extra = { ...solar, sectionHeading: "Included work", description: "Call out", unitPrice: "100" };
  const next = solarQuotePackages([solar, extra], equipment, 2, "solar-pack");
  assert.deepEqual(next.lines, [extra]);
  next.choices[1].lines[0].unitPrice = "9000";
  const choices = normaliseQuoteChoices(next.choices, (value) => String(value));
  const totals = choices.map((choice) => ({ ...choice, id: choice.clientKey, ...normaliseTradeQuoteLineGroup(choice.lines, String) }));
  const base = normaliseTradeQuoteLineGroup(next.lines, String);
  assert.equal(calculateQuoteSelection(base, totals, [totals[0].id]).totalCents, 561000);
  assert.equal(calculateQuoteSelection(base, totals, [totals[1].id]).totalCents, 1001000);
  assert.throws(() => calculateQuoteSelection(base, totals, totals.map((choice) => choice.id)), /INVALID_QUOTE_SELECTION/);
  const legacy = solarQuotePackages([{ ...solar, sectionHeading: "Map concept: solar panels", quantity: "12", unitPrice: "200" }], equipment, 2, "legacy");
  assert.equal(legacy.choices[0].lines[0].unitPrice, "2400.00");
  assert.equal(legacy.choices[0].lines[0].quantity, "1");
  assert.throws(() => solarQuotePackages([solar, solar], equipment, 2, "ambiguous"));
});

test("equipment snapshots reject unknown choices, duplicate identities and unsafe links while dropping private fields", () => {
  const normalized = normaliseQuoteEquipment({ common: [{ ...panel, supplierCost: 999, datasheetUrl: "https://manufacturer.com/p440.pdf" }], choices: [] });
  assert.equal("supplierCost" in normalized.common[0], false);
  assert.throws(() => quoteEquipmentForChoices({ common: [], choices: [{ choiceKey: "foreign-choice", items: [battery] }] }, ["local-choice"]), /INVALID_QUOTE_EQUIPMENT/);
  assert.throws(() => normaliseQuoteEquipment({ common: [panel, panel], choices: [] }));
  assert.throws(() => normaliseQuoteEquipment({ common: [{ ...panel, datasheetUrl: "javascript:alert(1)" }], choices: [] }));
  assert.deepEqual(normaliseQuoteEquipment(undefined), { common: [], choices: [] });
});
