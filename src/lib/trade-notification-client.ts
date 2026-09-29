const SUBSCRIPTION_ID_KEY = "tlink-push-subscription-id";
const NOTIFICATION_WORKER_PATH = "/tlink-notifications-sw.js";

export type TradeBrowserDevice = {
  platform: "ios" | "android" | "desktop";
  browser: "chrome" | "safari" | "edge" | "firefox" | "unknown";
  embedded: boolean;
  device: "iphone" | "ipad" | "android" | "desktop";
};
type BrowserDeviceInput = { userAgent?: string; maxTouchPoints?: number; standalone?: boolean };

// Presentation guidance only. User-agent detection never grants capabilities
// or replaces checking the browser API before it is used.
export function tradeBrowserDevice(input: BrowserDeviceInput = typeof navigator === "undefined" ? {} : navigator): TradeBrowserDevice {
  const ua = input.userAgent || "";
  const ipad = /iPad/i.test(ua) || /Macintosh/i.test(ua) && (input.maxTouchPoints || 0) > 1;
  const ios = ipad || /iPhone|iPod/i.test(ua), android = /Android/i.test(ua);
  const browser = /Edg(?:e|A|iOS)?\//i.test(ua) ? "edge"
    : /CriOS\//i.test(ua) || /Chrome\//i.test(ua) && !/SamsungBrowser\//i.test(ua) ? "chrome"
    : /Firefox\/|FxiOS\//i.test(ua) ? "firefox"
    : /Version\/.+Safari\//i.test(ua) || ios && input.standalone === true ? "safari" : "unknown";
  const embedded = /; wv\)|\bFBAN\/|\bFBAV\/|Instagram|GSA\//i.test(ua)
    || ios && browser === "unknown" && input.standalone !== true;
  return { platform: ios ? "ios" : android ? "android" : "desktop", browser, embedded,
    device: ipad ? "ipad" : ios ? "iphone" : android ? "android" : "desktop" };
}

export async function notificationTimeout<T>(operation: Promise<T>, milliseconds = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Notification setup took too long. Check your connection, then try again.")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export function notificationErrorMessage(error: unknown, fallback: string): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError" || name === "TypeError") return "Could not connect to notifications. Check your connection, then try again.";
  if (name === "NotAllowedError") return "Notifications are blocked. Allow notifications in this site's browser settings, then check again.";
  if (name === "NotSupportedError") return "This browser cannot enable notifications. Use an up-to-date browser or open TLink from its Home Screen icon on iPhone.";
  if (name === "InvalidStateError") return "This browser needs to reconnect. Turn off notifications on this device, then enable them again.";
  return error instanceof Error && error.message ? error.message : fallback;
}

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
