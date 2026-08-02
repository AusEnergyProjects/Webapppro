import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDITEX_TESSA_CSV_CONTRACT,
  CREDITEX_TESSA_CSV_DESCRIPTORS,
  TESSA_SCHEMES,
  preflightBlockedTessaCsv,
} from "../src/lib/creditex-tessa-csv.ts";

test("TESSA v1.7 keeps ESS and PDRS separate and cannot emit a file", () => {
  assert.equal(CREDITEX_TESSA_CSV_CONTRACT, "tessa-csv/v1.7");
  assert.deepEqual(TESSA_SCHEMES, ["ESS", "PDRS"]);

  for (const scheme of TESSA_SCHEMES) {
    const descriptor = CREDITEX_TESSA_CSV_DESCRIPTORS[scheme];
    assert.equal(descriptor.scheme, scheme);
    assert.equal(descriptor.version, "1.7");
    assert.equal(descriptor.effectiveFrom, "2026-07-22");
    assert.equal(descriptor.effectiveTo, "2050-06-30");
    assert.equal(descriptor.schemaWorkbookSha256, null);
    assert.equal(descriptor.exactHeader, null);
    assert.equal(descriptor.serializerAvailable, false);
    assert.equal(descriptor.parserAvailable, false);
    assert.equal(descriptor.externalSubmissionEnabled, false);
    assert.match(descriptor.officialSourceUrl, /^https:\/\//);
    assert.match(descriptor.schemaWorkbookUrl, /V1\.7\.XLSX$/);
  }
  assert.notEqual(
    CREDITEX_TESSA_CSV_DESCRIPTORS.ESS.adapterKey,
    CREDITEX_TESSA_CSV_DESCRIPTORS.PDRS.adapterKey,
  );
});

test("TESSA candidate manifests are deterministic but always schema-blocked", () => {
  const candidate = "candidate header\ncandidate value\n";
  const ess = preflightBlockedTessaCsv("ESS", candidate);
  const essRepeat = preflightBlockedTessaCsv("ESS", candidate);
  const pdrs = preflightBlockedTessaCsv("PDRS", candidate);

  assert.equal(ess.status, "blocked");
  assert.equal(ess.externalSubmissionEnabled, false);
  assert.equal(ess.dataRecordCount, 1);
  assert.equal(ess.manifestSha256, essRepeat.manifestSha256);
  assert.notEqual(ess.manifestSha256, pdrs.manifestSha256);
  assert.ok(
    ess.issues.some(
      (issue) => issue.code === "TESSA_V1_7_SCHEMA_BYTES_NOT_RETAINED",
    ),
  );
});

test("an empty TESSA candidate reports both structural and source blockers", () => {
  const result = preflightBlockedTessaCsv("ESS", "");
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "TESSA_HEADER_REQUIRED",
      "TESSA_V1_7_SCHEMA_BYTES_NOT_RETAINED",
    ],
  );
});
