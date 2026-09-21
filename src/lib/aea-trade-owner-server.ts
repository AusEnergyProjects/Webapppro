import { opportunityServiceScopeSqlParts } from "./aea-trade-routing.mjs";
import { PUBLIC_SITE } from "./public-site";
import { isValidAbn } from "./trade-abn";

function qualifiedColumn(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("A static qualified SQL column is required.");
  }
  return value;
}

// A business name or email does not establish authority over retained Australian Energy Assessments leads.
// Both the current authoritative ABN review and the bound operations identity do.
export function aeaTradeOwnerSql(ownerColumn: string) {
  const owner = qualifiedColumn(ownerColumn);
  const abn = PUBLIC_SITE.abn.replace(/\D/g, "");
  if (!isValidAbn(abn)) throw new Error("The Australian Energy Assessments ABN is invalid.");
  return `EXISTS (SELECT 1 FROM trade_accounts aea_account
    JOIN admin_users aea_admin ON aea_admin.firebase_uid = aea_account.firebase_uid
    JOIN trade_account_verification_reviews aea_review ON
      (aea_review.id, aea_review.firebase_uid, aea_review.abn, aea_review.business_name,
       aea_review.partner_type, aea_review.decision, aea_review.review_method,
       aea_review.reviewed_by_uid, aea_review.reviewed_at) =
      (aea_account.verification_review_id, aea_account.firebase_uid, aea_account.verified_abn,
       aea_account.business_name, aea_account.partner_type, 'approved', 'official_abr_lookup',
       aea_account.verification_reviewed_by_uid, aea_account.verification_reviewed_at)
    WHERE (aea_account.firebase_uid, aea_account.abn, aea_account.verified_abn,
      aea_account.partner_type, aea_account.account_status, aea_account.verification_status, aea_admin.status) =
      (${owner}, '${abn}', '${abn}', 'installer', 'active', 'approved', 'active')
      AND (aea_account.verification_review_id <> '', aea_account.verification_reviewed_at <> '',
        aea_account.verification_reviewed_by_uid <> '') = (1, 1, 1)
      AND aea_admin.role IN ('owner', 'admin'))`;
}

export function tradeOpportunityOwnerScopeSql(opportunityAlias: string, ownerColumn: string) {
  const { raw, reserved } = opportunityServiceScopeSqlParts(opportunityAlias);
  return `(CASE WHEN json_valid(${raw}) THEN
    ((json_type(${raw}), json_array_length(${raw}) > 0) = ('array', 1)
      AND NOT EXISTS (SELECT 1 FROM json_each(${raw}) scope_service
        WHERE scope_service.type <> 'text' OR trim(scope_service.value) = ''
          OR (lower(trim(scope_service.value)) IN (${reserved}) AND NOT ${aeaTradeOwnerSql(ownerColumn)})))
    ELSE 0 END)`;
}

export async function isAeaTradeOwner(db: D1Database, ownerUid: string) {
  return Boolean(await db.prepare(`SELECT 1 FROM (SELECT ? owner_uid) recipient
    WHERE ${aeaTradeOwnerSql("recipient.owner_uid")}`).bind(ownerUid).first());
}
