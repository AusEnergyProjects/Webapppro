import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  resolveEntitlements,
} from "../src/lib/direct-trade-entitlements.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const accountRoute = read("../src/app/api/admin/accounts/route.ts");
const opportunityRoute = read("../src/app/api/trade-opportunities/route.ts");
const opportunityServer = read("../src/lib/opportunity-server.ts");
const marketplaceRoute = read("../src/app/api/product-marketplace/route.ts");
const supplierRoute = read("../src/app/api/supplier-products/route.ts");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const adminPortal = read("../src/components/AdminOperationsPortal.tsx");
const adminAccounts = read("../src/components/AdminAccountWorkspace.tsx");

test("free, paid and administrator-granted access resolve independently", () => {
  const freeInstaller = resolveEntitlements("installer", "not_connected");
  assert.equal(freeInstaller.features.installer_leads, false);
  assert.equal(freeInstaller.features.installer_marketplace, false);
  assert.equal(freeInstaller.features.business_operations, false);

  const paidInstaller = resolveEntitlements("installer", "active");
  assert.equal(paidInstaller.features.installer_leads, true);
  assert.equal(paidInstaller.features.installer_marketplace, true);
  assert.equal(paidInstaller.features.business_operations, true);
  assert.equal(paidInstaller.features.advanced_analytics, false);

  const grantedInstaller = resolveEntitlements("installer", "not_connected", [
    {
      featureKey: "installer_leads",
      status: "active",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  ]);
  assert.equal(grantedInstaller.features.installer_leads, true);
  assert.equal(grantedInstaller.features.installer_marketplace, false);

  const expiredSupplier = resolveEntitlements("supplier", "cancelled", [
    {
      featureKey: "supplier_visibility",
      status: "active",
      expiresAt: "2020-01-01T00:00:00.000Z",
    },
  ]);
  assert.equal(expiredSupplier.features.supplier_visibility, false);
});
test("premium grants are durable, role protected and audited", () => {
  assert.match(schema, /sqliteTable\("trade_account_feature_grants"/);
  assert.match(schema, /trade_account_feature_grants_owner_key_idx/);
  assert.match(accountRoute, /Only owners and administrators can change premium feature access/);
  assert.match(accountRoute, /ON CONFLICT\(firebase_uid, feature_key\) DO UPDATE/);
  assert.match(accountRoute, /writeAdminAudit/);
  assert.match(adminPortal, /AdminAccountWorkspace/);
  assert.match(adminAccounts, /Premium feature grants/);
  assert.match(adminAccounts, /Grant expiry/);
});

test("free accounts are excluded at every commercial server boundary", () => {
  assert.match(opportunityRoute, /accountHasFeature/);
  assert.match(opportunityRoute, /Opportunity leads are available with paid membership/);
  assert.match(opportunityServer, /fg\.feature_key = 'installer_leads'/);
  assert.match(marketplaceRoute, /fg\.feature_key = 'supplier_visibility'/);
  assert.match(marketplaceRoute, /installer_marketplace/);
  assert.match(supplierRoute, /supplier_bulk_import/);
  assert.match(dashboard, /No household leads are sent to free installers/);
  assert.match(dashboard, /Unpaid wholesalers remain invisible in installer product selection/);
});
