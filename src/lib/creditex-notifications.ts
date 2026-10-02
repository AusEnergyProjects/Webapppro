export type CreditexNotificationTarget =
  | { kind: "job"; intentId: string }
  | { kind: "task"; taskId: string }
  | { kind: "message"; peerId: string }
  | { kind: "call"; intentId: string; caseId: string };

export type CreditexNotification = {
  id: string;
  type: "completed" | "correction" | "task" | "message" | "call";
  title: string;
  detail: string;
  createdAt: string;
  read: boolean;
  target: CreditexNotificationTarget;
};
export type CreditexNotificationList = {
  items: CreditexNotification[];
  unreadCount: number;
  total: number;
  page: number;
  totalPages: number;
};

export class CreditexNotificationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function notificationEventKeys(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 50 || value.some(id => typeof id !== "string" || !id || id.length > 1200)) {
    throw new CreditexNotificationError("Choose between 1 and 50 notifications.");
  }
  return [...new Set(value)];
}
