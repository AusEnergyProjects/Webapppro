import { env, waitUntil } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import {
  ENERGY_ASSISTANT_MAX_BODY_BYTES,
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

function requestTooLarge() {
  return Response.json({
    ok: false,
    error: {
      code: "REQUEST_TOO_LARGE",
      message: "The assistant request is too large.",
    },
  }, {
    status: 413,
    headers: securityHeaders,
  });
}

function isJsonRequest(request: Request) {
  return request.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase() === "application/json";
}

function boundedRequestId(source: string) {
  try {
    const body = JSON.parse(source) as Record<string, unknown>;
    const value = body.requestId ?? body.clientRequestId;
    return typeof value === "string" && /^[A-Za-z0-9:_-]{16,80}$/.test(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

async function prepareBoundedRequest(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > ENERGY_ASSISTANT_MAX_BODY_BYTES) return null;

  const reader = request.clone().body?.getReader();
  if (!reader) return { request, requestId: undefined };
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > ENERGY_ASSISTANT_MAX_BODY_BYTES) {
      await Promise.allSettled([
        reader.cancel(),
        request.body?.cancel() ?? Promise.resolve(),
      ]);
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const source = new TextDecoder().decode(bytes);
  return {
    request,
    requestId: boundedRequestId(source),
  };
}

function requestLogContext(requestId: string | undefined) {
  return requestId ? { requestId } : {};
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

function deniedReservation(reason = "unavailable"): SurgeModelCallReservation {
  return { allowed: false, reason };
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

function reportModelFailure(failure: SurgeModelFailure, requestId?: string) {
  const safeDetails = [
    `code=${failure.code}`,
    failure.stage ? `stage=${failure.stage}` : "",
    failure.providerStatus ? `provider_status=${failure.providerStatus}` : "",
    failure.providerCode ? `provider_code=${failure.providerCode}` : "",
    requestId ? `request_id=${requestId}` : "",
  ].filter(Boolean).join(" ");
  console.warn(`Surge model answer was unavailable. ${safeDetails}`, {
    ...requestLogContext(requestId),
    code: failure.code,
    ...(failure.stage ? { stage: failure.stage } : {}),
    ...(failure.providerStatus ? { providerStatus: failure.providerStatus } : {}),
    ...(failure.providerCode ? { providerCode: failure.providerCode } : {}),
  });
}

function generateHostedModelAnswer(
  modelRequest: Parameters<typeof generateSurgeModelAnswer>[0],
  requestId?: string,
) {
  const source = env as unknown as Record<string, unknown>;
  return generateSurgeModelAnswer(modelRequest, {
    apiKey: hostedString(source, "OPENAI_API_KEY"),
    model: hostedString(source, "SURGE_MODEL"),
    enabled: hostedBoolean(hostedString(source, "SURGE_AI_ENABLED")),
    onFailure: (failure) => reportModelFailure(failure, requestId),
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
  requestId?: string,
) {
  return handleEnergyAssistantServerRequest(request, {
    ...dependencies,
    generateAnswer: (modelRequest) => generateHostedModelAnswer(modelRequest, requestId),
    qualityMetadata: hostedQualityMetadata(),
    requireValidatedModelForOrdinaryAdvice: true,
  });
}

async function handle(request: Request) {
  if (!isJsonRequest(request)) return unsupportedMediaType();

  const preparedRequest = await prepareBoundedRequest(request);
  if (!preparedRequest) return requestTooLarge();
  request = preparedRequest.request;
  const requestId = preparedRequest.requestId;
  let setCookie: string | null = null;
  let database: D1Database | null = null;
  try {
    database = getD1();
  } catch {
    console.warn("Surge model admission was unavailable.", {
      ...requestLogContext(requestId),
      reason: "database_unavailable",
    });
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
  const guardEnvironment = usageGuardEnvironment();
  const identitySecret = guardEnvironment[SURGE_USAGE_GUARD_ENV.secret];
  let identity: Awaited<ReturnType<typeof resolveSurgeClientIdentity>> | null = null;
  let usageGuard: ReturnType<typeof createSharedSurgeUsageGuard> | null = null;
  const prepareAdmissionIdentity = async (): Promise<SurgeModelCallReservation | null> => {
    if (identity?.ready) return null;
    if (!identitySecret || identitySecret.length < 32) {
      console.warn("Surge model admission was denied.", {
        ...requestLogContext(requestId),
        reason: "identity_not_ready",
      });
      return deniedReservation("configuration");
    }
    try {
      const candidate = await resolveSurgeClientIdentity(request, {
        secret: identitySecret,
        production: guardEnvironment.NODE_ENV === "production",
      });
      setCookie = candidate.setCookie || setCookie;
      if (!candidate.ready) {
        console.warn("Surge model admission was denied.", {
          ...requestLogContext(requestId),
          reason: "identity_not_ready",
        });
        return deniedReservation("invalid_identity");
      }
      identity = candidate;
      return null;
    } catch {
      console.warn("Surge model admission was unavailable.", {
        ...requestLogContext(requestId),
        reason: "identity_resolution_failed",
      });
      return deniedReservation("unavailable");
    }
  };
  const reserveModelCall: (
    admission: SurgeModelAdmissionRequest,
  ) => Promise<SurgeModelCallReservation> = async ({ requestId, estimatedMicroUsd }) => {
    const identityDenial = await prepareAdmissionIdentity();
    if (identityDenial) return identityDenial;
    if (!database) {
      try {
        database = getD1();
      } catch {
        console.warn("Surge model admission was unavailable.", {
          ...requestLogContext(requestId),
          reason: "database_unavailable",
        });
        return deniedReservation("unavailable");
      }
    }
    try {
      const usageDatabase = database;
      if (!usageDatabase) return deniedReservation("unavailable");
      usageGuard ||= createSharedSurgeUsageGuard({
        env: guardEnvironment,
        getDatabase: () => usageDatabase,
      });
    } catch {
      usageGuard = null;
      console.warn("Surge model admission was unavailable.", {
        ...requestLogContext(requestId),
        reason: "guard_setup_failed",
      });
      return deniedReservation("unavailable");
    }
    try {
      const reservation = await usageGuard.reserve({
        clientKey: identity!.clientKey,
        networkKey: identity!.networkKey,
        requestKey: requestId,
        estimatedMicroUsd,
      });
      if (!reservation.allowed) {
        console.warn(
          reservation.reason === "unavailable"
            ? "Surge model admission was unavailable."
            : "Surge model admission was denied.",
          {
            ...requestLogContext(requestId),
            reason: reservation.reason,
            ...(reservation.retryAfterSeconds
              ? { retryAfterSeconds: reservation.retryAfterSeconds }
              : {}),
          },
        );
      }
      return reservation;
    } catch {
      usageGuard = null;
      console.warn("Surge model admission was unavailable.", {
        ...requestLogContext(requestId),
        reason: "reservation_unavailable",
      });
      return deniedReservation("unavailable");
    }
  };
  await prepareAdmissionIdentity();

  try {
    return withSetCookie(
      await handleEnergyAssistantRequest(request, {
        reserveModelCall,
        recordQuality,
        resolveGroundedAnswer,
      }, requestId),
      setCookie,
    );
  } catch {
    console.warn("Surge request failed before a customer answer was returned.", {
      ...requestLogContext(requestId),
      reason: "request_handler_failed",
    });
    return withSetCookie(unavailable(), setCookie);
  }
}

export const POST = handle;
