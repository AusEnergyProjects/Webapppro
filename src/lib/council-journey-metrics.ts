export type CouncilJourneyMetrics = {
  submittedEnquiries: number;
  enquiriesQuoted: number;
  quotesSent: number;
  checkedAt: string;
};

/** A response coherence fingerprint, never a caller-selected reporting area. */
export async function councilJourneyScopeKey(scope: { councilId: string; state: string; postcodes: string[] }): Promise<string> {
  const value = JSON.stringify([scope.councilId, scope.state, [...scope.postcodes].sort()]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return "council-journey-v1:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function isCouncilJourneyMetrics(value: unknown): value is CouncilJourneyMetrics {
  if (!value || typeof value !== "object" || !("submittedEnquiries" in value)
    || !("enquiriesQuoted" in value) || !("quotesSent" in value) || !("checkedAt" in value)) return false;
  const row = value;
  return [row.submittedEnquiries, row.enquiriesQuoted, row.quotesSent].every(count =>
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0)
    && typeof row.checkedAt === "string" && Number.isFinite(Date.parse(row.checkedAt))
    && Number(row.enquiriesQuoted) <= Number(row.submittedEnquiries)
    && Number(row.enquiriesQuoted) <= Number(row.quotesSent);
}
