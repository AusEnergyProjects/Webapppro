import { env, waitUntil } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import {
  handleEnergyAssistantRequest as handleEnergyAssistantServerRequest,
  type ServerDependencies,
  type SurgeModelAdmissionRequest,
  type SurgeModelCallReservation,
} from "@/lib/energy-assistant-server";
import type {
  SurgeConversationQualityEvent,
  SurgeConversationQualityMetadata,
} from "@/lib/energy-assistant-quality";
import { createSurgeConversationQualityRecorder } from "@/lib/energy-assistant-quality-server";
import {
  generateSurgeModelAnswer,
  type SurgeModelFailure,
} from "@/lib/energy-assistant-model";
import { resolveSurgeClientIdentity } from "@/lib/surge-client-identity";
import {
  createSharedSurgeUsageGuard,
  SURGE_USAGE_GUARD_ENV,
} from "@/lib/energy-assistant-usage-guard";
import { createSurgeGroundedProductGuidanceResolver } from "@/lib/energy-assistant-product-guidance-server";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};

function unavailable() {
  return Response.json({
    ok: false,
    error: {
      code: "ASSISTANT_UNAVAILABLE",
      message: "The energy assistant is temporarily unavailable. Please try again.",
    },
  }, {
    status: 500,
    headers: securityHeaders,
  });
}

function unsupportedMediaType() {
  return Response.json({
    ok: false,
    error: {
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Send the energy question as JSON.",
    },
  }, {
    status: 415,
    headers: securityHeaders,
  });
}

function isJsonRequest(request: Request) {
  return request.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase() === "application/json";
}

function withSetCookie(response: Response, setCookie: string | null) {
  if (!setCookie) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", setCookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function usageGuardEnvironment() {
  const source = env as unknown as Record<string, unknown>;
  const production = process.env.NODE_ENV === "production" || source.NODE_ENV === "production";
  const guardEnvironment: Record<string, string | undefined> = {
    NODE_ENV: production ? "production" : "development",
  };
  for (const key of Object.values(SURGE_USAGE_GUARD_ENV)) {
    guardEnvironment[key] = typeof source[key] === "string" ? source[key] : undefined;
  }
  return guardEnvironment;
}

function deniedReservation(): SurgeModelCallReservation {
  return { allowed: false };
}

function hostedString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstHostedString(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = hostedString(source, key);
    if (value) return value;
  }
  return undefined;
}

function hostedQualityMetadata(): Partial<SurgeConversationQualityMetadata> {
  const source = env as unknown as Record<string, unknown>;
  return {
    corpusSha256: firstHostedString(source, "SURGE_QUALITY_CORPUS_SHA256"),
    promptSha256: firstHostedString(source, "SURGE_QUALITY_PROMPT_SHA256", "SURGE_PROMPT_SHA256"),
    sourceSha256: firstHostedString(source, "SURGE_QUALITY_SOURCE_SHA256", "SURGE_SOURCE_SHA256"),
    appVersion: firstHostedString(source, "SURGE_APP_VERSION", "APP_VERSION", "CF_PAGES_BRANCH"),
    gitSha: firstHostedString(source, "SURGE_GIT_SHA", "GIT_COMMIT_SHA", "CF_PAGES_COMMIT_SHA"),
    deploymentId: firstHostedString(source, "SURGE_DEPLOYMENT_ID", "CF_PAGES_DEPLOYMENT_ID"),
    requestedModel: firstHostedString(source, "SURGE_MODEL"),
    providerModel: firstHostedString(source, "SURGE_PROVIDER_MODEL"),
  };
}

function hostedBoolean(value: string | undefined) {
  if (value === undefined) return undefined;
  if (/^(?:1|true|yes|on)$/i.test(value)) return true;
  return false;
}

function reportModelFailure(failure: SurgeModelFailure) {
  console.warn("Surge model answer was unavailable.", {
    code: failure.code,
    ...(failure.providerStatus ? { providerStatus: failure.providerStatus } : {}),
  });
}

function generateHostedModelAnswer(
  modelRequest: Parameters<typeof generateSurgeModelAnswer>[0],
) {
  const source = env as unknown as Record<string, unknown>;
  return generateSurgeModelAnswer(modelRequest, {
    apiKey: hostedString(source, "OPENAI_API_KEY"),
    model: hostedString(source, "SURGE_MODEL"),
    enabled: hostedBoolean(hostedString(source, "SURGE_AI_ENABLED")),
    onFailure: reportModelFailure,
  });
}

function handleEnergyAssistantRequest(
  request: Request,
  dependencies: {
    reserveModelCall: (
      request: SurgeModelAdmissionRequest,
    ) => Promise<SurgeModelCallReservation>;
    recordQuality: (event: SurgeConversationQualityEvent) => Promise<void>;
    resolveGroundedAnswer?: ServerDependencies["resolveGroundedAnswer"];
  },
) {
  return handleEnergyAssistantServerRequest(request, {
    ...dependencies,
    generateAnswer: generateHostedModelAnswer,
    qualityMetadata: hostedQualityMetadata(),
    requireValidatedModelForOrdinaryAdvice: true,
  });
}

async function handle(request: Request) {
  if (!isJsonRequest(request)) return unsupportedMediaType();

  let setCookie: string | null = null;
  let database: D1Database | null = null;
  try {
    database = getD1();
  } catch {
    database = null;
  }
  const recordQuality = async (event: SurgeConversationQualityEvent) => {
    if (!database) return;
    const recorder = createSurgeConversationQualityRecorder(database);
    waitUntil(recorder(event).catch(() => undefined));
  };
  const resolveGroundedAnswer = database
    ? createSurgeGroundedProductGuidanceResolver(database)
    : undefined;
  let reserveModelCall: (
    request: SurgeModelAdmissionRequest,
  ) => Promise<SurgeModelCallReservation> = async () => deniedReservation();
  try {
    const guardEnvironment = usageGuardEnvironment();
    const identity = await resolveSurgeClientIdentity(request, {
      secret: guardEnvironment[SURGE_USAGE_GUARD_ENV.secret],
      production: guardEnvironment.NODE_ENV === "production",
    });
    setCookie = identity.setCookie;
    if (identity.ready) {
      try {
        const usageDatabase = database;
        if (!usageDatabase) throw new Error("Surge database is unavailable.");
        const usageGuard = createSharedSurgeUsageGuard({
          env: guardEnvironment,
          getDatabase: () => usageDatabase,
        });
        reserveModelCall = async ({ requestId, estimatedMicroUsd }) => {
          try {
            return await usageGuard.reserve({
              clientKey: identity.clientKey,
              networkKey: identity.networkKey,
              requestKey: requestId,
              estimatedMicroUsd,
            });
          } catch {
            return deniedReservation();
          }
        };
      } catch {
        reserveModelCall = async () => deniedReservation();
      }
    }
  } catch {
    reserveModelCall = async () => deniedReservation();
  }

  try {
    return withSetCookie(
      await handleEnergyAssistantRequest(request, {
        reserveModelCall,
        recordQuality,
        resolveGroundedAnswer,
      }),
      setCookie,
    );
  } catch {
    return withSetCookie(unavailable(), setCookie);
  }
}

export const POST = handle;
