import path from "node:path";

export const APEX_CUTOVER_PHASES = new Set(["candidate", "post-cutover"]);
export const LEGACY_ANALYTICS_MEASUREMENT_ID = "G-3PGGJ0JX4H";
const MAX_EXTERNAL_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

function normaliseDnsRecordName(value) {
  return String(value || "").trim().toLowerCase().replace(/\.+$/u, "");
}

function normaliseRoutingValue(value, type) {
  const recordType = String(type || "").toUpperCase();
  if (recordType === "CNAME") return normaliseDnsRecordName(value);
  return String(value || "").trim();
}

function sameDnsValues(actual, expected) {
  const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right));
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

function isIpv4(value) {
  const parts = String(value || "").split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255);
}

export function publicResolverRoutingTtlEvidenceIsValid(observations, {
  expectedResolvers,
  expectedValues,
  maxTtl,
  name,
  type,
}) {
  const expectedName = normaliseDnsRecordName(name);
  const expectedType = String(type || "").toUpperCase();
  const resolvers = [...new Set((expectedResolvers || []).map(normaliseDnsRecordName).filter(Boolean))];
  if (!expectedName || !["A", "CNAME"].includes(expectedType) || resolvers.length !== 2) return false;
  if (!Number.isInteger(maxTtl) || maxTtl <= 0 || !Array.isArray(observations)) return false;
  if (expectedValues !== null && (!Array.isArray(expectedValues) || expectedValues.length === 0)) return false;

  const evidenceByResolver = new Map();
  for (const observation of observations) {
    const resolver = normaliseDnsRecordName(observation?.resolver);
    if (!resolver || evidenceByResolver.has(resolver)) return false;
    evidenceByResolver.set(resolver, observation);
  }
  if (evidenceByResolver.size !== resolvers.length) return false;

  const explicitValues = Array.isArray(expectedValues)
    ? expectedValues.map((value) => normaliseRoutingValue(value, expectedType))
    : null;
  let consensusValues = null;
  for (const resolver of resolvers) {
    const observation = evidenceByResolver.get(resolver);
    if (
      normaliseDnsRecordName(observation?.name) !== expectedName
      || String(observation?.type || "").toUpperCase() !== expectedType
      || !Array.isArray(observation?.records)
      || observation.records.length === 0
    ) return false;

    const values = [];
    for (const record of observation.records) {
      if (
        normaliseDnsRecordName(record?.name) !== expectedName
        || String(record?.type || "").toUpperCase() !== expectedType
        || !Number.isInteger(record?.ttl)
        || record.ttl < 0
        || record.ttl > maxTtl
      ) return false;
      const value = normaliseRoutingValue(record?.value, expectedType);
      if ((expectedType === "A" && !isIpv4(value)) || (expectedType === "CNAME" && !value)) return false;
      values.push(value);
    }

    const requiredValues = explicitValues || consensusValues;
    if (requiredValues && !sameDnsValues(values, requiredValues)) return false;
    consensusValues ??= values;
  }
  return true;
}

