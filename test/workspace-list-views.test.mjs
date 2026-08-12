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
const adminAccountsRoute = read("../src/app/api/admin/accounts/route.ts");
const adminOpportunitiesRoute = read("../src/app/api/admin/opportunities/route.ts");
const adminProductsRoute = read("../src/app/api/admin/products/route.ts");
const supplierUi = read("../src/components/SupplierCatalogueWorkspace.tsx");
const purchasingUi = read("../src/components/TradePurchasingWorkspace.tsx");
const crmUi = read("../src/components/InstallerCrmWorkspace.tsx");
const directoryUi = read("../src/components/AdminAccountDirectory.tsx");
const adminUi = read("../src/components/AdminOperationsPortal.tsx");
const adminAccountUi = read("../src/components/AdminAccountWorkspace.tsx");
const adminOpportunityUi = read("../src/components/AdminOpportunityWorkspace.tsx");
const adminCatalogueUi = read("../src/components/AdminCatalogueWorkspace.tsx");
const tableTools = read("../src/components/WorkspaceTableTools.tsx");
const savedViewsUi = read("../src/components/WorkspaceSavedViews.tsx");

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
  assert.match(tradeRoute, /requireVerifiedTradeAccess/);
  assert.match(tradeRoute, /TradeAccessError/);
  assert.match(tradeRoute, /sameOrigin/);
  assert.match(adminRoute, /requireAdminIdentity/);
  assert.match(adminRoute, /sameOrigin/);
  assert.match(tradeRoute, /TRADE_LIST_VIEWS/);
  assert.match(adminRoute, /ADMIN_LIST_VIEWS/);
  assert.match(shared, /"admin-customers"/);
  assert.match(shared, /"admin-partners"/);
  assert.match(shared, /"admin-opportunities"/);
  assert.match(shared, /"admin-products"/);
  assert.match(directoryUi, /fixedType/);
  assert.match(directoryUi, /effectiveType/);
});

