const SUBSCRIPTION_ID_KEY = "tlink-push-subscription-id";
const NOTIFICATION_WORKER_PATH = "/tlink-notifications-sw.js";

export function readTradePushSubscriptionId(): string {
  try {
    const id = localStorage.getItem(SUBSCRIPTION_ID_KEY);
    return id && /^[A-Za-z0-9_-]{1,180}$/.test(id) ? id : "";
  } catch { return ""; }
}

export function saveTradePushSubscriptionId(id: string): void {
  try { if (id) localStorage.setItem(SUBSCRIPTION_ID_KEY,id); else localStorage.removeItem(SUBSCRIPTION_ID_KEY); }
  catch { /* Browser subscription state remains authoritative if storage is unavailable. */ }
}

export async function disableTradeDeviceNotifications(getAuthHeaders: () => Promise<Record<string,string>>, request: typeof fetch = fetch): Promise<{serverRemoved:boolean;browserRemoved:boolean}> {
  const id = readTradePushSubscriptionId();
  // Start with the current identity before any browser or sign-out operation.
  const serverRemoval = id ? (async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await request("/api/trade-push",{method:"DELETE",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({subscriptionId:id}),cache:"no-store",signal:AbortSignal.timeout(12000)});
      if (!response.ok) return false;
      const result: {ok?:boolean} = await response.json();
      return result.ok === true;
    } catch { return false; }
  })() : Promise.resolve(false);

  let browserRemoved = false;
  let registration: ServiceWorkerRegistration | undefined;
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) browserRemoved = true;
    else {
      const found = await navigator.serviceWorker.getRegistration("/");
      const script = found?.active?.scriptURL || found?.waiting?.scriptURL || found?.installing?.scriptURL;
      if (!found || script && new URL(script).pathname !== NOTIFICATION_WORKER_PATH) browserRemoved = true;
      else {
        registration = found;
        const subscription = await found.pushManager.getSubscription();
        browserRemoved = !subscription || await subscription.unsubscribe();
        if (!browserRemoved) browserRemoved = !(await found.pushManager.getSubscription());
      }
    }
  } catch { /* Server removal is independent and still completes below. */ }

  // Clearing visible toasts is independent of delivery cleanup. A toast never
  // contains message contents, and following it always requires authentication.
  if (registration) {
    try {
      const notifications = await registration.getNotifications();
      for (const notification of notifications) if (notification.tag.startsWith("tlink:")) notification.close();
    } catch { /* Confirmed delivery removal still allows sign-out. */ }
  }
  const serverRemoved = await serverRemoval;
  if (!serverRemoved && !browserRemoved) throw new Error("This device's notifications could not be turned off. Check your connection and try signing out again.");
  saveTradePushSubscriptionId("");
  return {serverRemoved,browserRemoved};
}
