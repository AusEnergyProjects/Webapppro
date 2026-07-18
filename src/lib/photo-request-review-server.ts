import { getD1 } from "../../db";
import { photoProofCounts, photoRequestEvidenceKey, type PhotoRequirementReview, type PhotoRetakeReason, type PhotoReviewStatus } from "@/lib/photo-request-review";
import type { PhotoRequirement } from "@/lib/trade-photo-requests";

type Row = Record<string, unknown>;

export async function photoRequestProofOverview(input: {
  ownerUid: string;
  workOrderId: string;
  requestId: string;
  requestRevision: number;
  requirements: PhotoRequirement[];
}) {
  const db = getD1();
  const [mediaRows, reviewRows, completion] = await Promise.all([
    db.prepare(`SELECT id, photo_requirement_id, created_at FROM trade_crm_job_media
      WHERE firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND source = 'customer_request'
      ORDER BY created_at`).bind(input.ownerUid, input.workOrderId, input.requestId).all<Row>(),
    db.prepare(`SELECT photo_requirement_id, status, reason_code, guidance, review_revision, reviewed_upload_count, created_at
      FROM trade_crm_photo_requirement_reviews
      WHERE firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND request_revision = ?
      ORDER BY review_revision`).bind(input.ownerUid, input.workOrderId, input.requestId, input.requestRevision).all<Row>(),
    db.prepare(`SELECT completion_revision, checklist_version, evidence_key, required_count, supplied_count, completed_at
      FROM trade_crm_photo_request_completions
      WHERE firebase_uid = ? AND work_order_id = ? AND photo_request_id = ? AND request_revision = ?
      ORDER BY completion_revision DESC LIMIT 1`).bind(input.ownerUid, input.workOrderId, input.requestId, input.requestRevision).first<Row>(),
  ]);
  const uploadsByRequirement = new Map<string, Row[]>();
  for (const row of mediaRows.results) {
    const id = String(row.photo_requirement_id || "");
    const rows = uploadsByRequirement.get(id) || [];
    rows.push(row); uploadsByRequirement.set(id, rows);
  }
  const latestReviews = new Map<string, Row>();
  for (const row of reviewRows.results) latestReviews.set(String(row.photo_requirement_id || ""), row);
  const reviews: PhotoRequirementReview[] = input.requirements.map((requirement) => {
    const row = latestReviews.get(requirement.id);
    const status = (row?.status || "pending") as PhotoReviewStatus | "pending";
    const reviewedAt = String(row?.created_at || "");
    const retakeAnswered = status === "retake_requested"
      && (uploadsByRequirement.get(requirement.id) || []).length > Number(row?.reviewed_upload_count || 0);
    return { requirementId: requirement.id, label: requirement.label, status, reasonCode: String(row?.reason_code || "") as PhotoRetakeReason | "",
      guidance: String(row?.guidance || ""), reviewRevision: Number(row?.review_revision || 0), reviewedAt, retakeAnswered };
  });
  const uploadCounts = Object.fromEntries(input.requirements.map((item) => [item.id, (uploadsByRequirement.get(item.id) || []).length]));
  const counts = photoProofCounts(input.requirements, reviews, uploadCounts);
  const unresolvedRetakes = reviews.filter((item) => item.status === "retake_requested" && !item.retakeAnswered);
  const evidenceKey = await photoRequestEvidenceKey({ requestId: input.requestId, requestRevision: input.requestRevision,
    checklistVersion: String(completion?.checklist_version || ""), mediaIds: mediaRows.results.map((row) => String(row.id)) });
  const evidenceCurrent = Boolean(completion) && String(completion?.evidence_key || "") === evidenceKey;
  const completionCurrent = evidenceCurrent && unresolvedRetakes.length === 0;
  const requiredReviewed = input.requirements.filter((item) => item.required).every((requirement) => {
    const status = reviews.find((item) => item.requirementId === requirement.id)?.status;
    return status === "accepted" || status === "not_needed";
  });
  return {
    completion: completion ? { revision: Number(completion.completion_revision), checklistVersion: String(completion.checklist_version),
      requiredCount: Number(completion.required_count), suppliedCount: Number(completion.supplied_count),
      completedAt: String(completion.completed_at), evidenceCurrent, current: completionCurrent } : null,
    reviews,
    uploadCounts,
    counts,
    proofReady: completionCurrent && requiredReviewed,
    outstandingRequirementIds: input.requirements.filter((requirement) => {
      const review = reviews.find((item) => item.requirementId === requirement.id);
      return (requirement.required && !uploadCounts[requirement.id])
        || (review?.status === "retake_requested" && !review.retakeAnswered);
    }).map((item) => item.id),
  };
}
