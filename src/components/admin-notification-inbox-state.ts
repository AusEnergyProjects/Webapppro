type NotificationIdentity = {
  id: string;
};

export function notificationMatchesQueue(item: {
  binnedAt: string;
  status: string;
  requiresAction: boolean;
  assignedToUid: string;
  slaState: string;
}, queue: string, currentAdminUid: string) {
  if (item.binnedAt) return queue === "bin";
  if (queue === "bin") return false;
  return queue === "all"
    || queue === "action_required" && item.requiresAction && item.status !== "resolved"
    || queue === "mine" && item.assignedToUid === currentAdminUid && item.status !== "resolved"
    || queue === "unassigned" && !item.assignedToUid && item.requiresAction && item.status !== "resolved"
    || queue === "overdue" && item.slaState === "overdue" && item.status !== "resolved"
    || queue === "due_soon" && item.slaState === "due_soon" && item.status !== "resolved"
    || queue === "resolved" && item.status === "resolved";
}

export function pinExpandedNotification<T extends NotificationIdentity>(
  filtered: T[],
  all: T[],
  expandedId: string,
  preferredIndex: number,
) {
  if (!expandedId) return filtered;
  const expanded = all.find((item) => item.id === expandedId);
  if (!expanded) return filtered;
  const remaining = filtered.filter((item) => item.id !== expandedId);
  const insertionIndex = Math.min(
    Math.max(0, preferredIndex),
    remaining.length,
  );
  return [
    ...remaining.slice(0, insertionIndex),
    expanded,
    ...remaining.slice(insertionIndex),
  ];
}
