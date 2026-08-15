import handler from "vinext/server/app-router-entry";
import { getD1 } from "../db";
import { getCustomerProjectEvidenceBucket } from "../src/lib/customer-project-evidence-bucket";
import { dispatchAdminNotificationDeliveries } from "../src/lib/admin-notification-delivery";
import { syncCertificatePriceHistory } from "../src/lib/certificate-prices-server";
import {
  CUSTOMER_OPPORTUNITY_DISPATCH_HEADER,
  drainCustomerOpportunityDispatchJobs,
} from "../src/lib/customer-opportunity-dispatch-server";
import {
  CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER,
  drainCustomerProjectActivityDeliveries,
} from "../src/lib/customer-project-activity-notification-server";
import {
  OPPORTUNITY_NOTIFICATION_DISPATCH_HEADER,
  drainOpportunityNotificationDeliveries,
  drainOpportunityNotificationDeliveriesForOpportunity,
} from "../src/lib/opportunity-notification-server";
import {
  shouldDrainOpportunityNotificationBacklog,
  takeOpportunityNotificationDispatch,
} from "../src/lib/opportunity-notification-retry";
import {
  drainPublicPlanQuotePhotoCleanup,
  shouldDrainPublicPlanQuotePhotoCleanup,
} from "../src/lib/public-plan-quote-photo-cleanup";
import { drainPublicPlanDeliveries } from "../src/lib/public-plan-delivery-server";
import {
  PUBLIC_PLAN_DELIVERY_DISPATCH_HEADER,
  shouldDrainPublicPlanDeliveryBacklog,
  takePublicPlanDeliveryDispatch,
} from "../src/lib/public-plan-delivery-retry";
import { createOpportunityFromLead } from "../src/lib/opportunity-server";
import {
  type CreditexSresArtifactStore,
} from "../src/lib/creditex-sres-registry-server";
import {
  type CreditexOfficialProductArtifactStore,
} from "../src/lib/creditex-official-product-registry-server";
import {
  creditexAutomaticProductRegistryMaintenanceTargets,
  maintainNextCreditexProductRegistry,
} from "../src/lib/creditex-product-registry-maintenance";
import { ensureTlinkSchemaGuards } from "../src/lib/tlink-schema-guards";
import { generateDueServiceJobs } from "../src/lib/trade-recurring-jobs-server";
import { cleanupUnreferencedTradeIssuedDocuments } from "../src/lib/trade-issued-document-cleanup";
import { drainTradeCrmJobMediaCleanup } from "../src/lib/trade-crm-job-media-cleanup";
import {
  drainTradeTeamMemberFileCleanup,
  type TradeTeamMemberCleanupBucket,
} from "../src/lib/trade-team-member-file-cleanup";
import {
  drainTradeTeamDocumentExpiryEmails,
  enqueueTradeTeamDocumentExpiryWarnings,
} from "../src/lib/trade-team-document-expiry-server";
import {
  sendServiceReminderProviderMessage,
  serviceReminderProviderConfiguration,
} from "../src/lib/service-reminder-delivery";
import { drainTradeQuoteDeliveries } from "../src/lib/trade-quote-delivery-server";
import { queueTradeQuoteDeliveryDispatch } from "../src/lib/trade-quote-delivery-dispatch";

const HTML_CACHE_CONTROL = "public, max-age=0, s-maxage=120, stale-while-revalidate=600";
const PRIVATE_HTML_CACHE_CONTROL = "private, no-store, max-age=0";
const LEGACY_SITE_HOST = "aea-energy-comparison.info294029.chatgpt.site";
const CANONICAL_SITE_HOST = "compare.ausenergyassessments.com";
const NOTIFICATION_DELIVERY_CRON = "* * * * *";
const DAILY_MAINTENANCE_CRON = "15 20 * * *";

type RuntimeCacheStorage = CacheStorage & { default?: Cache };

