import { env } from "cloudflare:workers";
import { calendarIntegrationState } from "@/lib/trade-integration-state";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function protectedKeyBytes() {
  const configured = String((env as unknown as { CRM_INTEGRATION_ENCRYPTION_KEY?: string }).CRM_INTEGRATION_ENCRYPTION_KEY || "").trim();
  if (!configured) throw new Error("INTEGRATION_ENCRYPTION_UNAVAILABLE");
  let keyBytes: Uint8Array;
  try { keyBytes = fromBase64Url(configured); }
  catch { throw new Error("INTEGRATION_ENCRYPTION_UNAVAILABLE"); }
  if (keyBytes.byteLength !== 32) throw new Error("INTEGRATION_ENCRYPTION_UNAVAILABLE");
  return keyBytes;
}

async function encryptionKey() {
  return crypto.subtle.importKey("raw", await protectedKeyBytes() as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptProtectedPayload(value: Record<string, unknown>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(JSON.stringify(value)));
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptProtectedPayload(value: string) {
  const [version, ivValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("INTEGRATION_CREDENTIALS_INVALID");
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(ivValue) },
      await encryptionKey(),
      fromBase64Url(encryptedValue),
    );
    return JSON.parse(decoder.decode(decrypted)) as Record<string, unknown>;
  } catch { throw new Error("INTEGRATION_CREDENTIALS_INVALID"); }
}

export const encryptIntegrationCredentials = encryptProtectedPayload;
export const decryptIntegrationCredentials = decryptProtectedPayload;

export async function integrationStateHash(value: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function keyedProtectedAuditHash(purpose: string, value: string) {
  const sourceKey = await protectedKeyBytes();
  const purposeBytes = encoder.encode(`aea-protected-audit:${purpose}`);
  const derivedSource = new Uint8Array(sourceKey.byteLength + purposeBytes.byteLength);
  derivedSource.set(sourceKey);
  derivedSource.set(purposeBytes, sourceKey.byteLength);
  const derivedKey = await crypto.subtle.digest("SHA-256", derivedSource);
  const hmacKey = await crypto.subtle.importKey("raw", derivedKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function newIntegrationState(weekStart = "") {
  return calendarIntegrationState(toBase64Url(crypto.getRandomValues(new Uint8Array(32))), weekStart);
}
