import handler from "vinext/server/app-router-entry";
import { getD1 } from "../db";
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
import { drainOpportunityNotificationDeliveries } from "../src/lib/opportunity-notification-server";
import {
  syncCerSresProductRegistry,
  type CreditexSresArtifactStore,
} from "../src/lib/creditex-sres-registry-server";
import { CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES } from "../src/lib/creditex-official-product-registry-definitions";
import {
  syncOfficialProductRegistry,
  type CreditexOfficialProductArtifactStore,
} from "../src/lib/creditex-official-product-registry-server";
import { ensureCreditexProductRegistrySchemaGuards } from "../src/lib/creditex-product-registry-schema-guards";
import { generateDueServiceJobs } from "../src/lib/trade-recurring-jobs-server";

const HTML_CACHE_CONTROL = "public, max-age=0, s-maxage=120, stale-while-revalidate=600";
const PRIVATE_HTML_CACHE_CONTROL = "private, no-store, max-age=0";
const LEGACY_SITE_HOST = "aea-energy-comparison.info294029.chatgpt.site";
const CANONICAL_SITE_HOST = "compare.ausenergyassessments.com";
const NOTIFICATION_DELIVERY_CRON = "* * * * *";
const DAILY_MAINTENANCE_CRON = "15 20 * * *";
const SRES_REGISTRY_CRON = "45 20 * * *";
const OFFICIAL_PRODUCT_REGISTRY_CRON = "5 21 * * *";

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

function queueBackgroundDispatches(
  response: Response,
  ctx: ExecutionContext,
) {
  return queueCustomerProjectActivityDispatch(
    queueCustomerOpportunityDispatch(response, ctx),
    ctx,
  );
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

    if (!isCacheablePageRequest(request)) {
      const handled = await handler.fetch(request, env as never, ctx as never);
      return secureResponse(queueBackgroundDispatches(handled, ctx), request);
    }

    const cache = (globalThis as unknown as { caches?: RuntimeCacheStorage }).caches?.default;
    if (cache) {
      const cached = await cache.match(request).catch(() => undefined);
      if (cached) return secureResponse(cached, request);
    }

    const handled = await handler.fetch(request, env as never, ctx as never);
    const response = secureResponse(queueBackgroundDispatches(handled, ctx), request);
    const cacheable = cacheableHtmlResponse(response);
    if (!cacheable) return response;
    if (cache) ctx.waitUntil(cache.put(request, cacheable.clone()).catch(() => undefined));
    return cacheable;
  },
  async scheduled(controller: ScheduledController, workerEnv: unknown, ctx: ExecutionContext) {
    const tasks: Promise<unknown>[] = [];
    if (controller.cron === NOTIFICATION_DELIVERY_CRON) {
      tasks.push(
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
      );
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
    if (controller.cron === SRES_REGISTRY_CRON) {
      const db = getD1();
      const artifactStore = (workerEnv as {
        EVIDENCE?: CreditexSresArtifactStore;
      }).EVIDENCE;
      tasks.push(
        (async () => {
          await ensureCreditexProductRegistrySchemaGuards(db);
          await syncCerSresProductRegistry(db, { artifactStore });
        })().catch((error) => {
          console.error("CER SRES product registry refresh failed.", error instanceof Error ? error.message : "Unknown error");
        }),
      );
    }
    if (controller.cron === OFFICIAL_PRODUCT_REGISTRY_CRON) {
      const db = getD1();
      const artifactStore = (workerEnv as {
        EVIDENCE?: CreditexOfficialProductArtifactStore;
      }).EVIDENCE;
      tasks.push(
        (async () => {
          await ensureCreditexProductRegistrySchemaGuards(db);
          for (const definition of CREDITEX_AUTOMATIC_PRODUCT_REGISTRIES) {
            await syncOfficialProductRegistry(db, definition, {
              artifactStore,
            });
          }
        })().catch((error) => {
          console.error(
            "Official product registry refresh failed.",
            error instanceof Error ? error.message : "Unknown error",
          );
        }),
      );
    }
    ctx.waitUntil(Promise.all(tasks).then(() => undefined));
  },
};

export default worker;
