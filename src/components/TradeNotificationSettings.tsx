"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readTradePushSubscriptionId as localId, saveTradePushSubscriptionId as saveLocalId } from "@/lib/trade-notification-client";
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
  const appleMobile = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  if (appleMobile && !standalone) return "home-screen";
  return supported ? "ready" : "unsupported";
}

export function TradeNotificationSettings({ getAuthHeaders, enabled = true }: { getAuthHeaders: () => Promise<Record<string,string>>; enabled?: boolean }) {
  const [saved,setSaved] = useState<SavedSubscription | null>(null), [browserLinked,setBrowserLinked] = useState(false);
  const [support,setSupport] = useState<"loading" | "ready" | "home-screen" | "unsupported">("loading");
  const [permission,setPermission] = useState<NotificationPermission>("default"), [configured,setConfigured] = useState(false);
  const [prepared,setPrepared] = useState(false);
  const [busy,setBusy] = useState(true), [notice,setNotice] = useState(""), [reload,setReload] = useState(0);
  const authentication = useRef(getAuthHeaders), registration = useRef<ServiceWorkerRegistration | null>(null);
  const subscription = useRef<PushSubscription | null>(null), applicationKey = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const current = useRef(0), working = useRef(false);
  useEffect(() => { authentication.current = getAuthHeaders; },[getAuthHeaders]);

  const api = useCallback(async (method = "GET", body?: Record<string,unknown>, subscriptionId = "", frozenHeaders?: Record<string,string>): Promise<PushResult> => {
    const response = await fetch(`/api/trade-push${subscriptionId ? `?subscriptionId=${encodeURIComponent(subscriptionId)}` : ""}`, {
      method, headers:{...(frozenHeaders || await authentication.current()),...(body ? {"Content-Type":"application/json"} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}), cache:"no-store", signal:AbortSignal.timeout(12000),
    });
    const result: PushResult = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Notification settings could not be saved. Try again.");
    return result;
  },[]);

  useEffect(() => {
    if (!enabled) return;
    const epoch = ++current.current;
    const load = async () => {
      setBusy(true); setNotice(""); setSaved(null); setPrepared(false); registration.current = null; applicationKey.current = null;
      const standalone = window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true);
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
        const existingWorker = await navigator.serviceWorker.getRegistration("/");
        const existingScript = existingWorker?.active?.scriptURL || existingWorker?.waiting?.scriptURL || existingWorker?.installing?.scriptURL;
        if (existingScript && new URL(existingScript).pathname !== WORKER_PATH) throw new Error("Another site service is using notifications. Contact TLink support before enabling them.");
        await navigator.serviceWorker.register(WORKER_PATH,{scope:"/",updateViaCache:"none"});
        const ready = await new Promise<ServiceWorkerRegistration>((resolve,reject) => {
          const timeout = window.setTimeout(() => reject(new Error("Notification setup took too long. Check your connection and try again.")),12000);
          navigator.serviceWorker.ready.then(value => { window.clearTimeout(timeout); resolve(value); },error => { window.clearTimeout(timeout); reject(error); });
        });
        if (current.current !== epoch) return;
        registration.current = ready;
        const browserSubscription = await ready.pushManager.getSubscription();
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
      } catch (error) { if (current.current === epoch) setNotice(error instanceof Error ? error.message : "Notifications could not load. Try again."); }
      finally { if (current.current === epoch) setBusy(false); }
    };
    void load();
    const refreshPermission = () => { if ("Notification" in window) setPermission(Notification.permission); };
    window.addEventListener("focus",refreshPermission);
    return () => { current.current = epoch + 1; window.removeEventListener("focus",refreshPermission); };
  },[enabled,reload,api]);

  const enable = async () => {
    if (working.current || !registration.current || !applicationKey.current) return;
    working.current = true; setBusy(true); setNotice("");
    const epoch = current.current;
    // Capture this identity now. A later permission response must not register
    // or clean up notifications using the next person's sign-in.
    const capturedHeaders = authentication.current().then(value => ({ok:true as const,value}),error => ({ok:false as const,error}));
    let created: PushSubscription | null = null;
    try {
      // Keep the permission request directly inside the explicit button click.
      const choice = await Notification.requestPermission();
      if (current.current !== epoch) return;
      setPermission(choice);
      if (choice !== "granted") { setNotice(choice === "denied" ? "Notifications are blocked. Allow notifications in this site's browser settings, then check again." : "Notifications stay off until you choose Allow. You can try again whenever you are ready."); return; }
      const authorisation = await capturedHeaders;
      if (!authorisation.ok) throw authorisation.error;
      if (current.current !== epoch) return;
      const browserSubscription = subscription.current || await registration.current.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey.current});
      if (!subscription.current) created = browserSubscription;
      if (current.current !== epoch) { if (created) await created.unsubscribe(); return; }
      subscription.current = browserSubscription; setBrowserLinked(true);
      const result = await api("POST",{subscription:browserSubscription.toJSON(),messages:true,calls:true},"",authorisation.value);
      if (current.current !== epoch) {
        try { if (result.subscription?.id) await api("DELETE",{subscriptionId:result.subscription.id},"",authorisation.value); }
        finally { await browserSubscription.unsubscribe(); }
        return;
      }
      if (!result.subscription?.enabled) throw new Error("Notifications were not enabled. Try again.");
      saveLocalId(result.subscription.id); setSaved(result.subscription); setNotice("Notifications are on for this device.");
    } catch (error) {
      if (current.current === epoch) {
        setSaved(null);
        setNotice(error instanceof Error ? error.message : "Notifications could not be enabled. Try again.");
      }
      if (created) {
        try { if (await created.unsubscribe()) { subscription.current = null; if (current.current === epoch) setBrowserLinked(false); } }
        catch { /* The visible error remains; Turn off can retry browser cleanup. */ }
      }
    } finally { working.current = false; if (current.current === epoch) setBusy(false); }
  };

  const update = async (messages: boolean, calls: boolean) => {
    if (!saved || working.current) return;
    working.current = true; setBusy(true); setNotice(""); const epoch = current.current;
    try {
      const result = await api("PATCH",{subscriptionId:saved.id,messages,calls});
      if (!result.subscription?.enabled) throw new Error("Notification choices were not saved. Try again.");
      if (current.current === epoch) setSaved(result.subscription);
    } catch (error) { if (current.current === epoch) setNotice(error instanceof Error ? error.message : "Notification choices could not be saved."); }
    finally { working.current = false; if (current.current === epoch) setBusy(false); }
  };

  const turnOff = async () => {
    if (working.current) return;
    working.current = true; setBusy(true); setNotice(""); const epoch = current.current;
    try {
      const id = saved?.id || localId();
      if (id) await api("DELETE",{subscriptionId:id});
      saveLocalId("");
      if (current.current === epoch) setSaved(null);
      if (subscription.current) {
        const removed = await subscription.current.unsubscribe();
        if (!removed && await registration.current?.pushManager.getSubscription()) throw new Error("TLink alerts are off, but this browser could not disconnect. Try Turn off again.");
      }
      subscription.current = null;
      if (current.current === epoch) { setBrowserLinked(false); setNotice("Notifications are off on this device."); }
    } catch (error) { if (current.current === epoch) setNotice(error instanceof Error ? error.message : "Notifications could not be turned off. Try again."); }
    finally { working.current = false; if (current.current === epoch) setBusy(false); }
  };

  if (!enabled) return null;
  const active = Boolean(saved?.enabled && browserLinked && permission === "granted");
  return <details className={styles.settings}>
    <summary>Notifications <span className={active ? styles.on : styles.off}>{busy ? "…" : active ? saved?.messages || saved?.calls ? "On" : "Muted" : "Off"}</span></summary>
    <section className={styles.panel} aria-label="Notifications on this device">
      <header><strong>Alerts on this device</strong><button type="button" onClick={event => { const details = event.currentTarget.closest("details"); if (details) details.open = false; }}>Close</button></header>
      <p>Get team messages and incoming calls when TLink is in the background. Notification previews keep message content private.</p>
      {support === "home-screen" ? <p>On iPhone or iPad, open TLink in Safari, tap Share, then Add to Home Screen. Open TLink from that icon and enable notifications here.</p>
        : support === "unsupported" ? <p>This browser cannot receive background notifications. Use an up-to-date Chrome, Firefox or Safari browser. Calls and messages still work while TLink is open.</p>
        : support === "loading" || busy && !prepared ? <p role="status">Checking this device...</p>
        : !configured ? <p>Background alerts are being set up. Messages and calls still work while TLink is open.</p>
        : <>
          {permission === "denied" && <p>Notifications are blocked. Allow notifications for TLink in your browser or device settings, then return here.</p>}
          {active && saved ? <div className={styles.preferences}>
            <label><span>Team messages</span><input type="checkbox" role="switch" checked={saved.messages} disabled={busy} onChange={event => void update(event.target.checked,saved.calls)} /></label>
            <label><span>Incoming calls</span><input type="checkbox" role="switch" checked={saved.calls} disabled={busy} onChange={event => void update(saved.messages,event.target.checked)} /></label>
          </div> : permission !== "denied" && <button type="button" className={styles.enable} disabled={busy || !prepared} onClick={() => void enable()}>{browserLinked ? "Reconnect notifications" : "Enable notifications"}</button>}
          {(active || browserLinked) && <button type="button" disabled={busy} onClick={() => void turnOff()}>Turn off on this device</button>}
        </>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {(notice && !active || permission === "denied") && support === "ready" && <button type="button" disabled={busy} onClick={() => setReload(value => value+1)}>Check again</button>}
    </section>
  </details>;
}

export default TradeNotificationSettings;
