import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTLinkMapAttribution, isTLinkAddressResult, isTLinkMapConfiguration, tlinkMapBounds, tlinkMapFailure } from "../src/lib/tlink-map-client.ts";

const configuration = () => ({ ok: true, provider: "maptiler", configured: true, apiKey: "public-browser-key", gnaf: { ready: true, version: "aug2026", attribution: "G-NAF attribution" } });

test("overview configuration distinguishes a prepared directory from unavailable setup", () => {
  assert.equal(isTLinkMapConfiguration(configuration()), true);
  assert.equal(isTLinkMapConfiguration({ ...configuration(), configured: false, apiKey: "", gnaf: { ready: false, version: "", attribution: "" } }), true);
  assert.equal(isTLinkMapConfiguration({ ...configuration(), apiKey: " " }), false);
  assert.equal(isTLinkMapConfiguration({ ...configuration(), provider: "google" }), false);
  assert.equal(isTLinkMapConfiguration({ ...configuration(), gnaf: { ready: true, version: "", attribution: "" } }), false);
  assert.equal(isTLinkMapConfiguration(null), false);
});

test("address results support Australian external territories while rejecting unsafe coordinates", () => {
  const result = position => ({ ok: true, result: { status: "located", position, approximate: true } });
  for (const position of [{ lat: -37.8, lng: 145 }, { lat: -12.2, lng: 96.8 }, { lat: -29.03, lng: 167.95 }, { lat: -53.1, lng: 73.5 }]) {
    assert.equal(isTLinkAddressResult(result(position)), position.lng >= 96, "coordinates must match the supported Australian directory bounds");
  }
  for (const position of [{ lat: NaN, lng: 145 }, { lat: -37, lng: Infinity }, { lat: 51.5, lng: 0.1 }, { lat: -56, lng: 150 }, { lat: -37, lng: 170 }]) {
    assert.equal(isTLinkAddressResult(result(position)), false);
  }
  assert.equal(isTLinkAddressResult({ ok: true, result: { status: "located", position: { lat: -37.8, lng: 145 } } }), false);
});

test("ambiguous and absent addresses remain explicit unmatched results", () => {
  for (const reason of ["missing_address", "invalid_address", "zero_results", "outside_australia", "ambiguous"]) {
    assert.equal(isTLinkAddressResult({ ok: true, result: { status: "unlocated", reason } }), true);
  }
  for (const reason of ["denied", "quota", "unavailable"]) {
    assert.equal(isTLinkAddressResult({ ok: true, result: { status: "error", reason } }), true);
  }
  assert.equal(isTLinkAddressResult({ ok: true, result: { status: "unlocated", reason: "unavailable" } }), false);
  assert.equal(isTLinkAddressResult({ ok: true, result: { status: "unlocated", reason: { toString: () => "ambiguous" } } }), false);
  assert.equal(isTLinkAddressResult({ ok: false, result: { status: "unlocated", reason: "zero_results" } }), false);
});

test("map bounds are converted to longitude first without mutating the saved bounds", () => {
  const bounds = Object.freeze({ west: 96, south: -55, east: 169, north: -9 });
  assert.deepEqual(tlinkMapBounds(bounds), [[96, -55], [169, -9]]);
});

test("provider failures retain distinct access, hard spending limit and connection states", () => {
  for (const status of [401, 403]) assert.equal(tlinkMapFailure({ status }), "auth");
  for (const status of [402, 429]) assert.equal(tlinkMapFailure({ status }), "limit");
  for (const error of [null, undefined, new Error("offline"), { status: 500 }]) assert.equal(tlinkMapFailure(error), "unavailable");
});

test("customer overview has no Google loading or browser geocoding path", () => {
  const overview = readFileSync(new URL("../src/components/TradeRecordMap.tsx", import.meta.url), "utf8");
  const design = readFileSync(new URL("../src/components/TradeRoofDesignMap.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(overview, /google-maps-client|geocodeTradeMapAddress|resolveTradeMapClaims|claim_map_locations|save_map_locations/);
  assert.match(overview, /designOpen && <TradeRoofDesignMap/);
  assert.doesNotMatch(overview, /locate_map_records|lookupEnabled|Start locating addresses|Pause lookups|Retry address lookup|Keep this map open/);
  assert.match(overview, /key=\{`\$\{props\.user\.uid\}:\$\{businessOwnerUid\}`\}/);
  assert.match(design, /\/api\/trade-map\/config\?provider=design/);
  assert.match(design, /await loadGoogleMaps\(config\.apiKey\)/);
  assert.match(design, /await saveRef\.current\?\.\(\); onClose\(\)/);
});

test("fixed attribution bypasses vulnerable style HTML and retains safe provider credits", () => {
  const nodes = [];
  const document = { createElement(tag) {
    const node = { tag, children: [], append(child) { this.children.push(child); }, remove() { this.removed = true; },
      set innerHTML(_value) { assert.fail("Attribution must never insert HTML"); } };
    nodes.push(node); return node;
  } };
  const control = createTLinkMapAttribution(document, "map-attribution");
  const element = control.onAdd();
  assert.equal(element.tag, "div");
  const links = nodes.filter(node => node.tag === "a");
  assert.deepEqual(links.map(link => link.href), ["https://www.maptiler.com/", "https://www.maptiler.com/copyright/", "https://www.openstreetmap.org/copyright"]);
  assert.ok(links.every(link => link.target === "_blank" && link.rel === "noopener noreferrer"));
  assert.equal(links[1].textContent, "© MapTiler");
  assert.equal(links[2].textContent, "© OpenStreetMap contributors");
  assert.equal(nodes.find(node => node.tag === "img").src, "https://api.maptiler.com/resources/logo.svg");
  control.onRemove(); assert.equal(element.removed, true);
  const overview = readFileSync(new URL("../src/components/TradeRecordMap.tsx", import.meta.url), "utf8");
  assert.match(overview, /forceNoAttributionControl: true/);
  assert.match(overview, /addControl\(createTLinkMapAttribution\(document, styles\.mapAttribution\), "bottom-left"\)/);
  assert.doesNotMatch(overview, /customAttribution:|\.setHTML\(|\.innerHTML\s*=/);
});
