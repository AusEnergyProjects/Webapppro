import assert from "node:assert/strict";
import test from "node:test";
import {
  createTradeMapAddressResolver,
  groupTradeMapPins,
  interpretTradeMapGeocode,
  prepareTradeMapAddress,
  tradeMapAddressKey,
  tradeMapDirectionsUrl,
  tradeMapPinCategory,
  tradeMapRecordCategory,
  TRADE_MAP_PIN_LABELS,
} from "../src/lib/trade-record-map.ts";
import { TRADE_JOB_LIFECYCLE_LABELS, TRADE_JOB_LIFECYCLE_STATUSES } from "../src/lib/trade-job-lifecycle.ts";

const record = (id, address, kind = "job") => ({ id, kind, address, title: `Private title ${id}`, reference: `JOB-${id}`, detail: "Private customer notes" });
const located = (lat = -37.81, lng = 144.96, approximate = false) => ({ status: "located", position: { lat, lng }, approximate });
const candidate = (options = {}) => ({
  address_components: [{ short_name: options.country ?? "AU", types: ["country"] }],
  partial_match: options.partial ?? false,
  geometry: { location_type: options.type ?? "ROOFTOP", location: { lat: () => options.lat ?? -37.81, lng: () => options.lng ?? 144.96 } },
});

test("map categories preserve the indexed operational lifecycle and customer distinction", () => {
  const job = record("1", "1 Smith St Melbourne VIC 3000");
  for (const jobStatus of TRADE_JOB_LIFECYCLE_STATUSES) {
    assert.equal(tradeMapRecordCategory({ ...job, jobStatus }), jobStatus);
    assert.equal(TRADE_MAP_PIN_LABELS[jobStatus], TRADE_JOB_LIFECYCLE_LABELS[jobStatus]);
  }
  assert.equal(tradeMapRecordCategory(job), "unknown", "missing status must not be presented as unscheduled");
  assert.equal(tradeMapRecordCategory({ ...job, kind: "customer", jobStatus: "completed" }), "customer");
  assert.equal(TRADE_MAP_PIN_LABELS.partial, "Partial");
  assert.equal(TRADE_MAP_PIN_LABELS.no_show, "No show");
});

test("co-located jobs retain counts and use mixed status only when their lifecycles differ", () => {
  const records = [
    { ...record("1", "1 Smith St Melbourne VIC 3000"), jobStatus: "scheduled" },
    { ...record("2", "1 Smith St Melbourne VIC 3000"), jobStatus: "scheduled" },
  ];
  const results = new Map([[tradeMapAddressKey(records[0].address), located()]]);
  const pins = groupTradeMapPins(records, results);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].records.length, 2);
  assert.equal(tradeMapPinCategory(pins[0].records), "scheduled");
  assert.equal(tradeMapPinCategory([records[0], { ...records[1], jobStatus: "completed" }]), "mixed");
  assert.equal(tradeMapPinCategory([records[0], { ...records[1], jobStatus: undefined }]), "mixed");
  assert.equal(tradeMapPinCategory([records[0], { ...records[1], kind: "customer" }]), "mixed_records");
  assert.equal(tradeMapPinCategory([{ ...records[0], kind: "customer" }, { ...records[1], kind: "customer" }]), "customer");
  assert.equal(tradeMapPinCategory([]), "unknown");
});

test("map addresses exclude missing, withheld, non-street and invalid inputs", () => {
  for (const address of ["", "   ", "3000", "Address withheld", "1 withheld street", "PO Box 10 Melbourne 3000", "Locked Bag 20", "a@private.com 1", "https://example.com/1", "<script>1</script>", "x".repeat(501)]) {
    assert.equal(prepareTradeMapAddress(address), null, address);
  }
  assert.equal(prepareTradeMapAddress("  1  Smith St, , Melbourne VIC 3000,  "), "1 Smith St, Melbourne VIC 3000");
  assert.equal(prepareTradeMapAddress("Unit 2/1 Smith St, Melbourne VIC 3000"), "Unit 2/1 Smith St, Melbourne VIC 3000");
  assert.equal(tradeMapAddressKey("1 Smith St, MELBOURNE VIC 3000"), tradeMapAddressKey(" 1 Smith St Melbourne VIC 3000 "));
  assert.notEqual(tradeMapAddressKey("1/2 Smith St"), tradeMapAddressKey("12 Smith St"));
});

test("an API outage, denied access and quota are not treated as an unmatched address", () => {
  assert.deepEqual(interpretTradeMapGeocode("ZERO_RESULTS", []), { status: "unlocated", reason: "zero_results" });
  assert.deepEqual(interpretTradeMapGeocode("REQUEST_DENIED", null), { status: "error", reason: "denied" });
  for (const status of ["OVER_QUERY_LIMIT", "OVER_DAILY_LIMIT"]) {
    assert.deepEqual(interpretTradeMapGeocode(status, null), { status: "error", reason: "quota" });
  }
  for (const status of ["UNKNOWN_ERROR", "ERROR", "INVALID_REQUEST", "unexpected"]) {
    assert.deepEqual(interpretTradeMapGeocode(status, null), { status: "error", reason: "unavailable" });
  }
  assert.deepEqual(interpretTradeMapGeocode("OK", []), { status: "error", reason: "unavailable" });
});

