import { createHash } from "node:crypto";
import {
  APEX_EXACT_ROUTE_CONTRACT,
  APEX_URL_MIGRATION_CONTRACT,
  EXPECTED_APEX_SITEMAP,
  assertApexContentContractReady,
  buildApexMigrationInventory,
  summariseApexMigrationInventory,
} from "./lib/apex-url-migration-contract.mjs";

const timeoutMs = 20_000;

function decodeXmlText(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function extractPaths(xml) {
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((match) => {
    const url = new URL(decodeXmlText(match[1].trim()));
    if (url.hostname !== "ausenergyassessments.com") {
      throw new Error(`Unexpected sitemap host: ${url.hostname}`);
    }
    return url.pathname;
  });
}

async function fetchSitemap() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(EXPECTED_APEX_SITEMAP.url, {
      signal: controller.signal,
      headers: { "user-agent": "Australian-Energy-Assessments-Migration-Audit/1.0" },
    });
    if (!response.ok) throw new Error(`Sitemap returned HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

const xml = await fetchSitemap();
const paths = extractPaths(xml);
const uniquePaths = [...new Set(paths)].sort();
const blogArticlePaths = uniquePaths.filter((path) => path.startsWith("/blog/")).length;
const nonBlogPaths = uniquePaths.length - blogArticlePaths;
const sortedPathSha256 = createHash("sha256").update(uniquePaths.join("\n")).digest("hex");
const inventory = buildApexMigrationInventory(uniquePaths);
const summary = summariseApexMigrationInventory(inventory);
const pendingNonBlog = inventory.filter((entry) => (
  !entry.sourcePath.startsWith("/blog/") && entry.status !== "ready"
));
const snapshot = { totalPaths: uniquePaths.length, blogArticlePaths, nonBlogPaths, sortedPathSha256 };
const snapshotMatches = Object.entries(snapshot).every(
  ([key, value]) => EXPECTED_APEX_SITEMAP[key] === value,
);
const exactSourcePaths = new Set(APEX_EXACT_ROUTE_CONTRACT.map((entry) => entry.sourcePath));
const nonBlogContractMatches = uniquePaths
  .filter((path) => !path.startsWith("/blog/"))
  .every((path) => exactSourcePaths.has(path));
const explicitManifestMatches = APEX_URL_MIGRATION_CONTRACT.length === uniquePaths.length
  && APEX_URL_MIGRATION_CONTRACT.every((entry, index) => entry.sourcePath === uniquePaths[index]);

console.log(JSON.stringify({
  source: EXPECTED_APEX_SITEMAP.url,
  capturedAt: EXPECTED_APEX_SITEMAP.capturedAt,
  snapshot,
  snapshotMatches,
  nonBlogContractMatches,
  explicitManifestMatches,
  contentContractReady: inventory.every((entry) => entry.status === "ready"),
  migrationSummary: summary,
  pendingNonBlog,
}, null, 2));

if (!snapshotMatches || !nonBlogContractMatches || !explicitManifestMatches || paths.length !== uniquePaths.length) {
  throw new Error("The live apex sitemap changed or contains duplicate/unmapped paths. Refresh the contract before release.");
}

if (process.argv.includes("--assert-cutover-ready")) {
  throw new Error(
    "This audit proves URL content mapping only. Use rehearse:apex-cutover for operational cutover readiness.",
  );
}

if (process.argv.includes("--assert-content-ready")) {
  assertApexContentContractReady(inventory);
}
