import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const markerMigration = read("../drizzle/0032_windy_fixer.sql");
const historicalPopulationMigration = read("../drizzle/0033_synthetic_benchmark_population.sql");
const historicalJourneyMigration = read("../drizzle/0036_synthetic_journey_readiness.sql");
const historicalCatalogueMigration = read("../drizzle/0037_synthetic_catalogue_readiness.sql");
const directoryRoute = read("../src/app/api/admin/directory/route.ts");
const accountRoute = read("../src/app/api/admin/accounts/route.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const benchmark = read("../scripts/benchmark-scale-100k.mjs");

test("pre-existing synthetic records remain explicitly marked and excluded from operational views", () => {
  for (const table of ["trade_accounts", "customer_accounts", "customer_projects", "supplier_products", "trade_opportunities"]) {
    assert.match(markerMigration, new RegExp("ALTER TABLE `" + table + "` ADD `is_synthetic`"));
  }
  assert.match(directoryRoute, /synthetic !== "exclude"/);
  assert.match(directoryRoute, /is_synthetic = 0/);
  assert.doesNotMatch(accountRoute, /approved and premium/i);
});

test("retired synthetic population migrations are inert and no seed workflow remains", () => {
  for (const migration of [
    historicalPopulationMigration,
    historicalJourneyMigration,
    historicalCatalogueMigration,
  ]) {
    assert.match(migration, /Historical migration identifier retained/);
    assert.match(migration, /SELECT 1;/);
    assert.doesNotMatch(migration, /INSERT|UPDATE|DELETE/i);
  }
  assert.equal(fs.existsSync(new URL("../scripts/seed-synthetic-population.mjs", import.meta.url)), false);
  assert.equal(fs.existsSync(new URL("../scripts/validate-synthetic-population.mjs", import.meta.url)), false);
  assert.equal(fs.existsSync(new URL("../fixtures/synthetic/migrations/0033_synthetic_benchmark_population.sql", import.meta.url)), false);
});

test("the local scale benchmark models review-ledger-bound trade access", () => {
  assert.match(benchmark, /RECORDS_PER_DATASET = 100_000/);
  assert.match(benchmark, /verification_review_id TEXT NOT NULL/);
  assert.match(benchmark, /CREATE TABLE trade_account_verification_reviews/);
  assert.match(benchmark, /INSERT INTO trade_account_verification_reviews/);
  assert.match(benchmark, /verified_review\.id = a\.verification_review_id/);
  assert.match(benchmark, /verified_review\.business_name = a\.business_name/);
  assert.match(benchmark, /verified_review\.partner_type = a\.partner_type/);
  assert.match(benchmark, /verified_review\.decision = 'approved'/);
  assert.match(benchmark, /verified_review\.review_method = 'official_abr_lookup'/);
  assert.match(benchmark, /\(\(CAST\(substr\(a\.abn, 1, 1\) AS INTEGER\) - 1\) \* 10\)/);
  for (const [position, weight] of [[2, 1], [3, 3], [4, 5], [5, 7], [6, 9], [7, 11], [8, 13], [9, 15], [10, 17], [11, 19]]) {
    assert.match(
      benchmark,
      new RegExp(`CAST\\(substr\\(a\\.abn, ${position}, 1\\) AS INTEGER\\) \\* ${weight}`),
    );
  }
  assert.match(benchmark, /\) % 89 = 0/);
  assert.match(benchmark, /AND a\.verified_abn <> '' AND \$\{validAbn\}/);
  assert.match(benchmark, /\["verificationReviews", "trade_account_verification_reviews"\]/);
  assert.match(benchmark, /new DatabaseSync\(":memory:"\)/);
});

test("the refined CRM uses progressive navigation and a focused visual board", () => {
  assert.match(crm, /crm-quick-create/);
  assert.doesNotMatch(crm, /crm-more-nav/);
  assert.match(crm, /"templates", "reports", "import", "integrations"/);
  assert.match(crm, /crm-pipeline-board/);
  assert.match(crm, /crm-layout-toggle/);
  assert.match(crm, /setPipelineFocus\(""\); setJobLayout\("board"\)/);
  assert.match(crm, /AccessibleMenu/);
  assert.doesNotMatch(crm, /`More: \$\{/);
});

test("the temporary identity seeding endpoint has been removed", () => {
  assert.equal(fs.existsSync(new URL("../src/app/api/admin/synthetic-identity-batch/route.ts", import.meta.url)), false);
});
