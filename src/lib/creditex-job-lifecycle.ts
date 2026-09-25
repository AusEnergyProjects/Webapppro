export type CreditexJobLifecycle = {
  status: "unscheduled" | "assigned" | "partial" | "complete" | "reviewed" | "audited" | "correction_required" | "submitted" | "paid" | "failed" | "cancelled" | "deleted" | "no_show";
  label: string;
  detail: string;
};

export type CreditexJobSubmissionPacket = {
  status: string;
  registryStatus: string;
  approved: number;
  lodged: number;
  exported: number;
  dispatchPending: number;
  currentCase: number;
};

export type CreditexJobSubmission = {
  packetCount: number;
  submittedCount: number;
  exportedCount: number;
  detail: string;
};

export function creditexJobSubmissionSummary(packets: readonly CreditexJobSubmissionPacket[]): CreditexJobSubmission {
  const packetCount = packets.length;
  const submittedCount = packets.filter(packet => packet.lodged === 1).length;
  const exportedCount = packets.filter(packet => packet.exported === 1).length;
  const detail = packets.some(packet => packet.status === "reconciliation_required" || packet.dispatchPending === 1)
    ? "Check submission outcome"
    : submittedCount > 0 && submittedCount < packetCount
      ? `${submittedCount} of ${packetCount} claims lodged`
      : !submittedCount && exportedCount > 0
        ? exportedCount === packetCount ? "Exported, awaiting lodgement" : `${exportedCount} of ${packetCount} claims exported, awaiting lodgement`
        : "";
  return { packetCount, submittedCount, exportedCount, detail };
}

export function deriveCreditexJobLifecycle(input: {
  workStage: string;
  scheduledStart: string;
  fieldComplete: boolean;
  fieldProgress: boolean;
  creditexAuditApproved: boolean;
  correctionRequired: boolean;
  tradeReviewed?: boolean;
  creditexPayoutRecorded?: boolean;
  deleted?: boolean;
  packets: readonly CreditexJobSubmissionPacket[];
}): CreditexJobLifecycle {
  const submission = creditexJobSubmissionSummary(input.packets);
  const lifecycle = (status: CreditexJobLifecycle["status"], label: string) => ({ status, label, detail: submission.detail });
  if (input.deleted) return lifecycle("deleted", "Deleted");
  // Local evidence rejection is a correction, not a government failure.
  if (input.packets.some(packet => packet.lodged === 1 && (packet.status === "rejected" || packet.registryStatus === "rejected"))) {
    return lifecycle("failed", "Failed");
  }
  if (input.correctionRequired || input.packets.some(packet => packet.status === "rejected" && packet.lodged !== 1)) {
    return lifecycle("correction_required", "Correction required");
  }
  if (submission.packetCount > 0 && submission.submittedCount === submission.packetCount) {
    if (input.creditexPayoutRecorded) return lifecycle("paid", "Paid");
    return lifecycle("submitted", "Submitted");
  }
  if (input.creditexAuditApproved || (input.packets.length > 0 && input.packets.every(packet => packet.approved === 1 && packet.currentCase === 1))) {
    return lifecycle("audited", "Audited");
  }
  if (input.workStage === "cancelled") return lifecycle("cancelled", "Cancelled");
  if (input.workStage === "no_show") return lifecycle("no_show", "No show");
  if (input.tradeReviewed) return lifecycle("reviewed", "Reviewed");
  if (input.fieldComplete || input.workStage === "completed") return lifecycle("complete", "Complete");
  if (input.fieldProgress || ["in_progress", "blocked"].includes(input.workStage)) return lifecycle("partial", "Partial");
  if (input.scheduledStart || input.workStage === "scheduled") return lifecycle("assigned", "Assigned");
  return lifecycle("unscheduled", "Unscheduled");
}
