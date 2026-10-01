const STAGES = [
  "native_start", "configuration_changed", "push_received", "push_rejected",
  "call_reported", "call_report_failed", "duplicate_reported", "duplicate_report_failed",
] as const;
const APP_STATES = ["active", "inactive", "background", "unknown"] as const;
const REJECTION_REASONS = [
  "disabled", "invalid_call_id", "invalid_thread_id", "invalid_mode", "invalid_expiry", "expired",
] as const;
const ERROR_DOMAINS = ["callkit_incoming", "other"] as const;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

type NativeCallDiagnostic = {
  timestamp: string;
  stage: typeof STAGES[number];
  localEnabled: boolean;
  appState: typeof APP_STATES[number];
  managedCallCount: number;
  managedConnectedCount: number;
  systemCallCount: number;
  systemConnectedCount: number;
  rejectionReason?: typeof REJECTION_REASONS[number];
  errorDomain?: typeof ERROR_DOMAINS[number];
  errorCode?: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

function integerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function diagnosticTimestamp(value: unknown, now: number): string | null {
  if (typeof value !== "string" || value.length > 35
    || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) return null;
  const date = new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp) || timestamp < now - MAX_AGE_MS || timestamp > now + MAX_FUTURE_MS) return null;
  // Date.parse normalises invalid calendar days, so verify the unshifted local date too.
  const localDate = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (localDate.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return date.toISOString();
}

/** Accept only a small, recent, non-identifying native snapshot. Invalid diagnostics never block registration. */
export function nativeCallDiagnosticSnapshot(value: unknown, appVersion: unknown, now = Date.now()): {
  appVersion: string;
  events: NativeCallDiagnostic[];
} | null {
  if (typeof appVersion !== "string" || !/^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/.test(appVersion)
    || !Number.isFinite(now) || !Array.isArray(value) || value.length === 0 || value.length > 12) return null;
  const events: NativeCallDiagnostic[] = [];
  for (const item of value) {
    if (!record(item)) return null;
    const timestamp = diagnosticTimestamp(item.timestamp, now);
    if (!timestamp || !oneOf(item.stage, STAGES) || typeof item.localEnabled !== "boolean"
      || !oneOf(item.appState, APP_STATES)
      || !integerBetween(item.managedCallCount, 0, 32) || !integerBetween(item.managedConnectedCount, 0, 32)
      || !integerBetween(item.systemCallCount, 0, 32) || !integerBetween(item.systemConnectedCount, 0, 32)
      || (item.rejectionReason !== undefined && !oneOf(item.rejectionReason, REJECTION_REASONS))
      || (item.errorDomain !== undefined && !oneOf(item.errorDomain, ERROR_DOMAINS))
      || (item.errorCode !== undefined && !integerBetween(item.errorCode, -1, 100))) return null;
    events.push({
      timestamp, stage: item.stage, localEnabled: item.localEnabled, appState: item.appState,
      managedCallCount: item.managedCallCount, managedConnectedCount: item.managedConnectedCount,
      systemCallCount: item.systemCallCount, systemConnectedCount: item.systemConnectedCount,
      ...(item.rejectionReason !== undefined ? { rejectionReason: item.rejectionReason } : {}),
      ...(item.errorDomain !== undefined ? { errorDomain: item.errorDomain } : {}),
      ...(item.errorCode !== undefined ? { errorCode: item.errorCode } : {}),
    });
  }
  return { appVersion, events };
}
