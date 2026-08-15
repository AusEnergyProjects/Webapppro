import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const acquisitionComponent = new URL(
  "../src/components/CreditexOfficialSourceBatchAcquisition.tsx",
  import.meta.url,
);
const workPackGovernance = new URL(
  "../src/components/CreditexActivityWorkPackGovernance.tsx",
  import.meta.url,
);
const adminPortal = new URL(
  "../src/components/AdminOperationsPortal.tsx",
  import.meta.url,
);
const creditexPortal = new URL(
  "../src/components/CreditexCompliancePortal.tsx",
  import.meta.url,
);
const adminRoute = new URL(
  "../src/app/api/admin/compliance-official-sources/batch-import/route.ts",
  import.meta.url,
);
const creditexRoute = new URL(
  "../src/app/api/creditex/official-sources/batch-import/route.ts",
  import.meta.url,
);

test("Admin and Creditex Forms reuse the same bounded official source acquisition control", async () => {
  const [governance, admin, creditex] = await Promise.all([
    readFile(workPackGovernance, "utf8"),
    readFile(adminPortal, "utf8"),
    readFile(creditexPortal, "utf8"),
  ]);

  assert.match(governance, /CreditexOfficialSourceBatchAcquisition/);
  assert.match(governance, /endpoint=\{sourceBatchEndpoint\}/);
  assert.match(governance, /onImported=\{load\}/);
  assert.match(
    admin,
    /sourceBatchEndpoint="\/api\/admin\/compliance-official-sources\/batch-import"/,
  );
  assert.match(
    creditex,
    /sourceBatchEndpoint="\/api\/creditex\/official-sources\/batch-import"/,
  );
});

test("Forms source acquisition makes missing and pending custody explicit without an approval shortcut", async () => {
  const source = await readFile(acquisitionComponent, "utf8");

  assert.match(source, /const MAXIMUM_BATCH_ITEMS = 8/);
  assert.match(source, /const MAXIMUM_BATCH_BYTES = 32 \* 1024 \* 1024/);
  assert.match(source, /confirmExactOfficialSourceCustodyImport: true/);
  assert.match(source, /manifestContract: summary\.manifestContract/);
  assert.match(source, /Missing from Creditex custody/);
  assert.match(source, /Pending independent Creditex review/);
  assert.match(source, /Approved source \| not attached to an activity/);
  assert.match(source, /Custody receipt mismatch \| action required/);
  assert.match(source, /Import selected sources/);
  assert.match(source, /Every retained source still requires independent Creditex review and activity attachment/);
  assert.doesNotMatch(source, />Approve</);
  assert.doesNotMatch(source, /record_decision/);
  assert.doesNotMatch(source, /operationallyReady:\s*true/);
  assert.doesNotMatch(source, /[\u2013\u2014]/);
});

test("both batch route wrappers preserve their independent role boundaries and shared exact import service", async () => {
  const [admin, creditex] = await Promise.all([
    readFile(adminRoute, "utf8"),
    readFile(creditexRoute, "utf8"),
  ]);

  for (const source of [admin, creditex]) {
    assert.match(source, /importCreditexOfficialSourceCustodyBatch/);
    assert.match(source, /listCreditexOfficialSourceCustodyCandidateStatus/);
    assert.match(source, /readBoundedCreditexOfficialSourceBatchInput/);
    assert.match(source, /result\.failed\s*\? 207/);
    assert.doesNotMatch(source, /approved:\s*true/);
    assert.doesNotMatch(source, /ruleActivationEnabled:\s*true/);
  }
  assert.match(admin, /requireAdminIdentity\(request, \["owner", "admin"\]\)/);
  assert.match(
    creditex,
    /allowedRoles: \["admin", "case_manager"\]/,
  );
  assert.match(creditex, /actorKind: "compliance"/);
});
