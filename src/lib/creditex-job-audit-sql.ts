export const CREDITEX_INSTALLER_ACCOUNT_SELECT_SQL = `
  SELECT firebase_uid, email, business_name, abn, address_line_1,
    suburb, address_state, postcode, contact_name, phone, partner_type,
    business_website, service_states, capabilities, summary,
    account_status, verification_status, verified_abn,
    verification_review_id, verification_reviewed_at,
    verification_reviewed_by_uid, availability_status,
    service_base_postcode, service_radius_km, is_synthetic,
    created_at, updated_at
  FROM trade_accounts
  WHERE firebase_uid = ?
  LIMIT 1
`;
