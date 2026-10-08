import { activityCanonical, activityHash, normaliseActivityAnswers } from "./trade-activity-forms";
import type { ActivityAnswers } from "./trade-activity-form-types";
import { createVeuElectricalForm } from "./veu-electrical-safety-form";
import type { PiesaRecord } from "./veu-electrical-assessment";

export function createPiesaDraft(input: {
  id: string;
  workOrderId: string;
  ownerUid: string;
  createdAt: string;
  answers: ActivityAnswers;
}): PiesaRecord {
  const form = createVeuElectricalForm();
  const answers = normaliseActivityAnswers(form, input.answers);
  return {
    id: input.id, workOrderId: input.workOrderId, ownerUid: input.ownerUid,
    recordNumber: `PIESA-${input.id.slice(0, 8).toUpperCase()}`, revision: 1, status: "draft",
    form, formSha256: activityHash(form), answers, evidence: [], signatures: [],
    signerDefaults: { customer: String(answers.owner_name || ""), technician: String(answers.initial_electrician_name || "") },
    createdAt: input.createdAt, updatedAt: input.createdAt, completedAt: "",
  };
}

export function initialPiesaDraftStatement(database: D1Database, record: PiesaRecord, actorUid: string) {
  const payload = activityCanonical(record);
  return database.prepare(`INSERT INTO trade_veu_electrical_assessments
    (id, work_order_id, owner_uid, revision, status, payload, payload_sha256, actor_uid, created_at, updated_at)
    VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?, ?)`)
    .bind(record.id, record.workOrderId, record.ownerUid, payload, activityHash(payload), actorUid, record.createdAt, record.updatedAt);
}
