import handler from "vinext/server/app-router-entry";

const HTML_CACHE_CONTROL = "public, max-age=0, s-maxage=120, stale-while-revalidate=600";

type RuntimeCacheStorage = CacheStorage & { default?: Cache };

function secureResponse(response: Response, request: Request) {
  const headers = new Headers(response.headers);
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

function isCacheablePageRequest(request: Request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return false;
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
    if (!isCacheablePageRequest(request)) {
      return secureResponse(await handler.fetch(request, env, ctx), request);
    }

    const cache = (globalThis as unknown as { caches?: RuntimeCacheStorage }).caches?.default;
    if (cache) {
      const cached = await cache.match(request).catch(() => undefined);
      if (cached) return secureResponse(cached, request);
    }

    const response = secureResponse(await handler.fetch(request, env, ctx), request);
    const cacheable = cacheableHtmlResponse(response);
    if (!cacheable) return response;
    if (cache) ctx.waitUntil(cache.put(request, cacheable.clone()).catch(() => undefined));
    return cacheable;
  },
};

export default worker;
