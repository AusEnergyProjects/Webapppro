const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;


export function daysUntilIsoDate(dueAt: string, now = new Date()) {
  if (!ISO_DATE.test(dueAt)) throw new Error("INVALID_DATE");
  const due = Date.parse(`${dueAt}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((due - today) / 86_400_000);
}
export function serviceFollowUpDueState(dueAt: string, now = new Date()) {
  const days = daysUntilIsoDate(dueAt, now);
  if (days < 0) return "overdue";
  if (days <= 30) return "due_soon";
  return "upcoming";
}
