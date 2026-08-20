import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(
  new URL("../src/app/api/customer-projects/route.ts", import.meta.url),
  "utf8",
);
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

function submitBranch(source) {
  const start = source.indexOf('if (action === "submit")');
  const end = source.indexOf('} else if (action === "release_contact")', start);
  assert.ok(start >= 0 && end > start, "customer submit branch must remain identifiable");
  return source.slice(start, end);
}

test("customer submit commits the operations event without waiting for off-screen delivery", () => {
  const branch = submitBranch(route);
  assert.match(branch, /const submitStatements = \[/);
  assert.match(branch, /adminNotificationStatement\(db, \{/);
  assert.match(branch, /eventKey: `customer-enquiry:\$\{id\}`/);
  assert.match(branch, /const submitResults = await db\.batch\(submitStatements\)/);
  assert.doesNotMatch(branch, /createAdminNotification\(/);
  assert.doesNotMatch(branch, /dispatchAdminNotificationDeliveries\(/);
});

test("customer submit queues durable background allocation and returns a compact 202 acknowledgement", () => {
  const branch = submitBranch(route);
  assert.doesNotMatch(route, /allocateNearestInstallers/);
  assert.match(branch, /INSERT INTO customer_opportunity_dispatch_jobs/);
  assert.match(branch, /const submitResults = await db\.batch\(submitStatements\)/);
  assert.match(branch, /return dispatchJson\(\{[\s\S]*dispatch: \{ status: "queued" \}/);
  assert.match(route, /function dispatchJson\(body: object, dispatchJobId: string, status = 202\)/);
  assert.match(route, /\[CUSTOMER_OPPORTUNITY_DISPATCH_HEADER\]: dispatchJobId/);
  assert.doesNotMatch(branch, /projectsForOwner/);
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

test("project response hydration runs independent D1 groups concurrently", () => {
  const hydrateStart = route.indexOf("async function projectsForOwner");
  const hydrateEnd = route.indexOf("export async function GET", hydrateStart);
  const hydrate = route.slice(hydrateStart, hydrateEnd);
  assert.match(hydrate, /const \[account, rows\] = await Promise\.all\(\[/);
  assert.match(
    hydrate,
    /progressRows,[\s\S]*quoteRows,[\s\S]*handoverRows,[\s\S]*evidenceRows,[\s\S]*= await Promise\.all\(\[/,
  );
  assert.match(
    hydrate,
    /const \[assetRows, complianceRows, documentRows, correctionRows\] = await Promise\.all\(\[/,
  );
});
