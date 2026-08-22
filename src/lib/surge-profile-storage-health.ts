export type SurgeProfileStorageHealthStatus = "save_failed" | "load_failed" | "merge_recovered";

const reportedStatuses = new Set<SurgeProfileStorageHealthStatus>();

export function recordSurgeProfileStorageHealth(status: SurgeProfileStorageHealthStatus) {
  if (typeof window === "undefined" || reportedStatuses.has(status)) return;
  reportedStatuses.add(status);

  const body = JSON.stringify({ status });
  try {
    if (window.navigator.sendBeacon?.(
      "/api/energy-assistant/profile-storage-health",
      new Blob([body], { type: "application/json" }),
    )) return;
  } catch {
    // Fall through to the keepalive request when beacon delivery is unavailable.
  }

  void fetch("/api/energy-assistant/profile-storage-health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
}
