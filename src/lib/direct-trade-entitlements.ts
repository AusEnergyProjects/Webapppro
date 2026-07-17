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
  tier: "core" | "admin";
};

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    key: "installer_leads",
    label: "Opportunity leads",
    description: "Receive matched household opportunities and submit structured platform quote options.",
    roles: ["installer"],
    tier: "core",
  },
  {
    key: "installer_marketplace",
    label: "Wholesale product marketplace",
    description: "Browse approved products, pricing, stock and complete equipment kits.",
    roles: ["installer"],
    tier: "core",
  },
  {
    key: "supplier_visibility",
    label: "Installer marketplace visibility",
    description: "Make approved, published products selectable by installer members.",
    roles: ["supplier"],
    tier: "core",
  },
  {
    key: "supplier_bulk_import",
    label: "Bulk catalogue tools",
    description: "Import and maintain larger product catalogues using CSV workflows.",
    roles: ["supplier"],
    tier: "core",
  },
  {
    key: "business_operations",
    label: "CRM and Business Hub",
    description: "Run customers, jobs, scheduling, tasks, issues, quote and invoice progress, reporting, asset records, compliance and reviewed customer handovers in one workspace.",
    roles: ["installer", "supplier"],
    tier: "core",
  },
  {
    key: "advanced_analytics",
    label: "Advanced analytics",
    description: "Access conversion, demand, coverage and catalogue performance insights.",
    roles: ["installer", "supplier"],
    tier: "admin",
  },
  {
    key: "team_access",
    label: "Team access",
    description: "Prepare the account for additional users and shared workflow ownership.",
    roles: ["installer", "supplier"],
    tier: "core",
  },
  {
    key: "priority_support",
    label: "Priority support",
    description: "Place account support requests into the priority service queue.",
    roles: ["installer", "supplier"],
    tier: "admin",
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
  verified = false,
) {
  const paidMembership = isPaidBillingStatus(billingStatus);
  const granted = activeGrantKeys(grants);
  const features = Object.fromEntries(
    FEATURE_DEFINITIONS.map((feature) => {
      const roleApplies = feature.roles.includes(partnerType);
      const includedForVerifiedTrades = feature.tier === "core";
      return [
        feature.key,
        roleApplies &&
          verified &&
          (includedForVerifiedTrades || granted.has(feature.key)),
      ];
    }),
  ) as Record<FeatureKey, boolean>;

  return {
    paidMembership,
    verified,
    accessLabel: verified ? "Verified trade access" : "Verification required",
    features,
    activeGrants: [...granted],
  };
}
