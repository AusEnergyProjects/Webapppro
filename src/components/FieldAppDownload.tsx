"use client";

import { useEffect, useRef, useState } from "react";
import { tradeBrowserDevice } from "@/lib/trade-device-client";

type Platform = "ios" | "android" | "desktop";
type ReleasePolicy = { platform: "ios" | "android"; latestVersion?: string; updateUrl?: string; distribution?: "testflight-internal" };
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
function isInstallPrompt(event: Event): event is InstallPrompt {
  return "prompt" in event && typeof event.prompt === "function" && "userChoice" in event && event.userChoice instanceof Promise;
}

export function fieldAppReleaseUrl(value: unknown, platform: Platform = "android"): string {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname.replace(/\/$/, "") === "/direct-trade/field-app") return "";
    const apple = (url.hostname === "testflight.apple.com" && /^\/join\/[A-Za-z0-9]+\/?$/.test(url.pathname))
      || (url.hostname === "apps.apple.com" && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/.test(url.pathname));
    return platform === "ios" ? apple ? url.toString() : "" : platform === "android" && !url.hostname.endsWith("apple.com") ? url.toString() : "";
  } catch { return ""; }
}

export function FieldAppDownload() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [browser, setBrowser] = useState("your browser");
  const [webInstalled, setWebInstalled] = useState(false);
  const [release, setRelease] = useState<{ platform: Platform; policy: ReleasePolicy | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [canInstall, setCanInstall] = useState(false), [installing, setInstalling] = useState(false), [notice, setNotice] = useState("");
  const prompt = useRef<InstallPrompt | null>(null);
  useEffect(() => {
    const device = tradeBrowserDevice();
    const frame = requestAnimationFrame(() => {
      setPlatform(device.platform);
      setBrowser(({ chrome: "Chrome", safari: "Safari", edge: "Edge", firefox: "Firefox", unknown: "your browser" })[device.browser]);
      setWebInstalled(window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true));
    });
    const ready = (event: Event) => {
      if (!isInstallPrompt(event)) return;
      event.preventDefault(); prompt.current = event; setCanInstall(true);
    };
    const done = () => { setWebInstalled(true); prompt.current = null; setCanInstall(false); };
    window.addEventListener("beforeinstallprompt", ready); window.addEventListener("appinstalled", done);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("beforeinstallprompt", ready); window.removeEventListener("appinstalled", done); };
  }, []);
  useEffect(() => {
    if (platform !== "android" && platform !== "ios") return;
    let active = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    void fetch(`/api/field/app-release?platform=${platform}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { policy?: ReleasePolicy };
        if (!response.ok || body.policy?.platform !== platform || (platform === "android" && !fieldAppReleaseUrl(body.policy.updateUrl, platform))) throw new Error("release unavailable");
        if (active) setRelease({ platform, policy: body.policy, failed: false });
      })
      .catch(() => { if (active) setRelease({ platform, policy: null, failed: true }); }).finally(() => clearTimeout(timer));
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
      setNotice(choice.outcome === "accepted" ? "The TLink web portal is being added to this device." : "You can keep using TLink here, or add the web portal from your browser menu later.");
    } catch { setNotice("Open your browser menu and choose Install TLink or Add to Home Screen."); }
    finally { prompt.current = null; setCanInstall(false); setInstalling(false); }
  };
  const policy = release?.platform === platform ? release.policy : null;
  const failed = release?.platform === platform && release.failed;
  const url = platform ? fieldAppReleaseUrl(policy?.updateUrl, platform) : "";
  const internalTestFlight = platform === "ios" && policy?.distribution === "testflight-internal"
    && /^\d+\.\d+\.\d+$/.test(policy.latestVersion || "");
  const retry = () => { setRelease(null); setAttempt(value => value + 1); };
  return <section className="tlink-install-card" aria-label="Install TLink">
    <div className="tlink-install-devices" aria-label="Choose your device">{([['ios', 'iPhone / iPad'], ['android', 'Android'], ['desktop', 'Computer']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={platform === value} onClick={() => { if (value !== platform) { setRelease(null); setPlatform(value); } setNotice(""); }}>{label}</button>)}</div>
    {!platform ? <p role="status">Checking your device...</p> : platform === "ios" ? <>
      <span className="tlink-install-tag">iPhone / iPad</span>
      <h2>{internalTestFlight ? `TLink ${policy.latestVersion} is ready in TestFlight` : url ? "Get TLink for iPhone" : failed ? "We could not check the iPhone app" : policy ? "iPhone app is not available yet" : "Checking the iPhone app..."}</h2>
      {internalTestFlight ? <>
        <ol><li>Open <strong>TestFlight</strong> on this iPhone or iPad.</li><li>Select <strong>TLink</strong>, then tap <strong>Update</strong> or <strong>Install</strong>.</li><li>If the newer version is not shown, open <strong>Previous Builds</strong> and choose <strong>{policy.latestVersion}</strong>.</li></ol>
        <p className="tlink-install-hint">Use the Apple Account that accepted your TLink invitation. This release is available to invited testers; if TLink is missing, open your existing invitation.</p>
        <a className="tlink-install-primary" href="https://apps.apple.com/app/testflight/id899247664">Get TestFlight</a>
        <p className="tlink-install-hint">Already have TestFlight? Apple’s page will offer Open.</p>
      </> : url ? <a className="tlink-install-primary" href={url}>Install iPhone app</a> : <p>Use the TLink web portal for your jobs and messages with your existing team login.</p>}
      <a className={url || internalTestFlight ? "tlink-install-secondary" : "tlink-install-primary"} href="/direct-trade/dashboard">Open web portal</a>
      {failed && <button type="button" className="tlink-install-secondary" onClick={retry}>Try again</button>}
      {webInstalled ? <p className="tlink-install-hint">The web portal is on your Home Screen. This is separate from the native iPhone app.</p> : <details><summary>Save the web portal to your Home Screen</summary><p>This adds the web portal, not the native iPhone app.</p><ol><li>In {browser === "Chrome" || browser === "Safari" ? browser : "your browser"}, tap <strong>Share</strong> <span aria-hidden="true">↑</span> beside the address bar.</li><li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li></ol><p>Keep “Open as Web App” on if shown. If the option is missing, open this page in Safari and use Share.</p></details>}
    </> : platform === "android" ? <>
      <span className="tlink-install-tag">Android app</span><h2>Get TLink on your phone</h2><p>Your work, team messages and calls in one app.</p>
      {url ? <a className="tlink-install-primary" href={url}>Download Android app{policy?.latestVersion ? ` · ${policy.latestVersion}` : ""}</a> : failed ? <><p role="alert">The download link could not load.</p><button type="button" className="tlink-install-primary" onClick={retry}>Try again</button></> : <p role="status">Checking the latest Android app...</p>}
      <p className="tlink-install-hint">Already installed? Open TLink → Settings → Check for update.</p>
      <details><summary>Signing in to the Android app</summary><p>Your business opens Team, chooses your name, and sends a one-time field app PIN. Use that username and PIN on the app’s sign-in screen.</p></details>
    </> : <>
      <span className="tlink-install-tag">Computer web portal</span><h2>{webInstalled ? "Web portal installed" : "Keep TLink one click away"}</h2><p>Use your normal TLink login for your jobs, messages and calls.</p>
      {!webInstalled && (canInstall ? <button type="button" className="tlink-install-primary" disabled={installing} onClick={() => void install()}>{installing ? "Opening install prompt..." : "Install TLink web portal"}</button> : <p>Open your browser menu and choose <strong>Install TLink</strong> if available, or bookmark your workspace.</p>)}
      <a className="tlink-install-secondary" href="/direct-trade/dashboard">Open web portal</a>
    </>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
