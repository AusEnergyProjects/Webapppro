export function resetTradeDashboardStateOnUidChange(
  currentUid: string | null,
  nextUid: string | null,
  resetSensitiveState: () => void,
) {
  if (currentUid === nextUid) return false;
  resetSensitiveState();
  return true;
}

export function tradeRebatePreparingMessage(attempt: number | null) {
  return attempt === null
    ? ""
    : "Updating the exact official product register. Product choices will load automatically.";
}
