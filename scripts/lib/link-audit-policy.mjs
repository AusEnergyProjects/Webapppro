const RESERVED_EXAMPLE_HOSTS = new Set([
  "example.com",
  "example.net",
  "example.org",
]);

const NON_NAVIGABLE_SERVICE_URLS = new Set([
  "https://oauth2.googleapis.com/token",
]);

const FATAL_NETWORK_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ENOTFOUND",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

export function isAuditableUrl(value) {
  if (typeof value !== "string" || value.includes("${")) return false;
  if (NON_NAVIGABLE_SERVICE_URLS.has(value)) return false;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !hostname || hostname.includes("..")) return false;
    if (!/^[a-z0-9.-]+$/.test(hostname)) return false;
    if (
      RESERVED_EXAMPLE_HOSTS.has(hostname)
      || [...RESERVED_EXAMPLE_HOSTS].some((reserved) => hostname.endsWith(`.${reserved}`))
      || hostname.endsWith(".example")
    ) return false;
    if (hostname.endsWith(".invalid")) return false;
    return true;
  } catch {
    return false;
  }
}

export function linkNetworkFailureDisposition(error) {
  const code = String(error?.cause?.code || error?.code || "").toUpperCase();
  return FATAL_NETWORK_CODES.has(code) ? "broken" : "unverified";
}

export function linkResponseIsBroken(kind, status, apiShapeValid = true) {
  const code = Number(status);
  if (kind === "page") return code !== 200;
  if (kind === "api") return code !== 200 || !apiShapeValid;
  const automationBlocked = [401, 403, 405, 429].includes(code);
  return (code >= 400 && !automationBlocked) || !apiShapeValid;
}
