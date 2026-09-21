import type { ComplianceClaimOutputCode } from "./australian-government-program-catalogue";

// Certificate and carbon-credit outputs in the authoritative programme catalogue.
// A job's saved programme snapshot remains the source for its actual output.
export const CREDITEX_CERTIFICATE_TYPES = ["STC", "VEEC", "ESC", "PRC", "LGC", "REGO", "ACCU"] as const satisfies readonly ComplianceClaimOutputCode[];
export type CreditexCertificateType = typeof CREDITEX_CERTIFICATE_TYPES[number];

export function isCreditexCertificateType(value: unknown): value is CreditexCertificateType {
  return CREDITEX_CERTIFICATE_TYPES.some(code => code === value);
}
