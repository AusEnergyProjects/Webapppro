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
