import type { ReminderChannel } from "@/lib/service-reminder-delivery";

export const PHOTO_REQUEST_RESEND_LIMIT = 2;
export const PHOTO_REQUEST_REMINDER_DAYS = 7;
export type PhotoRequestDeliveryIntent = "initial" | "resend_1" | "resend_2" | "expiry_reminder" | "retake_followup";

const encoder = new TextEncoder();

export async function photoRequestDeliveryIdempotencyKey(input: {
  requestId: string;
  requestRevision: number;
  tokenIssue: number;
  intent: PhotoRequestDeliveryIntent;
  channel: ReminderChannel;
  reviewRevision?: number;
  photoRequirementId?: string;
}) {
  const content = [input.requestId, input.requestRevision, input.tokenIssue, input.intent, input.channel,
    input.reviewRevision || 0, input.photoRequirementId || ""].join("|");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function maskPhotoRequestEmail(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}${"*".repeat(Math.min(Math.max(local.length - 1, 2), 6))}@${domain}`;
}

export function maskPhotoRequestMobile(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `Mobile ending ${digits.slice(-3)}`;
}

export function photoRequestDeliveryDraft(input: {
  intent: PhotoRequestDeliveryIntent;
  businessName: string;
  workNumber: string;
  shareUrl: string;
  expiresAt: string;
  requirementLabel?: string;
  retakeGuidance?: string;
}) {
  const reminder = input.intent === "expiry_reminder";
  const retake = input.intent === "retake_followup";
  const subject = reminder ? `Photo request link expiring for ${input.workNumber}`
    : retake ? `Photo retake requested for ${input.workNumber}` : `Photos requested for ${input.workNumber}`;
  const lead = reminder
    ? `${input.businessName} is reminding you that the secure photo request for job ${input.workNumber} expires on ${new Date(input.expiresAt).toLocaleDateString("en-AU")}.`
    : retake ? `${input.businessName} has requested another photo of ${input.requirementLabel || "one job item"} for job ${input.workNumber}. ${input.retakeGuidance || "Open the request for safe capture guidance."}`
    : `${input.businessName} has requested photos for job ${input.workNumber}.`;
  return {
    subject: subject.slice(0, 160),
    body: `${lead}\n\nOpen the secure request: ${input.shareUrl}\n\nThe link does not show your name, contact details or address. Only add photos requested for this job.`.slice(0, 1200),
  };
}

export function photoRequestReminderAvailable(expiresAt: string, now = new Date()) {
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > now.getTime() && expiry <= now.getTime() + PHOTO_REQUEST_REMINDER_DAYS * 24 * 60 * 60 * 1000;
}