export function normaliseOrigin(value, label) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be an absolute HTTPS origin.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an absolute HTTPS origin with no path, query or credentials.`);
  }
  return url.origin;
}

export function parseCutoverArguments(argv, cwd = process.cwd()) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    const value = separator === -1 ? "true" : argument.slice(separator + 1);
    values.set(key, value);
  }

  const required = [
    "candidate-origin",
    "expected-apex-origin",
    "expected-release",
    "dns-baseline",
    "external-evidence",
    "phase",
  ];
  const missing = required.filter((key) => !String(values.get(key) || "").trim());
  if (missing.length) {
    throw new Error(`Missing required cutover arguments: ${missing.join(", ")}`);
  }

  const phase = values.get("phase");
  if (!APEX_CUTOVER_PHASES.has(phase)) {
    throw new Error(`phase must be one of: ${[...APEX_CUTOVER_PHASES].join(", ")}`);
  }

  const expectedRelease = String(values.get("expected-release")).trim();
  if (!/^[a-f0-9]{40}$/i.test(expectedRelease)) {
    throw new Error("expected-release must be the exact 40-character Git commit SHA.");
  }

  const candidateOrigin = normaliseOrigin(values.get("candidate-origin"), "candidate-origin");
  const expectedApexOrigin = normaliseOrigin(values.get("expected-apex-origin"), "expected-apex-origin");
  if (phase === "post-cutover" && candidateOrigin !== expectedApexOrigin) {
    throw new Error("candidate-origin must equal expected-apex-origin during post-cutover verification.");
  }

  return {
    candidateOrigin,
    expectedApexOrigin,
    expectedRelease: expectedRelease.toLowerCase(),
    dnsBaselinePath: path.resolve(cwd, values.get("dns-baseline")),
    externalEvidencePath: path.resolve(cwd, values.get("external-evidence")),
    phase,
    reportOnly: values.get("report-only") === "true",
  };
}

export function canonicalFromHtml(html) {
  const match = String(html || "").match(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i)
    || String(html || "").match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']canonical["'][^>]*>/i);
  return match?.[1] || null;
}

export function openGraphUrlFromHtml(html) {
  const match = String(html || "").match(/<meta\b[^>]*(?:property|name)=["']og:url["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i)
    || String(html || "").match(/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*(?:property|name)=["']og:url["'][^>]*>/i);
  return match?.[1] || null;
}

export function hasNoindexDirective(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((directive) => directive.trim().toLowerCase().replace(/^(?:googlebot|bingbot):\s*/, ""))
    .some((directive) => directive === "noindex" || directive === "none");
}

export function hasNoindex(html) {
  const searchRobotNames = new Set(["robots", "googlebot", "bingbot"]);
  for (const match of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map();
    for (const attribute of match[0].matchAll(/\b([a-z-]+)\s*=\s*["']([^"']*)["']/gi)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2]);
    }
    const name = String(attributes.get("name") || attributes.get("property") || "").toLowerCase();
    if (searchRobotNames.has(name) && hasNoindexDirective(attributes.get("content"))) return true;
  }
  return false;
}

export function robotsBlocksSearchCrawlers(robots) {
  let appliesToSearch = false;
  let groupHasDirective = false;
  for (const rawLine of String(robots || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      if (groupHasDirective) {
        appliesToSearch = false;
        groupHasDirective = false;
      }
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (groupHasDirective) {
        appliesToSearch = false;
        groupHasDirective = false;
      }
      appliesToSearch ||= ["*", "googlebot", "bingbot"].includes(value.toLowerCase());
    } else {
      groupHasDirective = true;
      if (field === "disallow" && appliesToSearch && /^\/\*?$/.test(value)) return true;
    }
  }
  return false;
}

export function dmarcRecordSetIsValid(records) {
  if (!Array.isArray(records) || records.length !== 1 || typeof records[0] !== "string") return false;

  const segments = records[0]
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return false;

  const tags = new Map();
  for (const segment of segments) {
    const separator = segment.indexOf("=");
    if (separator <= 0) return false;
    const name = segment.slice(0, separator).trim().toLowerCase();
    const value = segment.slice(separator + 1).trim();
    if (!/^[a-z][a-z0-9_]*$/i.test(name) || !value || tags.has(name)) return false;
    tags.set(name, value);
  }

  return segments[0].toLowerCase() === "v=dmarc1"
    && tags.get("v")?.toLowerCase() === "dmarc1"
    && /^(?:none|quarantine|reject)$/i.test(tags.get("p") || "");
}

export function extractXmlLocations(xml) {
  return [...String(xml || "").matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

export function expectedRedirectUrl(origin, targetPath, query = "") {
  const url = new URL(targetPath, `${origin}/`);
  url.search = query;
  return url.toString();
}

export function evaluateExternalEvidence(evidence, {
  candidateOrigin,
  expectedApexOrigin,
  expectedRelease,
  phase = "candidate",
  now = Date.now(),
}) {
  const expectedHost = new URL(expectedApexOrigin).hostname;
  const reviewedAt = Date.parse(String(evidence?.reviewedAt || ""));
  const evidenceAge = Number.isFinite(reviewedAt) ? now - reviewedAt : Number.POSITIVE_INFINITY;
  const callbacks = evidence?.oauthCallbacks || {};
  const requiredCallbackProviders = [
    "xero",
    "myob",
    "quickbooks",
    "google_calendar",
    "microsoft_calendar",
  ];
  const checks = [
    ["evidence_candidate_origin", evidence?.candidateOrigin === candidateOrigin],
    ["evidence_expected_apex_origin", evidence?.expectedApexOrigin === expectedApexOrigin],
    ["evidence_release", String(evidence?.expectedRelease || "").toLowerCase() === expectedRelease],
    ["evidence_fresh", evidenceAge >= -5 * 60 * 1000 && evidenceAge <= MAX_EXTERNAL_EVIDENCE_AGE_MS],
    ["search_console_property", evidence?.searchConsole?.property === `sc-domain:${expectedHost}`],
    ["search_console_owner", evidence?.searchConsole?.ownerVerified === true],
    ...(phase === "post-cutover" ? [["search_console_apex_sitemap_submitted", evidence?.searchConsole?.newSitemapSubmitted === true]] : []),
    [
      "google_business_profile_continuity",
      evidence?.googleBusinessProfile?.continuityVerified === true
        && evidence?.googleBusinessProfile?.replacementProfileRequired === false,
    ],
    ["destination_apex_attached", evidence?.destination?.apexAttached === true],
    ["destination_www_attached", evidence?.destination?.wwwAttached === true],
    ["destination_tls_verified", evidence?.destination?.tlsVerified === true],
    [
      "canonical_alias_redirect_state",
      evidence?.destination?.canonicalAliasRedirectsEnabled === (phase === "post-cutover"),
    ],
    [
      "analytics_continuity",
      evidence?.analytics?.destinationConfigured === true
        && evidence?.analytics?.legacyMeasurementId === LEGACY_ANALYTICS_MEASUREMENT_ID
        && evidence?.analytics?.destinationMeasurementId === evidence?.analytics?.legacyMeasurementId
        && evidence?.analytics?.manualPageViewsOnly === true
        && evidence?.analytics?.historyPageViewsDisabled === true,
    ],
    ["firebase_apex_authorised", evidence?.firebase?.authorisedDomains?.includes(expectedHost) === true],
    ["firebase_www_authorised", evidence?.firebase?.authorisedDomains?.includes(`www.${expectedHost}`) === true],
    ["critical_flow_origin", evidence?.criticalFlows?.origin === candidateOrigin],
    ["booking_flow_verified", evidence?.criticalFlows?.bookingCalendarAndEmails === true],
    ["quote_link_verified", evidence?.criticalFlows?.quoteLink === true],
    ["dns_baseline_approved", evidence?.dns?.baselineApproved === true],
    ["dns_routing_ttl_control_plane_verified", evidence?.dns?.routingTtlControlPlaneVerified === true],
    ["rollback_ready", evidence?.dns?.rollbackReady === true],
    ...requiredCallbackProviders.map((provider) => [
      `oauth_callback_${provider}`,
      callbacks[provider]?.status === "not-configured"
        ? callbacks[provider]?.callback === null
        : callbacks[provider]?.status === "configured"
          && callbacks[provider]?.callback === `${expectedApexOrigin}/api/trade-integrations/callback/${provider}`,
    ]),
  ];

  return checks.map(([id, passed]) => ({ id, passed: Boolean(passed) }));
}

export function summariseCutoverReport({
  sourceChecks,
  candidateChecks,
  externalChecks,
  postCutoverChecks,
  phase = "post-cutover",
}) {
  const passed = (checks) => checks.every((check) => check.passed);
  const sourceReady = passed(sourceChecks);
  const candidateReady = passed(candidateChecks);
  const externalReady = passed(externalChecks);
  const postCutoverReady = passed(postCutoverChecks);
  const readyForDnsChange = sourceReady && candidateReady && externalReady;
  return {
    sourceReady,
    candidateReady,
    externalReady,
    postCutoverReady,
    readyForDnsChange,
    cutoverReady: phase === "post-cutover" && readyForDnsChange && postCutoverReady,
  };
}
