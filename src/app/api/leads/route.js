import { validateLeadPayload } from "@/lib/lead-validation.mjs";
import { createLeadEnvelope } from "@/lib/lead-envelope.mjs";
import { createSharedLeadRateLimiter } from "@/lib/lead-rate-limit.mjs";
import { createOperationalRecorder } from "@/lib/operational-events.mjs";
import { LEAD_PROCESSOR_TIMEOUT_MS } from "@/lib/lead-webhook-probe.mjs";
import { createLeadPostHandler } from "@/lib/lead-route-handler.mjs";
import { getD1 } from "../../../../db";
import {
  createAdminNotification,
  resolveSystemAdminNotifications,
} from "@/lib/admin-notifications";
import { createOpportunityFromLead } from "@/lib/opportunity-server";
import { OPPORTUNITY_NOTIFICATION_DISPATCH_HEADER } from "@/lib/opportunity-notification-server";
import { isPublicPlanEnquiry } from "@/lib/public-plan-enquiry.mjs";
import {
  CustomerPlanPdfUnsupportedTextError,
  customerPlanPdfFileName,
} from "@/lib/customer-plan-pdf.mjs";
import { createPublicPlanCustomerPdfBundle } from "@/lib/public-plan-customer-pdf.mjs";
import {
  CustomerPlanPdfFontError,
  loadCustomerPlanPdfFonts,
} from "@/lib/customer-plan-pdf-fonts";

export const runtime = "nodejs";

const leadRateLimiter = createSharedLeadRateLimiter({ getDatabase: getD1 });
const MAX_CUSTOMER_PLAN_PDF_BYTES = 1_500_000;

function leadPdfFailureCode(error) {
  if (error instanceof CustomerPlanPdfFontError) return "font_invalid";
  const message = error instanceof Error ? error.message : "";
  if (error instanceof CustomerPlanPdfUnsupportedTextError) {
    return "unsupported_text";
  }
  if (message === "CUSTOMER_PLAN_PDF_SIZE_INVALID") return "size_invalid";
  return "generation_failed";
}

function publicPlanPdfPreparationError(error) {
  const code = leadPdfFailureCode(error);
  console.error("customer_plan_pdf_attachment_failed", {
    code,
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return Object.assign(new Error("CUSTOMER_PLAN_PDF_PREPARATION_FAILED"), {
    name: "CustomerPlanPdfPreparationError",
    code,
  });
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function preparePublicPlanLeadEnvelope({
  validatedPayload,
  envelope,
}) {
  if (
    !isPublicPlanEnquiry(validatedPayload?.enquiry)
    || !validatedPayload?.email
  ) return envelope;
  try {
    const reportInput = {
      snapshot: validatedPayload.planSnapshot,
      name: validatedPayload.name,
      postcode: validatedPayload.postcode,
      projectCategories: validatedPayload.projectCategories,
      preparedAt: envelope.submittedAt,
    };
    const fonts = await loadCustomerPlanPdfFonts();
    const { report, bytes } = await createPublicPlanCustomerPdfBundle(
      reportInput,
      fonts,
    );
    if (bytes.byteLength < 20_000 || bytes.byteLength > MAX_CUSTOMER_PLAN_PDF_BYTES) {
      throw new Error("CUSTOMER_PLAN_PDF_SIZE_INVALID");
    }
    return {
      ...envelope,
      customerPlanDelivery: {
        version: "customer-only-home-plan-pdf-v1",
        filename: customerPlanPdfFileName(report),
        mimeType: "application/pdf",
        encoding: "base64",
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        content: Buffer.from(bytes).toString("base64"),
      },
    };
  } catch (error) {
    throw publicPlanPdfPreparationError(error);
  }
}

function incidentBucket() {
  return new Date().toISOString().slice(0, 13);
}

async function recordLeadIncident(eventType, title, summary, priority = "urgent") {
  await createAdminNotification({
    eventKey: `${eventType}:${incidentBucket()}`,
    eventType,
    category: "platform",
    priority,
    title,
    summary,
    entityType: "platform_service",
    entityId: "comparison_lead_delivery",
    actorType: "system",
    requiresAction: true,
  }).catch(() => null);
}

export const POST = createLeadPostHandler({
  validateLeadPayload,
  createLeadEnvelope,
  createOperationalRecorder,
  leadRateLimiter,
  recordLeadIncident,
  resolveSystemAdminNotifications,
  isPublicPlanEnquiry,
  prepareLeadEnvelope: preparePublicPlanLeadEnvelope,
  createOpportunityFromLead,
  opportunityNotificationDispatchHeader: OPPORTUNITY_NOTIFICATION_DISPATCH_HEADER,
  timeoutMs: LEAD_PROCESSOR_TIMEOUT_MS,
});
