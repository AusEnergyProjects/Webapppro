export const TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS = 5;
export const TRADE_QUOTE_DELIVERY_LEASE_MS = 10 * 60 * 1000;

const RETRY_MINUTES = [5, 30, 120, 360];

export function tradeQuoteDeliveryRetryAt(attempts, now = Date.now()) {
  const count = Math.max(0, Math.floor(Number(attempts) || 0));
  if (count >= TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS) return "";
  const minutes = RETRY_MINUTES[Math.min(Math.max(count - 1, 0), RETRY_MINUTES.length - 1)];
  return new Date(Number(now) + minutes * 60 * 1000).toISOString();
}

export function tradeQuoteDeliveryLeaseUntil(now = Date.now()) {
  return new Date(Number(now) + TRADE_QUOTE_DELIVERY_LEASE_MS).toISOString();
}

export function tradeQuoteDeliveryPublicOrigin(value) {
  try {
    const origin = new URL(String(value || "")).origin;
    const host = new URL(origin).hostname.toLowerCase();
    if (
      new URL(origin).protocol === "https:"
      && [
        "compare.ausenergyassessments.com",
        "aea-energy-comparison.info294029.chatgpt.site",
      ].includes(host)
    ) return origin;
  } catch { /* Use the canonical public origin below. */ }
  return "https://compare.ausenergyassessments.com";
}

export function tradeQuoteDeliveryPresentation(status, attempts = 0, nextAttemptAt = "", failureCode = "", generation = 1) {
  const state = String(status || "queued");
  if (String(failureCode) === "QUOTE_DELIVERY_LEGACY_RETRY_REQUIRED") {
    return { key: "attention", label: "Needs attention", canRetry: Number(generation) === 1 };
  }
  if (String(failureCode) === "QUOTE_DELIVERY_PROVIDER_TERMINAL" && state === "failed") {
    return { key: "attention", label: "Needs attention", canRetry: Number(generation) === 1 };
  }
  if (state === "delivered") {
    return { key: "delivered", label: "Delivered", canRetry: false };
  }
  if (["provider_accepted", "sent"].includes(state)) {
    return { key: "accepted", label: "Email accepted for delivery", canRetry: false };
  }
  if (state === "queued") {
    return { key: "sending", label: "Queued for email", canRetry: false };
  }
  if (state === "sending") {
    return { key: "sending", label: "Submitting to email provider", canRetry: false };
  }
  if (state === "waiting_for_channel") {
    return { key: "sending", label: "Waiting for email service", canRetry: false };
  }
  if (
    state === "failed"
    && Number(attempts) < TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS
    && Boolean(String(nextAttemptAt || ""))
  ) {
    return { key: "sending", label: "Retry scheduled", canRetry: false };
  }
  return {
    key: "attention",
    label: "Needs attention",
    canRetry: Number(generation) === 1 && state === "failed" && (
      Number(attempts) >= TRADE_QUOTE_DELIVERY_MAX_ATTEMPTS
    ),
  };
}

export function tradeQuoteDeliveryCallbackStatus(currentStatus, incomingStatus) {
  const current = String(currentStatus || "");
  const incoming = String(incomingStatus || "");
  const adverse = new Set(["bounced", "complained", "opted_out"]);
  if (adverse.has(current)) return current;
  if (adverse.has(incoming)) return incoming;
  if (current === "delivered") return current;
  if (incoming === "delivered") return incoming;
  if (current === "failed") return current;
  if (incoming === "failed") return incoming;
  if (current === "sent" && incoming === "provider_accepted") return current;
  return incoming || current;
}

export function assertTradeQuoteIssueDeliveryAccess(canManage, canSend, consentConfirmed) {
  if (!canManage) throw new Error("QUOTE_MANAGEMENT_REQUIRED");
  if (!canSend) throw new Error("QUOTE_SEND_REQUIRED");
  if (consentConfirmed !== true) throw new Error("QUOTE_DELIVERY_CONSENT_REQUIRED");
}

export function boundedTradeQuoteDeliveryFailure(error) {
  const raw = error instanceof Error ? error.message : "QUOTE_DELIVERY_FAILED";
  const safe = String(raw || "QUOTE_DELIVERY_FAILED")
    .replace(/[^A-Z0-9_]/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 80);
  return safe || "QUOTE_DELIVERY_FAILED";
}
