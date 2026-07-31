import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canonicalAustralianState, AUSTRALIAN_STATE_CODES } from "../src/lib/australian-postcodes.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));

test("production migrations contain no synthetic population payload", () => {
  const migrations = fs.readdirSync(path.join(root, "drizzle")).filter((name) => name.endsWith(".sql"));
  const combined = migrations.map((name) => fs.readFileSync(path.join(root, "drizzle", name), "utf8")).join("\n");
  assert.doesNotMatch(combined, /aea-demo-\d+\.consumer|Synthetic private planning note|AEA Demo Energy Supply/i);
  assert.equal(fs.existsSync(path.join(root, "fixtures", "synthetic", "migrations", "0033_synthetic_benchmark_population.sql")), false);
  assert.equal(fs.existsSync(path.join(root, "scripts", "seed-synthetic-population.mjs")), false);
  assert.equal(fs.existsSync(path.join(root, "scripts", "validate-synthetic-population.mjs")), false);
});

test("synthetic credentials and generated output are ignored", () => {
  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /\/synthetic-test-output\//);
});

test("Australian states have one canonical stored representation", () => {
  assert.deepEqual(AUSTRALIAN_STATE_CODES, ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
  assert.equal(canonicalAustralianState("Qld"), "QLD");
  assert.equal(canonicalAustralianState("vic"), "VIC");
  assert.equal(canonicalAustralianState("Tas"), "TAS");
});

test("Sites ignores Stripe events and cannot reconcile or initiate payments", () => {
  const webhook = fs.readFileSync(path.join(root, "src", "app", "api", "stripe", "webhook", "route.ts"), "utf8");
  assert.doesNotMatch(webhook, /plink_[A-Za-z0-9]+/);
  assert.match(webhook, /SITES_FINANCIAL_TRANSACTIONS_DISABLED/);
  assert.match(webhook, /ignored: true/);
  assert.doesNotMatch(webhook, /STRIPE_CONNECT_WEBHOOK_SECRET|applyTradeCrmCheckout|getD1|fetch\(/);
});

test("the dated audit is immutable evidence and current truth has one documented owner per concern", () => {
  const auditDirectory = path.join(root, "docs", "audit", "2026-07-21-complete-current-state");
  const auditFiles = fs.readdirSync(auditDirectory).filter((name) => name.endsWith(".md")).sort();
  assert.equal(auditFiles.length, 22);
  assert.deepEqual(auditFiles, [
    "00_AUDIT_MANIFEST_AND_COVERAGE.md",
    "01_EXECUTIVE_PRODUCT_SUMMARY.md",
    "02_INDUSTRY_BUSINESS_AND_GLOSSARY.md",
    "03_PRODUCT_FEATURE_AND_WORKFLOW_STATUS.md",
    "04_DOCUMENTATION_TRUTH_AND_LINK_AUDIT.md",
    "05_CURRENT_ARCHITECTURE_AND_TECHNOLOGY.md",
    "06_HOSTING_OWNERSHIP_AND_CRM_SUITABILITY.md",
    "07_FRONTEND_UX_AND_ACCESSIBILITY.md",
    "08_BACKEND_API_WORKERS_AND_JOBS.md",
    "09_DATA_DATABASE_STORAGE_AND_MIGRATIONS.md",
    "10_AUTH_SECURITY_PRIVACY_AND_COMPLIANCE.md",
    "11_EXTERNAL_INTEGRATIONS.md",
    "12_TESTING_DEPLOYMENT_OPERATIONS_AND_RESILIENCE.md",
    "13_DATABASE_CONSOLE_SECURITY_REVIEW.md",
    "14_AI_NAVIGATION_AND_PLATFORM_INTELLIGENCE.md",
    "15_RECOMMENDED_DOCUMENTATION_ARCHITECTURE.md",
    "16_PRODUCTION_PLATFORM_OPTIONS.md",
    "17_MOVE_OFF_SITES_DECISION_AND_PLAN.md",
    "18_FINDINGS_RISKS_ASSUMPTIONS_AND_DECISIONS.md",
    "19_FORMAL_ROADMAP.md",
    "20_EVIDENCE_INDEX_AND_COMMAND_LOG.md",
    "README.md",
  ]);

  const auditReadme = fs.readFileSync(path.join(auditDirectory, "README.md"), "utf8");
  const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const releaseTruth = fs.readFileSync(path.join(root, "docs", "RELEASE_TRUTH.md"), "utf8");
  const roadmap = fs.readFileSync(path.join(root, "ROADMAP.md"), "utf8");
  const handover = fs.readFileSync(path.join(root, "docs", "HANDOVER_NEXT_TASK.md"), "utf8");

  assert.match(auditReadme, /Final repository checkpoint: `ff3c8efe/);
  assert.match(auditReadme, /## Snapshot warning/);
  assert.match(agents, /immutable dated evidence baseline; never rewrite it as current status/);
  assert.match(readme, /immutable evidence baseline/);
  assert.match(releaseTruth, /only current implementation and release-status document/);
  assert.match(releaseTruth, /## Advisor context and admin stability release/);
  assert.match(releaseTruth, /## Independent customer plan release/);
  assert.match(releaseTruth, /## Customer plan evidence and history release/);
  assert.match(releaseTruth, /## Professional review, responsive print and everyday comfort release/);
  assert.match(releaseTruth, /## Direct customer plan PDF download fix/);
  assert.match(releaseTruth, /## Browser-native customer plan PDF reliability correction/);
  assert.match(releaseTruth, /## Premium customer plan PDF and email report/);
  assert.match(releaseTruth, /## Technical customer plan presentation release/);
  assert.match(releaseTruth, /## Customer plan spacing and rounded-surface release/);
  assert.match(releaseTruth, /## Customer plan trust, evidence and revision release/);
  assert.match(releaseTruth, /## Customer project cleanup release/);
  assert.match(releaseTruth, /## Customer roadmap context release/);
  assert.match(releaseTruth, /## Customer installer request completion release/);
  assert.match(releaseTruth, /## Customer plan durability, evidence and history release/);
  assert.match(releaseTruth, /## Customer installer request and multi-photo release/);
  assert.match(releaseTruth, /## Installer enquiry pack, approved evidence and business notification release/);
  assert.match(releaseTruth, /Customer plan evidence and history application source.*Sites version 210/);
  assert.match(releaseTruth, /Professional review, print and comfort application source \| `ee75aadfd6800c01b92532b2d376a4a1e33c9d74` \|[\s\S]{0,150}Sites version 212/);
  assert.match(releaseTruth, /Premium report documentation checkpoint \| `a92e18b9ea79b53eaf6eda8665f37ec02c861972` \|[\s\S]{0,180}Sites version 219/);
  assert.match(releaseTruth, /Customer-plan spacing and rounded-surface application source \| `e74c2d95889a381cb3bb434607bc6584e54cf722` \|[\s\S]{0,180}Sites version 222/);
  assert.match(releaseTruth, /appgdep_6a6a8887a0048191b7eb1706e742ad28/);
  assert.match(releaseTruth, /Spacing release documentation checkpoint \| `c2599eb5bedb11b1648da2b4a60e11b242cb2abb` \|[\s\S]{0,180}Sites version 223/);
  assert.match(releaseTruth, /Sites version 224 from `bc427d295b3106907904a3c0b7bf9f2945561cd1`/);
  assert.match(releaseTruth, /appgdep_6a6b151c0178819185e4d57c1cbf75c2/);
  assert.match(releaseTruth, /Project-control readability application source \| `da35ce60295d6c7150cddd9b35e33fcf64c8521b` \|[\s\S]{0,180}Sites version 227/);
  assert.match(releaseTruth, /appgdep_6a6b22db21c48191a2dedbdbf05274ef/);
  assert.match(releaseTruth, /Customer roadmap context application source \| `0db488f325a79e22d126aace75647715b59c96f9` \|[\s\S]{0,180}Sites version 229/);
  assert.match(releaseTruth, /appgdep_6a6b38fcccbc8191b8b2daedf57b9e24/);
  assert.match(releaseTruth, /Customer installer-request application source \| `2607cc53f2e4c79546701e29d3d182fde4670952` \|[\s\S]{0,180}Sites version 230/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_52a74079cae481918a86072452749e99/);
  assert.match(releaseTruth, /appgdep_6a6b5469c8bc81919f0e2c9ef22da602/);
  assert.match(releaseTruth, /Customer plan durability worker-safe application source \| `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` \|[\s\S]{0,180}Sites version 232/);
  assert.match(releaseTruth, /Customer plan durability worker-safe application source \| `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` \|[\s\S]{0,180}saved and deployed as Sites version 232/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8/);
  assert.match(releaseTruth, /appgdep_6a6bd28a71888191be19f89db9b82ca5/);
  assert.match(releaseTruth, /Customer plan durability documentation checkpoint \| `2c55430757c316b4045e3edd9a26263a24793f14`/);
  assert.match(releaseTruth, /Installer-request and multi-photo application source \| `5acc4ccf37acd608dc437d3a074410b1d840f706` \|[\s\S]{0,180}Sites version 233/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_218ad21977748191a3283723f395cadd/);
  assert.match(releaseTruth, /appgdep_6a6be56ca9ac8191918423bd57f0a05d/);
  assert.match(releaseTruth, /Authoritative installer-submit application source \| `7d7a821123d9b70cace08ac632d58ca1d3851b1b` \|[\s\S]{0,180}Sites version 234/);
  assert.match(releaseTruth, /Installer enquiry-pack and business-notification application source \| `eeba3679c30789cfe2e633a913a18492270fcc3e` \|[\s\S]{0,180}Sites version 235/);
  assert.match(releaseTruth, /Sites version 235 from `eeba3679c30789cfe2e633a913a18492270fcc3e`/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_06f96686a8dc8191a0e01c2555c2de1b/);
  assert.match(releaseTruth, /appgdep_6a6bf3695b6081918ce2a9dd77bc3869/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_0fac9e3297808191afc57d58d9377584/);
  assert.match(releaseTruth, /appgdep_6a6c0908063081919b2e985a27141e34/);
  assert.match(releaseTruth, /a238af3e5f81164e/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_7a589f567528819189cf033456193bda/);
  assert.match(releaseTruth, /appgdep_6a6bcf5c0f7c8191b877d27581f9d82e/);
  assert.match(releaseTruth, /version 231 never became public and version 230 remained live/);
  assert.match(releaseTruth, /0084_customer_plan_revision_restore\.sql/);
  assert.match(releaseTruth, /0085_customer_evidence_resumable_retake\.sql/);
  assert.match(releaseTruth, /0086_customer_evidence_multi_photo_prompts\.sql/);
  assert.match(releaseTruth, /2026-07-30-tagged-plan-pdf-v3/);
  assert.match(releaseTruth, /2026-07-31-tagged-plan-pdf-v6/);
  assert.match(releaseTruth, /@pdf-lib\/fontkit/);
  assert.match(releaseTruth, /https:\/\/compare\.ausenergyassessments\.com\/api\/aea-brandmark/);
  assert.match(releaseTruth, /2026-07-30-tech-presentation-pdf-v2/);
  assert.match(releaseTruth, /2026-07-30-tech-presentation-design-v2/);
  assert.match(releaseTruth, /2026-07-29-premium-report-pdf-v3/);
  assert.match(releaseTruth, /2026-07-29-premium-report-v3/);
  assert.match(releaseTruth, /2026-07-29-premium-report-v1/);
  assert.match(releaseTruth, /consistent spacing with rounded report surfaces/);
  assert.match(roadmap, /contains only approved forward work and measurable gates/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-ADVISOR-CONTEXT-02/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-DECISION-03/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-EVIDENCE-04/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-PRO-PRINT-05/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-DIRECT-PDF-06/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-NATIVE-PDF-07/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-PREMIUM-REPORT-08/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-TECH-PRESENTATION-09/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-SPACING-10/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-TRUST-11/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PROJECT-CLEANUP-12/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-ROADMAP-CONTEXT-13/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-INSTALLER-REQUEST-14/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-DURABILITY-15/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-INSTALLER-PHOTOS-16/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-INSTALLER-SUBMIT-17/);
  assert.match(roadmap, /## Released milestone: INSTALLER-ENQUIRY-PACK-18/);
  assert.match(roadmap, /Release status: application commit `e74c2d95889a381cb3bb434607bc6584e54cf722`[\s\S]{0,250}Sites version 222/);
  assert.match(roadmap, /Release status: application commit `bc427d295b3106907904a3c0b7bf9f2945561cd1`[\s\S]{0,250}Sites version 224/);
  assert.match(roadmap, /Release status: application commit `da35ce60295d6c7150cddd9b35e33fcf64c8521b`[\s\S]{0,250}Sites version 227/);
  assert.match(roadmap, /Release status: application commit `0db488f325a79e22d126aace75647715b59c96f9`[\s\S]{0,250}Sites version 229/);
  assert.match(roadmap, /Release status: application commit `2607cc53f2e4c79546701e29d3d182fde4670952`[\s\S]{0,250}Sites version 230/);
  assert.match(roadmap, /Release status: corrective application commit `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`[\s\S]{0,300}Sites version 232/);
  assert.match(roadmap, /Release status: application commit `5acc4ccf37acd608dc437d3a074410b1d840f706`[\s\S]{0,300}Sites version 233/);
  assert.match(roadmap, /Release status: application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b`[\s\S]{0,300}Sites version 234/);
  assert.match(roadmap, /Release status: application commit `eeba3679c30789cfe2e633a913a18492270fcc3e`[\s\S]{0,300}Sites version 235/);
  assert.match(handover, /Status: released implementation milestone/);
  assert.match(handover, /Milestone ID: `INSTALLER-ENQUIRY-PACK-18`/);
  assert.match(handover, /Released application for this milestone: Sites version 235 from application commit `eeba3679c30789cfe2e633a913a18492270fcc3e`/);
  assert.match(handover, /Sites application version: 235/);
  assert.match(handover, /appgprj_6a550c378000819185caf094173422bb~appgver_0fac9e3297808191afc57d58d9377584/);
  assert.match(handover, /appgdep_6a6c0908063081919b2e985a27141e34/);
  assert.match(handover, /326DD4224505C9364A8D2852877D4037C397422788F97394B00A0EA9D80D48F1/);
  assert.match(handover, /0087_trade_opportunity_notifications\.sql/);
  assert.match(handover, /appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8/);
  assert.match(handover, /appgdep_6a6bd28a71888191be19f89db9b82ca5/);
  assert.match(handover, /2026-07-31-tagged-plan-pdf-v6/);
  assert.match(handover, /0085_customer_evidence_resumable_retake\.sql/);
  assert.match(handover, /2026-07-30-tagged-plan-pdf-v3/);
  assert.match(handover, /0084_customer_plan_revision_restore\.sql/);
  assert.match(handover, /Sites version 219/);

  const nextFivePattern =
    /## Next five logical product steps\r?\n\r?\n((?:[1-5]\. .*(?:\r?\n|$)){5})/;
  const roadmapNextFive = roadmap.match(nextFivePattern)?.[1];
  const handoverNextFive = handover.match(nextFivePattern)?.[1];

  assert.ok(roadmapNextFive, "ROADMAP.md must contain exactly five ordered next steps");
  assert.ok(handoverNextFive, "HANDOVER_NEXT_TASK.md must contain exactly five ordered next steps");
  assert.equal(handoverNextFive, roadmapNextFive);
  assert.match(roadmapNextFive, /^1\. \*\*Opportunity email delivery health and bounded retries:/);
  assert.match(roadmapNextFive, /\n2\. \*\*Customer share-before-submit review and resilient evidence:/);
  assert.match(roadmapNextFive, /\n3\. \*\*Installer quote-readiness and request-for-information loop:/);
  assert.match(roadmapNextFive, /\n4\. \*\*Outlook desktop and assistive-technology acceptance:/);
  assert.match(roadmapNextFive, /\n5\. \*\*Privacy-safe funnel telemetry, then deferred pilot:/);
});

test("inactive Netlify deployment targets are removed", () => {
  assert.equal(fs.existsSync(path.join(root, "netlify.toml")), false);
  assert.equal(fs.existsSync(path.join(root, "netlify", "functions", "api-health-monitor.mts")), false);
});
