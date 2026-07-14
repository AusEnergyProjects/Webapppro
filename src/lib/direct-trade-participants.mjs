const APPLICATION_CHECKS = {
  installer: [
    ["business", "Business identity and trading details"],
    ["coverage", "Service areas and installation capabilities"],
    ["credentials", "Current trade licences or registrations"],
    ["insurance", "Current insurance evidence"],
    ["scheme", "Scheme-specific approvals where the work requires them"],
    ["customer-support", "Quote, warranty, complaints and after-sales process"],
  ],
  supplier: [
    ["business", "Business identity and trading details"],
    ["coverage", "Supply areas and supported product categories"],
    ["product", "Product specifications, compliance and availability evidence"],
    ["warranty", "Warranty ownership, claims path and local support"],
    ["trade-support", "Installer training, technical support and supply continuity"],
  ],
};

function strings(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item))] : [];
}

function validFuture(value, now) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function validPastOrPresent(value, now) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

function verifiedForEveryCapability(items, capabilities, now) {
  const evidence = Array.isArray(items) ? items : [];
  return capabilities.every((capability) => evidence.some((item) => item?.capability === capability && item?.verified === true && (!item.expiresAt || validFuture(item.expiresAt, now))));
}

export function buildParticipantApplicationReview(application) {
  const partnerType = application?.partnerType === "supplier" ? "supplier" : "installer";
  return {
    version: "direct-trade-participant-review-1",
    status: "application_received",
    partnerType,
    autoApprove: false,
    publicListing: false,
    checks: APPLICATION_CHECKS[partnerType].map(([id, label]) => ({ id, label, status: "not_started" })),
  };
}

export function assessParticipantRecord(record, options = {}) {
  const now = options.now || new Date();
  const partnerType = record?.partnerType === "supplier" ? "supplier" : "installer";
  const capabilities = strings(record?.capabilities);
  const serviceStates = strings(record?.serviceStates);
  const matchingFlags = [];

  if (!record?.id || !record?.businessName) matchingFlags.push("participant_identity_missing");
  if (record?.status !== "approved") matchingFlags.push("participant_not_approved");
  if (record?.businessVerified !== true) matchingFlags.push("business_not_verified");
  if (!validPastOrPresent(record?.reviewedAt, now) || !validFuture(record?.reviewDueAt, now)) matchingFlags.push("participant_review_due");
  if (!serviceStates.length) matchingFlags.push("coverage_missing");
  if (!capabilities.length) matchingFlags.push("capability_missing");

  if (partnerType === "installer") {
    const credentials = Array.isArray(record?.credentials) ? record.credentials : [];
    if (!credentials.some((item) => item?.verified === true && validFuture(item?.expiresAt, now))) matchingFlags.push("credentials_missing_or_expired");
    if (record?.insurance?.verified !== true || !validFuture(record?.insurance?.expiresAt, now)) matchingFlags.push("insurance_missing_or_expired");
    const requiredSchemeCapabilities = strings(record?.requiredSchemeCapabilities);
    if (!verifiedForEveryCapability(record?.schemeApprovals, requiredSchemeCapabilities, now)) matchingFlags.push("scheme_approval_missing_or_expired");
  } else {
    if (!verifiedForEveryCapability(record?.productEvidence, capabilities, now)) matchingFlags.push("product_evidence_incomplete");
    if (record?.warrantySupportVerified !== true) matchingFlags.push("warranty_support_not_verified");
  }

  const publicFlags = [];
  if (record?.publicListingConsent !== true) publicFlags.push("public_listing_consent_missing");
  if (record?.publicProfileReviewed !== true) publicFlags.push("public_profile_not_reviewed");

  return {
    version: "direct-trade-participant-assessment-1",
    partnerType,
    matchingEligible: matchingFlags.length === 0,
    publicListingEligible: matchingFlags.length === 0 && publicFlags.length === 0,
    matchingFlags,
    publicFlags,
    assessedAt: now.toISOString(),
  };
}

export function publicParticipantProfile(record, options = {}) {
  const assessment = assessParticipantRecord(record, options);
  if (!assessment.publicListingEligible) return null;
  return {
    id: String(record.id || ""),
    businessName: String(record.businessName || ""),
    partnerType: assessment.partnerType,
    serviceStates: strings(record.serviceStates),
    capabilities: strings(record.capabilities),
    profileSummary: String(record.profileSummary || "").slice(0, 500),
    reviewedAt: String(record.reviewedAt || ""),
    reviewDueAt: String(record.reviewDueAt || ""),
  };
}
