import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const markerMigration = read("../drizzle/0032_windy_fixer.sql");
const population = read("../drizzle/0033_synthetic_benchmark_population.sql");
const ecosystemRepair = read("../drizzle/0035_ecosystem_flow_repair.sql");
const journeyReadiness = read("../drizzle/0036_synthetic_journey_readiness.sql");
const catalogueReadiness = read("../drizzle/0037_synthetic_catalogue_readiness.sql");
const purchasingWalkthrough = read("../drizzle/0038_complete_trade_purchasing_walkthrough.sql");
const generator = read("../scripts/seed-synthetic-population.mjs");
const validator = read("../scripts/validate-synthetic-population.mjs");
const directoryRoute = read("../src/app/api/admin/directory/route.ts");
const accountRoute = read("../src/app/api/admin/accounts/route.ts");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const customerProjects = read("../src/app/api/customer-projects/route.ts");
const customerAccount = read("../src/app/api/customer-account/route.ts");
const supplierProducts = read("../src/app/api/supplier-products/route.ts");

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

test("the benchmark uses the production customer-project path and six installer recipients", () => {
  assert.match(generator, /sql\(opportunityId\)/);
  assert.match(generator, /rank < 6/);
  assert.match(validator, /matches: 1200/);
  assert.match(ecosystemRepair, /SET `source_reference` = `id`/);
  assert.match(ecosystemRepair, /6 - existing_count/);
  assert.match(customerProjects, /COALESCE\(is_synthetic, 0\) is_synthetic/);
  assert.match(customerProjects, /created_by_uid, is_synthetic, created_at/);
  assert.match(customerProjects, /!user\.emailVerified && !Boolean\(current\.is_synthetic\)/);
  assert.match(customerAccount, /user\.emailVerified \|\| Boolean\(record\?\.is_synthetic\)/);
  assert.match(supplierProducts, /review_note, is_synthetic, created_at/);
  assert.match(supplierProducts, /identity\.isSynthetic/);
  assert.match(journeyReadiness, /service_radius_km` = 5000/);
  assert.match(journeyReadiness, /lower-bills/);
  assert.match(catalogueReadiness, /Synthetic walkthrough auto-approval/);
  assert.match(supplierProducts, /identity\.isSynthetic \? "approved" : "pending"/);
  assert.match(supplierProducts, /!identity\.isSynthetic && values\.listingStatus/);
});

test("seed data is notification free and maintains the protected household boundary", () => {
  assert.doesNotMatch(population, /admin_notifications|notification_deliveries|email_outbox|stripe/);
  assert.match(population, /Synthetic private planning note/);
  assert.match(population, /Synthetic anonymised/);
  assert.match(population, /INSERT OR IGNORE INTO customer_accounts\s+\(firebase_uid, email, display_name, postcode, address_state/);
  assert.match(population, /INSERT OR IGNORE INTO trade_opportunities\s+\(id, title, project_type, postcode, state, service_categories/);
});

test("the synthetic trade walkthrough covers enquiry, order, partial supply, completion and warranty", () => {
  assert.match(purchasingWalkthrough, /supplier_product_enquiries/);
  assert.match(purchasingWalkthrough, /'responded'/);
  assert.match(purchasingWalkthrough, /'part_fulfilled'/);
  assert.match(purchasingWalkthrough, /'fulfilled'/);
  assert.match(purchasingWalkthrough, /trade_warranty_claims/);
  assert.match(purchasingWalkthrough, /postcode-level planning only/i);
  assert.doesNotMatch(purchasingWalkthrough, /customer_accounts|customer_projects|street_address|customer_email|customer_phone/);
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
