import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const opportunityServer = read("../src/lib/opportunity-server.ts");
const partnerRoute = read("../src/app/api/trade-opportunities/route.ts");
const supplierRoute = read("../src/app/api/supplier-products/route.ts");
const marketplaceRoute = read("../src/app/api/product-marketplace/route.ts");
const marketplacePreferencesRoute = read("../src/app/api/product-marketplace/preferences/route.ts");
const marketplacePreferencesMigration = read("../drizzle/0039_exotic_mulholland_black.sql");
const adminMatches = read(
  "../src/app/api/admin/opportunities/matches/route.ts",
);
const supplierUi = read("../src/components/SupplierCatalogueWorkspace.tsx");
const installerUi = read("../src/components/InstallerProductMarketplace.tsx");
const standards = read("../src/app/direct-trade/standards/page.tsx");
const customerBrief = read("../src/components/DirectTradeProjectBrief.tsx");
const billing = read("../src/lib/direct-trade-billing.ts");
const stripeWebhook = read("../src/app/api/stripe/webhook/route.ts");
const membership = read("../src/app/direct-trade/membership/page.tsx");

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

test("household opportunity exposure, platform response and expiry have hard server limits", () => {
  assert.match(opportunityServer, /DEFAULT_CONNECTED_INSTALLERS = 3/);
  assert.match(opportunityServer, /OPPORTUNITY_LIFETIME_DAYS = 30/);
  assert.match(opportunityServer, /status = 'expired'/);
  assert.match(opportunityServer, /const lifetimeRecipientCount = existing\.results\.length/);
  assert.match(
    opportunityServer,
    /MAX_VISIBLE_INSTALLERS - lifetimeRecipientCount/,
  );
  assert.match(opportunityServer, /!previouslyMatched\.has/);
  assert.match(partnerRoute, /action === "record_contact"/);
  assert.match(partnerRoute, /Direct customer contact is not available/);
  assert.match(partnerRoute, /action === "submit_quote"/);
  assert.match(partnerRoute, /normalizePlatformQuote/);
  assert.match(partnerRoute, /INSERT INTO customer_project_quotes/);
  assert.match(partnerRoute, /postcode: ""/);
  assert.match(partnerRoute, /distanceBand: distanceBand/);
  assert.match(partnerRoute, /This opportunity response cannot be reversed/);
  assert.match(adminMatches, /reached its six-installer visibility limit/);
  assert.match(adminMatches, /progress to platform coordination/);
  assert.match(adminMatches, /reached its platform coordination limit/);
  assert.match(standards, /no more than six eligible installers/i);
  assert.match(standards, /Household contact stays private/i);
  assert.match(standards, /respond through structured platform controls/i);
  assert.match(
    customerBrief,
    /without direct trade contact/i,
  );
  assert.match(customerBrief, /No direct messages or contact details are exchanged/i);
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
  assert.match(partnerRoute, /p\.listing_status = 'published'/);
  assert.doesNotMatch(partnerRoute, /p\.listing_status = 'live'/);
  assert.match(marketplaceRoute, /p\.review_status = 'approved'/);
  assert.match(marketplaceRoute, /offset \+= 80/);
  assert.match(marketplaceRoute, /ids\.slice\(offset, offset \+ 80\)/);
  assert.match(marketplaceRoute, /account\.partner_type !== "installer"/);
  assert.match(marketplaceRoute, /a\.service_states supplier_service_states/);
  assert.match(marketplaceRoute, /a\.business_name \|\| ' ' \|\| p\.category\) LIKE/);
  assert.match(installerUi, /Product name A to Z/);
  assert.match(installerUi, /Wholesaler A to Z/);
  assert.match(installerUi, /Available in state/);
  assert.match(installerUi, /Maximum lead time/);
  assert.match(installerUi, /Minimum warranty/);
  assert.match(installerUi, /Clear all filters/);
  assert.doesNotMatch(
    marketplaceRoute,
    /supplier_email|supplier_phone|address_line_1/,
  );
});

