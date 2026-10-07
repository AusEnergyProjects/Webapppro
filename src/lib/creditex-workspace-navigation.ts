const AUDIT_ID = /^[A-Za-z0-9:_-]{1,180}$/;
const PANELS = ["creditex-full-audit-title", "audit-records", "audit-files", "audit-requirements", "audit-findings"] as const;
export type CreditexAuditPanel = typeof PANELS[number];

export function creditexAuditPanelFromHash(hash: string): CreditexAuditPanel | null {
  return PANELS.find(panel => hash === `#${panel}`) ?? null;
}

/** A link selects an audit view only. Current job, role and assignment gates remain authoritative. */
export function creditexAuditFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.getAll("workspace").length !== 1 || params.get("workspace") !== "cases"
    || params.getAll("intentId").length !== 1) return null;
  const intentId = params.get("intentId");
  return intentId && AUDIT_ID.test(intentId) ? intentId : null;
}

export function creditexAuditHref(intentId: string, panel: CreditexAuditPanel = "creditex-full-audit-title"): string {
  if (!AUDIT_ID.test(intentId)) throw new Error("Choose a valid Creditex audit.");
  return `/creditex/compliance?workspace=cases&intentId=${encodeURIComponent(intentId)}#${panel}`;
}
