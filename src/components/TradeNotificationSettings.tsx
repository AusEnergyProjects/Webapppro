"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import { useCallback, useEffect, useRef, useState } from "react";
import { tradeBrowserDevice, notificationErrorMessage, notificationTimeout, readTradePushSubscriptionId as localId, saveTradePushSubscriptionId as saveLocalId } from "@/lib/trade-device-client";
import styles from "./TradeNotificationSettings.module.css";

type SavedSubscription = { id: string; messages: boolean; calls: boolean; enabled: boolean };
type PushResult = { ok: boolean; error?: string; configured?: boolean; publicKey?: string; subscription?: SavedSubscription | null };
const WORKER_PATH = "/tlink-notifications-sw.js";

export function notificationApplicationKey(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{87}$/.test(value)) throw new Error("Notification setup is unavailable. Try again shortly.");
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=");
  if (binary.length !== 65 || binary.charCodeAt(0) !== 4) throw new Error("Notification setup is unavailable. Try again shortly.");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function notificationDeviceSupport(userAgent: string, touchPoints: number, standalone: boolean, supported: boolean): "ready" | "home-screen" | "unsupported" {
  const appleMobile = tradeBrowserDevice({ userAgent, maxTouchPoints: touchPoints, standalone }).platform === "ios";
  if (appleMobile && !standalone) return "home-screen";
  return supported ? "ready" : "unsupported";
}

