import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDITEX_INTERCHANGE_PREFLIGHT_CONTRACT,
  CREDITEX_VEU_INTERCHANGE_DESCRIPTOR,
  analyseCreditexCsv,
  preflightBlockedVeuFixture,
} from "../src/lib/creditex-interchange-preflight.ts";

test("generic CSV analysis is deterministic and handles quoted rows", () => {
  const input = 'first,second\r\n"value with\r\nnewline","escaped ""quote"""\r\n';
  const first = analyseCreditexCsv(input);
  const second = analyseCreditexCsv(input);

  assert.equal(first.rawSha256, second.rawSha256);
  assert.equal(first.rows.length, 2);
  assert.deepEqual(first.rows[1], [
    "value with\r\nnewline",
    'escaped "quote"',
  ]);
  assert.deepEqual(first.issues, []);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.rows));
});

test("invalid UTF-8 and malformed quoting fail closed", () => {
  const invalidUtf8 = analyseCreditexCsv(
    Uint8Array.from([0xc3, 0x28]),
  );
  assert.equal(invalidUtf8.rows.length, 0);
  assert.deepEqual(
    invalidUtf8.issues.map((issue) => issue.code),
    ["CSV_INVALID_UTF8"],
  );

  const malformed = analyseCreditexCsv('header\n"not closed');
  assert.deepEqual(
    malformed.issues.map((issue) => issue.code),
    ["CSV_UNCLOSED_QUOTED_FIELD"],
  );
});

test("VEU fixture preflight cannot imply an authorised submission contract", () => {
  assert.equal(
    CREDITEX_INTERCHANGE_PREFLIGHT_CONTRACT,
    "creditex-interchange-preflight/v1",
  );
  assert.equal(CREDITEX_VEU_INTERCHANGE_DESCRIPTOR.serializerAvailable, false);
  assert.equal(CREDITEX_VEU_INTERCHANGE_DESCRIPTOR.parserAvailable, false);
  assert.equal(
    CREDITEX_VEU_INTERCHANGE_DESCRIPTOR.externalSubmissionEnabled,
    false,
  );
  assert.match(
    CREDITEX_VEU_INTERCHANGE_DESCRIPTOR.publicRegistryUrl,
    /^https:\/\/veu\.esc\.vic\.gov\.au\//,
  );

  const first = preflightBlockedVeuFixture("candidate\nvalue\n");
  const second = preflightBlockedVeuFixture("candidate\nvalue\n");
  assert.equal(first.status, "blocked");
  assert.equal(first.externalSubmissionEnabled, false);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.ok(
    first.issues.some(
      (issue) => issue.code === "VEU_AUTHORISED_CONTRACT_UNAVAILABLE",
    ),
  );
});
