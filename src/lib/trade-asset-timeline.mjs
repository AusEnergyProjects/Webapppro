/**
 * @param {Record<string, unknown>} row
 */
export function tradeAssetTimelinePayload(row) {
  return {
    id: String(row.id),
    sourceType: String(row.source_type),
    eventType: String(row.event_type),
    title: String(row.title),
    summary: String(row.summary || ""),
    occurredAt: String(row.occurred_at),
    sourceReference: String(row.source_reference || ""),
    serviceSiteId: String(row.service_site_id || ""),
    workOrderId: String(row.work_order_id || ""),
  };
}

/**
 * Preserve the prior SQLite BINARY ordering without locale-dependent collation.
 *
 * @param {ReturnType<typeof tradeAssetTimelinePayload>} left
 * @param {ReturnType<typeof tradeAssetTimelinePayload>} right
 */
export function compareTradeAssetTimelineRows(left, right) {
  if (left.occurredAt !== right.occurredAt) return left.occurredAt > right.occurredAt ? -1 : 1;
  if (left.sourceType !== right.sourceType) return left.sourceType < right.sourceType ? -1 : 1;
  if (left.id !== right.id) return left.id > right.id ? -1 : 1;
  return 0;
}

/**
 * Merge the seven bounded D1 source reads into the existing 500-row API contract.
 *
 * @param {{ results: Record<string, unknown>[] }[]} resultSets
 */
export function mergeTradeAssetTimeline(resultSets) {
  return resultSets
    .flatMap((result) => result.results.map(tradeAssetTimelinePayload))
    .sort(compareTradeAssetTimelineRows)
    .slice(0, 500);
}
