import {
  parseSurgeProfileStorageHealthStatus,
  recordSurgeProfileStorageHealthAggregate,
} from "@/lib/surge-profile-storage-health-server";
import { getD1 } from "../../../../../db";

export const runtime = "edge";

function json(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false }, 403);
  }
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    return json({ ok: false }, 415);
  }
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 128) return json({ ok: false }, 413);
    const value = JSON.parse(raw) as { status?: unknown };
    const status = parseSurgeProfileStorageHealthStatus(value?.status);
    if (!status) return json({ ok: false }, 400);
    await recordSurgeProfileStorageHealthAggregate(status, getD1());
    return json({ ok: true }, 202);
  } catch (error) {
    console.error("Surge profile storage health event failed", error);
    return json({ ok: false }, 500);
  }
}
