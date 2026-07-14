import handler from "vinext/server/app-router-entry";

const HTML_CACHE_CONTROL = "public, max-age=0, s-maxage=120, stale-while-revalidate=600";

type RuntimeCacheStorage = CacheStorage & { default?: Cache };

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
    if (!isCacheablePageRequest(request)) return handler.fetch(request, env, ctx);

    const cache = (globalThis as unknown as { caches?: RuntimeCacheStorage }).caches?.default;
    if (cache) {
      const cached = await cache.match(request).catch(() => undefined);
      if (cached) return cached;
    }

    const response = await handler.fetch(request, env, ctx);
    const cacheable = cacheableHtmlResponse(response);
    if (!cacheable) return response;
    if (cache) ctx.waitUntil(cache.put(request, cacheable.clone()).catch(() => undefined));
    return cacheable;
  },
};

export default worker;
