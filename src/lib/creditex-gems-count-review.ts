function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type Decrease = { sourceKey: string; previousRecordCount: number; acceptedRecordCount: number };

function reportedDecreases(message: string): Decrease[] {
  // Failed syncs persist this bounded diagnostic. A partial or changed format
  // must never produce a partial approval request.
  const match = /^Official source counts decreased \(([^()]+)\)\. Exact reviewed approval is required\.$/.exec(message);
  if (!match) return [];
  const sources: Decrease[] = [];
  const seen = new Set<string>();
  for (const item of match[1].split(", ")) {
    const counts = /^(gems-[a-z0-9-]+):([1-9]\d*)->([1-9]\d*)$/.exec(item);
    if (!counts) return [];
    const [, sourceKey, previous, accepted] = counts;
    const previousRecordCount = Number(previous);
    const acceptedRecordCount = Number(accepted);
    if (seen.has(sourceKey) || !Number.isSafeInteger(previousRecordCount)
      || !Number.isSafeInteger(acceptedRecordCount) || acceptedRecordCount >= previousRecordCount) return [];
    seen.add(sourceKey);
    sources.push({ sourceKey, previousRecordCount, acceptedRecordCount });
  }
  return sources;
}

export function gemsCountReview(registries: unknown) {
  if (!Array.isArray(registries)) return null;
  const registry: unknown = registries.find(value => object(value) && value.registryCode === "gems-products");
  if (!object(registry) || typeof registry.status !== "string" || typeof registry.recordCount !== "number"
    || !Number.isSafeInteger(registry.recordCount) || registry.recordCount < 0) return null;
  const attempt = object(registry.lastAttempt) ? registry.lastAttempt : null;
  const failed = attempt?.status === "failed";
  const message = failed && typeof attempt.message === "string" ? attempt.message : "";
  const attemptAt = typeof attempt?.checkedAt === "string" && Number.isFinite(Date.parse(attempt.checkedAt))
    ? attempt.checkedAt : null;
  const sources = attemptAt && registry.recordCount > 0 ? reportedDecreases(message) : [];
  return { status: registry.status, recordCount: registry.recordCount, attemptAt, message, sources };
}

export function gemsReviewWasPublished(response: Record<string, unknown>) {
  if (response.ok !== true || !Array.isArray(response.results) || !Array.isArray(response.registries)) return null;
  const result: unknown = response.results.find(row => object(row) && row.registryCode === "gems-products");
  const status: unknown = response.registries.find(row => object(row) && row.registryCode === "gems-products");
  if (!object(result) || !object(status) || result.reviewedCountDecrease !== true
    || typeof result.snapshotId !== "string" || !result.snapshotId || result.snapshotId !== status.snapshotId
    || status.status !== "current" || typeof status.recordCount !== "number" || status.recordCount < 1
    || !Number.isSafeInteger(status.recordCount) || status.recordCount !== result.recordCount) return null;
  return { recordCount: status.recordCount };
}
