import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const marketplaceRoute = read("../src/app/api/product-marketplace/route.ts");
const supplierRoute = read("../src/app/api/product-marketplace/supplier/route.ts");
const searchRoute = read("../src/app/api/tlink-search/route.ts");
const accessServer = read("../src/lib/trade-access-server.ts") + read("../src/lib/trade-account-predicates.ts");

test("supplier marketplace surfaces use the authoritative ABN review predicate", () => {
  assert.match(
    marketplaceRoute,
    /const eligibleSupplierSql = `[\s\S]*a\.partner_type = 'supplier'[\s\S]*verifiedTradeAccountPredicate\("a"\)/,
  );
  assert.match(
    supplierRoute,
    /FROM trade_accounts supplier WHERE supplier\.firebase_uid = \? AND supplier\.partner_type = 'supplier'[\s\S]*verifiedTradeAccountPredicate\("supplier"\)/,
  );
  assert.match(searchRoute, /ownAccount\?\.partnerType === "supplier"[\s\S]*requireVerifiedTradeIdentity\(identity, \{ partnerTypes: \["supplier"\] \}\)/);
  assert.match(searchRoute, /teamAccess = await requireInstallerTeamAccess\(request\);\s*partnerType = "installer";\s*ownerUid = teamAccess\.ownerUid/);
  assert.match(searchRoute, /partnerType === "supplier" && matches\("product", selectedKind\)[\s\S]*FROM supplier_products WHERE firebase_uid = \?/);
  assert.doesNotMatch(searchRoute, /FROM supplier_products p JOIN trade_accounts/);

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
  const comparison = accessServer.match(/WHERE \(verified_review\.id,([\s\S]*?)\) =\s*\(([\s\S]*?)\)/);
  assert.ok(comparison, "current review fields must be compared atomically");
  assert.deepEqual(('verified_review.id,' + comparison[1]).split(',').map(field => field.trim()), [
    'verified_review.id', 'verified_review.firebase_uid', 'verified_review.abn', 'verified_review.business_name',
    'verified_review.partner_type', 'verified_review.decision', 'verified_review.review_method',
    'verified_review.reviewed_by_uid', 'verified_review.reviewed_at',
  ]);
  assert.deepEqual(comparison[2].split(',').map(field => field.trim()), [
    '${account}.verification_review_id', '${account}.firebase_uid', '${account}.verified_abn',
    '${account}.business_name', '${account}.partner_type', "'approved'", "'official_abr_lookup'",
    '${account}.verification_reviewed_by_uid', '${account}.verification_reviewed_at',
  ]);
});
