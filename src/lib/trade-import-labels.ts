/** Present generated import history without rewriting the immutable audit record. */
export function visibleImportedJobEventSummary(
  event: { id?: unknown; event_type?: unknown; summary?: unknown },
  workOrderId: unknown,
) {
  const summary = String(event.summary || "");
  const prefix = "Imported Dataforce job ";
  const suffix = "; source retained without issuing invoices, certificates or customer notifications.";
  return typeof workOrderId === "string" && workOrderId.length > 0
    && event.id === `${workOrderId}:import` && event.event_type === "data_imported"
    && summary.startsWith(prefix) && summary.endsWith(suffix) && summary.length > prefix.length + suffix.length
    ? `Imported job ${summary.slice(prefix.length)}` : summary;
}
