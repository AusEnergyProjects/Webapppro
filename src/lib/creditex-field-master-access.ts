const SHARED_EMAIL_LOCAL_PARTS = new Set([
  "admin",
  "administrator",
  "accounts",
  "compliance",
  "contact",
  "enquiries",
  "hello",
  "info",
  "office",
  "operations",
  "support",
  "team",
]);

type CreditexFieldMasterIdentity = {
  email: string;
  displayName: string;
  role: string;
  organisationCode: string;
};

export function isNamedCreditexIdentity(
  identity: Pick<CreditexFieldMasterIdentity, "email" | "displayName">,
) {
  const email = identity.email.trim().toLowerCase();
  const displayName = identity.displayName.trim();
  const nameParts = displayName.split(/\s+/).filter(Boolean);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    && nameParts.length >= 2
    && !SHARED_EMAIL_LOCAL_PARTS.has(email.split("@")[0])
    && !/\b(admin|administrator|shared|support|team|office)\b/i.test(displayName);
}

export function canEditCreditexFieldMasters(
  identity: CreditexFieldMasterIdentity,
) {
  return identity.organisationCode.trim().toUpperCase() === "CREDITEX-AU"
    && ["admin", "case_manager", "reviewer"].includes(identity.role)
    && isNamedCreditexIdentity(identity);
}
