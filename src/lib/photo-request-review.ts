import type { PhotoRequirement } from "@/lib/trade-photo-requests";

export const PHOTO_REVIEW_STATUSES = ["accepted", "retake_requested", "not_needed"] as const;
export type PhotoReviewStatus = typeof PHOTO_REVIEW_STATUSES[number];

export const PHOTO_RETAKE_REASONS = {
  wider_context: "Take a wider photo that shows the requested item and the area around it.",
  clearer_photo: "Take another well-lit photo with the requested item in focus.",
  requested_item_missing: "Take another photo with the requested item clearly visible.",
  private_information_visible: "Take another photo after removing or covering personal documents, numbers and unrelated belongings.",
} as const;
export type PhotoRetakeReason = keyof typeof PHOTO_RETAKE_REASONS;

export type PhotoRequirementReview = {
  requirementId: string;
  label: string;
  status: PhotoReviewStatus | "pending";
  reasonCode: PhotoRetakeReason | "";
  guidance: string;
  reviewRevision: number;
  reviewedAt: string;
  retakeAnswered: boolean;
};

export function photoRetakeGuidance(value: unknown) {
  const code = String(value || "") as PhotoRetakeReason;
  return PHOTO_RETAKE_REASONS[code] || "";
}

export async function photoRequestEvidenceKey(input: {
  requestId: string;
  requestRevision: number;
  checklistVersion: string;
  mediaIds: string[];
}) {
  const value = [input.requestId, input.requestRevision, input.checklistVersion, ...[...input.mediaIds].sort()].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function photoProofCounts(requirements: PhotoRequirement[], reviews: PhotoRequirementReview[], uploadCounts: Record<string, number>) {
  const current = new Map(reviews.map((item) => [item.requirementId, item]));
  let supplied = 0; let accepted = 0; let retakeRequested = 0; let notNeeded = 0; let pending = 0;
  for (const requirement of requirements) {
    if (Number(uploadCounts[requirement.id] || 0) > 0) supplied += 1;
    const status = current.get(requirement.id)?.status || "pending";
    if (status === "accepted") accepted += 1;
    else if (status === "retake_requested") retakeRequested += 1;
    else if (status === "not_needed") notNeeded += 1;
    else pending += 1;
  }
  return { total: requirements.length, required: requirements.filter((item) => item.required).length,
    supplied, accepted, retakeRequested, notNeeded, pending };
}
