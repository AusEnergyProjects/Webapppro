export type PartnerType = "installer" | "supplier";

export type FeatureKey =
  | "installer_leads"
  | "installer_marketplace"
  | "supplier_visibility"
  | "supplier_bulk_import"
  | "business_operations"
  | "team_access";

export type FeatureDefinition = {
  key: FeatureKey;
  label: string;
  description: string;
  roles: PartnerType[];
  tier: "core";
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
    description: "Make approved, published products selectable by verified installers.",
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
    description: "Run customers, jobs, scheduling, tasks, quotes, invoices, reporting, assets and service workflows.",
    roles: ["installer", "supplier"],
    tier: "core",
  },
  {
    key: "team_access",
    label: "Team access",
    description: "Add authorised team members and share workflow ownership.",
    roles: ["installer", "supplier"],
    tier: "core",
  },
];

export const FEATURE_KEYS = new Set<FeatureKey>(
  FEATURE_DEFINITIONS.map((feature) => feature.key),
);

export function resolveEntitlements(
  partnerType: PartnerType,
  verified = false,
) {
  const features = Object.fromEntries(
    FEATURE_DEFINITIONS.map((feature) => [
      feature.key,
      verified && feature.roles.includes(partnerType),
    ]),
  ) as Record<FeatureKey, boolean>;

  return {
    verified,
    accessLabel: verified ? "Verified trade access" : "ABN review required",
    features,
  };
}