test("installer catalogue queries are paginated, server filtered and return bounded facets", () => {
  assert.match(marketplaceRoute, /SELECT COUNT\(\*\) total/);
  assert.match(marketplaceRoute, /LIMIT \? OFFSET \?/);
  assert.match(marketplaceRoute, /PAGE_SIZES = new Set\(\[25, 50, 100\]\)/);
  assert.match(marketplaceRoute, /p\.unit_price_cents_ex_gst >= \?/);
  assert.match(marketplaceRoute, /p\.lead_time_days <= \?/);
  assert.match(marketplaceRoute, /a\.service_states LIKE \?/);
  assert.match(marketplaceRoute, /SORTS\[sort\]/);
  assert.match(marketplaceRoute, /pagination: \{ page, pageSize, pageCount, total \}/);
  assert.match(marketplaceRoute, /facets:/);
  assert.doesNotMatch(marketplaceRoute, /LIMIT 300/);
  assert.match(installerUi, /Rows per page/);
  assert.match(installerUi, /aria-label="Catalogue pages"/);
  assert.match(installerUi, /}, 250\)/);
  assert.match(installerUi, /AbortController/);
});

test("installer catalogue filters and columns persist to the authenticated account", () => {
  assert.match(schema, /sqliteTable\("installer_catalogue_preferences"/);
  assert.match(schema, /installer_catalogue_preferences_updated_idx/);
  assert.match(marketplacePreferencesMigration, /CREATE TABLE `installer_catalogue_preferences`/);
  assert.match(marketplacePreferencesRoute, /requireFirebaseIdentity/);
  assert.match(marketplacePreferencesRoute, /sameOrigin/);
  assert.match(marketplacePreferencesRoute, /accountHasFeature/);
  assert.match(marketplacePreferencesRoute, /ON CONFLICT\(firebase_uid\) DO UPDATE/);
  assert.match(marketplacePreferencesRoute, /WHERE firebase_uid = \?/);
  assert.match(marketplacePreferencesRoute, /export async function DELETE/);
  assert.match(installerUi, /Save this view/);
  assert.match(installerUi, /Restore default/);
  assert.match(installerUi, /visibleColumns/);
  assert.doesNotMatch(marketplacePreferencesRoute, /localStorage|sessionStorage/);
});

test("installer catalogue preference migration applies cleanly", () => {
  const database = new DatabaseSync(":memory:");
  for (const statement of marketplacePreferencesMigration.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
  const columns = database.prepare("PRAGMA table_info(installer_catalogue_preferences)").all().map((column) => column.name);
  assert.deepEqual(columns, [
    "firebase_uid", "search", "category", "supplier_uid", "brand", "service_state",
    "stock_status", "minimum_price_cents", "maximum_price_cents", "maximum_lead_days",
    "minimum_warranty_years", "sort_key", "page_size", "visible_columns", "updated_at",
  ]);
  database.close();
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
  assert.match(supplierRoute, /cleanModelDependencies/);
  assert.match(supplierRoute, /linkedModelNumber/);
  assert.match(supplierRoute, /dependenciesImported/);
  assert.match(supplierRoute, /Import between 1 and 100 catalogue rows/);
  assert.match(supplierUi, /Bulk catalogue import/);
  assert.match(supplierUi, /Download completed CSV demo/);
  assert.match(supplierUi, /dependency_model_numbers/);
  assert.match(supplierUi, /EASYFIT-250\|PLINTH-250/);
  assert.match(supplierUi, /Linked products and kit dependencies/);
  assert.match(installerUi, /Prices are wholesaler-supplied before GST/);
});

test("Stripe memberships are account matched, signed and term aware", () => {
  assert.match(billing, /client_reference_id/);
  assert.match(billing, /prefilled_email/);
  assert.match(billing, /billing\.stripe\.com\/p\/login/);
  assert.match(stripeWebhook, /verifyStripeSignature/);
  assert.match(stripeWebhook, /PLAN_BY_PAYMENT_LINK/);
  assert.match(stripeWebhook, /checkout\.session\.completed/);
  assert.match(stripeWebhook, /customer\.subscription\.updated/);
  assert.match(stripeWebhook, /active_cancels_at_period_end/);
  assert.match(membership, /Cancel any time/);
  assert.match(membership, /prepaid 12-month term/i);
  assert.match(membership, /Australian Consumer Law/);
});
