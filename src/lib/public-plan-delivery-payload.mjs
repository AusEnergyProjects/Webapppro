import { createHmac } from "node:crypto";

const MIN_SIGNING_SECRET_LENGTH = 32;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createSignedInternalLeadEnvelope(
  payload,
  secret,
  { now = () => new Date() } = {},
) {
  if (typeof secret !== "string" || secret.length < MIN_SIGNING_SECRET_LENGTH) {
    throw new Error("LEAD_WEBHOOK_SIGNING_UNCONFIGURED");
  }
  const sentAt = now().toISOString();
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${sentAt}.${encodedPayload}`)
    .digest("base64url");
  return {
    schemaVersion: "1",
    eventType: "lead.webhook",
    sentAt,
    payload: encodedPayload,
    signature,
  };
}

export function internalRelayPayload(envelope) {
  const payload = { ...envelope };
  delete payload.customerPlanDelivery;
  payload.customerPlanDeliveryManagedExternally = true;
  return payload;
}
