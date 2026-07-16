import { randomUUID } from "node:crypto";

function cleanMetrics(metrics) {
  return Object.fromEntries(
    Object.entries(metrics || {}).filter(([, value]) => (
      typeof value === "string"
      || typeof value === "number" && Number.isFinite(value)
      || typeof value === "boolean"
    )),
  );
}

/**
 * @param {{event?: string, logger?: Console, now?: () => number, createId?: () => string}} options
 */
export function createOperationalRecorder({
  event,
  logger = console,
  now = Date.now,
  createId = randomUUID,
} = {}) {
  const startedAt = now();
  const requestId = createId();

  return {
    requestId,
    record(outcome, status, metrics = {}) {
      const entry = {
        schemaVersion: "1",
        event,
        outcome,
        status,
        durationMs: Math.max(0, now() - startedAt),
        requestId,
        ...cleanMetrics(metrics),
      };
      const method = status >= 500 ? "error" : "info";
      logger[method](JSON.stringify(entry));
      return entry;
    },
  };
}
