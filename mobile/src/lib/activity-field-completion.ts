export function activityIntentComplete(intentId: string, records: readonly { intentId: string; status: string }[], packs: readonly { instance: { complianceIntentId: string; status: string }; finalRecord?: unknown }[]) {
  return records.some((record) => record.intentId === intentId && record.status === 'submitted_for_creditex_review')
    || packs.some((pack) => pack.instance.complianceIntentId === intentId && pack.instance.status === 'completed' && Boolean(pack.finalRecord));
}
