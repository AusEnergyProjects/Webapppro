import test from "node:test";
import assert from "node:assert/strict";
import { wholesaleLocationForStates } from "../src/lib/wholesale-location.ts";

test("one exact locality state selects its NEM region", () => {
  assert.deepEqual(wholesaleLocationForStates(["VIC"]), {
    kind: "region",
    regionId: "VIC1",
    stateLabels: ["Victoria"],
    states: ["VIC"],
  });
  assert.deepEqual(wholesaleLocationForStates(["NSW", "ACT"]), {
    kind: "region",
    regionId: "NSW1",
    stateLabels: ["New South Wales", "the ACT"],
    states: ["NSW", "ACT"],
  });
});

test("cross-border postcodes cannot silently select the wrong market", () => {
  assert.deepEqual(wholesaleLocationForStates(["NSW", "QLD"]), {
    kind: "ambiguous",
    regionId: null,
    stateLabels: ["New South Wales", "Queensland"],
    states: ["NSW", "QLD"],
  });
  assert.equal(wholesaleLocationForStates(["NT", "SA", "WA"]).kind, "ambiguous");
  assert.equal(wholesaleLocationForStates(["NT", "QLD"]).kind, "ambiguous");
});

test("WA and NT localities are recognised as outside the NEM", () => {
  assert.deepEqual(wholesaleLocationForStates(["WA"]), {
    kind: "outside-nem",
    regionId: null,
    stateLabels: ["Western Australia"],
    states: ["WA"],
  });
  assert.equal(wholesaleLocationForStates(["NT"]).kind, "outside-nem");
  assert.equal(wholesaleLocationForStates([]), null);
});

test("unexpected or malformed state values fail closed", () => {
  assert.equal(wholesaleLocationForStates(["VIC", "unexpected"]), null);
  assert.equal(wholesaleLocationForStates(["VIC", ""]), null);
});
