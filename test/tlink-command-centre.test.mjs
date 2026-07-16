import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const command = read("../src/components/TLinkCommandCentre.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");
const crm = read("../src/components/InstallerCrmWorkspace.tsx");
const products = read("../src/components/InstallerProductMarketplace.tsx");
const supplierProducts = read("../src/components/SupplierCatalogueWorkspace.tsx");
const purchasing = read("../src/components/TradePurchasingWorkspace.tsx");
const styles = read("../src/app/globals.css");

test("the TLink command centre searches role scoped business records", () => {
  assert.match(dashboard, /TLinkCommandCentre/);
  assert.match(command, /\/api\/trade-crm/);
  assert.match(command, /\/api\/product-marketplace/);
  assert.match(command, /\/api\/supplier-products/);
  assert.match(command, /\/api\/trade-purchasing/);
  assert.match(command, /\/api\/trade-team/);
  assert.match(command, /partnerType === "installer"/);
  assert.match(command, /features\.businessOperations/);
  assert.match(command, /features\.marketplace/);
  assert.match(command, /features\.teamAccess/);
  assert.match(command, /seen\.has\(key\)/);
  assert.match(command, /AEA protected household contact details are never indexed/);
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
  assert.match(command, /loadingRef\.current/);
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
  assert.doesNotMatch(command + dashboard, /[\u2013\u2014]/);
});
