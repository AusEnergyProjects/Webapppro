import { getD1 } from "../../../../db";
import { requireFirebaseIdentity } from "@/lib/firebase-server";
import {
  normalizeCustomerOutcomeInput,
} from "@/lib/customer-plan-history.mjs";
import {
  parseStoredJson,
  reconcileCompletedPlanItems,
} from "@/lib/customer-projects.mjs";

export const runtime = "edge";

const PLAN_REVISION_READ_LIMIT = 20;
const OUTCOME_CHECKIN_READ_LIMIT = 24;
const OUTCOME_CHECKIN_RETENTION_LIMIT = 48;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProjectRow = {
  id: string;
  status: string;
  plan_revision: number;
  updated_at: string;
  completed_plan_items: string;
  plan_snapshot: string;
};

type RevisionRow = {
  id: string;
  revision_number: number;
  event_type: string;
  plan_version: string;
  goals: string;
  home_features: string;
  pace: string;
  budget_range: string;
  plan_snapshot: string;
  restored_from_revision: number;
  created_at: string;
};

type OutcomeRow = {
  id: string;
  comfort_outcome: string;
  energy_outcome: string;
  completed_item_ids: string;
  note: string;
  recorded_at: string;
};

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function conflict(error: string) {
  return json({
    ok: false,
    code: "PLAN_REVISION_CONFLICT",
    error,
  }, 409);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function cleanProjectId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  return UUID_PATTERN.test(id) ? id : "";
}

function cleanPlanRevision(value: unknown) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= 1_000_000
    ? value
    : 0;
}

function cleanUpdatedAt(value: unknown) {
  return typeof value === "string"
    ? Array.from(value.trim()).slice(0, 40).join("")
    : "";
}

function nextUpdatedAt(current: string) {
  const currentTime = Date.parse(current);
  return new Date(Math.max(
    Date.now(),
    Number.isFinite(currentTime) ? currentTime + 1 : 0,
  )).toISOString();
}

async function identity(request: Request) {
  try {
    return await requireFirebaseIdentity(request);
  } catch {
    return null;
  }
}

async function ownedProject(customerUid: string, projectId: string) {
  return getD1().prepare(`SELECT id, status, plan_revision, updated_at,
      completed_plan_items, plan_snapshot
    FROM customer_projects
    WHERE id = ? AND firebase_uid = ?`)
    .bind(projectId, customerUid)
    .first<ProjectRow>();
}

function publicRevision(row: RevisionRow) {
  return {
    id: row.id,
    revisionNumber: Number(row.revision_number || 0),
    eventType: row.event_type,
    planVersion: row.plan_version,
    goals: parseStoredJson(row.goals, []),
    homeFeatures: parseStoredJson(row.home_features, []),
    pace: row.pace,
    budgetRange: row.budget_range,
    planSnapshot: parseStoredJson(row.plan_snapshot, {}),
    restoredFromRevision: Number(row.restored_from_revision || 0),
    createdAt: row.created_at,
  };
}

function publicOutcome(row: OutcomeRow) {
  return {
    id: row.id,
    comfortOutcome: row.comfort_outcome,
    energyOutcome: row.energy_outcome,
    completedItemIds: parseStoredJson(row.completed_item_ids, []),
    note: row.note,
    recordedAt: row.recorded_at,
  };
}

