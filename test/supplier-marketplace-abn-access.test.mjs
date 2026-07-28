import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const marketplaceRoute = read("../src/app/api/product-marketplace/route.ts");
const supplierRoute = read("../src/app/api/product-marketplace/supplier/route.ts");
const searchRoute = read("../src/app/api/tlink-search/route.ts");
const accessServer = read("../src/lib/trade-access-server.ts");

test("supplier marketplace surfaces use the authoritative ABN review predicate", () => {
  assert.match(
    marketplaceRoute,
    /const eligibleSupplierSql = `[\s\S]*a\.partner_type = 'supplier'[\s\S]*verifiedTradeAccountPredicate\("a"\)/,
  );
  assert.match(
    supplierRoute,
    /FROM trade_accounts supplier WHERE supplier\.firebase_uid = \? AND supplier\.partner_type = 'supplier'[\s\S]*verifiedTradeAccountPredicate\("supplier"\)/,
  );
  assert.match(
    searchRoute,
    /FROM supplier_products p JOIN trade_accounts a[\s\S]*a\.partner_type = 'supplier'[\s\S]*verifiedTradeAccountPredicate\("a"\)/,
  );

  for (const route of [marketplaceRoute, supplierRoute, searchRoute]) {
    assert.doesNotMatch(
      route,
      /verification_status = 'approved'[\s\S]{0,220}verification_reviewed_by_uid/,
      "supplier eligibility must not copy a projection-only approval check",
    );
  }
});

test("the shared supplier predicate binds approval to the exact authoritative review row", () => {
  assert.match(
    accessServer,
    /export function verifiedTradeAccountPredicate[\s\S]*approvedTradeReviewPredicate\(account\)/,
  );
  assert.match(
    accessServer,
    /verified_review\.id = \$\{account\}\.verification_review_id/,
  );
  assert.match(
    accessServer,
    /verified_review\.firebase_uid = \$\{account\}\.firebase_uid/,
  );
  assert.match(
    accessServer,
    /verified_review\.abn = \$\{account\}\.verified_abn/,
  );
  assert.match(
    accessServer,
    /verified_review\.business_name = \$\{account\}\.business_name/,
  );
  assert.match(
    accessServer,
    /verified_review\.partner_type = \$\{account\}\.partner_type/,
  );
  assert.match(accessServer, /verified_review\.decision = 'approved'/);
  assert.match(accessServer, /verified_review\.review_method = 'official_abr_lookup'/);
  assert.match(
    accessServer,
    /verified_review\.reviewed_by_uid = \$\{account\}\.verification_reviewed_by_uid/,
  );
  assert.match(
    accessServer,
    /verified_review\.reviewed_at = \$\{account\}\.verification_reviewed_at/,
  );
});
