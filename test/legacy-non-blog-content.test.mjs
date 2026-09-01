import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APEX_URL_MIGRATION_CONTRACT,
  assertApexContentContractReady,
  resolveApexMigrationPath,
} from "../scripts/lib/apex-url-migration-contract.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..");

const pageFile = (route) => path.join(
  root,
  "src",
  "app",
  ...(route === "/" ? [] : route.slice(1).split("/")),
  "page.tsx",
);

const readPage = (route) => fs.readFileSync(pageFile(route), "utf8");
const publicSite = fs.readFileSync(path.join(root, "src", "lib", "public-site.ts"), "utf8");

const expectedDecisions = new Map([
  ["/", { action: "preserve", targetPath: "/" }],
  ["/commercial-and-industrial-assessments", { action: "preserve", targetPath: "/commercial-and-industrial-assessments" }],
  ["/communities-schools", { action: "preserve", targetPath: "/communities-schools" }],
  ["/e-learning-resources", { action: "permanent_redirect", targetPath: "/guides" }],
  ["/email", { action: "permanent_redirect", targetPath: "/book-an-assessment" }],
  ["/energyupgradeinformation-2", { action: "permanent_redirect", targetPath: "/guides/home-energy-upgrades" }],
  ["/minimum-rental-standards", { action: "preserve", targetPath: "/minimum-rental-standards" }],
  ["/referral-program", { action: "retire", targetPath: null }],
  ["/team", { action: "preserve", targetPath: "/team" }],
  ["/trusted-suppliers", { action: "preserve", targetPath: "/trusted-suppliers" }],
]);

const preservedPages = [
  "/",
  "/commercial-and-industrial-assessments",
  "/communities-schools",
  "/minimum-rental-standards",
  "/team",
  "/trusted-suppliers",
];

const redirects = new Map([
  ["/e-learning-resources", "/guides"],
  ["/email", "/book-an-assessment"],
  ["/energyupgradeinformation-2", "/guides/home-energy-upgrades"],
]);

const portraitFiles = [
  "dan-markov.png",
  "gary-morris.jpg",
  "jabez-tang.jpg",
  "james-william.jpg",
  "joshua-lewis.jpg",
  "katja-rosic.jpg",
  "kris-chen.jpg",
  "malcolm-guy.jpg",
  "max-charters.jpg",
  "olen-dymke.png",
  "sarah-mosseveld.jpg",
  "thomas-curtis.jpg",
];

test("the ten reviewed non-blog routes have explicit ready migration decisions", () => {
  for (const [sourcePath, expected] of expectedDecisions) {
    const decision = resolveApexMigrationPath(sourcePath);
    assert.equal(decision.status, "ready", `${sourcePath} must be ready`);
    assert.equal(decision.action, expected.action, `${sourcePath} action`);
    assert.equal(decision.targetPath, expected.targetPath, `${sourcePath} target`);

    if (expected.action === "preserve") {
      assert.equal(decision.canonicalOwner, "apex", `${sourcePath} canonical owner`);
      assert.equal(decision.indexable, true, `${sourcePath} indexability`);
      assert.equal(decision.sitemap, true, `${sourcePath} sitemap inclusion`);
    } else if (expected.action === "permanent_redirect") {
      assert.equal(decision.canonicalOwner, "target", `${sourcePath} canonical owner`);
      assert.equal(decision.indexable, false, `${sourcePath} indexability`);
      assert.equal(decision.sitemap, false, `${sourcePath} sitemap inclusion`);
    } else {
      assert.equal(decision.canonicalOwner, "none", `${sourcePath} canonical owner`);
      assert.equal(decision.indexable, false, `${sourcePath} indexability`);
      assert.equal(decision.sitemap, false, `${sourcePath} sitemap inclusion`);
    }
  }

  assert.equal(assertApexContentContractReady(APEX_URL_MIGRATION_CONTRACT), true);
});

