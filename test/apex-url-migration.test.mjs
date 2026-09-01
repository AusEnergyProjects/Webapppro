import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APEX_EXACT_ROUTE_CONTRACT,
  APEX_URL_MIGRATION_CONTRACT,
  EXPECTED_APEX_SITEMAP,
  assertApexContentContractReady,
  buildApexMigrationInventory,
  resolveApexMigrationPath,
} from "../scripts/lib/apex-url-migration-contract.mjs";
import {
  LEGACY_BLOG_REDIRECT_ENTRIES,
  resolveLegacyBlogRedirect,
} from "../src/lib/legacy-blog-redirects.mjs";
import {
  LEGACY_BLOG_RETIREMENT_PATHS,
  isLegacyBlogRetirement,
} from "../src/lib/legacy-blog-retirements.mjs";

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
    if (entry.action === "retire") {
      assert.equal(entry.targetPath, null);
      continue;
    }
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

test("approved legacy articles redirect to reviewed local guides", () => {
  assert.equal(LEGACY_BLOG_REDIRECT_ENTRIES.length, 168);
  assert.equal(
    new Set(LEGACY_BLOG_REDIRECT_ENTRIES.map((entry) => entry.sourcePath)).size,
    LEGACY_BLOG_REDIRECT_ENTRIES.length,
  );

  const approvedSources = new Set(LEGACY_BLOG_REDIRECT_ENTRIES.map((entry) => entry.sourcePath));
  for (const { sourcePath, targetPath } of LEGACY_BLOG_REDIRECT_ENTRIES) {
    const segments = targetPath.slice(1).split("/");
    const targetFile = path.join(root, "src", "app", ...segments, "page.tsx");
    const resolved = resolveApexMigrationPath(sourcePath);

    assert.equal(fs.existsSync(targetFile), true, `Missing reviewed target for ${sourcePath}`);
    assert.equal(resolveLegacyBlogRedirect(sourcePath), targetPath);
    assert.equal(resolved.action, "permanent_redirect");
    assert.equal(resolved.status, "ready");
    assert.equal(resolved.targetPath, targetPath);
    assert.notEqual(targetPath, "/");
    assert.equal(approvedSources.has(targetPath), false, `Redirect chain starts at ${sourcePath}`);
  }

  assert.equal(resolveApexMigrationPath("/blog").targetPath, "/guides");
  assert.equal(resolveApexMigrationPath("/blog").status, "ready");
});

test("every captured legacy article has one explicit redirect or retirement decision", () => {
  const capturedBlogs = APEX_URL_MIGRATION_CONTRACT.filter((entry) => entry.sourcePath.startsWith("/blog/"));
  const redirected = capturedBlogs.filter((entry) => entry.action === "permanent_redirect");
  const retired = capturedBlogs.filter((entry) => entry.action === "retire");
  const redirectPaths = new Set(LEGACY_BLOG_REDIRECT_ENTRIES.map((entry) => entry.sourcePath));
  const retirementPaths = new Set(LEGACY_BLOG_RETIREMENT_PATHS);

  assert.equal(capturedBlogs.length, 229);
  assert.equal(redirected.length, 168);
  assert.equal(retired.length, 61);
  assert.equal(capturedBlogs.every((entry) => entry.status === "ready"), true);
  assert.equal(retirementPaths.size, 61);
  assert.equal([...retirementPaths].some((sourcePath) => redirectPaths.has(sourcePath)), false);

  for (const sourcePath of retirementPaths) {
    assert.equal(isLegacyBlogRetirement(sourcePath), true);
    assert.equal(resolveLegacyBlogRedirect(sourcePath), null);
    assert.deepEqual(resolveApexMigrationPath(sourcePath), {
      sourcePath,
      targetPath: null,
      action: "retire",
      status: "ready",
      canonicalOwner: "none",
      indexable: false,
      sitemap: false,
      note: "Return HTTP 404 because the reviewed legacy article has no honest equivalent destination.",
    });
  }

  const unsupportedCaseStudy = "/blog/case-study--successful-energy-upgrades-in-melbourne-homes-2";
  assert.equal(isLegacyBlogRetirement(unsupportedCaseStudy), true);
  assert.equal(resolveApexMigrationPath(unsupportedCaseStudy).action, "retire");
});

test("uncaptured articles and unknown URLs fail closed", () => {
  const inventory = buildApexMigrationInventory([
    "/",
    "/faq",
    "/blog/example-legacy-article",
    "/new-unmapped-route",
  ]);
  const byPath = new Map(inventory.map((entry) => [entry.sourcePath, entry]));
  assert.equal(byPath.get("/").status, "ready");
  assert.equal(byPath.get("/faq").status, "ready");
  assert.equal(byPath.get("/blog/example-legacy-article").status, "blocked");
  assert.equal(byPath.get("/blog/example-legacy-article").action, "unmapped");
  assert.equal(byPath.get("/new-unmapped-route").status, "blocked");
  assert.throws(() => assertApexContentContractReady(inventory), /Apex content contract is blocked by 2 unresolved URLs/);
});

test("the reviewed sitemap contract declares every captured URL ready", () => {
  assert.equal(assertApexContentContractReady(APEX_URL_MIGRATION_CONTRACT), true);
  assert.equal(APEX_URL_MIGRATION_CONTRACT.every((entry) => entry.status === "ready"), true);
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
