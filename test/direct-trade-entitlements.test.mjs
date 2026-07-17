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

test("verification, not billing, controls core trade access", () => {
  const unverifiedInstaller = resolveEntitlements("installer", "active", [], false);
  assert.equal(unverifiedInstaller.features.installer_leads, false);
  assert.equal(unverifiedInstaller.features.business_operations, false);

  const verifiedFreeInstaller = resolveEntitlements("installer", "not_connected", [], true);
  const verifiedPaidInstaller = resolveEntitlements("installer", "active", [], true);
  for (const entitlements of [verifiedFreeInstaller, verifiedPaidInstaller]) {
    assert.equal(entitlements.features.installer_leads, true);
    assert.equal(entitlements.features.installer_marketplace, true);
    assert.equal(entitlements.features.business_operations, true);
    assert.equal(entitlements.features.team_access, true);
    assert.equal(entitlements.features.advanced_analytics, false);
  }

  const grantedInstaller = resolveEntitlements("installer", "not_connected", [
    {
      featureKey: "installer_leads",
      status: "active",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  ], true);
  assert.equal(grantedInstaller.features.installer_leads, true);
  assert.equal(grantedInstaller.features.installer_marketplace, true);

  const expiredSupplier = resolveEntitlements("supplier", "cancelled", [
    {
      featureKey: "advanced_analytics",
      status: "active",
      expiresAt: "2020-01-01T00:00:00.000Z",
    },
  ], true);
  assert.equal(expiredSupplier.features.supplier_visibility, true);
  assert.equal(expiredSupplier.features.advanced_analytics, false);
});
test("administrator grants are durable, role protected and audited", () => {
  assert.match(schema, /sqliteTable\("trade_account_feature_grants"/);
  assert.match(schema, /trade_account_feature_grants_owner_key_idx/);
  assert.match(accountRoute, /Only owners and administrators can change premium feature access/);
  assert.match(accountRoute, /ON CONFLICT\(firebase_uid, feature_key\) DO UPDATE/);
  assert.match(accountRoute, /writeAdminAudit/);
  assert.match(adminPortal, /AdminAccountWorkspace/);
  assert.match(adminAccounts, /Administrator feature grants/);
  assert.match(adminAccounts, /Grant expiry/);
});

test("verified free accounts pass core server boundaries while privacy and roles remain enforced", () => {
  assert.match(opportunityRoute, /accountHasFeature/);
  assert.match(opportunityRoute, /Complete trade verification before opening marketplace opportunities/);
  assert.match(opportunityServer, /a\.verification_status = 'approved'/);
  assert.doesNotMatch(opportunityServer, /fg\.feature_key = 'installer_leads'/);
  assert.match(marketplaceRoute, /a\.verification_status = 'approved'/);
  assert.match(marketplaceRoute, /installer_marketplace/);
  assert.match(supplierRoute, /supplier_bulk_import/);
  assert.match(dashboard, /No card or subscription is required/);
  assert.doesNotMatch(dashboard, /Paid feature/);
});
