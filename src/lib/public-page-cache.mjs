import { PUBLIC_SITE_SEARCH_ENTRIES } from "./public-site-search.ts";
import { releaseIdentityFromEnvironment } from "./release-identity.mjs";

const publicPaths = new Set(PUBLIC_SITE_SEARCH_ENTRIES.map(entry => entry.path));

// Only anonymous, ordinary documents from the published public inventory share
// an edge entry. RSC navigation, query-dependent pages and private routes do not.
export function publicPageCacheKey(request, environment) {
  const url = new URL(request.url);
  const release = releaseIdentityFromEnvironment(environment);
  if (!release || request.method !== "GET" || url.search
    || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !publicPaths.has(url.pathname)
    || request.headers.has("authorization") || request.headers.has("cookie")
    || request.headers.has("rsc") || request.headers.has("next-router-state-tree")
    || request.headers.has("next-router-prefetch") || request.headers.has("next-router-segment-prefetch")
    || request.headers.has("next-url")
    || !(request.headers.get("accept") || "").includes("text/html")) return null;
  // Releases cannot reuse an older HTML document pointing at retired chunks.
  url.searchParams.set("__aea_document_release", release);
  return new Request(url, { headers: { Accept: "text/html" } });
}

export function publicPageCacheResponse(response) {
  const policy = response.headers.get("cache-control") || "";
  if (!response.ok || response.headers.has("set-cookie")
    || /(?:private|no-store)/i.test(policy)
    || !(response.headers.get("content-type") || "").includes("text/html")) return null;
  const headers = new Headers(response.headers);
  // The key admits a single document representation; framework RSC variants
  // never enter this cache. Keep the original Vary header on the client response.
  headers.delete("Vary");
  headers.set("Cache-Control", "public, max-age=120");
  return new Response(response.body, { status: response.status, headers });
}
