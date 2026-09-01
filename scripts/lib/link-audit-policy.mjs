const RESERVED_EXAMPLE_HOSTS = new Set([
  "example.com",
  "example.net",
  "example.org",
]);

const NON_NAVIGABLE_SERVICE_URLS = new Set([
  "https://oauth2.googleapis.com/token",
  "https://identity.xero.com/connect/token",
  "https://secure.myob.com/oauth2/v1/authorize",
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  "https://login.microsoftonline.com/common/oauth2/v2.0/token",
]);

const AUTOMATION_BLOCKED_LINK_RESPONSES = new Map([
  ["https://www.facebook.com/ausenergyassessments/", new Set([400])],
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

export function linkResponseIsAutomationBlocked(kind, status, url = "") {
  if (kind !== "link") return false;
  const code = Number(status);
  if ([401, 403, 405, 429].includes(code)) return true;
  return AUTOMATION_BLOCKED_LINK_RESPONSES.get(url)?.has(code) || false;
}

export function linkResponseIsBroken(kind, status, apiShapeValid = true, url = "") {
  const code = Number(status);
  if (kind === "page") return code !== 200;
  if (kind === "api") return code !== 200 || !apiShapeValid;
  const automationBlocked = linkResponseIsAutomationBlocked(kind, code, url);
  return (code >= 400 && !automationBlocked) || !apiShapeValid;
}

export function combineLinkAuditAttempts(first, retried, kind = first?.kind) {
  const firstAttempt = {
    status: first.status,
    broken: first.broken,
    unverified: first.unverified,
    error: first.error,
    errorCode: first.errorCode,
    failureDisposition: first.failureDisposition,
  };
  if (!retried.unverified) return { ...retried, retried: true, firstAttempt };

  const firstConfirmedFailure = first.broken || first.failureDisposition === "broken";
  const broken = firstConfirmedFailure || kind !== "link" || retried.failureDisposition === "broken";
  return {
    ...retried,
    broken,
    unverified: !broken,
    failureDisposition: broken ? "broken" : retried.failureDisposition,
    retried: true,
    firstAttempt,
  };
}
