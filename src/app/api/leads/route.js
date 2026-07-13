import { validateLeadPayload } from "@/lib/lead-validation.mjs";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 5;
const rateBuckets = new Map();

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function clientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

function rateAllowed(key) {
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    rateBuckets.set(key, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return true;
}

function safeMagicLink(value, requestUrl) {
  if (!value) return "";
  try {
    const link = new URL(value);
    const request = new URL(requestUrl);
    const allowedPaths = new Set(["/compare", "/compare/electricity-next"]);
    return link.origin === request.origin && allowedPaths.has(link.pathname) ? link.toString() : "";
  } catch {
    return "";
  }
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  if (origin && origin !== requestOrigin) return json({ ok: false, error: "Request origin was not accepted." }, 403);

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return json({ ok: false, error: "JSON is required." }, 415);

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ ok: false, error: "Request is too large." }, 413);

  let raw;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ ok: false, error: "Request is too large." }, 413);
    raw = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }

  const result = validateLeadPayload(raw);
  if (!result.ok) return json({ ok: false, error: result.error }, 400);

  const payload = result.value;
  const startedTooQuickly = payload.clientStartedAt && Date.now() - payload.clientStartedAt < 1200;
  if (payload.website || startedTooQuickly) return json({ ok: true, filtered: true });
  if (!rateAllowed(clientKey(request))) return json({ ok: false, error: "Too many requests. Please try again later." }, 429);

  const webhook = process.env.AEA_LEAD_WEBHOOK_URL;
  if (!webhook) return json({ ok: false, error: "Enquiries are not configured in this local environment." }, 503);

  payload.magicLink = safeMagicLink(payload.magicLink, request.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Lead processor returned " + response.status);
    return json({ ok: true, reference: crypto.randomUUID() });
  } catch {
    return json({ ok: false, error: "Your request could not be delivered. Please try again or call 1300 241 149." }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
