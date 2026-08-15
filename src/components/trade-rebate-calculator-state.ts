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
    : `Preparing governed calculator controls (${attempt} of 20)...`;
}
