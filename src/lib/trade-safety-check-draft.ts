import { activityCanonical, activityHash, normaliseActivityAnswers } from "./trade-activity-forms";
import type { ActivityAnswers } from "./trade-activity-form-types";
import { createOfficialSafetyCheckForm } from "./official-safety-check-forms";
import type { SafetyCheckKind, SafetyCheckRecord } from "./job-safety-check";

export function createSafetyCheckDraft(input: {
  id: string; workOrderId: string; ownerUid: string; kind: SafetyCheckKind;
  createdAt: string; customerName: string; answers: ActivityAnswers;
}): SafetyCheckRecord {
  const form = createOfficialSafetyCheckForm(input.kind);
  const answers = normaliseActivityAnswers(form, input.answers);
  return {
    id: input.id, workOrderId: input.workOrderId, ownerUid: input.ownerUid, kind: input.kind,
    recordNumber: `${input.kind === "electrical" ? "ESC" : "GSC"}-${input.createdAt.slice(0, 10).replaceAll("-", "")}-${input.id.slice(0, 8).toUpperCase()}`,
    revision: 1, status: "draft", form, formSha256: activityHash(form), answers, evidence: [], signatures: [],
    signerDefaults: { customer: input.customerName, technician: String(answers.inspector_name || "") },
    createdAt: input.createdAt, updatedAt: input.createdAt, completedAt: "",
  };
}

export function initialSafetyCheckDraftStatement(database: D1Database, record: SafetyCheckRecord, actorUid: string) {
  const payload = activityCanonical(record);
  return database.prepare(`INSERT INTO trade_safety_checks
    (id, work_order_id, owner_uid, kind, revision, status, payload, payload_sha256, actor_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 'draft', ?, ?, ?, ?, ?)`)
    .bind(record.id, record.workOrderId, record.ownerUid, record.kind, payload, activityHash(payload), actorUid, record.createdAt, record.updatedAt);
}
