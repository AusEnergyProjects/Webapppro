import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync(
  new URL("../src/app/api/customer-projects/route.ts", import.meta.url),
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

test("customer submit still awaits durable installer allocation before reporting success", () => {
  const branch = submitBranch(route);
  assert.match(
    branch,
    /await allocateNearestInstallers\(opportunityId, "customer-platform"\)\.catch\(\(\) => null\)/,
  );
  assert.doesNotMatch(branch, /void allocateNearestInstallers|setTimeout/);
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
