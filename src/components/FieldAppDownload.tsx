"use client";

import { useEffect, useRef, useState } from "react";
import { tradeBrowserDevice } from "@/lib/trade-device-client";

type ReleasePolicy = { latestVersion?: string; updateUrl?: string };
type Platform = "ios" | "android" | "desktop";
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
function isInstallPrompt(event: Event): event is InstallPrompt {
  return "prompt" in event && typeof event.prompt === "function" && "userChoice" in event && event.userChoice instanceof Promise;
}

export function fieldAppReleaseUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.pathname.replace(/\/$/, "") !== "/direct-trade/field-app" ? url.toString() : "";
  } catch { return ""; }
}

export function FieldAppDownload() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [browser, setBrowser] = useState("your browser");
  const [installed, setInstalled] = useState(false);
  const [policy, setPolicy] = useState<ReleasePolicy | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const [canInstall, setCanInstall] = useState(false), [installing, setInstalling] = useState(false), [notice, setNotice] = useState("");
  const prompt = useRef<InstallPrompt | null>(null);
  useEffect(() => {
    const device = tradeBrowserDevice();
    const frame = requestAnimationFrame(() => {
      setPlatform(device.platform);
      setBrowser(({ chrome: "Chrome", safari: "Safari", edge: "Edge", firefox: "Firefox", unknown: "your browser" })[device.browser]);
      setInstalled(window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true));
    });
    const ready = (event: Event) => {
      if (!isInstallPrompt(event)) return;
      event.preventDefault(); prompt.current = event; setCanInstall(true);
    };
    const done = () => { setInstalled(true); prompt.current = null; setCanInstall(false); };
    window.addEventListener("beforeinstallprompt", ready); window.addEventListener("appinstalled", done);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("beforeinstallprompt", ready); window.removeEventListener("appinstalled", done); };
  }, []);
  useEffect(() => {
    if (platform !== "android") return;
    let active = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    void fetch("/api/field/app-release?platform=android", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { policy?: ReleasePolicy };
        if (!response.ok || !body.policy || !fieldAppReleaseUrl(body.policy.updateUrl)) throw new Error("release unavailable");
        if (active) { setPolicy(body.policy); setFailed(false); }
      })
      .catch(() => { if (active) setFailed(true); }).finally(() => clearTimeout(timer));
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [platform, attempt]);
  const install = async () => {
    const current = prompt.current;
    if (!current || installing) return;
    setInstalling(true); setNotice("");
    try {
      // Keep the native browser prompt inside the user's install click.
      await current.prompt();
      const choice = await current.userChoice;
      setNotice(choice.outcome === "accepted" ? "TLink is being added to this device." : "You can keep using TLink here, or install it from your browser menu later.");
    } catch { setNotice("Open your browser menu and choose Install TLink or Add to Home Screen."); }
    finally { prompt.current = null; setCanInstall(false); setInstalling(false); }
  };
  const url = fieldAppReleaseUrl(policy?.updateUrl);
  return <section className="tlink-install-card" aria-label="Install TLink">
    <div className="tlink-install-devices" aria-label="Choose your device">{([['ios', 'iPhone / iPad'], ['android', 'Android'], ['desktop', 'Computer']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={platform === value} onClick={() => { setPlatform(value); setNotice(""); }}>{label}</button>)}</div>
    {!platform ? <p role="status">Checking your device...</p> : installed ? <>
      <h2>TLink is on this device</h2><p>Open your workspace to see your jobs and messages.</p><a className="tlink-install-primary" href="/direct-trade/dashboard">Open TLink</a>
    </> : platform === "ios" ? <>
      <span className="tlink-install-tag">TLink web app</span><h2>Add TLink to your Home Screen</h2>
      <p>Your existing team login works here. There is no separate account to create.</p>
      <ol><li>In {browser === "Chrome" || browser === "Safari" ? browser : "your browser"}, tap <strong>Share</strong> <span aria-hidden="true">↑</span> beside the address bar.</li><li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li></ol>
      <p className="tlink-install-hint">Open the new TLink icon, sign in and enable notifications in Messages. Keep “Open as Web App” on if your phone shows it.</p>
      <a className="tlink-install-secondary" href="/direct-trade/dashboard">Continue to TLink</a>
      <details><summary>Can’t find Add to Home Screen?</summary><p>Scroll down the Share menu. If it is still missing, open this page in Safari and use Share.</p></details>
    </> : platform === "android" ? <>
      <span className="tlink-install-tag">Android app</span><h2>Get TLink on your phone</h2><p>Your work, team messages and calls in one app.</p>
      {url ? <a className="tlink-install-primary" href={url}>Download Android app{policy?.latestVersion ? ` · ${policy.latestVersion}` : ""}</a> : failed ? <><p role="alert">The download link could not load.</p><button type="button" className="tlink-install-primary" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try again</button></> : <p role="status">Checking the latest Android app...</p>}
      <p className="tlink-install-hint">Already installed? Open TLink → Settings → Check for update.</p>
      <details><summary>Signing in to the Android app</summary><p>Your business opens Team, chooses your name, and sends a one-time field app PIN. Use that username and PIN on the app’s sign-in screen.</p></details>
    </> : <>
      <span className="tlink-install-tag">Computer</span><h2>Keep TLink one click away</h2><p>Use your normal TLink login for your jobs, messages and calls.</p>
      {canInstall ? <button type="button" className="tlink-install-primary" disabled={installing} onClick={() => void install()}>{installing ? "Opening install prompt..." : "Install TLink"}</button> : <p>Open your browser menu and choose <strong>Install TLink</strong> if available, or bookmark your workspace.</p>}
      <a className="tlink-install-secondary" href="/direct-trade/dashboard">Open TLink</a>
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
