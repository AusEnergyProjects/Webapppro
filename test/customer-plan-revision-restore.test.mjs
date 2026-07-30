import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  compareCustomerPlanRevisions,
  customerPlanRevisionProjection,
  prepareCustomerPlanRevisionRestore,
} from "../src/lib/customer-plan-revisions.mjs";
import {
  CUSTOMER_PLAN_VERSION,
  createCustomerProjectPlan,
} from "../src/lib/customer-projects.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const migration = read("../drizzle/0084_customer_plan_revision_restore.sql");
const schema = read("../db/schema.ts");
const projectsRoute = read("../src/app/api/customer-projects/route.ts");

function applyMigration(db) {
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((item) => item.trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
}

test("the additive migration backfills the owner project revision and restore lineage", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_projects (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL
  )`);
  db.exec(`CREATE TABLE customer_project_plan_revisions (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    customer_uid text NOT NULL,
    revision_number integer NOT NULL
  )`);
  db.exec(`INSERT INTO customer_projects (id, firebase_uid) VALUES
    ('with-history', 'owner-1'),
    ('without-history', 'owner-1'),
    ('other-owner', 'owner-2')`);
  db.exec(`INSERT INTO customer_project_plan_revisions
    (id, project_id, customer_uid, revision_number) VALUES
    ('r1', 'with-history', 'owner-1', 1),
    ('r4', 'with-history', 'owner-1', 4),
    ('foreign-r9', 'with-history', 'owner-2', 9),
    ('other-r3', 'other-owner', 'owner-2', 3)`);

  applyMigration(db);

  assert.deepEqual(
    db.prepare("SELECT id, plan_revision FROM customer_projects ORDER BY id")
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "other-owner", plan_revision: 3 },
      { id: "with-history", plan_revision: 4 },
      { id: "without-history", plan_revision: 1 },
    ],
  );
  assert.deepEqual(
    db.prepare(`SELECT id, restored_from_revision
      FROM customer_project_plan_revisions ORDER BY id`)
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "foreign-r9", restored_from_revision: 0 },
      { id: "other-r3", restored_from_revision: 0 },
      { id: "r1", restored_from_revision: 0 },
      { id: "r4", restored_from_revision: 0 },
    ],
  );
  db.close();

  assert.match(schema, /planRevision:\s*integer\("plan_revision"\)\.notNull\(\)\.default\(1\)/);
  assert.match(
    schema,
    /restoredFromRevision:\s*integer\("restored_from_revision"\)\.notNull\(\)\.default\(0\)/,
  );
});

test("revision comparison is deterministic, bounded and explains each roadmap change", () => {
  const from = {
    revisionNumber: 2,
    planVersion: "v2",
    goals: ["lower-bills", "improve-comfort", "lower-bills"],
    homeFeatures: ["single-glazing", "gas-heating"],
    pace: "staged",
    budgetRange: "under_2k",
    planSnapshot: {
      version: "v2",
      items: [
        { id: "step-a", stage: "First", title: "A", text: "Before A" },
        { id: "step-b", stage: "Next", title: "B", text: "Before B" },
        { id: "step-c", stage: "Later", title: "C", text: "Before C" },
      ],
    },
  };
  const to = {
    revisionNumber: 3,
    planVersion: "v3",
    goals: ["improve-comfort", "healthier-home"],
    homeFeatures: ["gas-heating", "double-glazing"],
    pace: "whole-home",
    budgetRange: "10k_plus",
    planSnapshot: {
      version: "v3",
      items: [
        { id: "step-b", stage: "Next", title: "B", text: "Before B" },
        { id: "step-a", stage: "First", title: "A updated", text: "After A" },
        { id: "step-d", stage: "Later", title: "D", text: "Added D" },
      ],
    },
  };

  const first = compareCustomerPlanRevisions(from, to);
  const second = compareCustomerPlanRevisions(
    structuredClone(from),
    structuredClone(to),
  );
  assert.deepEqual(first, second);
  assert.deepEqual(first.goals, {
    added: ["healthier-home"],
    removed: ["lower-bills"],
  });
  assert.deepEqual(first.homeFeatures, {
    added: ["double-glazing"],
    removed: ["single-glazing"],
  });
  assert.deepEqual(first.pace, {
    changed: true,
    from: "staged",
    to: "whole-home",
  });
  assert.deepEqual(first.budgetRange, {
    changed: true,
    from: "under_2k",
    to: "10k_plus",
  });
  assert.deepEqual(first.planVersion, {
    changed: true,
    from: "v2",
    to: "v3",
  });
  assert.deepEqual(first.steps.added.map((item) => item.id), ["step-d"]);
  assert.deepEqual(first.steps.removed.map((item) => item.id), ["step-c"]);
  assert.deepEqual(
    first.steps.moved.map(({ id, fromPosition, toPosition }) => ({
      id,
      fromPosition,
      toPosition,
    })),
    [
      { id: "step-b", fromPosition: 2, toPosition: 1 },
      { id: "step-a", fromPosition: 1, toPosition: 2 },
    ],
  );
  assert.deepEqual(first.steps.modified.map((item) => item.id), ["step-a"]);
  assert.equal(first.changeCount, 12);

  const projected = customerPlanRevisionProjection({
    revisionNumber: 9,
    goals: Array.from({ length: 30 }, (_, index) => `goal-${index}`),
    homeFeatures: Array.from({ length: 80 }, (_, index) => `feature-${index}`),
    planSnapshot: {
      version: "bounded",
      propertyContext: {
        storeys: "two",
        ageBand: "pre_1960",
        floorArea: "100_199",
        roofType: "metal",
        switchboard: "older_fuses",
        approvalContext: "strata",
        accessConstraints: ["stairs", "unsafe"],
        privateCanary: "must not survive",
      },
      serviceCategories: ["solar", "glazing", "not-a-service"],
      items: Array.from({ length: 80 }, (_, index) => ({
        id: `step-${index}`,
        title: `Step ${index}`,
        text: "x".repeat(1_200),
      })),
    },
  });
  assert.equal(projected.goals.length, 10);
  assert.equal(projected.homeFeatures.length, 40);
  assert.equal(projected.planSnapshot.items.length, 40);
  assert.equal(projected.planSnapshot.items[0].text.length, 900);
  assert.equal(projected.hasRoadmapInputs, true);
  assert.deepEqual(projected.propertyContext, {
    storeys: "two",
    ageBand: "pre_1960",
    floorArea: "100_199",
    roofType: "metal",
    switchboard: "older_fuses",
  });
  assert.deepEqual(
    projected.serviceCategories,
    ["solar", "glazing"],
  );
});

test("restore preparation reuses canonical legacy normalisation and reconciles completion", () => {
  const currentProject = {
    title: "Whole home priorities",
    homeNickname: "My home",
    postcode: "3000",
    addressState: "VIC",
    propertyType: "house",
    householdSituation: "renter",
    goal: "lower-bills",
    goals: ["lower-bills"],
    pace: "staged",
    existingFeatures: ["single-glazing"],
    serviceCategories: ["draught-proofing"],
    priorities: ["comfort"],
    projectStage: "exploring",
    timing: "planning",
    budgetRange: "under_2k",
    propertyContext: {
      storeys: "single",
      ageBand: "1960_1999",
      floorArea: "under_100",
      roofType: "tile",
      switchboard: "modern_breakers",
      approvalContext: "none",
      accessConstraints: [],
    },
    privateNotes: "Private household note",
    advisorProfile: {},
  };
  currentProject.planSnapshot = createCustomerProjectPlan(currentProject);

  const restoredInputs = {
    ...currentProject,
    goals: ["improve-comfort"],
    existingFeatures: ["double-glazing"],
    pace: "whole-home",
    budgetRange: "10k_plus",
    serviceCategories: ["solar", "glazing"],
    propertyContext: {
      storeys: "two",
      ageBand: "pre_1960",
      floorArea: "100_199",
      roofType: "metal",
      switchboard: "older_fuses",
      approvalContext: "strata",
      accessConstraints: ["stairs"],
    },
  };
  const targetPlan = createCustomerProjectPlan(restoredInputs);
  const canonicalStep = targetPlan.items[0];
  currentProject.completedPlanItems = [
    canonicalStep.id,
    "custom:budget-note",
    "not-in-restored-plan",
  ];
  const prepared = prepareCustomerPlanRevisionRestore(currentProject, {
    revisionNumber: 2,
    planVersion: "2026-07-15",
    goals: restoredInputs.goals,
    homeFeatures: restoredInputs.existingFeatures,
    pace: restoredInputs.pace,
    budgetRange: restoredInputs.budgetRange,
    planSnapshot: {
      version: "2026-07-15",
      items: [
        {
          ...canonicalStep,
          title: "Stale legacy wording",
          text: "Stale legacy detail",
        },
        {
          id: "custom:budget-note",
          stage: "Your note",
          title: "Keep a budget contingency",
          text: "Keep a home-specific contingency before requesting prices.",
          href: "https://untrusted.example",
          action: "Untrusted action",
        },
      ],
    },
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.project.planSnapshot.version, CUSTOMER_PLAN_VERSION);
  const restoredCanonical = prepared.project.planSnapshot.items.find(
    (item) => item.id === canonicalStep.id,
  );
  assert.equal(restoredCanonical.title, canonicalStep.title);
  assert.equal(restoredCanonical.text, canonicalStep.text);
  const restoredCustom = prepared.project.planSnapshot.items.find(
    (item) => item.id === "custom:budget-note",
  );
  assert.equal(restoredCustom.href, "");
  assert.equal(restoredCustom.action, "");
  assert.deepEqual(
    prepared.completedPlanItems.sort(),
    [canonicalStep.id, "custom:budget-note"].sort(),
  );
  assert.equal(prepared.project.privateNotes, currentProject.privateNotes);
  assert.deepEqual(
    prepared.project.serviceCategories,
    currentProject.serviceCategories,
  );
  assert.deepEqual(
    prepared.project.propertyContext,
    currentProject.propertyContext,
  );

  const contextual = prepareCustomerPlanRevisionRestore(currentProject, {
    revisionNumber: 6,
    planVersion: CUSTOMER_PLAN_VERSION,
    goals: restoredInputs.goals,
    homeFeatures: restoredInputs.existingFeatures,
    pace: restoredInputs.pace,
    budgetRange: restoredInputs.budgetRange,
    planSnapshot: targetPlan,
  });
  assert.equal(contextual.ok, true);
  assert.deepEqual(
    contextual.project.serviceCategories,
    restoredInputs.serviceCategories,
  );
  assert.deepEqual(
    contextual.project.propertyContext,
    {
      ...restoredInputs.propertyContext,
      approvalContext: currentProject.propertyContext.approvalContext,
      accessConstraints: currentProject.propertyContext.accessConstraints,
    },
  );

  const unsafe = prepareCustomerPlanRevisionRestore(currentProject, {
    revisionNumber: 3,
    planVersion: "future-version",
    goals: ["lower-bills"],
    homeFeatures: [],
    pace: "staged",
    budgetRange: "under_2k",
    planSnapshot: {
      version: "future-version",
      items: [],
    },
  });
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.error, /can no longer be restored safely/i);

  const mismatchedVersion = prepareCustomerPlanRevisionRestore(currentProject, {
    revisionNumber: 4,
    planVersion: "2026-07-15",
    goals: ["lower-bills"],
    homeFeatures: [],
    pace: "staged",
    budgetRange: "under_2k",
    planSnapshot: {
      version: CUSTOMER_PLAN_VERSION,
      items: [],
    },
  });
  assert.equal(mismatchedVersion.ok, false);

  const malformedSnapshot = prepareCustomerPlanRevisionRestore(currentProject, {
    revisionNumber: 5,
    planVersion: "2026-07-15",
    goals: ["lower-bills"],
    homeFeatures: [],
    pace: "staged",
    budgetRange: "under_2k",
    planSnapshot: {
      version: "2026-07-15",
    },
  });
  assert.equal(malformedSnapshot.ok, false);
});

test("the restore route is owner scoped, draft only, confirmed and CAS protected", () => {
  const restoreStart = projectsRoute.indexOf(
    'action === "restore_plan_revision"',
  );
  const restoreEnd = projectsRoute.indexOf(
    'action === "submit"',
    restoreStart,
  );
  assert.notEqual(restoreStart, -1);
  assert.notEqual(restoreEnd, -1);
  const restoreBranch = projectsRoute.slice(restoreStart, restoreEnd);

  assert.match(restoreBranch, /current\.status !== "draft"/);
  assert.match(restoreBranch, /raw\.confirmRestore !== true/);
  assert.match(restoreBranch, /sourceRevisionNumber/);
  assert.match(restoreBranch, /expectedPlanRevision/);
  assert.match(
    restoreBranch,
    /WHERE project_id = \? AND customer_uid = \? AND revision_number = \?/,
  );
  assert.match(
    restoreBranch,
    /WHERE id = \? AND firebase_uid = \? AND status = 'draft'\s+AND plan_revision = \? AND updated_at = \?/,
  );
  assert.match(restoreBranch, /parseStoredJson\(sourceRevision\.goals, null\)/);
  assert.match(restoreBranch, /parseStoredJson\(sourceRevision\.plan_snapshot, null\)/);
  assert.match(restoreBranch, /'restored'/);
  assert.match(restoreBranch, /restored_from_revision/);
  assert.match(restoreBranch, /PLAN_REVISION_RETENTION_LIMIT/);
  assert.match(restoreBranch, /results\[0\]\?\.meta\.changes/);
  assert.match(restoreBranch, /results\[1\]\?\.meta\.changes/);
  assert.match(restoreBranch, /restoredFromRevision: sourceRevisionNumber/);
  assert.match(restoreBranch, /planRevision: nextPlanRevision/);

  const restoreUpdate = restoreBranch.match(
    /UPDATE customer_projects SET([\s\S]*?)WHERE id = \? AND firebase_uid = \?/,
  );
  assert.ok(restoreUpdate);
  for (const restoredRoadmapColumn of [
    "service_categories",
    "priorities",
    "property_context",
  ]) {
    assert.match(restoreUpdate[1], new RegExp(restoredRoadmapColumn));
  }
  for (const unrelatedColumn of [
    "title",
    "home_nickname",
    "postcode",
    "address_state",
    "property_type",
    "household_situation",
    "project_stage",
    "timing",
    "private_notes",
    "advisor_profile",
  ]) {
    assert.doesNotMatch(restoreUpdate[1], new RegExp(unrelatedColumn));
  }
});

test("normal draft saves require the same revision token and advance it only for roadmap changes", () => {
  const updateStart = projectsRoute.indexOf('action === "update"');
  const updateEnd = projectsRoute.indexOf(
    'action === "restore_plan_revision"',
    updateStart,
  );
  const updateBranch = projectsRoute.slice(updateStart, updateEnd);

  assert.match(updateBranch, /cleanPlanRevision\(raw\.expectedPlanRevision\)/);
  assert.match(updateBranch, /expectedPlanRevision !== currentPlanRevision/);
  assert.match(updateBranch, /const nextPlanRevision = currentPlanRevision \+ 1/);
  assert.match(updateBranch, /'saved'/);
  assert.match(updateBranch, /plan_revision = \?/);
  assert.match(updateBranch, /results\[0\]\?\.meta\.changes/);
  assert.match(updateBranch, /results\[1\]\?\.meta\.changes/);
  assert.match(updateBranch, /changed in another tab/i);
  assert.doesNotMatch(updateBranch, /SELECT MAX\(revision_number\)/);

  assert.match(projectsRoute, /planRevision: Number\(row\.plan_revision \|\| 1\)/);
  assert.match(
    projectsRoute,
    /restoredFromRevision: Number\(revision\.restored_from_revision \|\| 0\)/,
  );
});

test("PATCH requires an active owner account and bounded numeric revision tokens", () => {
  const patchStart = projectsRoute.indexOf(
    "export async function PATCH",
  );
  const patchBody = projectsRoute.slice(patchStart);
  const cleanStart = projectsRoute.indexOf("function cleanPlanRevision");
  const cleanEnd = projectsRoute.indexOf(
    "async function identity",
    cleanStart,
  );
  const cleanRevision = projectsRoute.slice(cleanStart, cleanEnd);

  assert.match(
    patchBody,
    /SELECT account_status FROM customer_accounts WHERE firebase_uid = \?/,
  );
  assert.match(patchBody, /account\.account_status !== "active"/);
  assert.match(cleanRevision, /typeof value === "number"/);
  assert.match(cleanRevision, /Number\.isSafeInteger\(value\)/);
  assert.match(cleanRevision, /value >= 1/);
  assert.match(cleanRevision, /value <= 1_000_000/);
  assert.doesNotMatch(cleanRevision, /Number\(value\)/);
});

test("submit and progress mutations share the restore concurrency token", () => {
  const submitStart = projectsRoute.indexOf('action === "submit"');
  const submitEnd = projectsRoute.indexOf(
    'action === "release_contact"',
    submitStart,
  );
  const submitBranch = projectsRoute.slice(submitStart, submitEnd);
  const toggleStart = projectsRoute.indexOf('action === "toggle_milestone"');
  const toggleEnd = projectsRoute.indexOf(
    'action === "duplicate"',
    toggleStart,
  );
  const toggleBranch = projectsRoute.slice(toggleStart, toggleEnd);

  assert.match(submitBranch, /cleanPlanRevision\(raw\.expectedPlanRevision\)/);
  assert.match(submitBranch, /expectedPlanRevision !== currentPlanRevision/);
  assert.match(submitBranch, /plan_revision = \? AND updated_at = \?/);
  assert.match(submitBranch, /NOT EXISTS \(SELECT 1 FROM trade_opportunities/);
  assert.match(
    submitBranch,
    /INSERT INTO trade_opportunities[\s\S]*?FROM customer_projects[\s\S]*?status = 'matching'/,
  );
  assert.match(submitBranch, /submitResults\[0\]\?\.meta\.changes/);
  assert.match(submitBranch, /submitResults\[1\]\?\.meta\.changes/);

  assert.match(toggleBranch, /cleanPlanRevision\(raw\.expectedPlanRevision\)/);
  assert.match(toggleBranch, /expectedPlanRevision !== currentPlanRevision/);
  assert.match(toggleBranch, /plan_revision = \? AND updated_at = \?/);
  assert.match(toggleBranch, /toggled\.meta\.changes/);
});

test("the revision token provides compare-and-swap semantics", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE customer_projects (
    id text PRIMARY KEY NOT NULL,
    firebase_uid text NOT NULL,
    status text NOT NULL,
    plan_revision integer NOT NULL,
    plan_snapshot text NOT NULL
  )`);
  db.exec(`CREATE TABLE customer_project_plan_revisions (
    id text PRIMARY KEY NOT NULL,
    project_id text NOT NULL,
    customer_uid text NOT NULL,
    revision_number integer NOT NULL,
    restored_from_revision integer NOT NULL DEFAULT 0,
    UNIQUE(project_id, revision_number)
  )`);
  db.exec(`INSERT INTO customer_projects
    (id, firebase_uid, status, plan_revision, plan_snapshot)
    VALUES ('project-1', 'owner-1', 'draft', 2, '{"version":"v2"}')`);

  const restore = (revisionId, expectedRevision) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const nextRevision = expectedRevision + 1;
      const inserted = db.prepare(`INSERT INTO customer_project_plan_revisions
        (id, project_id, customer_uid, revision_number, restored_from_revision)
        SELECT ?, 'project-1', 'owner-1', ?, 1
        WHERE EXISTS (
          SELECT 1 FROM customer_projects
          WHERE id = 'project-1' AND firebase_uid = 'owner-1'
            AND status = 'draft' AND plan_revision = ?
        )`).run(revisionId, nextRevision, expectedRevision);
      const updated = db.prepare(`UPDATE customer_projects
        SET plan_revision = ?, plan_snapshot = '{"version":"restored"}'
        WHERE id = 'project-1' AND firebase_uid = 'owner-1'
          AND status = 'draft' AND plan_revision = ?
          AND EXISTS (
            SELECT 1 FROM customer_project_plan_revisions
            WHERE id = ? AND project_id = 'project-1' AND customer_uid = 'owner-1'
              AND revision_number = ? AND restored_from_revision = 1
          )`).run(nextRevision, expectedRevision, revisionId, nextRevision);
      db.exec("COMMIT");
      return { inserted: inserted.changes, updated: updated.changes };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  assert.deepEqual(restore("restore-3", 2), { inserted: 1, updated: 1 });
  assert.deepEqual(restore("stale-3", 2), { inserted: 0, updated: 0 });
  assert.deepEqual(
    {
      ...db.prepare(
        "SELECT plan_revision, plan_snapshot FROM customer_projects",
      ).get(),
    },
    { plan_revision: 3, plan_snapshot: '{"version":"restored"}' },
  );
  assert.deepEqual(
    {
      ...db.prepare(`SELECT revision_number, restored_from_revision
        FROM customer_project_plan_revisions`).get(),
    },
    { revision_number: 3, restored_from_revision: 1 },
  );
  db.close();
});
