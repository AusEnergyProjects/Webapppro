function checkedSqlAlias(alias: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error("A static SQL table alias is required.");
  }
  return alias;
}

function validAbnSqlPredicate(alias: string) {
  const account = checkedSqlAlias(alias);
  return `length(${account}.abn) = 11
    AND ${account}.abn NOT GLOB '*[^0-9]*'
    AND (
      ((CAST(substr(${account}.abn, 1, 1) AS INTEGER) - 1) * 10)
      + (CAST(substr(${account}.abn, 2, 1) AS INTEGER) * 1)
      + (CAST(substr(${account}.abn, 3, 1) AS INTEGER) * 3)
      + (CAST(substr(${account}.abn, 4, 1) AS INTEGER) * 5)
      + (CAST(substr(${account}.abn, 5, 1) AS INTEGER) * 7)
      + (CAST(substr(${account}.abn, 6, 1) AS INTEGER) * 9)
      + (CAST(substr(${account}.abn, 7, 1) AS INTEGER) * 11)
      + (CAST(substr(${account}.abn, 8, 1) AS INTEGER) * 13)
      + (CAST(substr(${account}.abn, 9, 1) AS INTEGER) * 15)
      + (CAST(substr(${account}.abn, 10, 1) AS INTEGER) * 17)
      + (CAST(substr(${account}.abn, 11, 1) AS INTEGER) * 19)
    ) % 89 = 0`;
}

export function approvedTradeReviewPredicate(alias: string) {
  const account = checkedSqlAlias(alias);
  return `${account}.verification_review_id <> ''
    AND EXISTS (
      SELECT 1 FROM trade_account_verification_reviews verified_review
      WHERE (verified_review.id, verified_review.firebase_uid, verified_review.abn,
        verified_review.business_name, verified_review.partner_type, verified_review.decision,
        verified_review.review_method, verified_review.reviewed_by_uid, verified_review.reviewed_at) =
        (${account}.verification_review_id, ${account}.firebase_uid, ${account}.verified_abn,
          ${account}.business_name, ${account}.partner_type, 'approved', 'official_abr_lookup',
          ${account}.verification_reviewed_by_uid, ${account}.verification_reviewed_at)
    )`;
}

export function verifiedTradeAccountPredicate(alias: string) {
  const account = checkedSqlAlias(alias);
  return `${account}.partner_type IN ('installer', 'supplier')
    AND (${account}.account_status, ${account}.verification_status,
      ${account}.verified_abn, ${account}.verified_abn <> '',
      ${account}.verification_reviewed_at <> '', ${account}.verification_reviewed_by_uid <> '') =
      ('active', 'approved', ${account}.abn, 1, 1, 1)
    AND (${validAbnSqlPredicate(account)})
    AND (${approvedTradeReviewPredicate(account)})`;
}
