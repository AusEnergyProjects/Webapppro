import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  APEX_URL_MIGRATION_CONTRACT,
  summariseApexMigrationInventory,
} from "./lib/apex-url-migration-contract.mjs";
import {
  canonicalFromHtml,
  dmarcRecordSetIsValid,
  evaluateExternalEvidence,
  expectedRedirectUrl,
  extractXmlLocations,
  hasNoindex,
  hasNoindexDirective,
  openGraphUrlFromHtml,
  parseCutoverArguments,
  robotsBlocksSearchCrawlers,
  summariseCutoverReport,
} from "./lib/apex-cutover-rehearsal.mjs";
import { tradeQuoteDeliveryPublicOrigin } from "../src/lib/trade-quote-delivery-policy.mjs";

const options = parseCutoverArguments(process.argv.slice(2));
const requestTimeoutMs = 20_000;

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} file does not exist: ${filePath}`);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function source(pathname) {
  return fs.readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : null;
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), ...(detail ? { detail } : {}) };
}

function normalizeDnsName(value) {
  return String(value || "").toLowerCase().replace(/\.$/, "");
}

function sorted(values) {
  return [...values].sort((left, right) => String(left).localeCompare(String(right)));
}

function sameValues(actual, expected) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

async function resolveOr(name, type, fallback = []) {
  try {
    return await dns.resolve(name, type);
  } catch (error) {
    if (["ENODATA", "ENOTFOUND"].includes(error?.code)) return fallback;
    throw error;
  }
}

async function fetchManual(url, timeoutMs = requestTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/json,application/xml,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Australian-Energy-Assessments-Apex-Cutover-Rehearsal/1.0",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function ownedUrlHostFailures(value, expectedOrigin, candidateOrigin, failures) {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      const expectedHost = new URL(expectedOrigin).hostname;
      const candidateHost = new URL(candidateOrigin).hostname;
      const host = url.hostname.toLowerCase();
      const isOwnedHost = host === candidateHost
        || host.endsWith(".ausenergyassessments.com")
        || host === "ausenergyassessments.com";
      if (
        isOwnedHost
        && (url.origin !== expectedOrigin || url.username || url.password || host !== expectedHost)
      ) failures.add(value);
    } catch { /* Non-URL JSON-LD strings do not affect ownership. */ }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => ownedUrlHostFailures(entry, expectedOrigin, candidateOrigin, failures));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => ownedUrlHostFailures(entry, expectedOrigin, candidateOrigin, failures));
  }
}

function jsonLdOwnership(html, expectedOrigin, candidateOrigin) {
  const scripts = [...String(html || "").matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )];
  const failures = new Set();
  let invalidBlocks = 0;
  for (const match of scripts) {
    try {
      ownedUrlHostFailures(JSON.parse(match[1]), expectedOrigin, candidateOrigin, failures);
    } catch {
      invalidBlocks += 1;
    }
  }
  return { blocks: scripts.length, invalidBlocks, wrongOwnedUrls: [...failures] };
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        results[index] = {
          sourcePath: items[index]?.sourcePath || String(items[index]),
          checks: [check("request_completed", false, `${error.name}: ${error.message}`)],
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function inspectContractEntry(entry) {
  const requestUrl = new URL(entry.sourcePath, `${options.candidateOrigin}/`);
  if (entry.action === "permanent_redirect") requestUrl.search = "cutover_audit=1";
  const response = await fetchManual(requestUrl);
  const body = await response.text();
  const checks = [];

  if (entry.action === "preserve") {
    const expectedUrl = new URL(entry.targetPath, `${options.expectedApexOrigin}/`).toString();
    const canonical = canonicalFromHtml(body);
    const openGraphUrl = openGraphUrlFromHtml(body);
    const jsonLd = jsonLdOwnership(
      body,
      options.expectedApexOrigin,
      options.candidateOrigin,
    );
    const responseNoindex = hasNoindex(body)
      || hasNoindexDirective(response.headers.get("x-robots-tag"));
    checks.push(
      check("status_200", response.status === 200, `HTTP ${response.status}`),
      check("indexable", !responseNoindex, "preserved response must not contain a noindex directive"),
      check("canonical_exact", canonical === expectedUrl, canonical || "missing"),
      check("open_graph_url_exact", openGraphUrl === expectedUrl, openGraphUrl || "missing"),
      check("json_ld_present", jsonLd.blocks > 0, `${jsonLd.blocks} blocks`),
      check("json_ld_valid", jsonLd.invalidBlocks === 0, `${jsonLd.invalidBlocks} invalid blocks`),
      check("json_ld_owned_urls_apex", jsonLd.wrongOwnedUrls.length === 0, jsonLd.wrongOwnedUrls.slice(0, 3).join(", ")),
    );
  } else if (entry.action === "permanent_redirect") {
    const location = response.headers.get("location");
    const absoluteLocation = location ? new URL(location, requestUrl).toString() : null;
    const expectedLocation = expectedRedirectUrl(
      options.expectedApexOrigin,
      entry.targetPath,
      requestUrl.searchParams.toString(),
    );
    checks.push(
      check("permanent_status", [301, 308].includes(response.status), `HTTP ${response.status}`),
      check("direct_target", absoluteLocation === expectedLocation, absoluteLocation || "missing Location"),
    );
  } else if (entry.action === "retire") {
    checks.push(
      check("status_404", response.status === 404, `HTTP ${response.status}`),
      check("noindex", hasNoindex(body), "retired response must contain a robots noindex directive"),
    );
  } else {
    checks.push(check("mapped_action", false, `Unexpected action: ${entry.action}`));
  }

  return { sourcePath: entry.sourcePath, action: entry.action, checks };
}

async function inspectIndexableTarget(pathname) {
  const response = await fetchManual(new URL(pathname, `${options.candidateOrigin}/`));
  const body = await response.text();
  const expectedUrl = new URL(pathname, `${options.expectedApexOrigin}/`).toString();
  const jsonLd = jsonLdOwnership(
    body,
    options.expectedApexOrigin,
    options.candidateOrigin,
  );
  const responseNoindex = hasNoindex(body)
    || hasNoindexDirective(response.headers.get("x-robots-tag"));
  return {
    pathname,
    checks: [
      check("status_200", response.status === 200, `HTTP ${response.status}`),
      check("indexable", !responseNoindex, "public target must not contain a noindex directive"),
      check("canonical_exact", canonicalFromHtml(body) === expectedUrl, canonicalFromHtml(body) || "missing"),
      check("open_graph_url_exact", openGraphUrlFromHtml(body) === expectedUrl, openGraphUrlFromHtml(body) || "missing"),
      check("json_ld_present", jsonLd.blocks > 0, `${jsonLd.blocks} blocks`),
      check("json_ld_valid", jsonLd.invalidBlocks === 0, `${jsonLd.invalidBlocks} invalid blocks`),
      check("json_ld_owned_urls_apex", jsonLd.wrongOwnedUrls.length === 0, jsonLd.wrongOwnedUrls.slice(0, 3).join(", ")),
    ],
  };
}

async function inspectCandidate() {
  const routeResults = await mapWithConcurrency(APEX_URL_MIGRATION_CONTRACT, 8, inspectContractEntry);
  const routeChecks = routeResults.flatMap((result) => result.checks.map((entry) => ({
    ...entry,
    id: `route:${result.sourcePath}:${entry.id}`,
  })));

  const canaryPath = "/apex-cutover-canary-this-page-must-not-exist";
  const canaryResponse = await fetchManual(new URL(canaryPath, `${options.candidateOrigin}/`));
  const canaryBody = await canaryResponse.text();
  routeChecks.push(
    check("unknown_canary_404", canaryResponse.status === 404, `HTTP ${canaryResponse.status}`),
    check("unknown_canary_noindex", hasNoindex(canaryBody), "unknown response must contain noindex"),
  );

  const healthResponse = await fetchManual(new URL("/api/health", `${options.candidateOrigin}/`));
  const healthPayload = await healthResponse.json().catch(() => null);
  const releaseIdentity = String(
    healthResponse.headers.get("x-release-id")
      || healthPayload?.release?.gitSha
      || healthPayload?.gitSha
      || "",
  ).toLowerCase();
  routeChecks.push(
    check("health_200", healthResponse.status === 200, `HTTP ${healthResponse.status}`),
    check("release_identity", releaseIdentity === options.expectedRelease, releaseIdentity || "missing"),
  );

  const sitemapResponse = await fetchManual(new URL("/sitemap.xml", `${options.candidateOrigin}/`));
  const sitemapXml = await sitemapResponse.text();
  const sitemapLocations = extractXmlLocations(sitemapXml);
  const sitemapUrls = sitemapLocations.map((value) => new URL(value));
  const sitemapPaths = new Set(sitemapUrls.map((url) => url.pathname));
  const requiredCanonicalPaths = new Set(APEX_URL_MIGRATION_CONTRACT.flatMap((entry) => (
    entry.action === "retire" || !entry.targetPath ? [] : [entry.targetPath]
  )));
  const excludedSourcePaths = APEX_URL_MIGRATION_CONTRACT
    .filter((entry) => entry.action !== "preserve")
    .map((entry) => entry.sourcePath);
  const missingCanonicalPaths = [...requiredCanonicalPaths].filter((pathname) => !sitemapPaths.has(pathname));
  const includedExcludedPaths = excludedSourcePaths.filter((pathname) => sitemapPaths.has(pathname));
  const sitemapOrigins = new Set(sitemapUrls.map((url) => url.origin));
  const sitemapUrlsAreClean = sitemapUrls.every((url) => !url.search && !url.hash);
  const privateSitemapPrefixes = [
    "/account",
    "/creditex",
    "/direct-trade/dashboard",
    "/operations",
    "/quote-review",
    "/rental-report",
  ];
  const includedPrivatePaths = [...sitemapPaths].filter((pathname) => (
    privateSitemapPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ));
  routeChecks.push(
    check("sitemap_200", sitemapResponse.status === 200, `HTTP ${sitemapResponse.status}`),
    check("sitemap_xml", /application\/xml|text\/xml/i.test(sitemapResponse.headers.get("content-type") || ""), sitemapResponse.headers.get("content-type") || "missing"),
    check("sitemap_unique", sitemapLocations.length === new Set(sitemapLocations).size, `${sitemapLocations.length} entries`),
    check("sitemap_apex_only", sitemapOrigins.size === 1 && sitemapOrigins.has(options.expectedApexOrigin), [...sitemapOrigins].join(", ") || "empty"),
    check("sitemap_urls_clean", sitemapUrlsAreClean, "sitemap URLs must not include query strings or fragments"),
    check("sitemap_required_paths", missingCanonicalPaths.length === 0, missingCanonicalPaths.slice(0, 12).join(", ")),
    check("sitemap_excludes_sources", includedExcludedPaths.length === 0, includedExcludedPaths.slice(0, 12).join(", ")),
    check("sitemap_excludes_private_routes", includedPrivatePaths.length === 0, includedPrivatePaths.slice(0, 12).join(", ")),
  );

  const indexableTargetPaths = [...new Set([...requiredCanonicalPaths, ...sitemapPaths])];
  const indexableTargetResults = await mapWithConcurrency(indexableTargetPaths, 8, inspectIndexableTarget);
  routeChecks.push(...indexableTargetResults.flatMap((result) => result.checks.map((entry) => ({
    ...entry,
    id: `target:${result.pathname}:${entry.id}`,
  }))));

  const legacySitemapResponse = await fetchManual(new URL("/sitemap", `${options.candidateOrigin}/`));
  const legacySitemapLocation = legacySitemapResponse.headers.get("location");
  routeChecks.push(
    check("legacy_sitemap_permanent", [301, 308].includes(legacySitemapResponse.status), `HTTP ${legacySitemapResponse.status}`),
    check(
      "legacy_sitemap_target",
      legacySitemapLocation
        ? new URL(legacySitemapLocation, `${options.candidateOrigin}/`).toString() === `${options.expectedApexOrigin}/sitemap.xml`
        : false,
      legacySitemapLocation || "missing Location",
    ),
  );

  const robotsResponse = await fetchManual(new URL("/robots.txt", `${options.candidateOrigin}/`));
  const robots = await robotsResponse.text();
  const advertisedSitemaps = [...robots.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim)].map((match) => match[1]);
  routeChecks.push(
    check("robots_200", robotsResponse.status === 200, `HTTP ${robotsResponse.status}`),
    check("robots_apex_sitemap", advertisedSitemaps.length === 1 && advertisedSitemaps[0] === `${options.expectedApexOrigin}/sitemap.xml`, advertisedSitemaps.join(", ") || "missing"),
    check("robots_allows_search_crawlers", !robotsBlocksSearchCrawlers(robots), "robots.txt must not block Googlebot, Bingbot or all crawlers from the entire site"),
  );

  return routeChecks;
}

async function inspectDns(baseline) {
  const apex = baseline.apex;
  if (normalizeDnsName(apex) !== new URL(options.expectedApexOrigin).hostname) {
    return [check("dns_baseline_matches_expected_apex", false, apex || "missing apex")];
  }
  const nameservers = (await resolveOr(apex, "NS")).map(normalizeDnsName);
  const mailExchanges = (await resolveOr(apex, "MX")).map((entry) => ({
    exchange: normalizeDnsName(entry.exchange),
    priority: entry.priority,
  }));
  const rootTxt = (await resolveOr(apex, "TXT")).map((segments) => segments.join(""));
  const spfRecords = rootTxt.filter((value) => /^v=spf1\b/i.test(value));
  const dkimTxt = (await resolveOr(`${baseline.dkimSelector}._domainkey.${apex}`, "TXT"))
    .map((segments) => segments.join(""));
  const dmarcTxt = (await resolveOr(`_dmarc.${apex}`, "TXT")).map((segments) => segments.join(""));
  const caa = (await resolveOr(apex, "CAA")).map((entry) => `${entry.critical}:${entry.issue || entry.issuewild || entry.iodef || ""}`);
  const currentA = await resolveOr(apex, "A");
  const currentAaaa = await resolveOr(apex, "AAAA");
  const wwwCname = (await resolveOr(`www.${apex}`, "CNAME")).map(normalizeDnsName);
  const compareCname = (await resolveOr(`compare.${apex}`, "CNAME")).map(normalizeDnsName);

  const dnssecResponse = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(apex)}&type=DS`,
    { headers: { accept: "application/dns-json" } },
  );
  const dnssec = await dnssecResponse.json().catch(() => null);
  const dnssecPresent = dnssecResponse.ok
    && dnssec?.AD === true
    && Array.isArray(dnssec?.Answer)
    && dnssec.Answer.some((answer) => answer.type === 43);

  const checks = [
    check("dns_nameservers_preserved", sameValues(nameservers, baseline.nameservers.map(normalizeDnsName)), nameservers.join(", ")),
    check(
      "dns_google_mx_preserved",
      JSON.stringify(mailExchanges.sort((a, b) => a.priority - b.priority || a.exchange.localeCompare(b.exchange)))
        === JSON.stringify(baseline.mailExchanges.map((entry) => ({
          exchange: normalizeDnsName(entry.exchange),
          priority: entry.priority,
        })).sort((a, b) => a.priority - b.priority || a.exchange.localeCompare(b.exchange))),
      mailExchanges.map((entry) => `${entry.priority} ${entry.exchange}`).join(", "),
    ),
    check("dns_spf_preserved", sameValues(spfRecords, baseline.spfRecords), spfRecords.join(" | ") || "missing"),
    check("dns_dkim_preserved", sameValues(dkimTxt, baseline.dkim), dkimTxt.length ? "present" : "missing"),
    check(
      "dns_dmarc_valid",
      dmarcRecordSetIsValid(dmarcTxt),
      dmarcTxt.join(" | ") || "missing",
    ),
    check("dns_caa_preserved", sameValues(caa, baseline.observedCaa || []), caa.join(", ") || "none"),
    check("dnssec_preserved", !baseline.dnssecDsRequired || dnssecPresent, dnssecPresent ? "validated DS" : "missing or unvalidated DS"),
  ];

  if (options.phase === "candidate") {
    checks.push(
      check("no_early_apex_dns_change", sameValues(currentA, baseline.observedApexA), currentA.join(", ")),
      check("no_early_apex_aaaa_change", sameValues(currentAaaa, baseline.observedApexAaaa || []), currentAaaa.join(", ") || "none"),
      check("no_early_www_dns_change", sameValues(wwwCname, [normalizeDnsName(baseline.observedWwwCname)]), wwwCname.join(", ")),
      check("compare_destination_preserved", sameValues(compareCname, [normalizeDnsName(baseline.observedCompareCname)]), compareCname.join(", ")),
    );
  }

  return checks;
}

