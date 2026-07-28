import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isValidAbn,
  normalizeAbn,
  officialAbnLookupUrl,
} from "../src/lib/trade-abn.ts";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const migration = read("../drizzle/0079_trade_abn_access_gate.sql");
const adminAccounts = read("../src/app/api/admin/accounts/route.ts");
const tradeProfile = read("../src/app/api/trade-profile/route.ts");
const accessServer = read("../src/lib/trade-access-server.ts");
const dashboard = read("../src/components/DirectTradeDashboard.tsx");

function hasApprovedAbnProjection(account) {
  const abn = normalizeAbn(account.abn);
  return (
    (account.partnerType === "installer" || account.partnerType === "supplier") &&
    account.accountStatus === "active" &&
    account.verificationStatus === "approved" &&
    isValidAbn(abn) &&
    normalizeAbn(account.verifiedAbn) === abn &&
    Boolean(account.verificationReviewId) &&
    Boolean(account.verificationReviewedAt) &&
    Boolean(account.verificationReviewedByUid) &&
    account.approvalReviewExists
  );
}

test("ABN validation rejects invalid length and preserves all supplied digits", () => {
  assert.equal(normalizeAbn("51 824 753 556"), "51824753556");
  assert.equal(isValidAbn("51 824 753 556"), true);
  assert.equal(isValidAbn("51 824 753 556 9"), false);
  assert.equal(isValidAbn("51 824 753 557"), false);
  assert.equal(officialAbnLookupUrl("invalid"), "");
  assert.equal(
    officialAbnLookupUrl("51 824 753 556"),
    "https://abr.business.gov.au/ABN/View?abn=51824753556",
  );
});

test("access requires the exact checksum-valid ABN projection recorded by an identified reviewer", () => {
  const approved = {
    abn: "51 824 753 556",
    partnerType: "installer",
    accountStatus: "active",
    verificationStatus: "approved",
    verifiedAbn: "51824753556",
    verificationReviewId: "review-1",
    verificationReviewedAt: "2026-07-28T01:02:03.000Z",
    verificationReviewedByUid: "reviewer-1",
    approvalReviewExists: true,
  };
  assert.equal(hasApprovedAbnProjection(approved), true);
  for (const change of [
    { abn: "51824753557" },
    { partnerType: "unknown" },
    { accountStatus: "suspended" },
    { verificationStatus: "under_review" },
    { verifiedAbn: "53004085616" },
    { verificationReviewId: "" },
    { verificationReviewedAt: "" },
    { verificationReviewedByUid: "" },
    { approvalReviewExists: false },
  ]) {
    assert.equal(hasApprovedAbnProjection({ ...approved, ...change }), false);
  }
  assert.match(accessServer, /account\.accountStatus === "active"/);
  assert.match(accessServer, /account\.partnerType === "installer"/);
  assert.match(accessServer, /account\.verificationStatus === "approved"/);
  assert.match(accessServer, /isValidAbn\(abn\)/);
  assert.match(accessServer, /normalizeAbn\(account\.verifiedAbn\) === abn/);
  assert.match(accessServer, /CAST\(substr\(\$\{account\}\.abn, 1, 1\) AS INTEGER\) - 1/);
  assert.match(accessServer, /\) % 89 = 0/);
  assert.match(accessServer, /Boolean\(account\.verificationReviewId\)/);
  assert.match(accessServer, /Boolean\(account\.verificationReviewedAt\)/);
  assert.match(accessServer, /Boolean\(account\.verificationReviewedByUid\)/);
  assert.match(accessServer, /SELECT 1 FROM trade_account_verification_reviews verified_review/);
  assert.match(accessServer, /verified_review\.business_name = \$\{account\}\.business_name/);
  assert.match(accessServer, /verified_review\.partner_type = \$\{account\}\.partner_type/);
  assert.match(accessServer, /account\.verification_status, account\.verified_abn, account\.verification_review_id/);
  assert.match(accessServer, /projection\.approvedAbnAccess = approvedAbnAccess\(projection\)/);
  assert.match(accessServer, /ABN_REVIEW_REQUIRED/);
});

