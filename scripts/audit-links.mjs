import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const liveOrigin = process.env.SITE_URL || "https://compare.ausenergyassessments.com";
const timeoutMs = 12_000;
const resourceHintOrigins = new Set([
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
]);
const reservedExampleHosts = new Set(["example.com", "example.net", "example.org"]);

function isAuditableUrl(value) {
  if (value.includes("${")) return false;
  try {
    const { hostname } = new URL(value);
    return !reservedExampleHosts.has(hostname) && !hostname.endsWith(".example");
  } catch {
    return false;
  }
}

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

async function check(entry) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(entry.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36 AEA-Link-Audit/1.0" },
    });
    let apiShapeValid = true;
    if (entry.kind === "api" && response.ok) {
      const payload = await response.clone().json().catch(() => null);
      apiShapeValid = Array.isArray(payload?.plans) && payload.plans.length > 0;
    }
    const broken = response.status === 404 || response.status >= 500 || !apiShapeValid;
    return { ...entry, status: response.status, finalUrl: response.url, broken, apiShapeValid };
  } catch (error) {
    return { ...entry, status: 0, broken: true, error: `${error.name}: ${error.message}` };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < checks.length) results.push(await check(checks[cursor++]));
}
await Promise.all(Array.from({ length: 10 }, () => worker()));

const broken = results.filter((result) => result.broken);
const blocked = results.filter((result) => !result.broken && [401, 403, 405, 429].includes(result.status));
console.log(JSON.stringify({
  checked: results.length,
  passedOrReachable: results.length - broken.length,
  blockedByAutomation: blocked.length,
  broken,
  blocked,
}, null, 2));
if (broken.length) process.exitCode = 1;
