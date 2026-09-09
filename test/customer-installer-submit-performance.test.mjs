import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const assistantLeadRoute = fs.readFileSync(
  new URL("../src/app/api/energy-assistant/leads/route.ts", import.meta.url),
  "utf8",
);
const worker = fs.readFileSync(
  new URL("../worker/index.ts", import.meta.url),
  "utf8",
);
const dispatchServer = fs.readFileSync(
  new URL("../src/lib/customer-opportunity-dispatch-server.ts", import.meta.url),
  "utf8",
);


test("durable allocation remains available to shared lead workflows", () => {
  assert.match(
    worker,
    /ctx\.waitUntil\([\s\S]*drainCustomerOpportunityDispatchJobs\(\{ jobId \}\)/,
  );
  assert.match(
    dispatchServer,
    /await allocateNearestInstallers\(row\.opportunity_id, "customer-platform"\)/,
  );
});

test("assistant trade sharing returns after durable queueing and uses the same worker dispatch seam", () => {
  assert.match(
    assistantLeadRoute,
    /result\.dispatchJobId[\s\S]*CUSTOMER_OPPORTUNITY_DISPATCH_HEADER/,
  );
  assert.doesNotMatch(
    assistantLeadRoute,
    /drainCustomerOpportunityDispatchJobs|allocateNearestInstallers/,
  );
  assert.match(
    worker,
    /ctx\.waitUntil\([\s\S]*drainCustomerOpportunityDispatchJobs\(\{ jobId \}\)/,
  );
});
