import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const markerMigration = read("../drizzle/0032_windy_fixer.sql");
const population = read("../drizzle/0033_synthetic_benchmark_population.sql");
const generator = read("../scripts/seed-synthetic-population.mjs");
const validator = read("../scripts/validate-synthetic-population.mjs");
const directoryRoute = read("../src/app/api/admin/directory/route.ts");
const accountRoute = read("../src/app/api/admin/accounts/route.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");

test("synthetic records are explicitly marked and removable from operational views", () => {
  for (const table of ["trade_accounts", "customer_accounts", "customer_projects", "supplier_products", "trade_opportunities"]) {
    assert.match(markerMigration, new RegExp("ALTER TABLE `" + table + "` ADD `is_synthetic`"));
  }
  assert.match(directoryRoute, /synthetic !== "exclude"/);
  assert.match(accountRoute, /COALESCE\(is_synthetic, 0\) = 0/);
});

test("the benchmark generator targets reserved accounts and the exact requested population", () => {
  assert.match(generator, /example\.com/);
  assert.match(generator, /installers: 100/);
  assert.match(generator, /wholesalers: 50/);
  assert.match(generator, /consumers: 200/);
  assert.match(validator, /installers: 100, wholesalers: 50, consumers: 200, products: 150/);
  assert.match(validator, /Every synthetic trade account must be approved and premium/);
});

test("seed data is notification free and maintains the protected household boundary", () => {
  assert.doesNotMatch(population, /admin_notifications|notification_deliveries|email_outbox|stripe/);
  assert.match(population, /Synthetic private planning note/);
  assert.match(population, /Synthetic anonymised/);
  assert.match(population, /INSERT OR IGNORE INTO customer_accounts\s+\(firebase_uid, email, display_name, postcode, address_state/);
  assert.match(population, /INSERT OR IGNORE INTO trade_opportunities\s+\(id, title, project_type, postcode, state, service_categories/);
});

test("the refined CRM uses progressive navigation and a focused visual board", () => {
  assert.match(crm, /crm-quick-create/);
  assert.match(crm, /crm-more-nav/);
  assert.match(crm, /crm-pipeline-board/);
  assert.match(crm, /crm-layout-toggle/);
  assert.match(crm, /setPipelineFocus\(""\); setJobLayout\("board"\)/);
  assert.match(crm, /closest\("details"\)\?\.removeAttribute\("open"\)/);
  assert.doesNotMatch(crm, /`More: \$\{/);
});

test("the temporary identity seeding endpoint has been removed", () => {
  assert.equal(fs.existsSync(new URL("../src/app/api/admin/synthetic-identity-batch/route.ts", import.meta.url)), false);
});