test("preserved pages own their canonical, schema and human public copy", () => {
  assert.match(publicSite, /export function buildApexMetadata/);
  assert.match(publicSite, /alternates: \{ canonical \}/);
  for (const route of preservedPages) {
    const file = pageFile(route);
    assert.equal(fs.existsSync(file), true, `Missing preserved page ${file}`);
    const source = readPage(route);

    assert.match(source, /alternates\s*:\s*\{\s*canonical\b|buildApexMetadata\s*\(/, `${route} needs a canonical`);
    assert.match(source, /<JsonLd\b/, `${route} needs rendered structured data`);
    assert.match(source, /Australian Energy Assessments/, `${route} needs the full public business name`);
    assert.doesNotMatch(source, /\bAEA\b/, `${route} must not use the public acronym`);
    assert.doesNotMatch(source, /[\u2013\u2014]/, `${route} must not use en or em dashes`);
    assert.doesNotMatch(
      source,
      /future[\s-]+proof|look no further|sustainable journey|holistic approach/i,
      `${route} contains generic AI-style copy`,
    );
  }
});

test("legacy redirects are direct route-level permanent redirects", () => {
  for (const [sourcePath, targetPath] of redirects) {
    const file = pageFile(sourcePath);
    assert.equal(fs.existsSync(file), true, `Missing redirect source ${file}`);
    const source = readPage(sourcePath);
    const escapedTarget = targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      source,
      new RegExp(`permanentRedirect\\(\\s*["']${escapedTarget}["']\\s*\\)`),
      `${sourcePath} must redirect directly to ${targetPath}`,
    );
  }
});

test("the unsupported legacy referral offer is retired without a route page", () => {
  assert.equal(fs.existsSync(pageFile("/referral-program")), false);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(resolveApexMigrationPath("/referral-program"))
        .filter(([key]) => ["sourcePath", "targetPath", "action", "status", "canonicalOwner", "indexable", "sitemap"].includes(key)),
    ),
    {
      sourcePath: "/referral-program",
      targetPath: null,
      action: "retire",
      status: "ready",
      canonicalOwner: "none",
      indexable: false,
      sitemap: false,
    },
  );
});

test("the team page uses every project-owned portrait", () => {
  const source = readPage("/team");
  for (const filename of portraitFiles) {
    const asset = path.join(root, "public", "team", filename);
    assert.equal(fs.existsSync(asset), true, `Missing project-owned portrait ${filename}`);
    assert.match(
      source,
      new RegExp(`/team/${filename.replaceAll(".", "\\.")}`),
      `Team page must reference ${filename}`,
    );
  }
});

test("the trusted resources page does not republish unverified commercial suppliers or logos", () => {
  const source = readPage("/trusted-suppliers");
  const legacyCommercialNames = [
    "Sustainable Home Loans",
    "ZECO",
    "Thermawood",
    "No Gap Insulation",
    "Magnetite",
    "Blinds Online",
    "Alwyn Projects",
    "Get Off Gas",
    "Spotlight",
    "Enviroflex",
    "Sapien",
    "Specialized Solar",
  ];

  for (const name of legacyCommercialNames) {
    assert.equal(
      source.toLowerCase().includes(name.toLowerCase()),
      false,
      `Remove unverified legacy supplier name: ${name}`,
    );
  }
  assert.doesNotMatch(source, /cdn\.durable\.co/i);
  assert.doesNotMatch(source, /Electrify Yarra/i);

  const requiredResources = [
    "Home Energy Rating (NatHERS)",
    "Your Home",
    "Clean Energy Regulator",
    "Energy Made Easy",
    "Solar Victoria",
    "Victorian Energy Upgrades",
    "SEC Victoria",
    "Rewiring Australia",
    "Renew",
    "Energy Consumers Australia",
    "Design Matters National",
    "Home Energy Raters Association",
    "Energy Efficiency Council",
    "Solar Accreditation Australia",
    "Australian Refrigeration Council",
    "Clean Energy Council",
    "AIRAH",
  ];
  for (const name of requiredResources) assert.match(source, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const logoReferences = [...source.matchAll(/logo: "\/(trusted-resources\/[^\"]+)"/g)].map((match) => match[1]);
  assert.ok(logoReferences.length >= 12, "Use a substantial local official-logo library");
  for (const logo of logoReferences) {
    assert.equal(fs.existsSync(path.join(root, "public", logo)), true, `Missing trusted resource logo ${logo}`);
  }
  assert.match(source, /name: "SEC Victoria"[\s\S]*?mark: "SEC"/);
  assert.match(source, /name: "AIRAH"[\s\S]*?mark: "AIRAH"/);
});

test("the rental page sends readers to the regulator and keeps compliance and gas safety boundaries clear", () => {
  const source = readPage("/minimum-rental-standards");
  assert.match(source, /https:\/\/www\.consumer\.vic\.gov\.au\//i);
  assert.match(source, /licensed(?:\s+or\s+registered)?\s+(?:gasfitter|plumber)/i);
  assert.match(source, /gas safety check[\s\S]{0,220}before[\s\S]{0,120}draught/i);
  assert.match(source, /(?:an?\s+)?rating (?:does not|doesn't) prove compliance/i);
});
