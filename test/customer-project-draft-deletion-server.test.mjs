import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const projectsRoute = read("../src/app/api/customer-projects/route.ts");
const evidenceRoute = read("../src/app/api/customer-project-evidence/route.ts");
const evidenceBucket = read("../src/lib/customer-project-evidence-bucket.ts");

test("draft deletion keeps the existing authenticated owner boundary", () => {
  assert.match(
    projectsRoute,
    /export async function DELETE\(request: Request\) \{[\s\S]*customerProjectMutation\(request, "delete_draft"\)/,
  );
  assert.match(projectsRoute, /if \(!sameOrigin\(request\)\)/);
  assert.match(projectsRoute, /requireFirebaseIdentity/);
  assert.match(
    projectsRoute,
    /SELECT account_status FROM customer_accounts WHERE firebase_uid = \?/,
  );
  assert.match(
    projectsRoute,
    /SELECT \* FROM customer_projects WHERE id = \? AND firebase_uid = \?/,
  );
  assert.match(
    projectsRoute,
    /if \(!current\) return json\(\{ ok: false, error: "Project not found\." \}, 404\)/,
  );
  assert.match(
    projectsRoute,
    /storedStatus === "deleting" \? "draft" : storedStatus/,
  );
});

test("draft deletion requires explicit confirmation and current saved state", () => {
  const deleteBranch = projectsRoute.slice(
    projectsRoute.indexOf('if (action === "delete_draft")'),
    projectsRoute.indexOf('} else if (action === "update")'),
  );
  assert.match(projectsRoute, /action === "delete_draft"/);
  assert.match(projectsRoute, /raw\.confirmDelete !== true/);
  assert.match(
    deleteBranch,
    /!\["draft", "deleting"\]\.includes\(String\(current\.status\)\)/,
  );
  assert.doesNotMatch(deleteBranch, /current\.status !== "draft"/);
  assert.match(
    deleteBranch,
    /expectedPlanRevision !== Number\(current\.plan_revision \|\| 1\)/,
  );
  assert.match(
    deleteBranch,
    /expectedUpdatedAt !== String\(current\.updated_at \|\| ""\)/,
  );
  assert.match(deleteBranch, /code: "PROJECT_DELETE_CONFLICT"/);
  assert.match(
    deleteBranch,
    /status = 'deleting'[\s\S]*status = 'draft'[\s\S]*plan_revision = \? AND updated_at = \?/,
  );
  assert.match(
    deleteBranch,
    /const resumingDeletion = current\.status === "deleting"/,
  );
  assert.match(
    deleteBranch,
    /if \(!resumingDeletion\) \{[\s\S]*SET status = 'deleting'/,
  );
  assert.match(
    projectsRoute,
    /if \(!forcedAction && action === "delete_draft"\)/,
  );
});

test("draft deletion refuses every linked customer lifecycle", () => {
  for (const table of [
    "customer_project_quotes",
    "customer_project_contact_releases",
    "customer_project_contact_release_events",
    "customer_project_arrival_proposals",
    "customer_project_arrival_events",
    "appointment_notification_events",
    "trade_handover_packs",
    "trade_opportunities",
  ]) {
    assert.match(projectsRoute, new RegExp(`FROM ${table}`));
  }
  assert.match(projectsRoute, /current\.opportunity_id \|\| current\.submitted_at/);
  assert.match(projectsRoute, /source_reference = \?/);
  assert.doesNotMatch(
    projectsRoute,
    /DELETE FROM (?:customer_project_quotes|customer_project_contact_releases|customer_project_arrival_proposals|appointment_notification_events|trade_handover_packs|trade_opportunities)/,
  );
  assert.match(
    projectsRoute,
    /if \(await hasLinkedLifecycle\(\)\) \{[\s\S]*await restoreDeletionLock\(\);[\s\S]*became linked/,
  );
  const postLockLifecycleCheck = projectsRoute.lastIndexOf(
    "if (await hasLinkedLifecycle())",
    projectsRoute.indexOf("await deleteCustomerProjectEvidenceObjects("),
  );
  assert.ok(postLockLifecycleCheck > projectsRoute.indexOf("SET status = 'deleting'"));
  assert.ok(
    postLockLifecycleCheck
      < projectsRoute.indexOf("await deleteCustomerProjectEvidenceObjects("),
  );
});

test("server-selected R2 objects are removed before owned database children", () => {
  assert.match(
    projectsRoute,
    /SELECT object_key[\s\S]*FROM customer_project_evidence[\s\S]*project_id = \? AND customer_uid = \?/,
  );
  const objectDelete = projectsRoute.indexOf(
    "await deleteCustomerProjectEvidenceObjects(",
  );
  const databaseDelete = projectsRoute.indexOf(
    "deletionResults = await db.batch([",
  );
  assert.ok(objectDelete > 0);
  assert.ok(databaseDelete > objectDelete);

  assert.match(
    evidenceBucket,
    /new Set\(objectKeys\.filter\(Boolean\)\)/,
  );
  assert.match(
    evidenceBucket,
    /for \(const objectKey of uniqueKeys\) \{[\s\S]*await bucket\.delete\(objectKey\)/,
  );
  assert.match(
    evidenceRoute,
    /getCustomerProjectEvidenceBucket as getEvidenceBucket/,
  );
});

test("database cleanup is owner scoped and deletes the project last", () => {
  const childTables = [
    "customer_project_evidence_events",
    "customer_project_evidence",
    "customer_project_plan_revisions",
    "customer_project_outcome_checkins",
    "customer_consent_receipts",
  ];
  let previous = -1;
  for (const table of childTables) {
    const position = projectsRoute.indexOf(`DELETE FROM ${table}`, previous + 1);
    assert.ok(position > previous, `${table} should be deleted in the owned cleanup batch`);
    previous = position;
  }
  const projectDelete = projectsRoute.indexOf(
    "DELETE FROM customer_projects",
    previous + 1,
  );
  assert.ok(projectDelete > previous, "the project row must be deleted last");
  assert.match(
    projectsRoute,
    /DELETE FROM customer_project_evidence_events[\s\S]*project_id = \? AND customer_uid = \?/,
  );
  assert.match(
    projectsRoute,
    /DELETE FROM customer_project_evidence[\s\S]*project_id = \? AND customer_uid = \?/,
  );
  assert.match(
    projectsRoute,
    /DELETE FROM customer_project_plan_revisions[\s\S]*project_id = \? AND customer_uid = \?/,
  );
  assert.match(
    projectsRoute,
    /DELETE FROM customer_project_outcome_checkins[\s\S]*project_id = \? AND customer_uid = \?/,
  );
  assert.match(
    projectsRoute,
    /DELETE FROM customer_consent_receipts[\s\S]*project_id = \? AND firebase_uid = \?/,
  );
  assert.match(
    projectsRoute,
    /DELETE FROM customer_projects[\s\S]*id = \? AND firebase_uid = \? AND status = 'deleting'/,
  );
});

test("storage or database failures restore a retryable draft and never report success", () => {
  assert.match(
    projectsRoute,
    /const restoreDeletionLock = async \(\) => \{[\s\S]*SET status = 'draft', updated_at = \?/,
  );
  assert.match(
    projectsRoute,
    /catch \{[\s\S]*await restoreDeletionLock\(\);[\s\S]*uploaded files could not be removed[\s\S]*503/,
  );
  assert.match(
    projectsRoute,
    /catch \{[\s\S]*await restoreDeletionLock\(\);[\s\S]*could not be deleted safely[\s\S]*503/,
  );
  assert.match(
    projectsRoute,
    /return json\(\{ ok: true, id, projects: await projectsForOwner\(user\.uid\) \}\)/,
  );
});
