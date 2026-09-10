/** Completion does not require invented travel, arrival or work-start events. */
export function fieldTransitionExpectedStatus(action: string, currentStatus: string, usualFrom: string) {
  return action === "finish" && ["scheduled", "en_route", "arrived", "in_progress"].includes(currentStatus)
    ? currentStatus : usualFrom;
}

/** An issued rental may close its active job without changing an ended appointment. */
export function fieldFinishWithoutActiveAppointment(jobStage: string, appointmentStatus: string, hasIssuedRental: boolean) {
  return hasIssuedRental
    && Boolean(jobStage) && !["completed", "cancelled"].includes(jobStage)
    && ["", "cancelled", "completed", "no_show"].includes(appointmentStatus);
}
