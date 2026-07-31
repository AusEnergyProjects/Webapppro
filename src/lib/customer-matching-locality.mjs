export const CUSTOMER_MATCHING_NOTICE_VERSION =
  "2026-08-01-anonymized-matching-locality-v1";
export const CUSTOMER_MATCHING_RECEIPT_PURPOSE =
  "anonymized_installer_matching";

function bounded(value, maximum) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

/**
 * @param {Record<string, unknown>} [value]
 */
export function matchingLocalitySnapshot(value = {}) {
  const postcode = bounded(value.postcode, 4);
  return {
    suburb: bounded(value.suburb, 80),
    postcode: /^\d{4}$/.test(postcode) ? postcode : "",
    state: bounded(value.state || value.addressState || value.address_state, 3).toUpperCase(),
  };
}

/**
 * @param {Record<string, unknown>} [value]
 * @param {Record<string, unknown> | null} [receipt]
 */
export function matchingLocalityDisclosure(value = {}, receipt = null) {
  const snapshot = matchingLocalitySnapshot(value);
  const consentIsCurrent =
    receipt
    && typeof receipt === "object"
    && bounded(receipt.purpose, 80) === CUSTOMER_MATCHING_RECEIPT_PURPOSE
    && bounded(receipt.noticeVersion || receipt.notice_version, 120)
      === CUSTOMER_MATCHING_NOTICE_VERSION
    && Boolean(bounded(receipt.grantedAt || receipt.granted_at, 80))
    && !bounded(receipt.withdrawnAt || receipt.withdrawn_at, 80);
  return {
    suburb: consentIsCurrent ? snapshot.suburb : "",
    postcode: consentIsCurrent ? snapshot.postcode : "",
    state: snapshot.state,
  };
}
