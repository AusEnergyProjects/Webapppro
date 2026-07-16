import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const command = read("../src/components/TLinkCommandCentre.tsx");
const searchRoute = read("../src/app/api/tlink-search/route.ts");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const products = read("../src/components/InstallerProductMarketplace.tsx");
const supplierProducts = read("../src/components/SupplierCatalogueWorkspace.tsx");
const purchasing = read("../src/components/TradePurchasingWorkspace.tsx");
const styles = read("../src/app/globals.css");

test("the TLink command centre uses a bounded role scoped server search", () => {
  assert.match(dashboard, /TLinkCommandCentre/);
  assert.match(command, /\/api\/tlink-search\?q=/);
  assert.doesNotMatch(command, /\/api\/(trade-crm|product-marketplace|supplier-products|trade-purchasing|trade-team)/);
  assert.match(command, /}, 220\)/);
  assert.match(command, /requestRef\.current\?\.abort\(\)/);
  assert.match(searchRoute, /requireFirebaseIdentity/);
  assert.match(searchRoute, /sameOrigin\(request\)/);
  assert.match(searchRoute, /accountEntitlements/);
  assert.match(searchRoute, /RESULT_LIMIT = 32/);
  assert.match(searchRoute, /KIND_LIMIT = 8/);
  assert.match(searchRoute, /\.flat\(\)\.slice\(0, RESULT_LIMIT\)/);
  assert.match(searchRoute, /entitlements\.features\.business_operations/);
  assert.match(searchRoute, /entitlements\.features\.installer_marketplace/);
  assert.match(searchRoute, /entitlements\.features\.team_access/);
  assert.match(command, /partnerType === "installer"/);
  assert.match(command, /AEA protected household contact details are never indexed/);
  assert.doesNotMatch(searchRoute, /address_line_1|private_notes|source_reference/);
});

test("command results open the matching focused workspace", () => {
  assert.match(dashboard, /setCommandTarget\(target\)/);
  assert.match(crm, /navigationTarget\.kind === "job"/);
  assert.match(crm, /navigationTarget\.kind === "customer"/);
  assert.match(crm, /navigationTarget\.kind === "new-job"/);
  assert.match(products, /navigationTarget\?\.kind !== "product"/);
  assert.match(supplierProducts, /setCatalogueView\("catalogue"\)/);
  assert.match(purchasing, /setSelectedId\(navigationTarget\.id\)/);
});

test("command search supports keyboard and responsive field use", () => {
  assert.match(command, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(command, /event\.key === "ArrowDown"/);
  assert.match(command, /event\.key === "Enter"/);
  assert.match(command, /AbortController/);
  assert.match(command, /role="dialog"/);
  assert.match(styles, /\.tlink-command-backdrop/);
  assert.match(styles, /\.tlink-command-dialog/);
  assert.match(styles, /align-items: flex-end; padding: 0/);
});

test("the portal brand remains a horizontal row without clipped text", () => {
  assert.match(styles, /\.trade-portal-brand > \.tlink-brand \{[^}]*display: flex;[^}]*flex-direction: row/);
  assert.match(styles, /\.trade-portal-brand \.tlink-brand > span > small \{[^}]*white-space: nowrap/);
});

test("new TLink command copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(command + searchRoute + dashboard, /[\u2013\u2014]/);
});

test("catalogue result sets default to responsive rows and columns", () => {
  assert.match(products, /marketplace-product-columns/);
  assert.match(supplierProducts, /supplier-product-columns/);
  assert.match(styles, /\.marketplace-product-columns/);
  assert.match(styles, /\.supplier-product-columns/);
  assert.match(styles, /\.admin-catalogue-columns/);
  assert.match(styles, /grid-template-columns: minmax\(200px/);
});
