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
  assert.match(releaseTruth, /## Complete customer-installer handoff release/);
  assert.match(releaseTruth, /## Customer quote communications and discovery release/);
  assert.match(releaseTruth, /## Customer-to-trade contact and compact lead workflow release/);
  assert.match(releaseTruth, /## Customer plan trade enquiry and home-fact refinement release/);
  assert.match(releaseTruth, /## Creditex evidence-policy governance release/);
  assert.match(releaseTruth, /## Current Creditex controlled intake foundations release/);
  assert.match(releaseTruth, /## Prior Creditex VEU operator usability release/);
  assert.match(releaseTruth, /## Prior Creditex VEU operator workspace/);
  assert.match(
    releaseTruth,
    /Creditex VEU operator-workspace application source \| `1a535a0fd2237e8aa3dcf1daf82da009885197b0`/,
  );
  assert.match(
    releaseTruth,
    /Creditex VEU operator-usability primary application source \| `96ecb9698943445c57ba7f4caec99ff3839d3499`/,
  );
  assert.match(
    releaseTruth,
    /Creditex VEU operator-usability application source \| `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1`/,
  );
  assert.match(
    releaseTruth,
    /Creditex controlled-intake primary application source \| `c423f3c3938b43bf92c8ec98d285b49e63024ee6`/,
  );
  assert.match(
    releaseTruth,
    /Corrective Creditex controlled-intake application source \| `d441d41cad4d5299a882e73ea006a963fa360cf4`/,
  );
  assert.match(releaseTruth, /Current executable application identity \| Sites version 261/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_8457f041be2881918ab5a196250df5a2/);
  assert.match(releaseTruth, /appgdep_6a6eb18712108191ab4ebab327e75df7/);
  assert.match(releaseTruth, /sha256:5dcedf66b4487104960462095e41850fac28a83f49ae9065c0e37f91467a7759/);
  assert.match(releaseTruth, /migrations `0100` through `0105` were absent from the package/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_138b4cc8cf988191a4f3e4be4404a6d6/);
  assert.match(releaseTruth, /appgdep_6a6eb97d1978819180b729e922f33971/);
  assert.match(releaseTruth, /sha256:9b6fd4e639695ea43eb2623fb495b680c6130e7d1539abb3c645b0291898c2b1/);
  assert.match(releaseTruth, /FFBDCAFEA54E7FF72AD1E8E19B0983193E8C554583E3248129CD5E9FEAAE8CB1/);
  assert.match(releaseTruth, /341 files and 30,177,280 bytes/);
  assert.match(releaseTruth, /1,220 main tests with 1,218 passed and 2 intentionally skipped/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_195313bad4888191a7b5472c6b215cc5/);
  assert.match(releaseTruth, /appgdep_6a6e5248b7048191acfe5904b1d4628b/);
  assert.match(releaseTruth, /sha256:81e8a258e445954acf669266c31c6fd7141d591925ff30148b6f70c4118172e9/);
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
  assert.match(releaseTruth, /Complete customer-installer handoff application source \| `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb` \|[\s\S]{0,180}Sites version 236/);
  assert.match(releaseTruth, /Quote-communications documentation-only saved checkpoint \| `40b4396b9ef41166a61ee346b023c00bcc9df11b` \|[\s\S]{0,260}version 237/);
  assert.match(releaseTruth, /version 237[\s\S]{0,180}never deployed[\s\S]{0,100}version 236 stayed public until version 238/);
  assert.match(releaseTruth, /Customer quote communications application source \| `35552796048df63c03409d03401d33a47f326434` \|[\s\S]{0,180}Sites version 238/);
  assert.match(releaseTruth, /Sites version 238 from `35552796048df63c03409d03401d33a47f326434`/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_c9b4dbcee8408191a3fdce1aaef5548d/);
  assert.match(releaseTruth, /appgdep_6a6c5f96df388191a5e68ffd53fb68b0/);
  assert.match(releaseTruth, /Customer-to-trade contact workflow application source \| `97e6c7356483706e8e978ab53b842a9e41152f7e` \|[\s\S]{0,180}Sites version 239/);
  assert.match(releaseTruth, /Sites version 239 from `97e6c7356483706e8e978ab53b842a9e41152f7e`/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_ae43b05060ac8191918c70e9960e213c/);
  assert.match(releaseTruth, /appgdep_6a6c7cb6d6e0819187e9566a452e6850/);
  assert.match(releaseTruth, /Customer-plan trade-enquiry application source \| `b40c101939eec44b178b34ccb6397a989d2467d0` \|[\s\S]{0,180}Sites version 240/);
  assert.match(releaseTruth, /Sites version 240 from `b40c101939eec44b178b34ccb6397a989d2467d0`/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_f26581d5ff348191855551ce325e8c40/);
  assert.match(releaseTruth, /appgdep_6a6c971b63988191a92e4031fc74692b/);
  assert.match(releaseTruth, /Customer account trust application source \| `da4fa911c0b6c7f520e266259af8882b95aaf14a` \|[\s\S]{0,180}Sites version 241/);
  assert.match(releaseTruth, /Historical exact saved version 241 built from `da4fa911c0b6c7f520e266259af8882b95aaf14a`/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_2149679b0df08191a77cd91ac13d9cc7/);
  assert.match(releaseTruth, /appgdep_6a6caabc547c81919c4642b1f7cfcde1/);
  assert.match(releaseTruth, /Protected trade locality and reciprocal navigation application source \| `399b04f4a5d680080610f9e88b994506bb60c16f` \|[\s\S]{0,180}Sites version 242/);
  assert.match(releaseTruth, /Creditex compliance operations foundation application source \| `2ef8ce19fd5423fd95652a7bc88265e80d7b827f` \|[\s\S]{0,180}Sites version 246/);
  assert.match(releaseTruth, /Sites version 246 from `2ef8ce19fd5423fd95652a7bc88265e80d7b827f`/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_3cef6ddd92e88191a54d034d3a6e72e3/);
  assert.match(releaseTruth, /appgdep_6a6d5c42819081919d81dcd9451338bd/);
  assert.match(releaseTruth, /sha256:9d6ac6f6e5a3036ba8fedf14c94b0fdc61e608b32b203346fc327a8119f625ea/);
  assert.match(releaseTruth, /Creditex operations portal application source \| `7b08cb600bde30273774a544e07039acc6de1c03`/);
  assert.match(releaseTruth, /Sites version 248 from `7b08cb600bde30273774a544e07039acc6de1c03`/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_1b287ac469e88191aca7160bfa41c32c/);
  assert.match(releaseTruth, /appgdep_6a6d733ea23c81918f4ccd8e4f30f98b/);
  assert.match(releaseTruth, /sha256:1928ee707d2076db876b6aa40e58219ae5e96273f8ee1ece08cfe74144cd2aac/);
  assert.match(releaseTruth, /Creditex evidence-policy governance application source \| `d40c803bfa0b614ed806624a375a1fa47bd0e5a4`/);
  assert.match(releaseTruth, /`d40c803bfa0b614ed806624a375a1fa47bd0e5a4` as Sites version 249/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_bf90b67a89508191bbea3f1a2d926719/);
  assert.match(releaseTruth, /appgdep_6a6da8704be08191a4d310adb523e0f3/);
  assert.match(releaseTruth, /sha256:3e66780f5d61ae46c650df39c711a9a26166f75f7d9eb58cf8461a39dc7bc123/);
  assert.match(releaseTruth, /7,352,352 bytes/);
  assert.match(releaseTruth, /4E9087A40A00613E4BBDD111D8D5E1CA4A3A5AED01BCF3DA8DD9635396CF920F/);
  assert.match(releaseTruth, /332 files and 29,276,160 bytes/);
  assert.match(releaseTruth, /1,157 main tests with 1,155 passed, 2 intentionally skipped and 0 failed/);
  assert.match(releaseTruth, /all 99 migrations through `0098_creditex_rule_governance\.sql`/);
  assert.match(releaseTruth, /Expo Doctor reports 19 of 20 because of dependency patch drift/);
  assert.match(releaseTruth, /Creditex government-activity workflow application source \| `a33b7053301a64bea4bbcbe76713067a2c1782dd`/);
  assert.match(releaseTruth, /Sites version 251 from `a33b7053301a64bea4bbcbe76713067a2c1782dd`/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_a8b4368a16a88191be90ea1a3ce33481/);
  assert.match(releaseTruth, /appgdep_6a6dbc598f0c81918d1e6656addd0463/);
  assert.match(releaseTruth, /sha256:917cf16e38b0a69e2081992a8f2944699bf9492b78f40c8ce4745b55612bf285/);
  assert.match(releaseTruth, /6,790,614 bytes/);
  assert.match(releaseTruth, /B14686D098A1FF76D8DBF1F2CA26DE2AABB6D600D991289891A9CF31C6E50FFB/);
  assert.match(releaseTruth, /178 files and 18,227,200 bytes/);
  assert.match(releaseTruth, /32 Australian government program pathways and 207 controlled activity templates/);
  assert.match(releaseTruth, /Initial Creditex VEU synthetic pilot application source \| `3ac6c72057a8afea61e85817ba566ec543079886`/);
  assert.match(releaseTruth, /Authentication-corrected Creditex VEU pilot application source \| `ebae330dab6c42881c14bc57548095b111d9c850`/);
  assert.match(releaseTruth, /Sites version 253 from `ebae330dab6c42881c14bc57548095b111d9c850`/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_6ead08734a6c8191b018dc5a952acd33/);
  assert.match(releaseTruth, /appgdep_6a6dd491dde88191bc862e69a2e59580/);
  assert.match(releaseTruth, /sha256:be656467751fb195f2c381c2c450df8d9bfb74256a52d29650eaebc3bfe97eaf/);
  assert.match(releaseTruth, /7,419,988 bytes/);
  assert.match(releaseTruth, /CF7F72704BCAA585110FF3C9ADE8E1C4B212240CEE9BDD0B0F9673ACDB4B0727/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_900ff3f8d0448191a798a5eb10ef648c/);
  assert.match(releaseTruth, /appgdep_6a6dde1747308191bf5c78bd4f674030/);
  assert.match(releaseTruth, /sha256:20934a09b4658dafbd2b9c420c402028a3619a9fc9216bd2cb154ebcf12b1e98/);
  assert.match(releaseTruth, /7,420,447 bytes/);
  assert.match(releaseTruth, /51DF880CF8C919FA0386B891BC98C18064491988325049B59CC3F4A4BCE370DA/);
  assert.match(releaseTruth, /333 files and 29,624,320 bytes/);
  assert.match(releaseTruth, /1,180 main tests with 1,178 passed, 2 intentionally skipped and 0 failed/);
  assert.match(releaseTruth, /all 100 migrations through `0099_creditex_synthetic_pilot\.sql`/);
  assert.match(releaseTruth, /Creditex VEU operator-workspace application source \| `1a535a0fd2237e8aa3dcf1daf82da009885197b0`/);
  assert.match(releaseTruth, /historical Sites version 257/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_416748b2d09881919f375b0cf255789c/);
  assert.match(releaseTruth, /appgdep_6a6e119ef9c48191aa7a6da69463dd80/);
  assert.match(releaseTruth, /6,893,645 bytes/);
  assert.match(releaseTruth, /A9B1526A4033D0CA060821A841A5DCF0D7ABA57AE6F0E1C84A42346587DC2038/);
  assert.match(releaseTruth, /178 files and 18,780,160 bytes/);
  assert.match(releaseTruth, /sha256:38dfcd7487aa2a6cde6eedc11b628e55dadd3d1cac4430a8beeeecf20f523357/);
  assert.match(releaseTruth, /https:\/\/compare\.ausenergyassessments\.com\/creditex\/compliance/);
  assert.match(releaseTruth, /https:\/\/aea-energy-comparison\.info294029\.chatgpt\.site/);
  assert.match(releaseTruth, /0 published programs, 0 activity versions, 0 policies and 0 regulated cases/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_bc9f3157a9e88191881c5989f7de7ba0/);
  assert.match(releaseTruth, /appgdep_6a6cc08dc6f881919a349de607f5a8a9/);
  assert.match(releaseTruth, /sha256:3d7535003e6b3fae6b2b7f4f86b5c69a59737a8aa607ba7feabdbd407fd890f0/);
  assert.match(releaseTruth, /environment revision 19/);
  assert.match(releaseTruth, /No Sites version 240 release archive was uploaded or recorded/);
  assert.match(releaseTruth, /No Sites version 241 release archive was uploaded or recorded/);
  assert.match(releaseTruth, /Production provider inbox receipt and hosted row counts remain unverified/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_06f96686a8dc8191a0e01c2555c2de1b/);
  assert.match(releaseTruth, /appgdep_6a6bf3695b6081918ce2a9dd77bc3869/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_0fac9e3297808191afc57d58d9377584/);
  assert.match(releaseTruth, /appgdep_6a6c0908063081919b2e985a27141e34/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_82454487760c8191b1f5338538b8fcb8/);
  assert.match(releaseTruth, /appgdep_6a6c3b56a1b881919e82e97eaa286bc4/);
  assert.match(releaseTruth, /a238af3e5f81164e/);
  assert.match(releaseTruth, /appgprj_6a550c378000819185caf094173422bb~appgver_7a589f567528819189cf033456193bda/);
  assert.match(releaseTruth, /appgdep_6a6bcf5c0f7c8191b877d27581f9d82e/);
  assert.match(releaseTruth, /version 231 never became public and version 230 remained live/);
  assert.match(releaseTruth, /0084_customer_plan_revision_restore\.sql/);
  assert.match(releaseTruth, /0085_customer_evidence_resumable_retake\.sql/);
  assert.match(releaseTruth, /0086_customer_evidence_multi_photo_prompts\.sql/);
  assert.match(releaseTruth, /0088_customer_opportunity_dispatch_jobs\.sql/);
  assert.match(releaseTruth, /0091_customer_project_quote_acceptance_claims\.sql/);
  assert.match(releaseTruth, /0092_trade_opportunity_matching_locality\.sql/);
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
  assert.match(roadmap, /## Released milestone: CUSTOMER-INSTALLER-HANDOFF-19/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-QUOTE-COMMS-20/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-TRADE-CONTACT-21/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-PLAN-TRADE-ENQUIRY-22/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-ACCOUNT-TRUST-23/);
  assert.match(roadmap, /## Released milestone: CUSTOMER-TRADE-LOCALITY-24/);
  assert.match(roadmap, /## Released milestone: CREDITEX-COMPLIANCE-OPERATIONS-25/);
  assert.match(roadmap, /## Released milestone: CREDITEX-EVIDENCE-POLICY-GOVERNANCE-26/);
  assert.match(roadmap, /Release status: application commit `e74c2d95889a381cb3bb434607bc6584e54cf722`[\s\S]{0,250}Sites version 222/);
  assert.match(roadmap, /Release status: application commit `bc427d295b3106907904a3c0b7bf9f2945561cd1`[\s\S]{0,250}Sites version 224/);
  assert.match(roadmap, /Release status: application commit `da35ce60295d6c7150cddd9b35e33fcf64c8521b`[\s\S]{0,250}Sites version 227/);
  assert.match(roadmap, /Release status: application commit `0db488f325a79e22d126aace75647715b59c96f9`[\s\S]{0,250}Sites version 229/);
  assert.match(roadmap, /Release status: application commit `2607cc53f2e4c79546701e29d3d182fde4670952`[\s\S]{0,250}Sites version 230/);
  assert.match(roadmap, /Release status: corrective application commit `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`[\s\S]{0,300}Sites version 232/);
  assert.match(roadmap, /Release status: application commit `5acc4ccf37acd608dc437d3a074410b1d840f706`[\s\S]{0,300}Sites version 233/);
  assert.match(roadmap, /Release status: application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b`[\s\S]{0,300}Sites version 234/);
  assert.match(roadmap, /Release status: application commit `eeba3679c30789cfe2e633a913a18492270fcc3e`[\s\S]{0,300}Sites version 235/);
  assert.match(roadmap, /Release status: application commit `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb`[\s\S]{0,300}Sites version 236/);
  assert.match(roadmap, /Release status: application commit `35552796048df63c03409d03401d33a47f326434`[\s\S]{0,300}Sites version 238/);
  assert.match(roadmap, /Release status: application commit `97e6c7356483706e8e978ab53b842a9e41152f7e`[\s\S]{0,300}Sites version 239/);
  assert.match(roadmap, /Release status: application commit `b40c101939eec44b178b34ccb6397a989d2467d0`[\s\S]{0,300}Sites version 240/);
  assert.match(roadmap, /Release status: application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a`[\s\S]{0,300}Sites version 241/);
  assert.match(roadmap, /Release status: application commit `399b04f4a5d680080610f9e88b994506bb60c16f`[\s\S]{0,300}Sites version 242/);
  assert.match(roadmap, /Exact application commit `7b08cb600bde30273774a544e07039acc6de1c03`[\s\S]{0,2500}Sites saved version 248/);
  assert.match(roadmap, /Release status: application commit `d40c803bfa0b614ed806624a375a1fa47bd0e5a4`[\s\S]{0,400}Sites version 249/);
  assert.match(roadmap, /## Released milestone: CREDITEX-GOVERNMENT-ACTIVITY-WORKFLOW-27/);
  assert.match(roadmap, /Release status: application commit `a33b7053301a64bea4bbcbe76713067a2c1782dd`[\s\S]{0,400}Sites version 251/);
  assert.match(roadmap, /## Released milestone: CREDITEX-VEU-SYNTHETIC-PILOT-28/);
  assert.match(roadmap, /initial pilot application commit `3ac6c72057a8afea61e85817ba566ec543079886`[\s\S]{0,700}corrective application commit `ebae330dab6c42881c14bc57548095b111d9c850`[\s\S]{0,700}Sites version 253/i);
  assert.match(roadmap, /## Released milestone: CREDITEX-VEU-DENSE-REGISTER-29/);
  assert.match(roadmap, /## Released milestone: CREDITEX-VEU-OPERATOR-WORKSPACE-30/);
  assert.match(roadmap, /Final production-D1 correction `1a535a0fd2237e8aa3dcf1daf82da009885197b0`[\s\S]{0,500}historical Sites version 257/);
  assert.match(roadmap, /## Released milestone: CREDITEX-VEU-OPERATOR-USABILITY-31/);
  assert.match(roadmap, /primary implementation commit `96ecb9698943445c57ba7f4caec99ff3839d3499`[\s\S]{0,800}Final heading correction `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1`[\s\S]{0,800}Sites version 259/i);
  assert.match(roadmap, /## Released milestone: CREDITEX-CONTROLLED-INTAKE-FOUNDATIONS-32/);
  assert.match(roadmap, /primary application commit `c423f3c3938b43bf92c8ec98d285b49e63024ee6`[\s\S]{0,900}Corrective application commit `d441d41cad4d5299a882e73ea006a963fa360cf4`[\s\S]{0,900}Sites version 261/i);
  assert.match(handover, /Status: `CREDITEX-CONTROLLED-INTAKE-FOUNDATIONS-32` released and live/);
  assert.match(handover, /Milestone ID: `CREDITEX-CONTROLLED-INTAKE-FOUNDATIONS-32`/);
  assert.match(handover, /Current production: Sites version 261 from application commit `d441d41cad4d5299a882e73ea006a963fa360cf4`/);
  assert.match(handover, /Primary controlled-intake implementation: `c423f3c3938b43bf92c8ec98d285b49e63024ee6`/);
  assert.match(handover, /Corrective Sites migration packaging: `d441d41cad4d5299a882e73ea006a963fa360cf4`/);
  assert.match(handover, /appgprj_6a550c378000819185caf094173422bb~appgver_138b4cc8cf988191a4f3e4be4404a6d6/);
  assert.match(handover, /appgdep_6a6eb97d1978819180b729e922f33971/);
  assert.match(handover, /7,511,787 bytes/);
  assert.match(handover, /FFBDCAFEA54E7FF72AD1E8E19B0983193E8C554583E3248129CD5E9FEAAE8CB1/);
  assert.match(handover, /341 stored files, 30,177,280 stored bytes/);
  assert.match(handover, /sha256:9b6fd4e639695ea43eb2623fb495b680c6130e7d1539abb3c645b0291898c2b1/);
  assert.match(handover, /migrations `0100` through `0105`/);
  assert.match(handover, /1,220-test main suite with 1,218 passed and 2 intentionally skipped/);
  assert.match(handover, /The supplied private Dataforce export remained local/);
  assert.match(handover, /0 published programs, 0 activity versions, 0 evidence policies and 0 regulated cases/);
  assert.match(handover, /appgprj_6a550c378000819185caf094173422bb~appgver_195313bad4888191a7b5472c6b215cc5/);
  assert.match(handover, /appgdep_6a6e5248b7048191acfe5904b1d4628b/);
  assert.match(handover, /6,894,158 bytes/);
  assert.match(handover, /605BEE1AC610C7D4F82BD9CEBD5C2706B55BFB7F73B2640D1D5FBB6F041B21FF/);
  assert.match(handover, /178 stored files, 18,780,160 stored bytes/);
  assert.match(handover, /sha256:81e8a258e445954acf669266c31c6fd7141d591925ff30148b6f70c4118172e9/);
  assert.match(handover, /Status: released implementation milestone/);
  assert.match(handover, /(?:Milestone ID|Prior released milestone record): `CUSTOMER-ACCOUNT-TRUST-23`/);
  assert.match(handover, /Released application for this milestone: Sites version 241 from application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a`/);
  assert.match(handover, /Sites application version: 241/);
  assert.match(handover, /appgprj_6a550c378000819185caf094173422bb~appgver_2149679b0df08191a77cd91ac13d9cc7/);
  assert.match(handover, /appgdep_6a6caabc547c81919c4642b1f7cfcde1/);
  assert.match(handover, /No local release archive was uploaded or supplied for this release/);
  assert.match(handover, /Production provider inbox receipt and hosted row counts remain unverified/);
  assert.match(handover, /## Prior released milestone: `CUSTOMER-PLAN-TRADE-ENQUIRY-22`/);
  assert.match(handover, /appgprj_6a550c378000819185caf094173422bb~appgver_f26581d5ff348191855551ce325e8c40/);
  assert.match(handover, /appgdep_6a6c971b63988191a92e4031fc74692b/);
  assert.match(handover, /## Prior released milestone: `CUSTOMER-TRADE-CONTACT-21`/);
  assert.match(handover, /appgprj_6a550c378000819185caf094173422bb~appgver_ae43b05060ac8191918c70e9960e213c/);
  assert.match(handover, /appgdep_6a6c7cb6d6e0819187e9566a452e6850/);
  assert.match(handover, /BF9EAAE34B1FBB197C30AF94F0ADB9DBE92BBC347F8B60424C6D0444D9FCD7DF/);
  assert.match(handover, /0091_customer_project_quote_acceptance_claims\.sql/);
  assert.match(handover, /appgprj_6a550c378000819185caf094173422bb~appgver_82454487760c8191b1f5338538b8fcb8/);
  assert.match(handover, /appgdep_6a6c3b56a1b881919e82e97eaa286bc4/);
  assert.match(handover, /D32307C4B0FABF955FB4CF878CBD31290F053E06BA3CA67A92DBFBED6FD262E4/);
  assert.match(handover, /0088_customer_opportunity_dispatch_jobs\.sql/);
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
  assert.match(roadmapNextFive, /^1\. \*\*Approve the first exact VEU source pack:/);
  assert.match(roadmapNextFive, /\n2\. \*\*Connect authorised operational source adapters:/);
  assert.match(roadmapNextFive, /\n3\. \*\*Prove physical AEA Field custody:/);
  assert.match(roadmapNextFive, /\n4\. \*\*Approve the first calculator:/);
  assert.match(roadmapNextFive, /\n5\. \*\*Run one governed parallel activity:/);
});

test("inactive Netlify deployment targets are removed", () => {
  assert.equal(fs.existsSync(path.join(root, "netlify.toml")), false);
  assert.equal(fs.existsSync(path.join(root, "netlify", "functions", "api-health-monitor.mts")), false);
});
