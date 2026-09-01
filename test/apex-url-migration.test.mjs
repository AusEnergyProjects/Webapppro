import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APEX_EXACT_ROUTE_CONTRACT,
  APEX_BLOG_CONSOLIDATION_CANDIDATES,
  APEX_URL_MIGRATION_CONTRACT,
  EXPECTED_APEX_SITEMAP,
  assertApexCutoverReady,
  buildApexMigrationInventory,
  resolveApexMigrationPath,
} from "../scripts/lib/apex-url-migration-contract.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");

test("captured apex contract covers all 249 sitemap routes exactly once", () => {
  assert.equal(EXPECTED_APEX_SITEMAP.totalPaths, 249);
  assert.equal(EXPECTED_APEX_SITEMAP.blogArticlePaths, 229);
  assert.equal(EXPECTED_APEX_SITEMAP.nonBlogPaths, 20);
  assert.match(EXPECTED_APEX_SITEMAP.sortedPathSha256, /^[a-f0-9]{64}$/);
  assert.equal(APEX_EXACT_ROUTE_CONTRACT.length, 20);
  assert.equal(new Set(APEX_EXACT_ROUTE_CONTRACT.map((entry) => entry.sourcePath)).size, 20);
  assert.equal(APEX_URL_MIGRATION_CONTRACT.length, 249);
  assert.equal(new Set(APEX_URL_MIGRATION_CONTRACT.map((entry) => entry.sourcePath)).size, 249);
  assert.equal(APEX_URL_MIGRATION_CONTRACT.filter((entry) => entry.sourcePath.startsWith("/blog/")).length, 229);
  assert.equal(APEX_URL_MIGRATION_CONTRACT.some((entry) => entry.action === "unmapped"), false);
});

test("ready page destinations exist and redirects remain one hop", () => {
  for (const entry of APEX_EXACT_ROUTE_CONTRACT.filter((route) => route.status === "ready")) {
    assert.ok(entry.targetPath, `${entry.sourcePath} must have a target`);
    const segments = entry.targetPath === "/" ? [] : entry.targetPath.slice(1).split("/");
    const pageFile = path.join(root, "src", "app", ...segments, "page.tsx");
    assert.equal(fs.existsSync(pageFile), true, `Missing target page for ${entry.sourcePath}: ${pageFile}`);

    if (entry.action === "permanent_redirect") {
      const sourceSegments = entry.sourcePath.slice(1).split("/");
      const sourceFile = path.join(root, "src", "app", ...sourceSegments, "page.tsx");
      assert.equal(fs.existsSync(sourceFile), true, `Missing redirect source for ${entry.sourcePath}`);
      assert.match(
        fs.readFileSync(sourceFile, "utf8"),
        new RegExp(`permanentRedirect\\(\\"${entry.targetPath.replaceAll("/", "\\/")}\\"\\)`),
      );
    }
  }

  assert.deepEqual(resolveApexMigrationPath("/schedule-call"), {
    sourcePath: "/schedule-call",
    targetPath: "/book-an-assessment",
    action: "permanent_redirect",
    status: "ready",
    canonicalOwner: "target",
    indexable: false,
    sitemap: false,
    note: "Consolidate the legacy call URL into the current booking page.",
  });
  assert.equal(resolveApexMigrationPath("/privacy-policy").targetPath, "/privacy");
  assert.notEqual(resolveApexMigrationPath("/schedule-call").targetPath, "/");
  assert.notEqual(resolveApexMigrationPath("/privacy-policy").targetPath, "/");
});

test("legacy articles and unknown URLs fail closed", () => {
  const inventory = buildApexMigrationInventory([
    "/",
    "/faq",
    "/blog/example-legacy-article",
    "/new-unmapped-route",
  ]);
  assert.equal(inventory[0].status, "pending_review");
  assert.equal(inventory[1].status, "pending_review");
  assert.equal(inventory[2].status, "ready");
  assert.equal(inventory[3].status, "blocked");
  assert.throws(() => assertApexCutoverReady(inventory), /Apex cutover is blocked by 3 unresolved URLs/);
});

test("the current contract cannot declare cutover ready", () => {
  assert.throws(() => assertApexCutoverReady(APEX_URL_MIGRATION_CONTRACT), /unresolved URLs/);
});

test("duplicate-title blogs stay proposed until evidence and target content are reviewed", () => {
  assert.equal(APEX_BLOG_CONSOLIDATION_CANDIDATES.length, 26);
  const manifestPaths = new Set(APEX_URL_MIGRATION_CONTRACT.map((entry) => entry.sourcePath));
  for (const [sourcePath, targetPath] of APEX_BLOG_CONSOLIDATION_CANDIDATES) {
    assert.equal(manifestPaths.has(sourcePath), true, `Missing duplicate source ${sourcePath}`);
    assert.equal(manifestPaths.has(targetPath), true, `Missing duplicate target ${targetPath}`);
    const entry = resolveApexMigrationPath(sourcePath);
    assert.equal(entry.action, "proposed_redirect");
    assert.equal(entry.status, "pending_review");
    assert.equal(entry.targetPath, targetPath);
  }
});

test("redirects are direct, path-only and never blanket homepage redirects", () => {
  const redirects = APEX_URL_MIGRATION_CONTRACT.filter((entry) => entry.action === "permanent_redirect");
  const redirectSources = new Set(redirects.map((entry) => entry.sourcePath));
  for (const entry of redirects) {
    assert.ok(entry.targetPath?.startsWith("/"));
    assert.equal(entry.targetPath.includes("?"), false);
    assert.equal(entry.targetPath.includes("#"), false);
    assert.notEqual(entry.targetPath, "/");
    assert.equal(redirectSources.has(entry.targetPath), false, `Redirect chain starts at ${entry.sourcePath}`);
  }
});
