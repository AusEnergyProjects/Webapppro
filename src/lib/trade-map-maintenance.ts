export const TRADE_MAP_MAINTENANCE_PATH = "/api/internal/trade-map-maintenance";
export const TRADE_MAP_MAINTENANCE_HEADER = "X-TLink-Map-Maintenance-Dispatch";
const TIMESTAMP_HEADER = "X-TLink-Maintenance-Timestamp";
const SIGNATURE_HEADER = "X-TLink-Maintenance-Signature";
const MAXIMUM_CLOCK_SKEW_MS = 120_000;

function json(body: object, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

/** The existing monitor secret signs only a fresh, purpose-specific maintenance tick. */
export async function handleTradeMapMaintenance(request: Request, options: { secret: unknown; now?: number }) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" });
  if (typeof options.secret !== "string" || options.secret.length < 32) {
    return json({ ok: false, error: "Map maintenance is unavailable." }, 503);
  }
  const timestamp = request.headers.get(TIMESTAMP_HEADER) || "";
  const signature = request.headers.get(SIGNATURE_HEADER) || "";
  if (!/^\d{13}$/.test(timestamp) || !/^[A-Za-z0-9_-]{43}$/.test(signature)
    || Math.abs((options.now ?? Date.now()) - Number(timestamp)) > MAXIMUM_CLOCK_SKEW_MS) {
    return json({ ok: false, error: "Authentication is required." }, 401);
  }
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(options.secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "="), character => character.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, bytes,
      new TextEncoder().encode(`tlink-map-maintenance\n${timestamp}`));
    if (!valid) return json({ ok: false, error: "Authentication is required." }, 401);
  } catch {
    console.error("Map maintenance authentication could not be verified.");
    return json({ ok: false, error: "Map maintenance is unavailable." }, 503);
  }
  // No tenant identifier, customer data, or operations can be supplied by this caller.
  if (new URL(request.url).search) return json({ ok: false, error: "Send an empty maintenance request." }, 400);
  if (request.body) {
    const reader = request.body.getReader();
    try {
      const first = await reader.read();
      if (!first.done) {
        void reader.cancel().catch(() => undefined);
        return json({ ok: false, error: "Send an empty maintenance request." }, 400);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return json({ ok: true, accepted: true }, 202, { [TRADE_MAP_MAINTENANCE_HEADER]: "1" });
}

/** Only the authenticated route response can request a background drain. Never trust request headers. */
export function queueTradeMapMaintenance(request: Request, response: Response, context: {
  waitUntil: (promise: Promise<unknown>) => void;
  drain: () => Promise<{ failed: number }>;
  onError: () => void;
}) {
  if (!response.headers.has(TRADE_MAP_MAINTENANCE_HEADER)) return response;
  const headers = new Headers(response.headers);
  headers.delete(TRADE_MAP_MAINTENANCE_HEADER);
  if (request.method === "POST" && new URL(request.url).pathname === TRADE_MAP_MAINTENANCE_PATH
    && response.status === 202 && response.headers.get(TRADE_MAP_MAINTENANCE_HEADER) === "1") {
    context.waitUntil(Promise.resolve().then(context.drain).then(result => {
      if (result.failed) context.onError();
    }).catch(() => context.onError()));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
