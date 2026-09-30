import assert from "node:assert/strict";
import test from "node:test";
import {
  interpretTradeMapGeocode,
  prepareTradeMapAddress,
  tradeMapDirectionsUrl,
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

test("map addresses exclude missing, withheld, non-street and invalid inputs", () => {
  for (const address of ["", "   ", "3000", "Address withheld", "1 withheld street", "PO Box 10 Melbourne 3000", "Locked Bag 20", "a@private.com 1", "https://example.com/1", "<script>1</script>", "x".repeat(501)]) {
    assert.equal(prepareTradeMapAddress(address), null, address);
  }
  assert.equal(prepareTradeMapAddress("  1  Smith St, , Melbourne VIC 3000,  "), "1 Smith St, Melbourne VIC 3000");
  assert.equal(prepareTradeMapAddress("Unit 2/1 Smith St, Melbourne VIC 3000"), "Unit 2/1 Smith St, Melbourne VIC 3000");
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

test("directions URLs share only the prepared address and safely encode it", () => {
  assert.equal(tradeMapDirectionsUrl(""), null);
  const url = new URL(tradeMapDirectionsUrl("1 Smith & Jones St, Melbourne VIC 3000"));
  assert.equal(url.origin, "https://www.google.com");
  assert.deepEqual([...url.searchParams.keys()], ["api", "destination", "travelmode"]);
  assert.equal(url.searchParams.get("destination"), "1 Smith & Jones St, Melbourne VIC 3000");
});
