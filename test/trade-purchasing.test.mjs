import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const route = read("../src/app/api/trade-purchasing/route.ts");
const ui = read("../src/components/TradePurchasingWorkspace.tsx");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");

test("trade purchasing stores durable system-numbered orders, events and warranty claims", () => {
  assert.match(schema, /sqliteTable\("trade_purchase_orders"/);
  assert.match(schema, /sqliteTable\("trade_purchase_order_items"/);
  assert.match(schema, /sqliteTable\("trade_purchase_order_events"/);
  assert.match(schema, /sqliteTable\("trade_warranty_claims"/);
  assert.match(route, /nextTradeWorkNumber\(db, identity\.uid, "PO"/);
  assert.match(route, /nextTradeWorkNumber\(db, identity\.uid, "WTY"/);
  assert.match(schema, /trade_purchase_orders_enquiry_idx/);
});

test("orders are created only from a wholesaler response and snapshot selected commercial items", () => {
  assert.match(route, /e\.status = 'responded'/);
  assert.match(route, /po\.id IS NULL/);
  assert.match(route, /installer_product_list_items/);
  assert.match(route, /supplier_product_id, model_number, brand, product_name/);
  assert.match(route, /Math\.round\(subtotal \* 0\.1\)/);
});

test("purchasing access is owner scoped and requires Business Hub entitlement", () => {
  assert.match(route, /accountHasFeature/);
  assert.match(route, /"business_operations"/);
  assert.match(route, /WHERE po\.\$\{ownerColumn\} = \?/);
  assert.match(route, /WHERE id = \? AND \$\{ownerColumn\} = \?/);
  assert.match(dashboard, /TradePurchasingWorkspace/);
});

test("the B2B purchasing workflow never selects household identity or street address data", () => {
  assert.doesNotMatch(route, /customer_accounts|customer_projects|address_line_1|customer_email|customer_phone/);
  assert.match(ui, /Household names, contacts and street addresses are never included/);
  assert.match(ui, /Never add a household address/);
});

test("purchasing copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(route + ui + dashboard, /[\u2013\u2014]/);
});