test("named trade views stay owner and index scoped with a bounded server contract", () => {
  assert.match(shared, /NAMED_LIST_VIEW_LIMIT = 12/);
  assert.match(shared, /namedScope\(ownerScope, viewKey\)/);
  assert.match(shared, /WHERE id = \? AND owner_uid = \? AND owner_scope = \?/);
  assert.match(shared, /SAVED_VIEW_LIMIT/);
  assert.match(tradeRoute, /export async function POST/);
  assert.match(tradeRoute, /presetId\(request\)/);
  assert.match(tradeRoute, /readNamedListViews/);
  assert.match(tradeRoute, /A saved view with that name already exists/);

  const database = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) database.exec(statement);
  const insert = database.prepare(`INSERT INTO workspace_list_views (id, owner_uid, owner_scope, view_key, preferences, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  insert.run("one", "owner-a", "trade:named:installer-jobs", "northside", "{}", "2026-07-21T00:00:00.000Z");
  assert.throws(() => insert.run("two", "owner-a", "trade:named:installer-jobs", "northside", "{}", "2026-07-21T00:00:01.000Z"), /UNIQUE constraint failed/);
  assert.doesNotThrow(() => insert.run("three", "owner-b", "trade:named:installer-jobs", "northside", "{}", "2026-07-21T00:00:02.000Z"));
  assert.doesNotThrow(() => insert.run("four", "owner-a", "trade:named:installer-customers", "northside", "{}", "2026-07-21T00:00:03.000Z"));
  database.close();
});

test("installer indexes apply named views, movable columns and matching visible exports", () => {
  assert.match(crmUi, /WorkspaceSavedViews/);
  assert.match(crmUi, /WorkspaceTableTools/);
  assert.match(crmUi, /downloadAllFilteredJobs/);
  assert.match(crmUi, /Download all filtered jobs CSV/);
  assert.match(crmUi, /safeJobRegisterColumns\(preferences\.jobColumnOrderVersion === 3 \? preferences\.columns : undefined\)/);
  assert.match(crmUi, /downloadWorkspaceCsv\("tlink-customers\.csv"/);
  assert.match(crmUi, /jobCursors\.current = \[""\]; jobTotalReady\.current = false/);
  assert.match(crmUi, /customerCursors\.current = \[""\]; customerTotalReady\.current = false/);
  assert.match(shared, /"installer-jobs": \[\.\.\.JOB_REGISTER_COLUMN_KEYS\]/);
  assert.match(shared, /INSTALLER_JOB_DEFAULT_COLUMNS = \[\.\.\.JOB_REGISTER_COLUMN_KEYS\]/);
  assert.match(shared, /if \(viewKey === "installer-jobs"\) return \{ \.\.\.defaults, jobColumnOrderVersion: 3, columns: \[\.\.\.INSTALLER_JOB_DEFAULT_COLUMNS\] \}/);
  assert.match(shared, /migrateLegacyInstallerJobColumns\?: boolean/);
  assert.match(shared, /Number\(raw\.jobColumnOrderVersion \|\| 0\) < 3/);
  assert.match(shared, /const isLegacyExactOrder = rawColumns\.length === DATAFORCE_JOB_CSV_HEADERS\.length/);
  assert.match(shared, /if \(\(legacyInstallerJobColumns && isLegacyExactOrder\) \|\| !columns\.length\) return \[\.\.\.INSTALLER_JOB_DEFAULT_COLUMNS\]/);
  assert.match(shared, /cleanListView\(viewKey, parsed, \{ migrateLegacyInstallerJobColumns: true \}\)/);
  assert.match(shared, /const preferences = cleanListView\(viewKey, \(raw\.preferences \|\| \{\}\) as Record<string, unknown>\)/);
  assert.match(shared, /return columns\.length \? columns : \[\.\.\.columnsByView\[viewKey\]\]/);
  assert.match(shared, /"installer-customers": \["customer", "firstName", "lastName"/);
  assert.match(savedViewsUi, /Save current view/);
  assert.match(savedViewsUi, /Update view/);
  assert.match(savedViewsUi, /Delete/);
});

test("installer job rows preserve the selected register column grid", () => {
  const jobResultsStart = crmUi.indexOf('aria-label="Job results"');
  assert.notEqual(jobResultsStart, -1);
  const jobResults = crmUi.slice(jobResultsStart, crmUi.indexOf("</section>", jobResultsStart));
  assert.match(
    jobResults,
    /<article key=\{job\.id\} tabIndex=\{0\} className=\{`\$\{registerStyles\.row\} crm-row-open crm-record-data-row crm-index-row`\} style=\{jobGridStyle\}/,
  );
  assert.match(jobResults, /\}>\{jobColumns\.map\(\(key\) => <span className="crm-index-cell" key=\{key\}>\{jobIndexCell\(job, key,/);
  assert.doesNotMatch(
    jobResults,
    /<article key=\{job\.id\} className="crm-row-open"[^>]*><div className="crm-record-data-row crm-index-row"/,
  );
  assert.doesNotMatch(jobResults, /type="checkbox"|crm-row-select/);
  assert.match(jobResults, /jobColumns\.map\(\(key\) => <span key=\{key\}>\{jobIndexColumns\.find/);
  assert.match(crmUi, /if \(key === "contactNumber"\) return record\.contactNumber \? <a[\s\S]*href=\{phoneHref\(record\.contactNumber\)\}/);
});

test("installer saved views retain bounded populated job filters", () => {
  for (const field of ["appointmentId", "scheduledFrom", "scheduledTo", "invoiceStatus", "customerReference", "firstName", "lastName", "street", "state"]) {
    assert.match(shared, new RegExp(`${field}\\?: string`));
    assert.match(shared, new RegExp(`${field}: cleanAdminText\\(raw\\.${field},`));
    assert.match(crmUi, new RegExp(`${field}:`));
  }
  for (const field of ["jobId", "email", "phone", "suburb", "postcode"]) {
    assert.match(crmUi, new RegExp(`${field}:`));
  }
  for (const field of ["operationalStatus", "quoteTotalMin", "quoteTotalMax"]) {
    assert.match(shared, new RegExp(`${field}\\?: string`));
    assert.match(crmUi, new RegExp(`${field}:`));
  }
  assert.match(shared, /JOB_REGISTER_OPERATIONAL_STATUSES/);
  assert.match(shared, /quoteTotalMin: cleanNonNegativeMoneyFilter\(raw\.quoteTotalMin\)/);
  assert.match(shared, /quoteTotalMax: cleanNonNegativeMoneyFilter\(raw\.quoteTotalMax\)/);
});

test("high volume catalogue, order and account indexes use server paging", () => {
  for (const route of [supplierRoute, purchasingRoute, directoryRoute, adminAccountsRoute, adminOpportunitiesRoute, adminProductsRoute]) {
    assert.match(route, /PAGE_SIZES = new Set\(\[25, 50, 100\]\)/);
    assert.match(route, /decodeKeysetCursor/);
    assert.match(route, /keysetAfter/);
    assert.doesNotMatch(route, /LIMIT \? OFFSET \?/);
  }
  assert.match(supplierRoute, /SELECT COUNT\(\*\) total FROM supplier_products/);
  assert.match(purchasingRoute, /SELECT COUNT\(\*\) total/);
  assert.match(directoryRoute, /UNION ALL/);
  assert.doesNotMatch(adminAccountsRoute, /LIMIT 2000/);
  assert.doesNotMatch(adminOpportunitiesRoute, /LIMIT 1000/);
  assert.match(supplierRoute, /mode"\) === "lookup"/);
  assert.match(adminProductsRoute, /review_status = 'pending'/);
});

test("all business and operations result lists expose consistent saved paging controls", () => {
  for (const ui of [supplierUi, purchasingUi, crmUi, directoryUi, adminAccountUi, adminOpportunityUi, adminCatalogueUi]) {
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
  assert.match(tableTools, /`Export visible \$\{noun\} CSV`/);
  assert.match(tableTools, /\/\^\[=\+\\-@\]\//);
  assert.match(adminUi, /AdminAccountWorkspace/);
  assert.match(adminAccountUi, /admin-partners/);
  assert.match(adminOpportunityUi, /admin-opportunities/);
  assert.match(adminCatalogueUi, /admin-products/);
});
