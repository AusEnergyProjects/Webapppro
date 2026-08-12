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
import { isPublicPlanEnquiry } from "@/lib/public-plan-enquiry.mjs";
import {
  confirmPublicPlanIntakeOpportunity,
  enqueuePublicPlanDelivery,
} from "@/lib/public-plan-delivery-server";
import { createOpportunityFromLead } from "@/lib/opportunity-server";
import {
  PUBLIC_PLAN_DELIVERY_DISPATCH_HEADER,
} from "@/lib/public-plan-delivery-retry";

export const runtime = "nodejs";

const leadRateLimiter = createSharedLeadRateLimiter({ getDatabase: getD1 });

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
  enqueuePublicPlanDelivery,
  createOpportunityFromLead,
  confirmPublicPlanIntakeOpportunity,
  publicPlanDeliveryDispatchHeader: PUBLIC_PLAN_DELIVERY_DISPATCH_HEADER,
  timeoutMs: LEAD_PROCESSOR_TIMEOUT_MS,
});
