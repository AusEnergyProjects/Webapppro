import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSolarDesignInput, solarDesignRecordId, solarDesignRevision } from "../src/lib/trade-solar-design.ts";

const equipment = { id: "panel-440", kind: "panel", name: "Panel 440 W", manufacturer: "Manufacturer", model: "Model 440", quantity: 1, watts: 440, widthM: 1.13, lengthM: 1.72, datasheetUrl: "https://manufacturer.com/panel.pdf" };
const input = () => ({ title: "12 Example Street", panels: [{ id: 1, center: { lat: -37.8, lng: 145 }, widthM: 1.13, lengthM: 1.72, lengthTilt: 22.5, widthTilt: 0, heading: 350, equipment }], equipment: [equipment], installationNotes: "Access from driveway.\nKeep gate closed.", center: { lat: -37.8, lng: 145 }, zoom: 21, customerId: "customer-1", workOrderId: "job-1" });

test("saved design round-trips exact geometry, tilt and equipment without browser-only fields", () => {
  const source = input();
  assert.deepEqual(normalizeSolarDesignInput(JSON.parse(JSON.stringify(source))), source);
  const result = normalizeSolarDesignInput({ ...source, ownerUid: "foreign", selectedIds: [1], panels: [{ ...source.panels[0], heading: -10, html: "ignored" }] });
  assert.equal(result.panels[0].heading, 350);
  assert.equal(result.ownerUid, undefined);
  assert.equal(result.selectedIds, undefined);
  assert.equal(result.panels[0].html, undefined);
});

test("malformed geometry, oversized payloads and mismatched panel models are rejected", () => {
  const panel = input().panels[0];
  const invalid = [
    null, [], { ...input(), panels: Array.from({ length: 501 }, (_, id) => ({ ...panel, id: id + 1 })) },
    { ...input(), panels: [panel, panel] }, { ...input(), panels: [{ ...panel, id: 1.1 }] },
    { ...input(), panels: [{ ...panel, center: { lat: 91, lng: 145 } }] },
    { ...input(), panels: [{ ...panel, widthM: NaN }] }, { ...input(), panels: [{ ...panel, lengthTilt: 86 }] },
    { ...input(), panels: [{ ...panel, widthM: 1.4 }] }, { ...input(), zoom: Infinity },
    { ...input(), title: " " }, { ...input(), title: "x".repeat(181) },
    { ...input(), installationNotes: "x".repeat(5001) }, { ...input(), customerId: "../../foreign" },
    { ...input(), equipment: [{ ...equipment, datasheetUrl: "javascript:alert(1)" }] },
    { ...input(), equipment: [{ ...equipment, imageUrl: "http://127.0.0.1/private" }] },
  ];
  for (const value of invalid) assert.throws(() => normalizeSolarDesignInput(value), /SOLAR_DESIGN_INVALID/);
});

test("revision and reference validation cannot silently coerce unknown values", () => {
  for (const value of [-1, 1.2, "1", undefined, NaN, Number.MAX_SAFE_INTEGER]) assert.throws(() => solarDesignRevision(value), /SOLAR_DESIGN_INVALID/);
  assert.equal(solarDesignRevision(0), 0);
  assert.equal(solarDesignRecordId("public-lead-work-abc"), "public-lead-work-abc");
  assert.equal(solarDesignRecordId(undefined), "");
  assert.throws(() => solarDesignRecordId("", true), /SOLAR_DESIGN_INVALID/);
});