async function inspectPostCutoverAliases() {
  if (options.phase !== "post-cutover") {
    return [check("post_cutover_checks_run", false, `not run during ${options.phase} phase`)];
  }
  const apexHost = new URL(options.expectedApexOrigin).hostname;
  const testPath = "/team?cutover_audit=1";
  const aliases = [
    ["http_apex", `http://${apexHost}${testPath}`],
    ["http_www", `http://www.${apexHost}${testPath}`],
    ["http_compare", `http://compare.${apexHost}${testPath}`],
    ["https_www", `https://www.${apexHost}${testPath}`],
    ["https_compare", `https://compare.${apexHost}${testPath}`],
  ];
  const checks = [];
  for (const [id, url] of aliases) {
    const response = await fetchManual(url);
    const location = response.headers.get("location");
    checks.push(
      check(`${id}_permanent`, [301, 308].includes(response.status), `HTTP ${response.status}`),
      check(
        `${id}_target`,
        location ? new URL(location, url).toString() === `${options.expectedApexOrigin}${testPath}` : false,
        location || "missing Location",
      ),
    );
  }
  return checks;
}

const dnsBaseline = readJson(options.dnsBaselinePath, "DNS baseline");
const externalEvidence = readJson(options.externalEvidencePath, "External evidence");
const migrationSummary = summariseApexMigrationInventory(APEX_URL_MIGRATION_CONTRACT);
const localHead = gitOutput(["rev-parse", "HEAD"]);
const localStatus = gitOutput(["status", "--porcelain", "--untracked-files=all"]);
const sourceChecks = [
  check("git_head_matches_expected_release", localHead === options.expectedRelease, localHead || "unavailable"),
  check("git_worktree_clean", localStatus === "", localStatus === null ? "unavailable" : "working tree has changes"),
  check("all_contract_urls_mapped", APEX_URL_MIGRATION_CONTRACT.every((entry) => entry.status === "ready"), `${migrationSummary.total} URLs`),
  check("metadata_base_apex", /metadataBase:\s*new URL\(PUBLIC_SITE\.apexUrl\)/.test(source("src/app/layout.tsx")), "layout metadataBase must use apexUrl"),
  check("sitemap_origin_apex", /PUBLIC_SITE\.apexUrl/.test(source("src/app/sitemap.ts")), "sitemap must emit apex URLs"),
  check("robots_origin_apex", /PUBLIC_SITE\.apexUrl/.test(source("src/app/robots.ts")), "robots must advertise the apex sitemap"),
  check("worker_canonical_origin_apex", /CANONICAL_SITE_HOST = new URL\(PUBLIC_SITE\.apexUrl\)\.hostname/.test(source("worker/index.ts")), "worker canonical host must use apexUrl"),
  check("quote_links_accept_apex", tradeQuoteDeliveryPublicOrigin(options.expectedApexOrigin) === options.expectedApexOrigin, tradeQuoteDeliveryPublicOrigin(options.expectedApexOrigin)),
  check("quote_links_default_to_apex", tradeQuoteDeliveryPublicOrigin() === options.expectedApexOrigin, tradeQuoteDeliveryPublicOrigin()),
  check(
    "runtime_absolute_links_use_apex",
    [
      ".env.example",
      "src/lib/customer-plan-document.mjs",
      "src/lib/customer-project-activity-notification-server.ts",
      "src/lib/customer-project-activity-notifications.ts",
      "src/lib/opportunity-notifications.ts",
      "src/lib/opportunity-notification-server.ts",
      "src/lib/public-plan-delivery-server.ts",
      "src/lib/trade-mobile-server.ts",
      "src/lib/trade-calendar-sync-server.ts",
      "src/lib/trade-team-document-expiry-server.ts",
    ].every((pathname) => !source(pathname).includes("compare.ausenergyassessments.com")),
    "runtime links and callback examples must not point customers back to compare",
  ),
];
const candidateChecks = await inspectCandidate();
const externalChecks = [
  ...(await inspectDns(dnsBaseline)),
  check(
    "external_evidence_outside_worktree",
    path.isAbsolute(path.relative(process.cwd(), options.externalEvidencePath))
      || path.relative(process.cwd(), options.externalEvidencePath).startsWith(`..${path.sep}`),
    "passing evidence must be a fresh out-of-worktree artifact created after the candidate release",
  ),
  ...evaluateExternalEvidence(externalEvidence, {
    candidateOrigin: options.candidateOrigin,
    expectedApexOrigin: options.expectedApexOrigin,
    expectedRelease: options.expectedRelease,
    phase: options.phase,
  }),
];
const postCutoverChecks = await inspectPostCutoverAliases();
const readiness = summariseCutoverReport({
  sourceChecks,
  candidateChecks,
  externalChecks,
  postCutoverChecks,
  phase: options.phase,
});

function section(checks) {
  const failures = checks.filter((entry) => !entry.passed);
  return {
    total: checks.length,
    passed: checks.filter((entry) => entry.passed).length,
    failed: failures.length,
    failures: failures.slice(0, 30),
    failuresOmitted: Math.max(0, failures.length - 30),
  };
}

console.log(JSON.stringify({
  phase: options.phase,
  candidateOrigin: options.candidateOrigin,
  expectedApexOrigin: options.expectedApexOrigin,
  expectedRelease: options.expectedRelease,
  migrationSummary,
  source: section(sourceChecks),
  candidate: section(candidateChecks),
  external: section(externalChecks),
  postCutover: section(postCutoverChecks),
  readiness,
}, null, 2));

const requiredReady = options.phase === "post-cutover"
  ? readiness.cutoverReady
  : readiness.readyForDnsChange;
if (!options.reportOnly && !requiredReady) process.exitCode = 1;
