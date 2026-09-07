/** Completion does not require invented travel, arrival or work-start events. */
export function fieldTransitionExpectedStatus(action: string, currentStatus: string, usualFrom: string) {
  return action === "finish" && ["scheduled", "en_route", "arrived", "in_progress"].includes(currentStatus)
    ? currentStatus : usualFrom;
}
