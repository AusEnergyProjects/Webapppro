/** Browser-safe registry workspace contract. Regulator transport is capability-specific. */
export const REGISTRY_SCHEME_KEYS = ["veu", "nsw_esc", "nsw_prc", "stc", "reps", "eeis", "lgc"] as const;
export type RegistrySchemeKey = typeof REGISTRY_SCHEME_KEYS[number];
export type RegistryStatus = "submitted" | "assessment" | "registered" | "rejected" | "withdrawn";

export type RegistryScheme = Readonly<{
  key: RegistrySchemeKey;
  title: string;
  output: string;
  portalUrl: string;
  submissionMode: "portal" | "provider_approval_required" | "retailer_reporting";
  connectionMessage: string;
}>;

export const REGISTRY_SCHEMES: readonly RegistryScheme[] = [
  { key: "veu", title: "Victorian Energy Upgrades", output: "VEECs", portalUrl: "https://veu.esc.vic.gov.au/", submissionMode: "provider_approval_required", connectionMessage: "ESC developer access, the approved activity specification and a verified test submission are required for direct submission." },
  { key: "nsw_esc", title: "NSW Energy Savings Scheme", output: "ESCs", portalUrl: "https://tessa.energysustainabilityschemes.nsw.gov.au/", submissionMode: "portal", connectionMessage: "Prepare the official upload and lodge it through your authorised TESSA account." },
  { key: "nsw_prc", title: "NSW Peak Demand Reduction Scheme", output: "PRCs", portalUrl: "https://tessa.energysustainabilityschemes.nsw.gov.au/", submissionMode: "portal", connectionMessage: "Prepare the official upload and lodge it through your authorised TESSA account." },
  { key: "stc", title: "Small-scale Renewable Energy Scheme", output: "STCs", portalUrl: "https://www.rec-registry.gov.au/", submissionMode: "portal", connectionMessage: "Lodge the official upload in REC Registry, then reconcile the returned references and certificate status." },
  { key: "reps", title: "SA Retailer Energy Productivity Scheme", output: "Retailer reporting", portalUrl: "https://www.escosa.sa.gov.au/industry/reps", submissionMode: "retailer_reporting", connectionMessage: "Use the reporting process agreed with your obliged retailer. This is a separate retailer obligation workflow." },
  { key: "eeis", title: "ACT Energy Efficiency Improvement Scheme", output: "Retailer reporting", portalUrl: "https://www.climatechoices.act.gov.au/policy-programs/energy-efficiency-improvement-scheme", submissionMode: "retailer_reporting", connectionMessage: "Use your approved provider and retailer reporting arrangements." },
  { key: "lgc", title: "Large-scale Renewable Energy Target", output: "LGCs", portalUrl: "https://www.rec-registry.gov.au/", submissionMode: "portal", connectionMessage: "Use the accredited power-station generation workflow in REC Registry." },
];

export function registrySchemeForProgram(program: string): RegistrySchemeKey | null {
  const map: Readonly<Record<string, RegistrySchemeKey>> = {
    VEU: "veu", "NSW-ESS": "nsw_esc", ESS: "nsw_esc", PDRS: "nsw_prc", "NSW-PDRS": "nsw_prc",
    SRES: "stc", STC: "stc", "SA-REPS": "reps", REPS: "reps", "ACT-EEIS": "eeis", EEIS: "eeis", LRET: "lgc",
  };
  return map[program] ?? null;
}

export type RegistryAccount = Readonly<{
  id: string; scheme: RegistrySchemeKey; accountReference: string; submitterReference: string;
  legalName: string; financeEmail: string; resultsEmail: string; activityScope: readonly string[];
  authorityReference: string; authorityExpiresOn: string; version: number; enabled: boolean; updatedAt: string;
}>;

export type RegistryClaim = Readonly<{
  packetId: string; packetSha256: string; scheme: RegistrySchemeKey; jobReference: string; jobLabel: string;
  customerLabel: string; activityTitle: string; quantity: string; unit: string; status: string;
  approved: boolean; canSubmit: boolean; providerReference: string; accountId: string;
  registryStatus: RegistryStatus | "unconfirmed"; registeredQuantity: string; lastCheckedAt: string;
}>;

export type RegistryInvoice = Readonly<{
  id: string; accountId: string; reference: string; amountMinor: number; paidMinor: number;
  dueDate: string; evidenceId: string; packetIds: readonly string[]; createdAt: string;
  status: "active" | "void";
}>;

export type RegistryResult = Readonly<{
  id: string; packetId: string; accountId: string; externalReference: string; registryStatus: RegistryStatus;
  quantity: string; occurredAt: string; evidenceId: string; note: string; recordedByUid: string;
  source: "reviewed_document" | "rec_public_register"; reviewStatus: "pending" | "approved" | "rejected";
  canReview: boolean; createdAt: string;
}>;

export type RegistryPayment = Readonly<{
  id: string; invoiceId: string; reference: string; amountMinor: number; paidAt: string; evidenceId: string;
}>;

export type RegistryWorkspace = Readonly<{
  schemes: readonly RegistryScheme[]; accounts: readonly RegistryAccount[]; claims: readonly RegistryClaim[];
  invoices: readonly RegistryInvoice[]; payments: readonly RegistryPayment[]; results: readonly RegistryResult[];
  capabilities: Readonly<{ canManageAccounts: boolean; canOperate: boolean; canReview: boolean }>;
}>;

export type RegistryExport = Readonly<{
  id:string; accountId:string; formatKey:string; packetIds:readonly string[]; baseVintage:string;
  createdAt:string; createdByUid:string; reviewStatus:"pending"|"approved"|"rejected"; canReview:boolean;
}>;
export type RegistryFormatSummary = Readonly<{
  key:string; label:string; scheme:string; headers:readonly string[]; maximumRecords:number;
  referenceField:string; version:string;
}>;
export type RegistryWorkspaceResponse = RegistryWorkspace & Readonly<{
  exports:readonly RegistryExport[]; formats:readonly RegistryFormatSummary[];
  activityOptions:readonly Readonly<{activityTemplateId:string;scheme:RegistrySchemeKey;title:string}>[];
  unresolvedMatches:readonly Readonly<{packetId:string;evidenceId:string;sourceDate:string;checkedAt:string}>[];
}>;
