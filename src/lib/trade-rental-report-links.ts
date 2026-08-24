import {
  decryptProtectedPayload,
  encryptProtectedPayload,
  keyedProtectedAuditHash,
} from "@/lib/trade-integration-crypto";

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function newRentalReportSecret() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashRentalReportSecret(secret: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(secret))));
}

export function rentalReportPath(linkId: string, secret: string) {
  return `/rental-report/${encodeURIComponent(`${linkId}.${secret}`)}`;
}

export async function protectRentalReportSecret(
  linkId: string,
  tokenIssue: number,
  secret: string,
) {
  return encryptProtectedPayload({ kind: "rental_report_link", linkId, tokenIssue, secret });
}

export async function recoverRentalReportSecret(
  encrypted: string,
  linkId: string,
  tokenIssue: number,
  tokenHash: string,
) {
  const value = await decryptProtectedPayload(encrypted);
  const secret = String(value.secret || "");
  if (
    value.kind !== "rental_report_link" ||
    value.linkId !== linkId ||
    Number(value.tokenIssue) !== tokenIssue ||
    !secret ||
    (await hashRentalReportSecret(secret)) !== tokenHash
  ) {
    throw new Error("RENTAL_REPORT_LINK_STALE");
  }
  return secret;
}

export function splitRentalReportToken(token: string) {
  const dot = token.indexOf(".");
  const linkId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (
    dot < 1 ||
    linkId.length > 180 ||
    !/^[A-Za-z0-9_-]{40,100}$/.test(secret)
  ) {
    throw new Error("RENTAL_REPORT_LINK_INVALID");
  }
  return { linkId, secret };
}

export async function rentalReportRequestHash(value: string) {
  const clean = value.trim().slice(0, 1000);
  return clean ? keyedProtectedAuditHash("rental-report-access-v1", clean) : "";
}
