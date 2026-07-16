import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0040_dry_pyro.sql");
const shared = read("../src/lib/workspace-list-views.ts");
const tradeRoute = read("../src/app/api/trade-list-views/route.ts");
const adminRoute = read("../src/app/api/admin/list-views/route.ts");
const supplierRoute = read("../src/app/api/supplier-products/route.ts");
const purchasingRoute = read("../src/app/api/trade-purchasing/route.ts");
const directoryRoute = read("../src/app/api/admin/directory/route.ts");
const supplierUi = read("../src/components/SupplierCatalogueWorkspace.tsx");
const purchasingUi = read("../src/components/TradePurchasingWorkspace.tsx");
const crmUi = read("../src/components/InstallerCrmWorkspace.tsx");
const directoryUi = read("../src/components/AdminAccountDirectory.tsx");
const tableTools = read("../src/components/WorkspaceTableTools.tsx");

test("role scoped list views are durable and unique per workspace", () => {
  assert.match(schema, /sqliteTable\("workspace_list_views"/);
  assert.match(schema, /workspace_list_views_owner_view_idx/);
  assert.match(shared, /ON CONFLICT\(owner_uid, owner_scope, view_key\) DO UPDATE/);
  assert.match(shared, /WHERE owner_uid = \? AND owner_scope = \? AND view_key = \?/);
  assert.doesNotMatch(shared, /localStorage|sessionStorage/);
  assert.match(shared, /columnsByView/);
  assert.match(shared, /raw\.columns/);
  const database = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) database.exec(statement);
  const columns = database.prepare("PRAGMA table_info(workspace_list_views)").all().map((column) => column.name);
  assert.deepEqual(columns, ["id", "owner_uid", "owner_scope", "view_key", "preferences", "updated_at"]);
  database.close();
});

test("saved views enforce trade and operations account boundaries", () => {
  assert.match(tradeRoute, /requireFirebaseIdentity/);
  assert.match(tradeRoute, /account_status/);
  assert.match(tradeRoute, /sameOrigin/);
  assert.match(adminRoute, /requireAdminIdentity/);
  assert.match(adminRoute, /sameOrigin/);
  assert.match(tradeRoute, /TRADE_LIST_VIEWS/);
  assert.match(adminRoute, /ADMIN_LIST_VIEWS/);
  assert.match(shared, /"admin-customers"/);
  assert.match(directoryUi, /fixedType/);
  assert.match(directoryUi, /effectiveType/);
});

test("high volume catalogue, order and account indexes use server paging", () => {
  for (const route of [supplierRoute, purchasingRoute, directoryRoute]) {
    assert.match(route, /PAGE_SIZES = new Set\(\[25, 50, 100\]\)/);
    assert.match(route, /LIMIT \? OFFSET \?/);
    assert.match(route, /pageCount: Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)/);
  }
  assert.match(supplierRoute, /SELECT COUNT\(\*\) total FROM supplier_products/);
  assert.match(purchasingRoute, /SELECT COUNT\(\*\) total/);
  assert.match(directoryRoute, /UNION ALL/);
});

test("all business and operations result lists expose consistent saved paging controls", () => {
  for (const ui of [supplierUi, purchasingUi, crmUi, directoryUi]) {
    assert.match(ui, /WorkspaceListControls/);
  }
  assert.match(crmUi, /indexedJobs/);
  assert.match(crmUi, /indexedCustomers/);
  assert.match(crmUi, /jobPagination/);
  assert.match(crmUi, /customerPagination/);
  assert.match(supplierUi, /supplier-catalogue-filters/);
  assert.match(purchasingUi, /purchasing-list-filters/);
  assert.match(supplierUi, /WorkspaceTableTools/);
  assert.match(directoryUi, /WorkspaceTableTools/);
  assert.match(tableTools, /Pin left/);
  assert.match(tableTools, /Export visible \{noun\} CSV/);
  assert.match(tableTools, /\/\^\[=\+\\-@\]\//);
});
