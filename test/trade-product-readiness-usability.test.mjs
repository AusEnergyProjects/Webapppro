import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("catalogue header filters support include, exclude and search", () => {
  const component = read("src/components/MarketplaceColumnFilter.tsx");
  const catalogue = read("src/components/InstallerProductMarketplace.tsx");
  const route = read("src/app/api/product-marketplace/route.ts");
  for (const phrase of ["Search {label.toLowerCase()}", 'kind: "include" | "exclude"', "Clear {label.toLowerCase()} filter"]) assert.match(component, new RegExp(phrase.replace(/[{}().*+?^$|[\]\\]/g, "\\$&")));
  for (const phrase of ["supplierInclude", "supplierExclude", "brandInclude", "brandExclude", "modelInclude", "modelExclude"]) { assert.match(catalogue, new RegExp(phrase)); assert.match(route, new RegExp(phrase)); }
});

test("catalogue exposes horizontal navigation and wholesaler profiles", () => {
  const catalogue = read("src/components/InstallerProductMarketplace.tsx");
  const profile = read("src/components/WholesalerProfileDrawer.tsx");
  const route = read("src/app/api/product-marketplace/supplier/route.ts");
  assert.match(catalogue, /Scroll left/); assert.match(catalogue, /Scroll right/); assert.match(catalogue, /setProfileSupplierUid\(product\.supplierUid\)/);
  assert.match(profile, /Dispatch and warehouse locations/); assert.match(profile, /Approved product catalogue/);
  assert.match(route, /trade_supplier_locations/); assert.match(route, /verification_status = 'approved'/);
  const manager = read("src/components/SupplierLocationManager.tsx");
  const locations = read("src/app/api/supplier-locations/route.ts");
  assert.match(manager, /Dispatch and warehouse locations/); assert.match(manager, /Location saved to your installer-facing TLink profile/);
  assert.match(locations, /head_office/); assert.match(locations, /warehouse/); assert.match(locations, /dispatch/); assert.match(locations, /showroom/);
});

test("accepted scope becomes an explicitly gated ready job", () => {
  const route = read("src/app/api/trade-job-readiness/route.ts");
  const panel = read("src/components/TradeJobReadinessPanel.tsx");
  for (const check of ["scope", "forms", "people", "materials", "deposit"]) assert.match(route, new RegExp(`${check}:`));
  assert.match(route, /trade_crm_job_plans/); assert.match(route, /job_plan_prepared/); assert.match(route, /stage = 'ready'/);
  assert.match(panel, /Prepare ready-to-run job/); assert.match(panel, /Confirm only what still needs a human decision/); assert.match(panel, /Mark ready to schedule/);
});

test("roster-only people can be assigned while login access remains separate", () => {
  const route = read("src/app/api/trade-team/route.ts");
  const centre = read("src/components/TradeTeamCentre.tsx");
  assert.match(route, /status IN \('active', 'invited'\)/);
  assert.match(route, /action === "add_member"/);
  assert.match(centre, /They can be assigned now/); assert.match(centre, /Create login/);
});
