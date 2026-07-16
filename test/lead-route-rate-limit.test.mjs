import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const routePath = path.join(process.cwd(), "src/app/api/leads/route.js");

test("lead route uses the D1 limiter and trusted proxy client addresses", () => {
  const route = fs.readFileSync(routePath, "utf8");

  assert.match(route, /createSharedLeadRateLimiter/);
  assert.match(route, /await leadRateLimiter\.check/);
  assert.match(route, /getDatabase: getD1/);
  assert.match(route, /cf-connecting-ip/);
  assert.doesNotMatch(route, /x-nf-client-connection-ip/);
  assert.match(route, /"Retry-After"/);
  assert.match(route, /createOperationalRecorder\(\{ event: "api\.leads" \}\)/);
  assert.match(route, /"X-Request-Id": operations\.requestId/);
  assert.match(route, /submissionType: payload\.submissionType/);
  assert.match(route, /createLeadEnvelope/);
  assert.match(route, /acknowledgement\.trim\(\) !== "ok"/);
  assert.doesNotMatch(route, /rateBuckets|new Map\(\)/);
});
