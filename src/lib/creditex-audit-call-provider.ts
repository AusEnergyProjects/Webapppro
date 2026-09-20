import { CREDITEX_AUDIT_CALL_LIMITS } from "./creditex-audit-calls";

export type AuditCallConfiguration = {
  connectionId: string; organisationId: string; apiKey: string; publicKey: string;
  credentialConnectionId: string; callControlApplicationId: string; outboundVoiceProfileId: string; callerId: string;
};
export const AUDIT_CALL_CALLBACK_URL = "https://ausenergyassessments.com/api/creditex/audit-calls/telnyx";
export type ProviderRecord = Record<string, unknown>;
export function providerObject(value: unknown): ProviderRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ProviderRecord : {};
}
export async function auditProviderRequest(configuration: AuditCallConfiguration, resource: string, fetchImpl: typeof fetch = fetch, body?: object) {
  if (!/^\/(calls|telephony_credentials|recordings)([/?][A-Za-z0-9_:%=.\[\]&?/-]*)?$/.test(resource)) throw new Error("AUDIT_CALL_PROVIDER_RESOURCE_INVALID");
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telnyx.com/v2${resource}`, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${configuration.apiKey}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error("AUDIT_CALL_PROVIDER_UNKNOWN"); }
  if (!response.ok) throw new Error(response.status >= 400 && response.status < 500 && ![408,409].includes(response.status) ? "AUDIT_CALL_PROVIDER_REJECTED" : "AUDIT_CALL_PROVIDER_UNKNOWN");
  if (resource.endsWith("/token")) {
    const token = await response.text();
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error("AUDIT_CALL_PROVIDER_UNKNOWN");
    return { token };
  }
  try { return providerObject(await response.json()); } catch { throw new Error("AUDIT_CALL_PROVIDER_UNKNOWN"); }
}
export function providerData(result: ProviderRecord) { return providerObject(result.data); }
export async function auditCallCommand(configuration: AuditCallConfiguration, controlId: string, action: string, body: object, fetchImpl: typeof fetch = fetch) {
  const result = providerData(await auditProviderRequest(configuration, `/calls/${encodeURIComponent(controlId)}/actions/${action}`, fetchImpl, body));
  if (result.result !== "ok") throw new Error("AUDIT_CALL_PROVIDER_UNKNOWN");
}
export async function createAuditVoiceToken(configuration: AuditCallConfiguration, callId: string, expiresAt: string, fetchImpl: typeof fetch = fetch) {
  const credential = providerData(await auditProviderRequest(configuration, "/telephony_credentials", fetchImpl,
    { name: `Creditex audit ${callId}`, connection_id: configuration.credentialConnectionId, expires_at: expiresAt }));
  if (typeof credential.id !== "string" || !/^[\w-]{1,100}$/.test(credential.id) || credential.resource_id !== `connection:${configuration.credentialConnectionId}`
    || credential.expired === true || !Number.isFinite(Date.parse(String(credential.expires_at)))
    || Date.parse(String(credential.expires_at)) <= Date.now() || Date.parse(String(credential.expires_at)) > Date.parse(expiresAt) + 1000) throw new Error("AUDIT_CALL_PROVIDER_UNKNOWN");
  const token = await auditProviderRequest(configuration, `/telephony_credentials/${credential.id}/token`, fetchImpl, {});
  if (typeof token.token !== "string") throw new Error("AUDIT_CALL_PROVIDER_UNKNOWN");
  return { credentialId: credential.id, token: token.token };
}
export async function verifyAuditCallSignature(raw: string, timestamp: string, signature: string, publicKey: string, now = Date.now()) {
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || raw.length > 64000) return false;
  try {
    const keyBytes = Uint8Array.from(atob(publicKey), c => c.charCodeAt(0));
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    if (keyBytes.length !== 32 || signatureBytes.length !== 64) return false;
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, ["verify"]);
    return crypto.subtle.verify("Ed25519", key, signatureBytes, new TextEncoder().encode(`${timestamp}|${raw}`));
  } catch { return false; }
}
export async function downloadAuditRecording(urlValue: unknown, fetchImpl: typeof fetch = fetch) {
  if (typeof urlValue !== "string") throw new Error("AUDIT_CALL_MEDIA_UNAVAILABLE");
  const url = new URL(urlValue);
  // Only fresh URLs obtained through authenticated Telnyx recording metadata reach this boundary.
  // Explicit storage hosts prevent private-network requests; never forward the API credential.
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
    || !(url.hostname === "s3.amazonaws.com" && url.pathname.startsWith("/telephony-recorder-prod/"))
    || url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" || !/^[a-f0-9]{64}$/i.test(url.searchParams.get("X-Amz-Signature") || "")
    || Number(url.searchParams.get("X-Amz-Expires")) > 600 || Number(url.searchParams.get("X-Amz-Expires")) < 1) throw new Error("AUDIT_CALL_MEDIA_URL_INVALID");
  const response = await fetchImpl(url.toString(), { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body || !["audio/mpeg","audio/mp3"].includes((response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase())) throw new Error("AUDIT_CALL_MEDIA_UNAVAILABLE");
  const maximum = CREDITEX_AUDIT_CALL_LIMITS.maximumRecordingBytes;
  if (Number(response.headers.get("content-length") || 0) > maximum) throw new Error("AUDIT_CALL_MEDIA_TOO_LARGE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("AUDIT_CALL_MEDIA_TOO_LARGE"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  if (!length) throw new Error("AUDIT_CALL_MEDIA_UNAVAILABLE");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!(bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) && !(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) throw new Error("AUDIT_CALL_MEDIA_INVALID");
  return bytes;
}
