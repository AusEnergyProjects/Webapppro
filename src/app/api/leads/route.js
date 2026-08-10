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
import { isPublicPlanEnquiry } from "@/lib/public-plan-enquiry.mjs";
import {
  createPublicPlanCustomerReportView,
} from "@/lib/customer-plan-document.mjs";
import {
  CustomerPlanPdfUnsupportedTextError,
  createCustomerPlanPdfBytes,
  customerPlanPdfFileName,
} from "@/lib/customer-plan-pdf.mjs";

export const runtime = "nodejs";

const leadRateLimiter = createSharedLeadRateLimiter({ getDatabase: getD1 });
const MAX_CUSTOMER_PLAN_PDF_BYTES = 1_500_000;
const PDF_FONT_PATHS = {
  regular: "/fonts/LiberationSans-Regular.ttf",
  bold: "/fonts/LiberationSans-Bold.ttf",
};
const pdfFontCache = new Map();

function leadPdfFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  if (/^LEAD_PDF_(?:REGULAR|BOLD)_FONT_UNAVAILABLE$/.test(message)) {
    return "font_unavailable";
  }
  if (/^LEAD_PDF_(?:REGULAR|BOLD)_FONT_INVALID$/.test(message)) {
    return "font_invalid";
  }
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

function leadPdfFonts(request) {
  const origin = new URL(request.url).origin;
  const cached = pdfFontCache.get(origin);
  if (cached) return cached;
  const loading = Promise.all(
    Object.entries(PDF_FONT_PATHS).map(async ([weight, path]) => {
      // Vinext's Worker fetch wrapper rejects framework cache modes. The
      // completed byte pair is already cached in this module by origin.
      const response = await fetch(new URL(path, origin));
      if (!response.ok) throw new Error(`LEAD_PDF_${weight.toUpperCase()}_FONT_UNAVAILABLE`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 10_000 || bytes.byteLength > 500_000) {
        throw new Error(`LEAD_PDF_${weight.toUpperCase()}_FONT_INVALID`);
      }
      return [weight, bytes];
    }),
  ).then((entries) => Object.fromEntries(entries)).catch((error) => {
    pdfFontCache.delete(origin);
    throw error;
  });
  pdfFontCache.set(origin, loading);
  return loading;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function preparePublicPlanLeadEnvelope({
  request,
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
      postcode: validatedPayload.postcode,
      projectCategories: validatedPayload.projectCategories,
      preparedAt: envelope.submittedAt,
    };
    let report = createPublicPlanCustomerReportView({
      ...reportInput,
      name: validatedPayload.name,
    });
    const fonts = await leadPdfFonts(request);
    let bytes;
    try {
      bytes = await createCustomerPlanPdfBytes(report, fonts);
    } catch (error) {
      const nameCharacters = new Set(Array.from(validatedPayload.name || ""));
      const displayNameOnly = error instanceof CustomerPlanPdfUnsupportedTextError
        && error.unsupportedCharacters.length > 0
        && error.unsupportedCharacters.every((character) => nameCharacters.has(character));
      if (!displayNameOnly) throw error;
      report = createPublicPlanCustomerReportView({
        ...reportInput,
        name: "Customer",
      });
      report = {
        ...report,
        privacyNote: "This personalised copy is emailed only to the customer and uses a neutral cover label because the current PDF font cannot display every character in the customer's name. The real name remains in the private enquiry. The PDF excludes street address, contact details, bills, meter identifiers, usage files, account records, uploaded documents and private trade notes.",
      };
      bytes = await createCustomerPlanPdfBytes(report, fonts);
    }
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
  timeoutMs: LEAD_PROCESSOR_TIMEOUT_MS,
});
