import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  FEATURE_DEFINITIONS,
  resolveEntitlements,
} from "../src/lib/direct-trade-entitlements.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const accountRoute = read("../src/app/api/admin/accounts/route.ts");
const entitlementServer = read("../src/lib/direct-trade-entitlements-server.ts");
const accessServer = read("../src/lib/trade-access-server.ts");
const opportunityRoute = read("../src/app/api/trade-opportunities/route.ts");
const opportunityServer = read("../src/lib/opportunity-server.ts");
const marketplaceRoute = read("../src/app/api/product-marketplace/route.ts");
const supplierRoute = read("../src/app/api/supplier-products/route.ts");
const listViewsRoute = read("../src/app/api/trade-list-views/route.ts");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const adminPortal = read("../src/components/AdminOperationsPortal.tsx");
const adminAccounts = read("../src/components/AdminAccountWorkspace.tsx");

test("unreviewed trade accounts receive no operational role features", () => {
  for (const role of ["installer", "supplier"]) {
    const entitlements = resolveEntitlements(role, false);
    assert.equal(entitlements.verified, false);
    assert.equal(entitlements.accessLabel, "ABN review required");
    assert.deepEqual(Object.values(entitlements.features), [
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  }
});

test("reviewed accounts receive every free core feature for their exact role", () => {
  const installer = resolveEntitlements("installer", true);
  assert.equal(installer.verified, true);
  assert.equal(installer.accessLabel, "Verified trade access");
  assert.deepEqual(installer.features, {
    installer_leads: true,
    installer_marketplace: true,
    supplier_visibility: false,
    supplier_bulk_import: false,
    business_operations: true,
    team_access: true,
  });

  const supplier = resolveEntitlements("supplier", true);
  assert.deepEqual(supplier.features, {
    installer_leads: false,
    installer_marketplace: false,
    supplier_visibility: true,
    supplier_bulk_import: true,
    business_operations: true,
    team_access: true,
  });
  assert.ok(FEATURE_DEFINITIONS.every((feature) => feature.tier === "core"));
});

test("retired account pricing and feature-grant surfaces are absent from current product truth", () => {
  assert.doesNotMatch(schema, /sqliteTable\("trade_account_feature_grants"/);
  assert.doesNotMatch(accountRoute, /featureKey|featureGrant|grantExpiresAt/);
  assert.doesNotMatch(adminAccounts, /Administrator feature grants|Grant expiry/);
  assert.doesNotMatch(dashboard, /advanced_analytics|Paid feature/);
  assert.match(adminPortal, /AdminAccountWorkspace/);
  assert.match(adminAccounts, /every role-appropriate core tool/);
  assert.match(adminAccounts, /official ABN Register record/);
});

test("the reviewed ABN projection is shared by entitlements and operational server gates", () => {
  assert.match(entitlementServer, /tradeAccountProjection/);
  assert.match(entitlementServer, /account\?\.approvedAbnAccess/);
  assert.match(accessServer, /normalizeAbn\(account\.verifiedAbn\) === abn/);
  assert.match(accessServer, /Boolean\(account\.verificationReviewedAt\)/);
  assert.match(accessServer, /Boolean\(account\.verificationReviewedByUid\)/);
  assert.match(accessServer, /ABN_REVIEW_REQUIRED/);
  for (const route of [opportunityRoute, marketplaceRoute, supplierRoute, listViewsRoute]) {
    assert.match(
      route,
      /requireVerifiedTradeAccess|accountHasFeature/,
      "operational trade route must use a shared reviewed-access boundary",
    );
  }
  assert.match(opportunityServer, /verifiedTradeAccountPredicate\("a"\)/);
  assert.doesNotMatch(opportunityServer, /fg\.feature_key = 'installer_leads'/);
  assert.match(dashboard, /No payment details are required/);
  assert.match(dashboard, /Trade access is locked until approval/);
  assert.match(dashboard, /no trade workspace or operational data is\s+available until an authorised reviewer approves the current ABN/);
});
