import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  BoundedJsonRequestError,
  readBoundedJsonRequest,
} from "../src/lib/bounded-json-request.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const complianceRoute = read("../src/app/api/trade-compliance/route.ts");
const syncRoute = read("../src/app/api/trade-team/sync/route.ts");
const mediaRoute = read("../src/app/api/trade-team/media/route.ts");

async function expectActualByteLimit(maximumBytes, headers) {
  const request = new Request(
    "https://compare.ausenergyassessments.com/api/test",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ value: "x".repeat(maximumBytes) }),
    },
  );
  await assert.rejects(
    readBoundedJsonRequest(request, maximumBytes),
    (error) => {
      assert.ok(error instanceof BoundedJsonRequestError);
      assert.equal(error.code, "REQUEST_TOO_LARGE");
      assert.equal(error.status, 413);
      return true;
    },
  );
}

test("trade JSON limits count streamed bytes with absent or false Content-Length", async () => {
  for (const maximumBytes of [4_096, 128 * 1024, 512 * 1024]) {
    await expectActualByteLimit(maximumBytes, {});
    await expectActualByteLimit(maximumBytes, { "content-length": "1" });
  }
});

test("trade JSON routes use the bounded reader and retain their workflow caps", () => {
  assert.match(
    complianceRoute,
    /readBoundedJsonRequest\(\s*request,\s*MAX_COMPLIANCE_INTAKE_JSON_BYTES,\s*\)/,
  );
  assert.match(complianceRoute, /MAX_COMPLIANCE_INTAKE_JSON_BYTES = 4_096/);
  assert.doesNotMatch(complianceRoute, /request\.json\(\)/);

  assert.match(
    syncRoute,
    /readBoundedJsonRequest\(request, MAX_SYNC_JSON_BYTES\)/,
  );
  assert.match(syncRoute, /MAX_SYNC_JSON_BYTES = 512 \* 1024/);
  assert.match(syncRoute, /MAX_ACTIONS = 50/);
  assert.match(
    syncRoute,
    /!actions\.length \|\| actions\.length > MAX_ACTIONS/,
  );
  assert.doesNotMatch(syncRoute, /request\.json\(\)/);

  assert.match(
    mediaRoute,
    /readBoundedJsonRequest\(request, MAX_MEDIA_JSON_BYTES\)/,
  );
  assert.match(mediaRoute, /MAX_MEDIA_JSON_BYTES = 128 \* 1024/);
  assert.match(mediaRoute, /includes\("multipart\/form-data"\)/);
  assert.doesNotMatch(mediaRoute, /request\.json\(\)/);
});

test("mobile bootstrap companions share the selected job cohort and a total cardinality cap", () => {
  const accessibleJobs = syncRoute.slice(
    syncRoute.indexOf("async function accessibleJobs"),
    syncRoute.indexOf("async function highWater"),
  );
  assert.match(syncRoute, /const MAX_SYNC_JOBS = 500/);
  assert.match(syncRoute, /const MAX_SYNC_COMPANION_ROWS = 10_000/);
  assert.match(
    syncRoute,
    /const ACCESSIBLE_JOB_COHORT_SQL = `SELECT cohort\.id[\s\S]*LIMIT \$\{MAX_SYNC_JOBS\}`/,
  );
  for (const table of [
    "trade_work_order_tasks",
    "trade_crm_job_media",
    "trade_job_forms",
    "compliance_cases",
  ]) {
    const start = accessibleJobs.indexOf(`FROM ${table}`);
    assert.notEqual(start, -1, `${table} companion query is present`);
    const query = accessibleJobs.slice(
      start,
      accessibleJobs.indexOf(").all<", start),
    );
    assert.match(query, /work_order_id IN \(\$\{ACCESSIBLE_JOB_COHORT_SQL\}\)/);
    assert.match(query, /LIMIT \?/);
    assert.match(query, /MAX_SYNC_COMPANION_ROWS \+ 1/);
  }
  assert.match(
    syncRoute,
    /const companionRowCount = taskRows\.results\.length[\s\S]*\+ complianceRows\.results\.length/,
  );
  assert.match(
    syncRoute,
    /companionRowCount > MAX_SYNC_COMPANION_ROWS[\s\S]*SYNC_RESPONSE_CARDINALITY_EXCEEDED/,
  );
});
