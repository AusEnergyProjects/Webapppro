import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS,
  REC_BULK_UPLOAD_KINDS,
  REC_BULK_UPLOAD_MAXIMUM_RECORDS,
  preflightBlockedRecBulkUpload,
} from "../src/lib/creditex-rec-bulk-upload.ts";

function candidateWithRows(count) {
  return [
    "candidate header",
    ...Array.from({ length: count }, (_, index) => `candidate ${index + 1}`),
    "",
  ].join("\r\n");
}

test("REC public file limits are represented separately for SGU and SWH/ASHP", () => {
  assert.deepEqual(REC_BULK_UPLOAD_KINDS, ["SGU", "SWH_ASHP"]);
  assert.equal(REC_BULK_UPLOAD_MAXIMUM_RECORDS, 250);

  for (const kind of REC_BULK_UPLOAD_KINDS) {
    const descriptor = CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS[kind];
    assert.equal(descriptor.kind, kind);
    assert.equal(descriptor.fileType, "CSV");
    assert.equal(descriptor.extension, ".CSV");
    assert.equal(descriptor.characterSet, "UTF-8");
    assert.equal(descriptor.columnDelimiter, "comma");
    assert.equal(descriptor.textQualifier, "double quote");
    assert.equal(descriptor.headerRequired, true);
    assert.equal(descriptor.maximumRecords, 250);
    assert.deepEqual(descriptor.validationStages, [
      "structural",
      "functional",
    ]);
    assert.equal(descriptor.completeFileAcceptance, "binary");
    assert.equal(descriptor.exactHeader, null);
    assert.equal(descriptor.serializerAvailable, false);
    assert.equal(descriptor.functionalParserAvailable, false);
    assert.equal(descriptor.externalSubmissionEnabled, false);
    assert.match(descriptor.officialSourceUrl, /^https:\/\/cer\.gov\.au\//);
  }
});

test("REC preflight enforces the public 250-record ceiling", () => {
  const atLimit = preflightBlockedRecBulkUpload(
    "SGU",
    candidateWithRows(250),
  );
  const overLimit = preflightBlockedRecBulkUpload(
    "SGU",
    candidateWithRows(251),
  );

  assert.equal(atLimit.dataRecordCount, 250);
  assert.equal(
    atLimit.issues.some(
      (issue) => issue.code === "REC_MAXIMUM_RECORDS_EXCEEDED",
    ),
    false,
  );
  assert.equal(overLimit.dataRecordCount, 251);
  assert.equal(
    overLimit.issues.some(
      (issue) => issue.code === "REC_MAXIMUM_RECORDS_EXCEEDED",
    ),
    true,
  );
  assert.ok(
    atLimit.issues.some(
      (issue) => issue.code === "REC_EXACT_DICTIONARY_NOT_RETAINED",
    ),
  );
  assert.equal(atLimit.status, "blocked");
  assert.equal(atLimit.externalSubmissionEnabled, false);
});

test("REC manifests are deterministic and contract-specific", () => {
  const candidate = candidateWithRows(1);
  const sgu = preflightBlockedRecBulkUpload("SGU", candidate);
  const sguRepeat = preflightBlockedRecBulkUpload("SGU", candidate);
  const swh = preflightBlockedRecBulkUpload("SWH_ASHP", candidate);

  assert.equal(sgu.manifestSha256, sguRepeat.manifestSha256);
  assert.notEqual(sgu.manifestSha256, swh.manifestSha256);
  assert.notEqual(
    CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS.SGU.adapterKey,
    CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS.SWH_ASHP.adapterKey,
  );
});
