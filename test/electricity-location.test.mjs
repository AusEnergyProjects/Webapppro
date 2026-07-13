import assert from "node:assert/strict";
import test from "node:test";
import { DISTRIBUTOR_INFO, cleanNmi, distributorFromNmi, maskNmi } from "../src/lib/electricity/location.ts";

test("NMI allocation resolves exact distributors while ignoring an optional checksum", () => {
  assert.equal(distributorFromNmi("6407123456"), "United Energy");
  assert.equal(distributorFromNmi("64071234567"), "United Energy");
  assert.equal(distributorFromNmi("VCCC123456"), "Powercor");
  assert.equal(distributorFromNmi("  NCCC 123456 "), "Ausgrid");
  assert.equal(distributorFromNmi("1234"), null);
  assert.equal(cleanNmi(" vccc 123456 "), "VCCC123456");
});

test("NMI display is masked and every mapped distributor has meter-data guidance", () => {
  assert.equal(maskNmi("6407123456"), "640••••456");
  const mapped = ["Evoenergy", "Essential Energy", "Ausgrid", "Endeavour Energy", "Ergon Energy", "Energex", "SA Power Networks", "TasNetworks", "CitiPower", "AusNet Services", "Powercor", "Jemena", "United Energy"];
  mapped.forEach((name) => {
    assert.ok(DISTRIBUTOR_INFO[name]);
    assert.ok(DISTRIBUTOR_INFO[name].meterDataInstructions.length > 10);
  });
});
