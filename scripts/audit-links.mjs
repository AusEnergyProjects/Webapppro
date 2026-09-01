import fs from "node:fs";
import path from "node:path";
import {
  combineLinkAuditAttempts,
  isAuditableUrl,
  linkNetworkFailureDisposition,
  linkResponseIsAutomationBlocked,
  linkResponseIsBroken,
} from "./lib/link-audit-policy.mjs";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const liveOrigin = process.env.SITE_URL || "https://compare.ausenergyassessments.com";
const timeoutMs = 12_000;
const retryTimeoutMs = 30_000;
const resourceHintOrigins = new Set([
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

const sourceFiles = walk(sourceRoot).filter((file) => /\.(?:js|mjs|ts|tsx)$/.test(file));
const literalUrls = [...new Set(sourceFiles.flatMap((file) => {
  const source = fs.readFileSync(file, "utf8");
  return [...source.matchAll(/https:\/\/[^\s"')]+/g)].map((match) => match[0].replace(/[.,;]$/, ""));
}))].filter((url) => !resourceHintOrigins.has(url) && isAuditableUrl(url));

const checks = [
  { label: "live electricity comparer", url: new URL("/compare", liveOrigin).href, kind: "page" },
  { label: "live gas comparer", url: new URL("/gas-compare", liveOrigin).href, kind: "page" },
  { label: "electricity plan API", url: new URL("/api/electricity-plans?postcode=3000&customerType=RESIDENTIAL", liveOrigin).href, kind: "api" },
  { label: "gas plan API", url: new URL("/api/gas-plans?postcode=3000&annualMj=58000&usageProfile=heating&includeConditional=false", liveOrigin).href, kind: "api" },
  ...literalUrls.map((url) => ({ label: "source link", url, kind: "link" })),
];

async function checkOnce(entry, attemptTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
  try {
    const response = await fetch(entry.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36 Australian-Energy-Assessments-Link-Audit/1.0" },
    });
    let apiShapeValid = true;
    if (entry.kind === "api" && response.ok) {
      const payload = await response.json().catch(() => null);
      apiShapeValid = Array.isArray(payload?.plans) && payload.plans.length > 0;
    } else {
      await response.body?.cancel().catch(() => {});
    }
    const broken = linkResponseIsBroken(entry.kind, response.status, apiShapeValid, entry.url);
    return {
      ...entry,
      status: response.status,
      finalUrl: response.url,
      broken,
      unverified: false,
      retryable: response.status === 429 || response.status >= 500,
      apiShapeValid,
    };
  } catch (error) {
    return {
      ...entry,
      status: 0,
      broken: false,
      unverified: true,
      error: `${error.name}: ${error.message}`,
      errorCode: error?.cause?.code || error?.code || null,
      failureDisposition: linkNetworkFailureDisposition(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function check(entry) {
  const first = await checkOnce(entry, timeoutMs);
  if (!first.unverified && !first.retryable) return first;

  const retried = await checkOnce(entry, retryTimeoutMs);
  return combineLinkAuditAttempts(first, retried, entry.kind);
}

const results = [];
for (const entry of checks.filter((item) => item.kind !== "link")) {
  results.push(await check(entry));
}

const linkChecks = checks.filter((item) => item.kind === "link");
let linkCursor = 0;
async function linkWorker() {
  while (linkCursor < linkChecks.length) results.push(await check(linkChecks[linkCursor++]));
}
await Promise.all(Array.from({ length: 6 }, () => linkWorker()));

const broken = results.filter((result) => result.broken);
const unverified = results.filter((result) => result.unverified);
const blocked = results.filter((result) => (
  !result.broken
  && linkResponseIsAutomationBlocked(result.kind, result.status, result.url)
));
const verbose = process.argv.includes("--verbose");
const report = {
  checked: results.length,
  reachable: results.filter((result) => result.status > 0).length,
  passed: results.filter((result) => !result.broken && !result.unverified && !blocked.includes(result)).length,
  blockedByAutomation: blocked.length,
  unverifiedByNetwork: unverified.length,
  broken,
  unverified,
};
if (verbose) report.blocked = blocked;
console.log(JSON.stringify(report, null, 2));
if (broken.length || (process.argv.includes("--strict-network") && unverified.length)) {
  process.exitCode = 1;
}
