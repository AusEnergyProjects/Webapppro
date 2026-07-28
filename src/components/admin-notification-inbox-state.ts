type NotificationIdentity = {
  id: string;
};

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
