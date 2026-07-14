function clean(value, maximum) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, maximum);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlText(value) {
  return base64Url(new TextEncoder().encode(value));
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

export async function createGoogleWorkspaceAdminAlertEnvelope(payload, secret, now = Date.now(), cryptoImpl = globalThis.crypto) {
  if (clean(secret, 1000).length < 32) throw new Error("Google Workspace alert signing requires a 32 character secret.");
  const sentAtDate = new Date(now);
  if (Number.isNaN(sentAtDate.getTime())) throw new Error("Google Workspace alert time is invalid.");
  const sentAt = sentAtDate.toISOString();
  const encodedPayload = base64UrlText(JSON.stringify(payload));
  const signingInput = `${sentAt}.${encodedPayload}`;
  const key = await cryptoImpl.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoImpl.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return {
    schemaVersion: "1",
    eventType: "admin.notification",
    sentAt,
    payload: encodedPayload,
    signature: base64Url(new Uint8Array(signature)),
  };
}