async function historyForOwner(
  customerUid: string,
  project: ProjectRow,
) {
  const db = getD1();
  const revisions = await db.prepare(`SELECT id, revision_number, event_type,
      plan_version, goals, home_features, pace, budget_range, plan_snapshot,
      restored_from_revision, created_at
    FROM customer_project_plan_revisions
    WHERE project_id = ? AND customer_uid = ?
    ORDER BY revision_number DESC, created_at DESC, id DESC
    LIMIT ${PLAN_REVISION_READ_LIMIT}`)
    .bind(project.id, customerUid)
    .all<RevisionRow>();
  const outcomes = await db.prepare(`SELECT id, comfort_outcome, energy_outcome,
      completed_item_ids, note, recorded_at
    FROM customer_project_outcome_checkins
    WHERE project_id = ? AND customer_uid = ?
    ORDER BY recorded_at DESC, id DESC
    LIMIT ${OUTCOME_CHECKIN_READ_LIMIT}`)
    .bind(project.id, customerUid)
    .all<OutcomeRow>();
  return {
    project: {
      id: project.id,
      status: project.status,
      planRevision: Number(project.plan_revision || 1),
      updatedAt: project.updated_at,
    },
    revisions: revisions.results.map(publicRevision),
    outcomes: outcomes.results.map(publicOutcome),
  };
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const user = await identity(request);
  if (!user) {
    return json({ ok: false, error: "Sign in to continue." }, 401);
  }
  const projectId = cleanProjectId(
    new URL(request.url).searchParams.get("projectId"),
  );
  if (!projectId) {
    return json({ ok: false, error: "Choose a valid project." }, 400);
  }
  const project = await ownedProject(user.uid, projectId);
  if (!project) {
    return json({ ok: false, error: "Project not found." }, 404);
  }
  return json({
    ok: true,
    history: await historyForOwner(user.uid, project),
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: "Request origin was not accepted." }, 403);
  }
  const user = await identity(request);
  if (!user) {
    return json({ ok: false, error: "Sign in to continue." }, 401);
  }
  if (Number(request.headers.get("content-length") || 0) > 4_000) {
    return json({ ok: false, error: "The progress check-in was too large." }, 413);
  }
  let raw: Record<string, unknown>;
  try {
    raw = await request.json() as Record<string, unknown>;
  } catch {
    return json({
      ok: false,
      error: "The progress check-in could not be read.",
    }, 400);
  }
  if (raw.action !== "record_outcome") {
    return json({ ok: false, error: "Choose a valid history action." }, 400);
  }
  const projectId = cleanProjectId(raw.projectId);
  const expectedPlanRevision = cleanPlanRevision(raw.expectedPlanRevision);
  const expectedUpdatedAt = cleanUpdatedAt(raw.expectedUpdatedAt);
  if (!projectId || !expectedPlanRevision || !expectedUpdatedAt) {
    return json({
      ok: false,
      error: "Refresh this project before saving a progress check-in.",
    }, 400);
  }
  const project = await ownedProject(user.uid, projectId);
  if (!project) {
    return json({ ok: false, error: "Project not found." }, 404);
  }
  if (project.status === "archived") {
    return json({
      ok: false,
      error: "Restore or duplicate this project before recording another check-in.",
    }, 409);
  }
  if (
    Number(project.plan_revision || 1) !== expectedPlanRevision
    || project.updated_at !== expectedUpdatedAt
  ) {
    return conflict(
      "This plan changed in another tab. Review the latest version before saving progress.",
    );
  }
  const normalized = normalizeCustomerOutcomeInput(raw);
  const outcome = normalized.outcome;
  if (!normalized.ok || !outcome) {
    return json({ ok: false, error: normalized.error }, 400);
  }
  const completedItemIds = reconcileCompletedPlanItems(
    parseStoredJson(project.completed_plan_items, []),
    parseStoredJson(project.plan_snapshot, {}),
  );
  const db = getD1();
  const id = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const updatedAt = nextUpdatedAt(project.updated_at);
  const results = await db.batch([
    db.prepare(`INSERT INTO customer_project_outcome_checkins
      (id, project_id, customer_uid, comfort_outcome, energy_outcome,
       completed_item_ids, note, recorded_at)
      SELECT ?, id, firebase_uid, ?, ?, ?, ?, ?
      FROM customer_projects
      WHERE id = ? AND firebase_uid = ? AND status != 'archived'
        AND plan_revision = ? AND updated_at = ?`)
      .bind(
        id,
        outcome.comfortOutcome,
        outcome.energyOutcome,
        JSON.stringify(completedItemIds),
        outcome.note,
        recordedAt,
        projectId,
        user.uid,
        expectedPlanRevision,
        expectedUpdatedAt,
      ),
    db.prepare(`UPDATE customer_projects SET updated_at = ?
      WHERE id = ? AND firebase_uid = ? AND status != 'archived'
        AND plan_revision = ? AND updated_at = ?`)
      .bind(
        updatedAt,
        projectId,
        user.uid,
        expectedPlanRevision,
        expectedUpdatedAt,
      ),
    db.prepare(`DELETE FROM customer_project_outcome_checkins
      WHERE project_id = ? AND customer_uid = ? AND id NOT IN (
        SELECT id FROM customer_project_outcome_checkins
        WHERE project_id = ? AND customer_uid = ?
        ORDER BY recorded_at DESC, id DESC
        LIMIT ${OUTCOME_CHECKIN_RETENTION_LIMIT}
      ) AND EXISTS (
        SELECT 1 FROM customer_project_outcome_checkins
        WHERE id = ? AND project_id = ? AND customer_uid = ?
      )`)
      .bind(
        projectId,
        user.uid,
        projectId,
        user.uid,
        id,
        projectId,
        user.uid,
      ),
  ]);
  if (
    Number(results[0]?.meta.changes || 0) !== 1
    || Number(results[1]?.meta.changes || 0) !== 1
  ) {
    return conflict(
      "This plan changed in another tab. Review the latest version before saving progress.",
    );
  }
  return json({
    ok: true,
    checkin: {
      id,
      comfortOutcome: outcome.comfortOutcome,
      energyOutcome: outcome.energyOutcome,
      completedItemIds,
      note: outcome.note,
      recordedAt,
    },
    planRevision: expectedPlanRevision,
    updatedAt,
  }, 201);
}
