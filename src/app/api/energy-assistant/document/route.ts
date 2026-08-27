import { getD1 } from "../../../../../db";
import {
  analyseEnergyDocumentBytes,
  EnergyDocumentError,
  MAX_ENERGY_DOCUMENT_REQUEST_BYTES,
} from "@/lib/energy-assistant-document";
import {
  createMemoryLeadRateLimiter,
  createSharedLeadRateLimiter,
} from "@/lib/lead-rate-limit.mjs";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};
const DOCUMENT_RATE_LIMIT = 20;
const documentRateLimiterOptions = {
  env: process.env,
  getDatabase: getD1,
  limit: DOCUMENT_RATE_LIMIT,
};
const documentRateLimiter = createSharedLeadRateLimiter(documentRateLimiterOptions);
const localDocumentRateLimiter = createMemoryLeadRateLimiter({ limit: DOCUMENT_RATE_LIMIT });

function json(body: object, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: { ...securityHeaders, ...headers },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

function requestFingerprint(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
}

function assistantReply(directAnswer: string) {
  return {
    id: crypto.randomUUID().toLowerCase(),
    role: "assistant",
    createdAt: new Date().toISOString(),
    content: directAnswer,
    directAnswer,
    status: "answered",
    confidence: "high",
    followUpQuestion: "",
  };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({ ok: false, error: { code: "ORIGIN_REJECTED", message: "Request origin was not accepted." } }, 403);
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("multipart/form-data;")) {
    return json({
      ok: false,
      error: { code: "MULTIPART_REQUIRED", message: "Send one PDF or .docx file as multipart form data." },
    }, 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ENERGY_DOCUMENT_REQUEST_BYTES) {
    return json({
      ok: false,
      error: { code: "DOCUMENT_SIZE_INVALID", message: "Documents must be no larger than 5 MB." },
    }, 413);
  }
  try {
    const local = /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(request.url).hostname);
    const rateLimit = await (local ? localDocumentRateLimiter : documentRateLimiter)
      .check(`energy-assistant-document:${requestFingerprint(request)}`);
    if (rateLimit.unavailable) {
      return json({
        ok: false,
        error: { code: "DOCUMENT_ANALYSIS_UNAVAILABLE", message: "Document analysis is temporarily unavailable." },
      }, 503, { "Retry-After": "60" });
    }
    if (!rateLimit.allowed) {
      return json({
        ok: false,
        error: { code: "DOCUMENT_RATE_LIMITED", message: "Too many documents were submitted. Try again later." },
      }, 429, { "Retry-After": String(rateLimit.retryAfterSeconds || 3600) });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({
        ok: false,
        error: { code: "DOCUMENT_REQUIRED", message: "Choose one PDF or .docx file." },
      }, 400);
    }
    const source = new Uint8Array(await file.arrayBuffer());
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    const analysis = await analyseEnergyDocumentBytes({
      bytes,
      fileName: file.name,
      contentType: file.type,
    });
    return json({
      ok: true,
      accepted: analysis.accepted,
      kind: analysis.kind,
      conversationContext: analysis.conversationContext,
      reply: assistantReply(analysis.directAnswer),
      retention: "transient",
    });
  } catch (error) {
    if (error instanceof EnergyDocumentError) {
      return json({
        ok: false,
        error: { code: error.code, message: error.message },
      }, error.status);
    }
    console.warn("Surge document analysis failed.", { name: error instanceof Error ? error.name : "UnknownError" });
    return json({
      ok: false,
      error: { code: "DOCUMENT_ANALYSIS_FAILED", message: "The document could not be analysed. Try a shorter text-based PDF or .docx file." },
    }, 500);
  }
}

export function GET() {
  return json({
    ok: false,
    error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to analyse an energy document." },
  }, 405, { Allow: "POST" });
}
