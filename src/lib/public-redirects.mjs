import { resolveLegacyBlogRedirect } from "./legacy-blog-redirects.mjs";

const APEX_ORIGIN = "https://ausenergyassessments.com";
const APEX_HOST = new URL(APEX_ORIGIN).hostname;
export const APEX_CANONICAL_REDIRECTS_ENV = "APEX_CANONICAL_REDIRECTS_ENABLED";
const PUBLIC_ALIAS_HOSTS = new Set([
  "www.ausenergyassessments.com",
  "compare.ausenergyassessments.com",
  "aea-energy-comparison.info294029.chatgpt.site",
]);

const redirectByPath = new Map([
  ["/blog", "/guides"],
  ["/compare/gas", "/gas-compare"],
  ["/e-learning-resources", "/guides"],
  ["/email", "/book-an-assessment"],
  ["/energyupgradeinformation-2", "/guides/home-energy-upgrades"],
  ["/getting-started", "/plan"],
  ["/nathers-existing-homes", "/home-energy-rating-for-existing-homes"],
  ["/nathers-new-homes", "/nathers-for-new-homes"],
  ["/privacy-policy", "/privacy"],
  ["/schedule-call", "/book-an-assessment"],
  ["/sitemap", "/sitemap.xml"],
  ["/surge", "/wattzun"],
]);

export function publicRedirectTarget(requestUrl) {
  const source = new URL(String(requestUrl));
  const sourcePath = source.pathname === "/" ? "/" : source.pathname.replace(/\/+$/, "");
  const targetPath = redirectByPath.get(sourcePath)
    || (sourcePath.startsWith("/blog/")
      ? resolveLegacyBlogRedirect(sourcePath)
      : null);
  if (!targetPath) return null;

  const target = new URL(targetPath, `${APEX_ORIGIN}/`);
  target.search = source.search;
  return target.toString();
}

export function canonicalPublicTarget(requestUrl, method = "GET") {
  if (!["GET", "HEAD"].includes(String(method).toUpperCase())) return null;

  const source = new URL(String(requestUrl));
  if (source.pathname === "/api" || source.pathname.startsWith("/api/")) return null;

  const isCanonicalHost = source.hostname === APEX_HOST;
  if (isCanonicalHost && source.protocol === "https:") return null;
  if (!isCanonicalHost && !PUBLIC_ALIAS_HOSTS.has(source.hostname)) return null;

  source.protocol = "https:";
  source.hostname = APEX_HOST;
  source.port = "";
  return source.toString();
}

export function canonicalAliasRedirectsEnabled(environment) {
  if (!environment || typeof environment !== "object") return false;
  return String(environment[APEX_CANONICAL_REDIRECTS_ENV] || "").trim().toLowerCase() === "true";
}

export function shouldApplyCanonicalHostRedirect(requestUrl, environment) {
  const source = new URL(String(requestUrl));
  const isPlainHttpApex = source.hostname === APEX_HOST && source.protocol === "http:";
  return isPlainHttpApex || canonicalAliasRedirectsEnabled(environment);
}
