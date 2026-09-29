import { normalizeTLinkPasswordResetContinue } from "./tlink-password-reset-continue.ts";

type ResetFailure = "invalid-email" | "rate-limited" | "unavailable" | "connection" | "failed";

const RESET_MESSAGES: Record<ResetFailure, string> = {
  "invalid-email": "Enter a valid email address and try again.",
  "rate-limited": "Too many reset requests. Please wait a few minutes, then try again.",
  unavailable: "Password reset emails are temporarily unavailable. Try again later, or use Continue with Google if that is how you joined.",
  connection: "The connection was interrupted. Check your internet connection and try again.",
  failed: "The password reset request could not be completed. Please try again.",
};

export class TLinkPasswordResetError extends Error {
  readonly reason: ResetFailure;

  constructor(reason: ResetFailure) {
    super(RESET_MESSAGES[reason]);
    this.name = "TLinkPasswordResetError";
    this.reason = reason;
  }
}

export function tlinkPasswordResetErrorMessage(error: unknown): string {
  return error instanceof TLinkPasswordResetError ? RESET_MESSAGES[error.reason] : RESET_MESSAGES.failed;
}

export async function requestTLinkPasswordReset(email: string, continuePath?: string): Promise<void> {
  const recipient = email.trim().toLowerCase();
  if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new TLinkPasswordResetError("invalid-email");
  }
  let response: Response;
  try {
    response = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: recipient, continuePath: normalizeTLinkPasswordResetContinue(continuePath) }),
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new TLinkPasswordResetError("connection");
  }
  if (!response.ok) {
    throw new TLinkPasswordResetError(response.status === 400 ? "invalid-email" : response.status === 429 ? "rate-limited" : response.status === 503 ? "unavailable" : "failed");
  }
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true) {
    throw new TLinkPasswordResetError("failed");
  }
}
