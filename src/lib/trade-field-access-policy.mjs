export const FIELD_SETUP_PIN_PATTERN = /^\d{6}$/;
export const FIELD_SETUP_PIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FIELD_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const FIELD_ACCESS_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const FIELD_ACCESS_LOCK_MS = 15 * 60 * 1000;
export const FIELD_ACCESS_MAX_ATTEMPTS = 5;

export function normalizeFieldAccessName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-AU")
    .slice(0, 160);
}

export function validFieldSetupPin(value) {
  return FIELD_SETUP_PIN_PATTERN.test(String(value || "").trim());
}

export function fieldAccessAttemptState(current, nowMs = Date.now()) {
  const updatedMs = Date.parse(String(current?.updatedAt || current?.updated_at || ""));
  const lockedUntilMs = Date.parse(String(current?.lockedUntil || current?.locked_until || ""));
  const attempts = Number(current?.attempts || 0);
  if (Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs) {
    return Object.freeze({ attempts, locked: true, retryAt: new Date(lockedUntilMs).toISOString() });
  }
  if (!Number.isFinite(updatedMs) || nowMs - updatedMs >= FIELD_ACCESS_ATTEMPT_WINDOW_MS) {
    return Object.freeze({ attempts: 0, locked: false, retryAt: "" });
  }
  return Object.freeze({ attempts, locked: false, retryAt: "" });
}
