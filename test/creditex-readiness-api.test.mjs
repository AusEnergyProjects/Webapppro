import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CREDITEX_CALCULATION_COVERAGE_SUMMARY,
} from "../src/lib/creditex-calculation-coverage.ts";
import {
  CREDITEX_VEU_INTERCHANGE_DESCRIPTOR,
} from "../src/lib/creditex-interchange-preflight.ts";
import {
  CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS,
} from "../src/lib/creditex-rec-bulk-upload.ts";
import {
  CREDITEX_TESSA_CSV_DESCRIPTORS,
} from "../src/lib/creditex-tessa-csv.ts";

const read = (path) =>
  fs.readFileSync(new URL(path, import.meta.url), "utf8");

const interchangeRoute = read(
  "../src/app/api/creditex/interchange-readiness/route.ts",
);
const calculationRoute = read(
  "../src/app/api/creditex/calculation-coverage/route.ts",
);

test("readiness routes require a verified Creditex compliance identity", () => {
  for (const route of [interchangeRoute, calculationRoute]) {
    assert.match(route, /requireFirebaseIdentity\(request\)/);
    assert.match(route, /requireComplianceIdentity\(identity,/);
    assert.match(
      route,
      /allowedRoles: \["admin", "case_manager", "reviewer", "auditor"\]/,
    );
    assert.match(route, /export async function GET\(request: Request\)/);
    assert.doesNotMatch(
      route,
      /export async function (?:POST|PUT|PATCH|DELETE)\(/,
    );
    assert.match(route, /"Cache-Control": "private, no-store"/);
    assert.match(route, /sameOrigin\(request\)/);
  }
});

test("interchange readiness exposes five blocked adapters and no send path", () => {
  const adapters = [
    CREDITEX_VEU_INTERCHANGE_DESCRIPTOR,
    CREDITEX_TESSA_CSV_DESCRIPTORS.ESS,
    CREDITEX_TESSA_CSV_DESCRIPTORS.PDRS,
    CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS.SGU,
    CREDITEX_REC_BULK_UPLOAD_DESCRIPTORS.SWH_ASHP,
  ];

  assert.equal(adapters.length, 5);
  assert.ok(
    adapters.every(
      (adapter) =>
        adapter.serializerAvailable === false
        && adapter.externalSubmissionEnabled === false,
    ),
  );
  assert.match(interchangeRoute, /dryRunOnly: true/);
  assert.match(interchangeRoute, /externalSubmissionEnabled: false/);
  assert.match(interchangeRoute, /status: "blocked"/g);
  assert.doesNotMatch(interchangeRoute, /request\.(?:json|formData|body)/);
  assert.doesNotMatch(
    interchangeRoute,
    /preflightBlocked(?:TessaCsv|RecBulkUpload|VeuFixture)\(/,
  );
});

test("calculation readiness accounts for every activity without enabling certificates", () => {
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.programs, 35);
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.activities, 216);
  assert.equal(CREDITEX_CALCULATION_COVERAGE_SUMMARY.estimateExecutable, 33);
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_SUMMARY.blockedOrNonExecutable,
    183,
  );
  assert.equal(
    CREDITEX_CALCULATION_COVERAGE_SUMMARY.certificateActionsEnabled,
    0,
  );
  assert.match(calculationRoute, /certificateActionsEnabled: false/);
  assert.doesNotMatch(calculationRoute, /request\.(?:json|formData|body)/);
});
