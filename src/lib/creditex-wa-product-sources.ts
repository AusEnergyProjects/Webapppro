export const CREDITEX_WA_PRODUCT_SOURCE_CONTRACT =
  "creditex-wa-product-sources/v1" as const;

export const CREDITEX_WA_PRODUCT_SOURCES_VERIFIED_AT = "2026-08-08" as const;

export type WaSupportedSolutionSource = Readonly<{
  registryCode: "wa-synergy-supported-solutions";
  sourceKey: "wa-synergy-supported-solutions";
  productKind: "inverter_compatibility";
  url: string;
  productionMode: "controlled_manual";
  format: "html_table";
  minimumRecords: number;
  maximumRecords: number;
  maxBytes: number;
  expectedContentTypes: readonly string[];
  expectedHeaderRows: readonly (readonly string[])[];
  reviewedSnapshotDate: string;
  verifiedRecordCount: number;
  verifiedAt: typeof CREDITEX_WA_PRODUCT_SOURCES_VERIFIED_AT;
  stableKeyFields: readonly string[];
  licence: Readonly<{
    status: "permission_required_for_commercial_reuse";
    url: string;
    note: string;
  }>;
  robots: Readonly<{
    url: string;
    routeAllowed: true;
    note: string;
  }>;
}>;

export type WaControlledManualProductConnector = Readonly<{
  connectorKey: "wa-horizon-power-compatible-inverters";
  registryCode: "wa-horizon-supported-solutions";
  productKind: "inverter_compatibility";
  url: string;
  productionMode: "controlled_manual";
  automatedSyncAvailable: false;
  reason: string;
  robotsUrl: string;
  verifiedAt: typeof CREDITEX_WA_PRODUCT_SOURCES_VERIFIED_AT;
}>;

export const WA_SYNERGY_SUPPORTED_SOLUTIONS_SOURCE:
  WaSupportedSolutionSource = {
    registryCode: "wa-synergy-supported-solutions",
    sourceKey: "wa-synergy-supported-solutions",
    productKind: "inverter_compatibility",
    url: "https://www.synergy.net.au/Global/SSL",
    productionMode: "controlled_manual",
    format: "html_table",
    minimumRecords: 1_800,
    maximumRecords: 5_000,
    maxBytes: 2_500_000,
    expectedContentTypes: ["text/html"],
    expectedHeaderRows: [
      ["HARDWARE", "TECHNOLOGY PROVIDER CSIP-AUS CLIENT"],
      [
        "Brand",
        "Inverter OEM",
        "Series",
        "Model",
        "DER - Generator",
        "DER - Storage",
      ],
      ["Provisional", "Full Listing", "Provisional", "Full Listing"],
    ],
    reviewedSnapshotDate: "2026-08-06",
    verifiedRecordCount: 2_024,
    verifiedAt: CREDITEX_WA_PRODUCT_SOURCES_VERIFIED_AT,
    stableKeyFields: ["Brand", "Inverter OEM", "Series", "Model"],
    licence: {
      status: "permission_required_for_commercial_reuse",
      url: "https://www.synergy.net.au/UtilityLinks/Website-terms-and-conditions",
      note:
        "Synergy permits personal viewing, copying and printing but requires written permission for commercial reuse or republication. Keep automated production sync disabled until permission is recorded.",
    },
    robots: {
      url: "https://www.synergy.net.au/robots.txt",
      routeAllowed: true,
      note:
        "The public /Global/SSL route is not disallowed. Search, media and script routes have separate disallow rules.",
    },
  } as const;

export const WA_HORIZON_POWER_SUPPORTED_SOLUTIONS_CONNECTOR:
  WaControlledManualProductConnector = {
    connectorKey: "wa-horizon-power-compatible-inverters",
    registryCode: "wa-horizon-supported-solutions",
    productKind: "inverter_compatibility",
    url: "https://www.horizonpower.com.au/contractors-installers/connect-solar-battery-ev/community-wave/#inverters",
    productionMode: "controlled_manual",
    automatedSyncAvailable: false,
    reason:
      "Horizon Power publishes an authoritative interactive HTML list but no supported machine feed was located. Unattended access receives a Cloudflare challenge, which must not be bypassed.",
    robotsUrl: "https://www.horizonpower.com.au/robots.txt",
    verifiedAt: CREDITEX_WA_PRODUCT_SOURCES_VERIFIED_AT,
  } as const;
