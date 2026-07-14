import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const opportunityServer = read("../src/lib/opportunity-server.ts");
const partnerRoute = read("../src/app/api/trade-opportunities/route.ts");
const supplierRoute = read("../src/app/api/supplier-products/route.ts");
const marketplaceRoute = read("../src/app/api/product-marketplace/route.ts");
const adminMatches = read(
  "../src/app/api/admin/opportunities/matches/route.ts",
);
const supplierUi = read("../src/components/SupplierCatalogueWorkspace.tsx");
const installerUi = read("../src/components/InstallerProductMarketplace.tsx");
const standards = read("../src/app/direct-trade/standards/page.tsx");
const customerBrief = read("../src/components/DirectTradeProjectBrief.tsx");

test("opportunity allocation is capped, proximity based and load balanced", () => {
  assert.match(opportunityServer, /MAX_VISIBLE_INSTALLERS = 6/);
  assert.match(opportunityServer, /Math\.floor\(distanceKm \/ 10\)/);
  assert.match(
    opportunityServer,
    /recentAssignments\s*\+\s*activeAssignments\s*\*\s*2/,
  );
  assert.match(opportunityServer, /distanceBand - right\.distanceBand/);
  assert.match(opportunityServer, /fairnessLoad - right\.fairnessLoad/);
  assert.match(opportunityServer, /service_radius_km/);
  assert.match(opportunityServer, /verification_status = 'approved'/);
  assert.match(
    opportunityServer,
    /availability_status IN \('open', 'limited'\)/,
  );
  assert.match(partnerRoute, /automatic-decline-refill/);
  assert.match(opportunityServer, /automatic-lead-intake/);
  assert.match(
    opportunityServer,
    /directTradeTriage\?\.autoSend === false\s+\? "draft" : "open"/,
  );
});

test("household opportunity exposure, handover, contact and expiry have hard server limits", () => {
  assert.match(opportunityServer, /DEFAULT_CONNECTED_INSTALLERS = 3/);
  assert.match(opportunityServer, /DEFAULT_CONTACT_LIMIT = 2/);
  assert.match(opportunityServer, /OPPORTUNITY_LIFETIME_DAYS = 30/);
  assert.match(opportunityServer, /status = 'expired'/);
  assert.match(partnerRoute, /contact_attempt_count < \(SELECT contact_limit/);
  assert.match(adminMatches, /reached its six-installer visibility limit/);
  assert.match(adminMatches, /reached its installer handover limit/);
  assert.match(standards, /no more than six eligible installers/i);
  assert.match(standards, /no more than two contact attempts/i);
  assert.match(
    customerBrief,
    /up to\s+six\s+eligible installers for up to 30 days/i,
  );
});

test("wholesalers cannot access leads and installers only see approved published products", () => {
  assert.match(
    partnerRoute,
    /Household opportunities are never available to wholesaler accounts/,
  );
  assert.match(
    partnerRoute,
    /Wholesalers cannot access or respond to household opportunities/,
  );
  assert.match(
    adminMatches,
    /Wholesaler accounts cannot receive household opportunities/,
  );
  assert.match(marketplaceRoute, /a\.partner_type = 'supplier'/);
  assert.match(marketplaceRoute, /p\.listing_status = 'published'/);
  assert.match(marketplaceRoute, /p\.review_status = 'approved'/);
  assert.match(marketplaceRoute, /account\.partner_type !== "installer"/);
  assert.doesNotMatch(
    marketplaceRoute,
    /supplier_email|supplier_phone|address_line_1/,
  );
});

test("supplier catalogues are owner scoped and support pricing, order rules, CSV and dependencies", () => {
  assert.match(schema, /sqliteTable\("supplier_products"/);
  assert.match(schema, /sqliteTable\("supplier_product_links"/);
  assert.match(schema, /supplier_products_owner_model_idx/);
  assert.match(supplierRoute, /WHERE firebase_uid = \?/);
  assert.match(supplierRoute, /unit_price_cents_ex_gst/);
  assert.match(supplierRoute, /min_order_qty/);
  assert.match(supplierRoute, /order_increment/);
  assert.match(supplierRoute, /DEPENDENCY_OWNERSHIP/);
  assert.match(supplierRoute, /Import between 1 and 100 catalogue rows/);
  assert.match(supplierUi, /Bulk catalogue import/);
  assert.match(supplierUi, /Download CSV template/);
  assert.match(supplierUi, /Linked products and kit dependencies/);
  assert.match(installerUi, /Prices are wholesaler-supplied before GST/);
});
