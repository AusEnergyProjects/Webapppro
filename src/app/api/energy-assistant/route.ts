import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import {
  handleEnergyAssistantRequest as handleEnergyAssistantServerRequest,
  type SurgeModelAdmissionRequest,
  type SurgeModelCallReservation,
} from "@/lib/energy-assistant-server";
import {
  generateSurgeModelAnswer,
  type SurgeModelFailure,
} from "@/lib/energy-assistant-model";
import { resolveSurgeClientIdentity } from "@/lib/surge-client-identity";
import {
  createSharedSurgeUsageGuard,
  SURGE_USAGE_GUARD_ENV,
} from "@/lib/energy-assistant-usage-guard";

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

function hostedBoolean(value: string | undefined) {
  if (value === undefined) return undefined;
  if (/^(?:1|true|yes|on)$/i.test(value)) return true;
  return false;
}

function reportModelFailure(failure: SurgeModelFailure) {
  console.warn("Surge model used deterministic fallback.", {
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
  },
) {
  return handleEnergyAssistantServerRequest(request, {
    ...dependencies,
    generateAnswer: generateHostedModelAnswer,
  });
}

async function handle(request: Request) {
  if (!isJsonRequest(request)) return unsupportedMediaType();

  let setCookie: string | null = null;
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
        const database = getD1();
        const usageGuard = createSharedSurgeUsageGuard({
          env: guardEnvironment,
          getDatabase: () => database,
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
      await handleEnergyAssistantRequest(request, { reserveModelCall }),
      setCookie,
    );
  } catch {
    return withSetCookie(unavailable(), setCookie);
  }
}

export const POST = handle;
