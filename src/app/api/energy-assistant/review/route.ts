import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { SURGE_USAGE_GUARD_ENV } from "@/lib/energy-assistant-usage-guard";
import { resolveSurgeClientIdentity } from "@/lib/surge-client-identity";

export const runtime = "edge";

const headers = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};

function json(body: object, status = 200, setCookie?: string | null) {
  const responseHeaders = new Headers(headers);
  if (setCookie) responseHeaders.append("Set-Cookie", setCookie);
  return Response.json(body, { status, headers: responseHeaders });
}

function cleanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum)
    .trim();
}

function sameBrowserOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

export async function POST(request: Request) {
  if (!sameBrowserOrigin(request)) return json({ ok: false, error: "Request origin was not accepted." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].toLowerCase() !== "application/json") {
    return json({ ok: false, error: "Send the review as JSON." }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 8_192) {
    return json({ ok: false, error: "The review was too large." }, 413);
  }

  let body: Record<string, unknown>;
  try {
    const source = await request.text();
    if (new TextEncoder().encode(source).byteLength > 8_192) return json({ ok: false, error: "The review was too large." }, 413);
    body = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "The review was not valid." }, 400);
  }
  const allowedKeys = new Set(["answerId", "question", "answer"]);
  if (!body || Array.isArray(body) || Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return json({ ok: false, error: "The review contained an unsupported field." }, 400);
  }
  const answerId = cleanText(body.answerId, 120).toLowerCase();
  const question = cleanText(body.question, 1_200);
  const answer = cleanText(body.answer, 4_000);
  if (!/^[a-z0-9][a-z0-9:_-]{7,119}$/u.test(answerId) || !question || !answer) {
    return json({ ok: false, error: "Choose a complete Surge answer to review." }, 400);
  }

  const hosted = env as unknown as Record<string, unknown>;
  const secret = typeof hosted[SURGE_USAGE_GUARD_ENV.secret] === "string"
    ? String(hosted[SURGE_USAGE_GUARD_ENV.secret])
    : "";
  const identity = await resolveSurgeClientIdentity(request, {
    secret,
    production: process.env.NODE_ENV === "production" || hosted.NODE_ENV === "production",
  });
  if (!identity.ready) {
    return json({ ok: false, error: "Answer review is temporarily unavailable." }, 503, identity.setCookie);
  }

  const database = getD1();
  const recent = await database.prepare(`SELECT COUNT(*) total
    FROM surge_answer_reviews
    WHERE client_key = ? AND datetime(created_at) >= datetime('now', '-1 day')`)
    .bind(identity.clientKey).first<{ total: number }>();
  if (Number(recent?.total || 0) >= 20) {
    return json({ ok: false, error: "Too many answers were sent for review today." }, 429, identity.setCookie);
  }

  const now = new Date().toISOString();
  await database.prepare(`INSERT OR IGNORE INTO surge_answer_reviews (
      id, answer_id, client_key, question, answer, status,
      reviewer_uid, review_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', '', '', ?, ?)`)
    .bind(crypto.randomUUID(), answerId, identity.clientKey, question, answer, now, now)
    .run();
  return json({ ok: true, sent: true }, 200, identity.setCookie);
}
