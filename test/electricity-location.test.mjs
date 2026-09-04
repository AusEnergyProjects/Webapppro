import assert from "node:assert/strict";
import test from "node:test";
import { DISTRIBUTOR_INFO, cleanNmi, distributorFromNmi, hasValidNmiCheckDigit, maskNmi, nmiCheckDigit } from "../src/lib/electricity/location.ts";

test("NMI allocation resolves likely distributors and validates an optional checksum", () => {
  assert.equal(distributorFromNmi("6407123456"), "United Energy");
  assert.equal(nmiCheckDigit("6407123456"), "0");
  assert.equal(hasValidNmiCheckDigit("64071234560"), true);
  assert.equal(hasValidNmiCheckDigit("64071234567"), false);
  assert.equal(distributorFromNmi("64071234560"), "United Energy");
  assert.equal(distributorFromNmi("64071234567"), null);
  assert.equal(distributorFromNmi("VCCC123456"), "Powercor");
  assert.equal(distributorFromNmi("  NCCC 123456 "), "Ausgrid");
  assert.equal(distributorFromNmi("T000005001"), "TasNetworks");
  assert.equal(distributorFromNmi("T000005002"), null);
  assert.equal(distributorFromNmi("VEEE000000"), null);
  assert.equal(distributorFromNmi("SASMPL1234"), null);
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
