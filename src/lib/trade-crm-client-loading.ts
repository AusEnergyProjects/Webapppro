export type CrmListViewKey = "installer-jobs" | "installer-customers";

/** A component-scoped loader. Never share an instance between users or businesses. */
export function createCrmListViewLoader<T>(
  read: (view: CrmListViewKey, signal: AbortSignal) => Promise<T>,
  timeoutMs = 5_000,
  timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis,
) {
  const requests = new Map<CrmListViewKey, { controller: AbortController; result: Promise<T>; cancel: () => void }>();
  return {
    load(view: CrmListViewKey): Promise<T> {
      const existing = requests.get(view);
      if (existing) return existing.result;
      const controller = new AbortController();
      let rejectRequest: (reason: Error) => void = () => {};
      const deadline = timers.setTimeout(() => {
        controller.abort();
        rejectRequest(new Error("The saved list view took too long to load. Your saved filters could not be applied. Reopen this view to try again."));
      }, timeoutMs);
      const result = new Promise<T>((resolve, reject) => {
        rejectRequest = reject;
        try { void read(view, controller.signal).then(resolve, reject); }
        catch (error) { reject(error); }
      }).finally(() => timers.clearTimeout(deadline)).catch((error: unknown) => {
        if (requests.get(view)?.controller === controller) requests.delete(view);
        throw error;
      });
      requests.set(view, { controller, result, cancel() {
        timers.clearTimeout(deadline);
        controller.abort();
        rejectRequest(new DOMException("Request cancelled", "AbortError"));
      } });
      return result;
    },
    cancel() {
      const pending = [...requests.values()];
      requests.clear();
      for (const request of pending) request.cancel();
    },
  };
}

/** Text entry is debounced; opening a view, sorting and paging start immediately. */
export function crmIndexRequestDelay(previousText: string | null, currentText: string): number {
  return previousText !== null && previousText !== currentText ? 180 : 0;
}