test("only valid Australian results are plotted and imprecise matches are labelled", () => {
  assert.deepEqual(interpretTradeMapGeocode("OK", [candidate()]), located());
  assert.equal(interpretTradeMapGeocode("OK", [candidate({ partial: true })]).approximate, true);
  assert.equal(interpretTradeMapGeocode("OK", [candidate({ type: "RANGE_INTERPOLATED" })]).approximate, true);
  assert.equal(interpretTradeMapGeocode("OK", [candidate({ type: "APPROXIMATE" })]).approximate, true);
  assert.deepEqual(interpretTradeMapGeocode("OK", [candidate({ country: "US" })]), { status: "unlocated", reason: "outside_australia" });
  for (const options of [{ lat: NaN }, { lng: Infinity }, { lat: 91 }, { lng: -181 }]) {
    assert.deepEqual(interpretTradeMapGeocode("OK", [candidate(options)]), { status: "error", reason: "unavailable" });
  }
});

test("pins group shared addresses and equivalent coordinates without dropping underlying records", () => {
  const records = [record("1", "1 Smith St, Melbourne VIC 3000"), record("2", "1 smith st Melbourne VIC 3000"), record("3", "Unit 1, 1 Smith St Melbourne VIC 3000", "customer"), record("4", "2 Smith St Melbourne VIC 3000"), record("5", ""), record("6", "3 Smith St Melbourne VIC 3000")];
  const results = new Map([
    [tradeMapAddressKey(records[0].address), located()],
    [tradeMapAddressKey(records[2].address), located(-37.81000001, 144.96000001, true)],
    [tradeMapAddressKey(records[3].address), located(-37.812, 144.96)],
    [tradeMapAddressKey(records[5].address), { status: "unlocated", reason: "zero_results" }],
  ]);
  const pins = groupTradeMapPins(records, results);
  assert.equal(pins.length, 2);
  assert.deepEqual(pins[0].records.map((item) => item.id), ["1", "2", "3"]);
  assert.deepEqual(pins[1].records.map((item) => item.id), ["4"]);
  assert.equal(records.length, 6, "unlocated records remain available for the side list");
  assert.equal(records[4].address, "");
});

test("directions URLs share only the prepared address and safely encode it", () => {
  assert.equal(tradeMapDirectionsUrl(""), null);
  const url = new URL(tradeMapDirectionsUrl("1 Smith & Jones St, Melbourne VIC 3000"));
  assert.equal(url.origin, "https://www.google.com");
  assert.deepEqual([...url.searchParams.keys()], ["api", "destination", "travelmode"]);
  assert.equal(url.searchParams.get("destination"), "1 Smith & Jones St, Melbourne VIC 3000");
});

test("address resolver deduplicates simultaneous and later requests using component memory", async () => {
  const calls = [];
  const resolve = createTradeMapAddressResolver(async (address) => { calls.push(address); return located(); });
  const signal = new AbortController().signal;
  const values = await Promise.all([
    resolve("1 Smith St, Melbourne VIC 3000", signal),
    resolve("1 smith st Melbourne VIC 3000", signal),
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(values, [located(), located()]);
  await resolve("1 Smith St Melbourne VIC 3000", signal);
  assert.equal(calls.length, 1);
  await resolve("", signal);
  assert.equal(calls.length, 1, "missing addresses never reach Google");
});

test("queued requests are sequential and a cancelled filter cannot send queued addresses", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const resolve = createTradeMapAddressResolver(async (address) => {
    calls.push(address);
    if (calls.length === 1) await gate;
    return located();
  });
  const oldPage = new AbortController();
  const first = resolve("1 Smith St Melbourne VIC 3000", oldPage.signal);
  const queued = resolve("2 Smith St Melbourne VIC 3000", oldPage.signal);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  oldPage.abort();
  const nextPage = resolve("3 Smith St Melbourne VIC 3000", new AbortController().signal);
  assert.equal(calls.length, 1);
  release();
  assert.equal(await first, null);
  assert.equal(await queued, null);
  assert.deepEqual(await nextPage, located());
  assert.deepEqual(calls, ["1 Smith St Melbourne VIC 3000", "3 Smith St Melbourne VIC 3000"]);
});

test("a replacement page can resolve an address whose queued request was cancelled", async () => {
  const firstPage = new AbortController();
  const calls = [];
  const resolve = createTradeMapAddressResolver(async (address) => { calls.push(address); return located(); });
  const cancelled = resolve("1 Smith St Melbourne VIC 3000", firstPage.signal);
  firstPage.abort();
  const replacement = resolve("1 Smith St Melbourne VIC 3000", new AbortController().signal);
  assert.equal(await cancelled, null);
  assert.deepEqual(await replacement, located());
  assert.equal(calls.length, 1);
});

test("service failures can retry and an unmatched address is deduplicated", async () => {
  let calls = 0;
  const resolve = createTradeMapAddressResolver(async () => {
    calls += 1;
    return calls === 1 ? { status: "error", reason: "quota" } : { status: "unlocated", reason: "zero_results" };
  });
  const signal = new AbortController().signal;
  assert.equal((await resolve("1 Smith St Melbourne VIC 3000", signal)).status, "error");
  assert.equal((await resolve("1 Smith St Melbourne VIC 3000", signal)).reason, "zero_results");
  await resolve("1 Smith St Melbourne VIC 3000", signal);
  assert.equal(calls, 2);
});