export function TradeNotificationSettings({ getAuthHeaders, enabled = true }: { getAuthHeaders: () => Promise<Record<string,string>>; enabled?: boolean }) {
  const fetch = useTradeBusinessFetch();
  const [saved,setSaved] = useState<SavedSubscription | null>(null), [browserLinked,setBrowserLinked] = useState(false);
  const [support,setSupport] = useState<"loading" | "ready" | "home-screen" | "unsupported">("loading");
  const [homeScreenBrowser,setHomeScreenBrowser] = useState("your browser");
  const [permission,setPermission] = useState<NotificationPermission>("default"), [configured,setConfigured] = useState(false);
  const [prepared,setPrepared] = useState(false);
  const [busy,setBusy] = useState(true), [notice,setNotice] = useState(""), [reload,setReload] = useState(0);
  const [issue,setIssue] = useState(false), [step,setStep] = useState("Checking this device...");
  const authentication = useRef(getAuthHeaders), registration = useRef<ServiceWorkerRegistration | null>(null);
  const subscription = useRef<PushSubscription | null>(null), applicationKey = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const current = useRef(0), working = useRef(false);
  useEffect(() => { authentication.current = getAuthHeaders; },[getAuthHeaders]);

  const api = useCallback(async (method = "GET", body?: Record<string,unknown>, subscriptionId = "", frozenHeaders?: Record<string,string>): Promise<PushResult> => {
    // Bound authentication too; a stalled token refresh must not leave Enable grey.
    const headers = frozenHeaders || await notificationTimeout(authentication.current());
    const response = await notificationTimeout(fetch(`/api/trade-push${subscriptionId ? `?subscriptionId=${encodeURIComponent(subscriptionId)}` : ""}`, {
      method, headers:{...headers,...(body ? {"Content-Type":"application/json"} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}), cache:"no-store", signal:AbortSignal.timeout(12000),
    }));
    const result: PushResult = await notificationTimeout(response.json());
    if (!response.ok || !result.ok) throw new Error(result.error || "Notification settings could not be saved. Try again.");
    return result;
  },[fetch]);

  useEffect(() => {
    if (!enabled) return;
    const epoch = ++current.current;
    const load = async () => {
      setBusy(true); setStep("Checking this device..."); setNotice(""); setIssue(false); setSaved(null); setPrepared(false); setBrowserLinked(false); registration.current = null; subscription.current = null; applicationKey.current = null;
      const standalone = window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true);
      const browser = tradeBrowserDevice({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, standalone }).browser;
      setHomeScreenBrowser(browser === "chrome" ? "Chrome" : browser === "safari" ? "Safari" : "your browser");
      const device = notificationDeviceSupport(navigator.userAgent,navigator.maxTouchPoints,standalone,
        window.isSecureContext && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window);
      setSupport(device);
      if (device !== "ready") { setBusy(false); return; }
      setPermission(Notification.permission);
      try {
        const settings = await api("GET",undefined,localId());
        if (current.current !== epoch) return;
        setConfigured(Boolean(settings.configured));
        if (!settings.configured || !settings.publicKey) { setBusy(false); return; }
        applicationKey.current = notificationApplicationKey(settings.publicKey);
        const existingWorker = await notificationTimeout(navigator.serviceWorker.getRegistration("/"));
        if (current.current !== epoch) return;
        const existingScript = existingWorker?.active?.scriptURL || existingWorker?.waiting?.scriptURL || existingWorker?.installing?.scriptURL;
        if (existingScript && new URL(existingScript).pathname !== WORKER_PATH) throw new Error("Another site service is using notifications. Contact TLink support before enabling them.");
        await notificationTimeout(navigator.serviceWorker.register(WORKER_PATH,{scope:"/",updateViaCache:"none"}));
        const ready = await notificationTimeout(navigator.serviceWorker.ready);
        if (current.current !== epoch) return;
        registration.current = ready;
        const browserSubscription = await notificationTimeout(ready.pushManager.getSubscription());
        if (current.current !== epoch) return;
        subscription.current = browserSubscription; setBrowserLinked(Boolean(browserSubscription));
        setPrepared(true);
        let status = settings.subscription || null;
        if (browserSubscription && status?.enabled && Notification.permission === "granted") {
          // Renew the already-consented device lease using its saved choices.
          // This does not request browser permission or change preferences.
          const renewed = await api("POST",{subscription:browserSubscription.toJSON(),messages:status.messages,calls:status.calls});
          if (current.current !== epoch) return;
          if (!renewed.subscription?.enabled) throw new Error("Notifications could not reconnect. Try again.");
          status = renewed.subscription; saveLocalId(status.id);
        }
        setSaved(browserSubscription && Notification.permission === "granted" ? status : null);
      } catch (error) { if (current.current === epoch) { setIssue(true); setNotice(notificationErrorMessage(error,"Notifications could not load. Try again.")); } }
      finally { if (current.current === epoch) setBusy(false); }
    };
    void load();
    const refreshPermission = () => { if ("Notification" in window) setPermission(Notification.permission); };
    window.addEventListener("focus",refreshPermission);
    return () => { current.current = epoch + 1; window.removeEventListener("focus",refreshPermission); };
  },[enabled,reload,api]);

  const enable = async () => {
    if (working.current) return;
    if (!registration.current || !applicationKey.current) { setIssue(true); setNotice("This device is not ready yet. Choose Check again to reconnect."); return; }
    working.current = true; setBusy(true); setStep("Waiting for your browser permission..."); setNotice(""); setIssue(false);
    const epoch = current.current;
    // Capture this identity now. A later permission response must not register
    // or clean up notifications using the next person's sign-in.
    const capturedHeaders = notificationTimeout(authentication.current()).then(value => ({ok:true as const,value}),error => ({ok:false as const,error}));
    let created: PushSubscription | null = null;
    try {
      // Keep the permission request directly inside the explicit button click.
      const choice = await notificationTimeout(Notification.requestPermission(),60000);
      if (current.current !== epoch) return;
      setPermission(choice);
      if (choice !== "granted") { setIssue(true); setNotice(choice === "denied" ? "Notifications are blocked. Allow notifications in this site's browser settings, then check again." : "Notifications stay off until you choose Allow. Check for the permission prompt beside the address bar, then try Enable notifications again."); return; }
      setStep("Connecting notifications to this device...");
      const authorisation = await capturedHeaders;
      if (!authorisation.ok) throw authorisation.error;
      if (current.current !== epoch) return;
      const browserSubscription = subscription.current || await notificationTimeout(registration.current.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey.current}));
      if (!subscription.current) created = browserSubscription;
      if (current.current !== epoch) { if (created) await notificationTimeout(created.unsubscribe()); return; }
      subscription.current = browserSubscription; setBrowserLinked(true);
      const result = await api("POST",{subscription:browserSubscription.toJSON(),messages:true,calls:true},"",authorisation.value);
      if (current.current !== epoch) {
        try { if (result.subscription?.id) await api("DELETE",{subscriptionId:result.subscription.id},"",authorisation.value); }
        finally { await notificationTimeout(browserSubscription.unsubscribe()); }
        return;
      }
      if (!result.subscription?.enabled) throw new Error("Notifications were not enabled. Try again.");
      saveLocalId(result.subscription.id); setSaved(result.subscription); setNotice("Notifications are on. Use Test this device to check your browser and device settings.");
    } catch (error) {
      if (current.current === epoch) {
        setSaved(null);
        setIssue(true); setNotice(notificationErrorMessage(error,"Notifications could not be enabled. Try again."));
      }
      if (created) {
        try { if (await notificationTimeout(created.unsubscribe())) { subscription.current = null; if (current.current === epoch) setBrowserLinked(false); } }
        catch { /* The visible error remains; Turn off can retry browser cleanup. */ }
      }
    } finally { working.current = false; if (current.current === epoch) setBusy(false); }
  };

  const update = async (messages: boolean, calls: boolean) => {
    if (!saved || working.current) return;
    working.current = true; setBusy(true); setStep("Saving your choices..."); setNotice(""); setIssue(false); const epoch = current.current;
    try {
      const result = await api("PATCH",{subscriptionId:saved.id,messages,calls});
      if (!result.subscription?.enabled) throw new Error("Notification choices were not saved. Try again.");
      if (current.current === epoch) setSaved(result.subscription);
    } catch (error) { if (current.current === epoch) { setIssue(true); setNotice(notificationErrorMessage(error,"Notification choices could not be saved.")); } }
    finally { working.current = false; if (current.current === epoch) setBusy(false); }
  };

  const turnOff = async () => {
    if (working.current) return;
    working.current = true; setBusy(true); setStep("Turning off notifications..."); setNotice(""); setIssue(false); const epoch = current.current;
    try {
      const id = saved?.id || localId();
      if (id) await api("DELETE",{subscriptionId:id});
      saveLocalId("");
      if (current.current === epoch) setSaved(null);
      if (subscription.current) {
        const removed = await notificationTimeout(subscription.current.unsubscribe());
        if (!removed && registration.current && await notificationTimeout(registration.current.pushManager.getSubscription())) throw new Error("TLink alerts are off, but this browser could not disconnect. Try Turn off again.");
      }
      subscription.current = null;
      if (current.current === epoch) { setBrowserLinked(false); setNotice("Notifications are off on this device."); }
    } catch (error) { if (current.current === epoch) { setIssue(true); setNotice(notificationErrorMessage(error,"Notifications could not be turned off. Try again.")); } }
    finally { working.current = false; if (current.current === epoch) setBusy(false); }
  };

  const testDevice = async () => {
    if (working.current || !registration.current || Notification.permission !== "granted") return;
    working.current = true; setBusy(true); setStep("Showing a test alert..."); setNotice(""); setIssue(false); const epoch = current.current;
    try {
      await notificationTimeout(registration.current.showNotification("TLink",{
        body:"Device notification test", icon:"/tlink-icon-192.png", badge:"/tlink-mark.png", tag:"tlink:device-test", data:{kind:"device-test"},
      }));
      if (current.current === epoch) setNotice("Test alert sent to this device. If you did not see it, allow browser notifications in your device settings and check Focus or Do Not Disturb.");
    } catch (error) { if (current.current === epoch) { setIssue(true); setNotice(notificationErrorMessage(error,"The test alert could not be shown. Check this device's notification settings.")); } }
    finally { working.current = false; if (current.current === epoch) setBusy(false); }
  };

  if (!enabled) return null;
  const active = Boolean(saved?.enabled && browserLinked && permission === "granted");
  const label = busy ? "Checking" : support === "home-screen" ? "Set up" : support === "unsupported" ? "Unsupported" : permission === "denied" ? "Blocked" : issue ? "Needs attention" : !configured ? "Unavailable" : active ? saved?.messages || saved?.calls ? "On" : "Muted" : "Off";
  return <details className={styles.settings}>
    <summary>Notifications <span className={issue || permission === "denied" ? styles.warning : active ? styles.on : styles.off}>{label}</span></summary>
    <section className={styles.panel} aria-label="Notifications on this device">
      <header><strong>Alerts on this device</strong><button type="button" onClick={event => { const details = event.currentTarget.closest("details"); if (details) details.open = false; }}>Close</button></header>
      <p>Get alerts for team messages and incoming calls. Message contents stay private on the lock screen.</p>
      {support === "home-screen" ? <div className={styles.setup}><strong>Add TLink to your Home Screen</strong><ol><li>In {homeScreenBrowser}, tap Share → Add to Home Screen → Add.</li><li>Open the TLink icon, then turn on notifications here.</li></ol><p>Calls work while this page is open. Home Screen setup lets this device receive background alerts.</p><a href="/direct-trade/field-app">Show install steps</a></div>
        : support === "unsupported" ? <p>This browser cannot receive background notifications. Use an up-to-date Chrome, Firefox or Safari browser. Calls and messages still work while TLink is open.</p>
        : support === "loading" || busy && !prepared ? <p role="status">{step}</p>
        : !configured && !issue ? <p>Background alerts are not configured for TLink yet. Contact TLink support. Keep TLink open for live messages and calls.</p>
        : <>
          {permission === "denied" && <p>Notifications are blocked. Allow notifications for TLink in your browser or device settings, then return here.</p>}
          {active && saved ? <div className={styles.preferences}>
            <label><span>Team messages</span><input type="checkbox" role="switch" checked={saved.messages} disabled={busy} onChange={event => void update(event.target.checked,saved.calls)} /></label>
            <label><span>Incoming calls</span><input type="checkbox" role="switch" checked={saved.calls} disabled={busy} onChange={event => void update(saved.messages,event.target.checked)} /></label>
          </div> : permission !== "denied" && prepared && <button type="button" className={styles.enable} disabled={busy} onClick={() => void enable()}>{busy ? "Enabling..." : browserLinked ? "Reconnect notifications" : "Enable notifications"}</button>}
          {active && <button type="button" disabled={busy} onClick={() => void testDevice()}>Test this device</button>}
          {(active || browserLinked) && <button type="button" disabled={busy} onClick={() => void turnOff()}>Turn off on this device</button>}
          {active && <p>Keep sound on and allow TLink through Focus or Do Not Disturb. Background call alerts use your device&apos;s notification sound; an open TLink screen can ring.</p>}
        </>}
      {busy && prepared && <p role="status">{step}</p>}
      {notice && <p role={issue ? "alert" : "status"} className={styles.notice}>{notice}</p>}
      {(issue || notice && !active || permission === "denied" || !configured) && support === "ready" && <button type="button" disabled={busy} onClick={() => setReload(value => value+1)}>Check again</button>}
    </section>
  </details>;
}

export default TradeNotificationSettings;