function secureResponse(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  const pathname = new URL(request.url).pathname;
  if (
    (pathname === "/account" || pathname.startsWith("/account/"))
    && (headers.get("content-type") || "").includes("text/html")
  ) {
    headers.set("Cache-Control", PRIVATE_HTML_CACHE_CONTROL);
  }
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function queueCustomerOpportunityDispatch(
  response: Response,
  ctx: ExecutionContext,
) {
  const jobId = response.headers.get(CUSTOMER_OPPORTUNITY_DISPATCH_HEADER) || "";
  if (!jobId) return response;
  const headers = new Headers(response.headers);
  headers.delete(CUSTOMER_OPPORTUNITY_DISPATCH_HEADER);
  ctx.waitUntil(
    drainCustomerOpportunityDispatchJobs({ jobId }).then(() => undefined).catch((error) => {
      console.error(
        "Customer opportunity dispatch failed.",
        error instanceof Error ? error.message : "Unknown error",
      );
    }),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function queueCustomerProjectActivityDispatch(
  response: Response,
  ctx: ExecutionContext,
) {
  const deliveryId =
    response.headers.get(CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER) || "";
  if (!deliveryId) return response;
  const headers = new Headers(response.headers);
  headers.delete(CUSTOMER_PROJECT_ACTIVITY_DISPATCH_HEADER);
  ctx.waitUntil(
    drainCustomerProjectActivityDeliveries({ deliveryId })
      .then(() => undefined)
      .catch((error) => {
        console.error(
          "Customer project activity delivery failed.",
          error instanceof Error ? error.message : "Unknown error",
        );
      }),
  );
  ctx.waitUntil(
    dispatchAdminNotificationDeliveries()
      .then(() => undefined)
      .catch((error) => {
        console.error(
          "Admin notification delivery failed.",
          error instanceof Error ? error.message : "Unknown error",
        );
      }),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function queueOpportunityNotificationDispatch(
  response: Response,
  ctx: ExecutionContext,
) {
  const dispatch = takeOpportunityNotificationDispatch(
    response,
    OPPORTUNITY_NOTIFICATION_DISPATCH_HEADER,
  );
  const { opportunityId } = dispatch;
  if (!opportunityId) return response;
  ctx.waitUntil(
    drainOpportunityNotificationDeliveriesForOpportunity({ opportunityId })
      .then((result) => {
        if (result.failed > 0 || result.waitingForChannel > 0) {
          console.error("Opportunity notification delivery remains pending.", {
            attempted: result.attempted,
            failed: result.failed,
            waitingForChannel: result.waitingForChannel,
          });
        }
      })
      .catch((error) => {
        console.error(
          "Opportunity notification delivery failed.",
          error instanceof Error ? error.message : "Unknown error",
        );
      }),
  );
  return dispatch.response;
}

function queuePublicPlanDeliveryDispatch(
  response: Response,
  ctx: ExecutionContext,
) {
  const dispatch = takePublicPlanDeliveryDispatch(
    response,
    PUBLIC_PLAN_DELIVERY_DISPATCH_HEADER,
  );
  if (!dispatch.intakeId) return response;
  ctx.waitUntil(
    drainPublicPlanDeliveries({
      intakeId: dispatch.intakeId,
      createOpportunityFromLead,
      dispatchOpportunityNotifications: (opportunityId) =>
        drainOpportunityNotificationDeliveriesForOpportunity({ opportunityId }),
    }).then(() => undefined).catch((error) => {
      console.error(
        "Public plan delivery failed.",
        error instanceof Error ? error.message : "Unknown error",
      );
    }),
  );
  return dispatch.response;
}

function queueBackgroundDispatches(
  response: Response,
  ctx: ExecutionContext,
  request: Request,
  workerEnv: unknown,
) {
  const url = new URL(request.url);
  const drainsNotificationBacklog = shouldDrainOpportunityNotificationBacklog({
    method: request.method,
    pathname: url.pathname,
    responseOk: response.ok,
  });
  if (drainsNotificationBacklog) {
    ctx.waitUntil(
      drainOpportunityNotificationDeliveries()
        .then((result) => {
          if (result.failed > 0 || result.waitingForChannel > 0) {
            console.error("Opportunity notification backlog remains pending.", {
              attempted: result.attempted,
              failed: result.failed,
              waitingForChannel: result.waitingForChannel,
            });
          }
        })
        .catch((error) => {
          console.error(
            "Opportunity notification backlog delivery failed.",
            error instanceof Error ? error.message : "Unknown error",
          );
        }),
    );
  }
  if (shouldDrainPublicPlanDeliveryBacklog({
    method: request.method,
    pathname: url.pathname,
    responseOk: response.ok,
  })) {
    ctx.waitUntil(
      drainPublicPlanDeliveries({
        createOpportunityFromLead,
        dispatchOpportunityNotifications: (opportunityId) =>
          drainOpportunityNotificationDeliveriesForOpportunity({ opportunityId }),
      })
        .then(() => undefined)
        .catch((error) => {
          console.error(
            "Public plan delivery backlog failed.",
            error instanceof Error ? error.message : "Unknown error",
          );
        }),
    );
  }
  if (shouldDrainPublicPlanQuotePhotoCleanup({
    method: request.method,
    pathname: url.pathname,
    responseOk: response.ok,
  })) {
    ctx.waitUntil(
      drainPublicPlanQuotePhotoCleanup({
        db: getD1(),
        bucket: getCustomerProjectEvidenceBucket(),
      })
        .then(() => undefined)
        .catch((error) => {
          console.error(
            "Public quote photo cleanup failed.",
            error instanceof Error ? error.message : "Unknown error",
          );
        }),
    );
  }
  if (request.method === "GET" && url.pathname === "/api/health" && response.ok) {
    const database = getD1();
    ctx.waitUntil(
      drainTradeQuoteDeliveries({ db: database, limit: 10 })
        .then(() => undefined)
        .catch((error) => {
          console.error(
            "Trade quote delivery recovery failed.",
            error instanceof Error ? error.message : "Unknown error",
          );
        }),
    );
    ctx.waitUntil(
      cleanupUnreferencedTradeIssuedDocuments().then(() => undefined).catch((error) => {
        console.error("Issued document cleanup failed.", error instanceof Error ? error.message : "Unknown error");
      }),
    );
    const bucket = (workerEnv as { EVIDENCE?: TradeTeamMemberCleanupBucket }).EVIDENCE;
    if (bucket) {
      ctx.waitUntil(
        drainTradeTeamMemberFileCleanup({ db: database, bucket })
          .then(() => undefined)
          .catch((error) => {
            console.error("Team member file cleanup failed.", error instanceof Error ? error.message : "Unknown error");
          }),
      );
      ctx.waitUntil(
        drainTradeCrmJobMediaCleanup({ db: database, bucket })
          .then(() => undefined)
          .catch((error) => {
            console.error("Accepted job file cleanup failed.", error instanceof Error ? error.message : "Unknown error");
          }),
      );
    }
  }
  return queueTradeQuoteDeliveryDispatch(queuePublicPlanDeliveryDispatch(queueCustomerProjectActivityDispatch(
    queueOpportunityNotificationDispatch(
      queueCustomerOpportunityDispatch(response, ctx),
      ctx,
    ),
    ctx,
  ), ctx), {
    waitUntil: (promise) => ctx.waitUntil(promise),
    drain: (deliveryId) => drainTradeQuoteDeliveries({ db: getD1(), deliveryId }),
    onError: (error) => {
      console.error(
        "Trade quote delivery dispatch failed.",
        error instanceof Error ? error.message : "Unknown error",
      );
    },
  });
}

function canonicalHostRedirect(request: Request) {
  const url = new URL(request.url);
  if (url.hostname !== LEGACY_SITE_HOST) return null;
  url.protocol = "https:";
  url.hostname = CANONICAL_SITE_HOST;
  url.port = "";
  return secureResponse(Response.redirect(url.toString(), 308), request);
}

function isCacheablePageRequest(request: Request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname === "/account" || url.pathname.startsWith("/account/")) {
    return false;
  }
  return (request.headers.get("accept") || "").includes("text/html");
}

function cacheableHtmlResponse(response: Response) {
  if (!response.ok) return null;
  if (!(response.headers.get("content-type") || "").includes("text/html")) return null;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", HTML_CACHE_CONTROL);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const worker = {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const redirect = canonicalHostRedirect(request);
    if (redirect) return redirect;

    if (request.method === "GET" && new URL(request.url).pathname === "/api/health") {
      await ensureTlinkSchemaGuards(getD1());
    }
    if (!isCacheablePageRequest(request)) {
      const handled = await handler.fetch(request, env as never, ctx as never);
      return secureResponse(queueBackgroundDispatches(handled, ctx, request, env), request);
    }

    const cache = (globalThis as unknown as { caches?: RuntimeCacheStorage }).caches?.default;
    if (cache) {
      const cached = await cache.match(request).catch(() => undefined);
      if (cached) return secureResponse(cached, request);
    }

    const handled = await handler.fetch(request, env as never, ctx as never);
    const response = secureResponse(queueBackgroundDispatches(handled, ctx, request, env), request);
    const cacheable = cacheableHtmlResponse(response);
    if (!cacheable) return response;
    if (cache) ctx.waitUntil(cache.put(request, cacheable.clone()).catch(() => undefined));
    return cacheable;
  },
  async scheduled(controller: ScheduledController, workerEnv: unknown, ctx: ExecutionContext) {
    const tasks: Promise<unknown>[] = [];
    if (controller.cron === NOTIFICATION_DELIVERY_CRON) {
      const teamMemberBucket = (workerEnv as { EVIDENCE?: TradeTeamMemberCleanupBucket }).EVIDENCE;
      const documentExpiryEmail = serviceReminderProviderConfiguration().email;
      const registryArtifactStore = (workerEnv as {
        EVIDENCE?: CreditexOfficialProductArtifactStore
          & CreditexSresArtifactStore;
      }).EVIDENCE;
      const registryEnvironment = workerEnv as Readonly<Record<string, unknown>>;
      tasks.push(
        maintainNextCreditexProductRegistry({
          database: getD1(),
          now: new Date(controller.scheduledTime),
          targets: creditexAutomaticProductRegistryMaintenanceTargets({
            artifactStore: registryArtifactStore,
            environment: registryEnvironment,
          }),
        }).catch((error) => {
          console.error(
            "Official product registry scheduled refresh failed.",
            error instanceof Error ? error.message : "Unknown error",
          );
        }),
        ensureTlinkSchemaGuards(getD1()).catch((error) => {
          console.error("TLink schema guard installation failed.", error instanceof Error ? error.message : "Unknown error");
          throw error;
        }),
        drainCustomerOpportunityDispatchJobs().catch((error) => {
          console.error("Customer opportunity dispatch failed.", error instanceof Error ? error.message : "Unknown error");
        }),
        drainOpportunityNotificationDeliveries().catch((error) => {
          console.error("Opportunity notification delivery failed.", error instanceof Error ? error.message : "Unknown error");
        }),
        drainCustomerProjectActivityDeliveries().catch((error) => {
          console.error("Customer project activity delivery failed.", error instanceof Error ? error.message : "Unknown error");
        }),
        dispatchAdminNotificationDeliveries().catch((error) => {
          console.error("Admin notification delivery failed.", error instanceof Error ? error.message : "Unknown error");
        }),
        drainPublicPlanQuotePhotoCleanup({
          db: getD1(),
          bucket: getCustomerProjectEvidenceBucket(),
        }).catch((error) => {
          console.error("Public quote photo cleanup failed.", error instanceof Error ? error.message : "Unknown error");
        }),
        drainPublicPlanDeliveries({
          createOpportunityFromLead,
          dispatchOpportunityNotifications: (opportunityId) =>
            drainOpportunityNotificationDeliveriesForOpportunity({ opportunityId }),
        }).catch((error) => {
          console.error("Public plan delivery failed.", error instanceof Error ? error.message : "Unknown error");
        }),
        drainTradeQuoteDeliveries({ db: getD1() }).catch((error) => {
          console.error("Trade quote delivery failed.", error instanceof Error ? error.message : "Unknown error");
        }),
        cleanupUnreferencedTradeIssuedDocuments().catch((error) => {
          console.error("Issued document cleanup failed.", error instanceof Error ? error.message : "Unknown error");
        }),
        enqueueTradeTeamDocumentExpiryWarnings({ db: getD1() })
          .then(() => drainTradeTeamDocumentExpiryEmails({
            db: getD1(),
            emailConfigured: documentExpiryEmail.configured,
            sendEmail: (message) => sendServiceReminderProviderMessage(message),
          }))
          .catch((error) => {
            console.error("Team document expiry notification failed.", error instanceof Error ? error.message : "Unknown error");
          }),
      );
      if (teamMemberBucket) {
        tasks.push(drainTradeTeamMemberFileCleanup({ db: getD1(), bucket: teamMemberBucket }).catch((error) => {
          console.error("Team member file cleanup failed.", error instanceof Error ? error.message : "Unknown error");
        }));
        tasks.push(drainTradeCrmJobMediaCleanup({ db: getD1(), bucket: teamMemberBucket }).catch((error) => {
          console.error("Accepted job file cleanup failed.", error instanceof Error ? error.message : "Unknown error");
        }));
      }
    }
    if (controller.cron === DAILY_MAINTENANCE_CRON) {
      const db = getD1();
      tasks.push(
        generateDueServiceJobs(db, { limit: 200 }).catch((error) => {
          console.error("Recurring service job generation failed.", error instanceof Error ? error.message : "Unknown error");
        }),
        syncCertificatePriceHistory(db).catch((error) => {
          console.error("Certificate price refresh failed.", error instanceof Error ? error.message : "Unknown error");
        }),
      );
    }
    ctx.waitUntil(Promise.all(tasks).then(() => undefined));
  },
};

export default worker;