test("approved ABNs have one authoritative owner and duplicate races fail safely", () => {
  assert.match(schema, /trade_accounts_verified_abn_unique_idx/);
  assert.match(migration, /CREATE UNIQUE INDEX `trade_accounts_verified_abn_unique_idx`/);
  assert.match(migration, /WHERE `verified_abn` <> ''/);
  assert.match(adminAccounts, /ABN_ALREADY_APPROVED/);
  assert.match(adminAccounts, /WHERE verified_abn = \? AND firebase_uid <> \? LIMIT 1/);
  assert.match(adminAccounts, /UNIQUE constraint failed: trade_accounts\\\.verified_abn/);
  assert.match(adminAccounts, /Add authorised people through team access instead/);
});

test("admin approval is evidence-backed, append-only and atomically audited", () => {
  assert.match(schema, /sqliteTable\("trade_account_verification_reviews"/);
  assert.match(migration, /CREATE TABLE `trade_account_verification_reviews`/);
  assert.match(migration, /CREATE TRIGGER `trade_account_verification_reviews_no_update`/);
  assert.match(migration, /CREATE TRIGGER `trade_account_verification_reviews_no_delete`/);
  assert.equal(
    (migration.match(/Trade account verification reviews are append-only/g) || []).length,
    2,
  );
  assert.match(adminAccounts, /Record the evidence and reason for this decision/);
  assert.match(adminAccounts, /This account does not have a valid 11-digit ABN/);
  assert.match(adminAccounts, /Record the legal entity name shown in the ABN register/);
  assert.match(adminAccounts, /Choose how the ABN and business identity were reviewed/);
  assert.match(adminAccounts, /Confirm the account against its official ABN Register record/);
  assert.match(adminAccounts, /INSERT INTO trade_account_verification_reviews/);
  assert.match(adminAccounts, /verified_abn = \?, verification_review_id = \?, verification_reviewed_at = \?/);
  assert.match(adminAccounts, /reviewMethod !== "official_abr_lookup"/);
  assert.match(adminAccounts, /WHERE firebase_uid = \? AND abn = \? AND business_name = \? AND partner_type = \?/);
  assert.match(adminAccounts, /ACCOUNT_IDENTITY_CHANGED/);
  assert.match(adminAccounts, /const reviewRecordId = reviewRecordRequired/);
  assert.match(adminAccounts, /SELECT 1 FROM trade_account_verification_reviews\s+WHERE id = \? AND firebase_uid = \?/);
  assert.match(adminAccounts, /INSERT INTO admin_audit_log/);
  assert.match(adminAccounts, /adminAuditStatement\(/);
  assert.match(adminAccounts, /"trade_account\.abn_review"/);
  assert.match(adminAccounts, /await db\.batch\(statements\)/);
});

test("identity changes revoke the saved ABN approval projection", () => {
  assert.ok(
    tradeProfile.indexOf("if (!isValidAbn(abn))") <
      tradeProfile.indexOf("INSERT INTO trade_accounts"),
    "checksum validation must happen before profile persistence",
  );
  assert.match(tradeProfile, /verification_status = CASE/);
  assert.match(tradeProfile, /THEN trade_accounts\.verification_status ELSE 'submitted' END/);
  assert.match(tradeProfile, /verified_abn = CASE/);
  assert.match(tradeProfile, /verification_review_id = CASE/);
  assert.match(tradeProfile, /verification_reviewed_at = CASE/);
  assert.match(tradeProfile, /verification_reviewed_by_uid = CASE/);
  assert.ok(
    (tradeProfile.match(/trade_accounts\.abn = excluded\.abn/g) || []).length >= 5,
    "every approval projection field must compare the submitted ABN",
  );
  assert.ok(
    (tradeProfile.match(/trade_accounts\.business_name = excluded\.business_name/g) || []).length >= 5,
    "every approval projection field must compare the reviewed business name",
  );
  assert.ok(
    (tradeProfile.match(/trade_accounts\.partner_type = excluded\.partner_type/g) || []).length >= 5,
    "every approval projection field must compare the reviewed account role",
  );
});

test("pending accounts see status and evidence actions but no operational workspace", () => {
  const lockIndex = dashboard.indexOf("!profile.entitlements.verified");
  const operationsIndex = dashboard.indexOf("<TradeBusinessHub");
  assert.ok(lockIndex > -1);
  assert.ok(operationsIndex > lockIndex);
  assert.match(dashboard, /Trade access is locked until approval/);
  assert.match(dashboard, /no trade workspace or operational data is\s+available until an authorised reviewer approves the current ABN/);
  assert.match(dashboard, /<TradeAccessPanel profile=\{profile\} \/>/);
});
