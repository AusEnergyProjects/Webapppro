import assert from "node:assert/strict";
import test from "node:test";
import { createDirectTradeHandoffUrl, parseDirectTradeHandoff } from "../src/lib/direct-trade-handoff.mjs";

test("electricity and gas handoffs retain only safe project selections", () => {
  const url = createDirectTradeHandoffUrl({
    source: "electricity-battery",
    services: ["assessment", "battery", "not-allowed"],
    priorities: ["lower-running-costs", "solar-storage", "not-allowed"],
    postcode: "3000",
    nmi: "6407123456",
    email: "private@example.com",
    annualKwh: 5000,
    saving: 1200,
  });
  assert.equal(url, "/direct-trade?from=electricity-battery&services=assessment%2Cbattery&priorities=lower-running-costs%2Csolar-storage&postcode=3000");
  assert.doesNotMatch(url, /nmi|email|annual|saving|private|6407123456/i);
});

test("handoff parsing ignores sensitive, unknown and malformed query values", () => {
  const parsed = parseDirectTradeHandoff("?from=gas-heating&services=assessment,heating-cooling,unknown&priorities=move-from-gas&postcode=3000&nmi=6407123456&projectNotes=private&email=a%40b.com");
  assert.equal(parsed.source, "gas-heating");
  assert.equal(parsed.sourceLabel, "gas heating upgrade estimate");
  assert.equal(parsed.returnHref, "/gas-compare");
  assert.deepEqual(parsed.services, ["assessment", "heating-cooling"]);
  assert.deepEqual(parsed.priorities, ["move-from-gas"]);
  assert.equal(parsed.postcode, "3000");
  assert.equal("nmi" in parsed, false);
  assert.equal("projectNotes" in parsed, false);
  assert.equal("email" in parsed, false);
});
