import test from "node:test";
import assert from "node:assert/strict";
import * as contract from "../src/lib/trade-network.ts";

const post = (changes = {}) => ({ kind: "work", title: "Plumber for hot water install", trade: "Plumbing", suburb: "Richmond", postcode: "3121", state: "VIC", details: "Licensed plumber required. No customer details included.", rateCents: 8500, rateUnit: "hour", startsOn: "2026-10-01", endsOn: "2026-10-02", ...changes });
test("network contract strips foreign ownership, customer and job data from posts", () => {
  const expected = post();
  assert.deepEqual(contract.normalizeNetworkPost({ ...expected, ownerUid: "another-business", customerId: "private-customer", workOrderId: "private-job", phone: "hidden" }), expected);
  assert.deepEqual(contract.normalizeNetworkPost(post({ rateCents: null, startsOn: "", endsOn: "" })), post({ rateCents: null, startsOn: "", endsOn: "" }));
});
test("network contract rejects invalid prices, dates, oversized and unsupported fields", () => {
  for (const changes of [{ rateCents: -1 }, { rateCents: 1.5 }, { rateCents: "8500" }, { rateCents: Infinity }, { startsOn: "2026-02-30" }, { endsOn: "2026-09-01" }, { trade: "invalid" }, { kind: "public" }, { postcode: "312" }, { state: "vic" }, { rateUnit: "week" }, { title: "x".repeat(121) }, { details: "x".repeat(2001) }]) {
    assert.throws(() => contract.normalizeNetworkPost(post(changes)), { code: "NETWORK_INVALID" });
  }
  for (const revision of [-1, "1", 1.5, NaN]) assert.throws(() => contract.networkRevision(revision), { code: "NETWORK_INVALID" });
});
test("business contact sharing needs an explicit checkbox and valid contact", () => {
  const contact = { name: "Pat", email: "PAT@EXAMPLE.COM", phone: "" };
  assert.deepEqual(contract.normalizeNetworkContact({ ...contact, customerId: "private" }, true), { ...contact, email: "pat@example.com" });
  for (const confirmed of [false, undefined, "true"]) assert.throws(() => contract.normalizeNetworkContact(contact, confirmed), { code: "NETWORK_INVALID" });
  for (const raw of [{ name: "Pat" }, { ...contact, email: "invalid" }, { ...contact, phone: "call-me" }]) assert.throws(() => contract.normalizeNetworkContact(raw, true), { code: "NETWORK_INVALID" });
});
test("work availability defaults are explicit and accept only distinct supported trades", () => {
  assert.deepEqual(contract.normalizeNetworkAvailability(false, []), { openToWork: false, workTrades: [] });
  assert.deepEqual(contract.normalizeNetworkAvailability(true, ["Plumbing", "Electrical", "Plumbing"]), { openToWork: true, workTrades: ["Electrical", "Plumbing"] });
  for (const [open, trades] of [[true, []], ["true", ["Plumbing"]], [true, ["invalid"]], [true, "Plumbing"]]) assert.throws(() => contract.normalizeNetworkAvailability(open, trades), { code: "NETWORK_INVALID" });
});
