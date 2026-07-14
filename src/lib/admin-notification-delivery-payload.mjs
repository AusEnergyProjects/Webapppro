function clean(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

export function buildAdminNotificationDeliveryPayload(row) {
  return {
    schemaVersion: "1",
    eventType: "admin.notification",
    notification: {
      id: clean(row.notification_id, 180),
      type: clean(row.event_type, 100),
      category: clean(row.category, 30),
      priority: clean(row.priority, 30),
      title: clean(row.title, 180),
      summary: clean(row.summary, 600),
      requiresAction: Boolean(row.requires_action),
      createdAt: clean(row.created_at, 60),
    },
    actionPath: "/operations/control-centre",
    privacy: "No customer contact details, addresses, account tokens or uploaded documents are included.",
  };
}

export function adminNotificationRetryAt(attempts, now = Date.now()) {
  const minutes = [5, 30, 120, 360, 720][Math.min(Math.max(Number(attempts) - 1, 0), 4)];
  return new Date(now + minutes * 60 * 1000).toISOString();
}
