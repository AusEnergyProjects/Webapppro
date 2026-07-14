export const PAID_BILLING_STATUSES = new Set([
  "trial",
  "active",
  "active_cancels_at_period_end",
]);

export type PartnerType = "installer" | "supplier";

export type FeatureKey =
  | "installer_leads"
  | "installer_marketplace"
  | "supplier_visibility"
  | "supplier_bulk_import"
  | "business_operations"
  | "advanced_analytics"
  | "featured_placement"
  | "team_access"
  | "priority_support";

export type FeatureGrant = {
  featureKey: FeatureKey;
  status: "active" | "revoked";
  expiresAt: string;
  note: string;
  updatedAt?: string;
};

export type FeatureDefinition = {
  key: FeatureKey;
  label: string;
  description: string;
  roles: PartnerType[];
  tier: "membership" | "premium";
};

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    key: "installer_leads",
    label: "Opportunity leads",
    description: "Receive matched household opportunities and submit structured platform quote options.",
    roles: ["installer"],
    tier: "membership",
  },
  {
    key: "installer_marketplace",
    label: "Wholesale product marketplace",
    description: "Browse approved products, pricing, stock and complete equipment kits.",
    roles: ["installer"],
    tier: "membership",
  },
  {
    key: "supplier_visibility",
    label: "Installer marketplace visibility",
    description: "Make approved, published products selectable by installer members.",
    roles: ["supplier"],
    tier: "membership",
  },
  {
    key: "supplier_bulk_import",
    label: "Bulk catalogue tools",
    description: "Import and maintain larger product catalogues using CSV workflows.",
    roles: ["supplier"],
    tier: "membership",
  },
  {
    key: "business_operations",
    label: "Expanded Business Hub",
    description: "Expand privacy-safe work management beyond the free five-record allowance and convert eligible platform work into operations records.",
    roles: ["installer", "supplier"],
    tier: "membership",
  },
  {
    key: "advanced_analytics",
    label: "Advanced analytics",
    description: "Access conversion, demand, coverage and catalogue performance insights.",
    roles: ["installer", "supplier"],
    tier: "premium",
  },
  {
    key: "featured_placement",
    label: "Featured placement",
    description: "Add an approved featured badge and enhanced marketplace placement.",
    roles: ["installer", "supplier"],
    tier: "premium",
  },
  {
    key: "team_access",
    label: "Team access",
    description: "Prepare the account for additional users and shared workflow ownership.",
    roles: ["installer", "supplier"],
    tier: "premium",
  },
  {
    key: "priority_support",
    label: "Priority support",
    description: "Place account support requests into the priority service queue.",
    roles: ["installer", "supplier"],
    tier: "premium",
  },
];

export const FEATURE_KEYS = new Set<FeatureKey>(
  FEATURE_DEFINITIONS.map((feature) => feature.key),
);

export function isPaidBillingStatus(status: unknown) {
  return PAID_BILLING_STATUSES.has(String(status || ""));
}
export function activeGrantKeys(
  grants: Array<Partial<FeatureGrant>>,
  now = new Date(),
) {
  const timestamp = now.getTime();
  return new Set<FeatureKey>(
    grants
      .filter((grant) => {
        if (grant.status !== "active" || !grant.featureKey) return false;
        if (!grant.expiresAt) return true;
        const expiry = Date.parse(grant.expiresAt);
        return Number.isFinite(expiry) && expiry > timestamp;
      })
      .map((grant) => grant.featureKey as FeatureKey),
  );
}

export function resolveEntitlements(
  partnerType: PartnerType,
  billingStatus: unknown,
  grants: Array<Partial<FeatureGrant>> = [],
) {
  const paidMembership = isPaidBillingStatus(billingStatus);
  const granted = activeGrantKeys(grants);
  const features = Object.fromEntries(
    FEATURE_DEFINITIONS.map((feature) => {
      const roleApplies = feature.roles.includes(partnerType);
      const includedWithMembership = feature.tier === "membership";
      return [
        feature.key,
        roleApplies &&
          (granted.has(feature.key) ||
            (paidMembership && includedWithMembership)),
      ];
    }),
  ) as Record<FeatureKey, boolean>;

  return {
    paidMembership,
    accessLabel: paidMembership ? "Paid membership" : granted.size ? "Free account with admin access" : "Free account",
    features,
    activeGrants: [...granted],
  };
}
