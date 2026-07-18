import { encryptProtectedPayload, decryptProtectedPayload } from "@/lib/trade-integration-crypto";

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function newQuoteLinkSecret() { return base64Url(crypto.getRandomValues(new Uint8Array(32))); }
export async function hashQuoteLinkSecret(secret: string) { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret)))); }
export function quoteReviewPath(linkId: string, secret: string) { return `/quote-review/${encodeURIComponent(`${linkId}.${secret}`)}`; }
export async function protectQuoteLinkSecret(linkId: string, tokenIssue: number, secret: string) {
  return encryptProtectedPayload({ kind: "quote_link", linkId, tokenIssue, secret });
}
export async function recoverQuoteLinkSecret(encrypted: string, linkId: string, tokenIssue: number, tokenHash: string) {
  const value = await decryptProtectedPayload(encrypted); const secret = String(value.secret || "");
  if (value.kind !== "quote_link" || value.linkId !== linkId || Number(value.tokenIssue) !== tokenIssue || !secret || await hashQuoteLinkSecret(secret) !== tokenHash) throw new Error("QUOTE_LINK_STALE");
  return secret;
}
export function splitQuoteLinkToken(token: string) {
  const dot = token.indexOf("."); const linkId = token.slice(0, dot); const secret = token.slice(dot + 1);
  if (dot < 1 || linkId.length > 180 || !/^[A-Za-z0-9_-]{40,100}$/.test(secret)) throw new Error("QUOTE_LINK_INVALID");
  return { linkId, secret };
}
