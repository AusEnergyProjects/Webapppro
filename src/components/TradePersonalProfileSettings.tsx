"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { TRADE_BRAND_THEME_KEYS, TRADE_BRAND_THEME_OPTIONS, type TradeBrandThemeKey } from "@/lib/trade-business-branding";
import type { TradePersonalAppearance } from "@/lib/trade-personal-appearance";
import { useTradeBusinessFetch, useTradePersonalNameUpdate } from "./TradeBusinessProvider";
import styles from "./TradePersonalProfileSettings.module.css";

type Profile = { name: string; phone: string; isOwner: boolean };
type ProfileResult = Partial<Profile> & { ok?: boolean; error?: string };
function savedProfile(response: Response, result: ProfileResult): Profile {
  if (!response.ok || !result.ok || typeof result.name !== "string" || typeof result.phone !== "string" || typeof result.isOwner !== "boolean") {
    throw new Error(result.error || "Your profile could not be loaded or saved. Try again.");
  }
  return { name: result.name, phone: result.phone, isOwner: result.isOwner };
}

async function requestProfile(request: typeof fetch, user: User, method: "GET" | "PATCH", body?: { name: string; phone: string }, signal?: AbortSignal): Promise<Profile> {
  const controller = new AbortController();
  let rejectDeadline: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  const abort = () => { controller.abort(); rejectDeadline(new Error("Profile request cancelled.")); };
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(() => { controller.abort(); rejectDeadline(new Error("Your profile took too long to respond. Check your connection and try again.")); }, 15_000);
  try {
    return await Promise.race([(async () => {
      const token = await user.getIdToken();
      if (controller.signal.aborted) throw new Error("Profile request cancelled.");
      const response = await request("/api/trade-personal-profile", { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, cache: "no-store", signal: controller.signal, ...(body ? { body: JSON.stringify(body) } : {}) });
      return savedProfile(response, await response.json());
    })(), deadline]);
  } finally { window.clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}

export function TradePersonalProfileSettings({ user, name, appearance, employerTheme, storageAvailable, onAppearanceChange, onResetAppearance, onSaved }: {
  user: User; name: string; appearance: TradePersonalAppearance; employerTheme: TradeBrandThemeKey; storageAvailable: boolean;
  onAppearanceChange: (appearance: TradePersonalAppearance) => void; onResetAppearance: () => void; onSaved: (name: string) => void;
}) {
  const request = useTradeBusinessFetch();
  const updatePersonalName = useTradePersonalNameUpdate();
  const [profile, setProfile] = useState<Profile>({ name, phone: "", isOwner: false });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await requestProfile(request, user, "GET", undefined, controller.signal);
        if (active) { setProfile(result); setLoaded(true); }
      } catch (error) { if (active) setLoadError(error instanceof Error ? error.message : "Your profile could not be loaded. Try again."); }
    })();
    return () => { active = false; controller.abort(); };
  }, [request, user, attempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || saving.current) return;
    saving.current = true; setBusy(true); setStatus(""); setSaveError("");
    try {
      const result = await requestProfile(request, user, "PATCH", { name: profile.name, phone: profile.phone });
      if (!mounted.current) return;
      setProfile(result); updatePersonalName?.(result.name); onSaved(result.name); setStatus("Your profile is saved.");
    } catch (error) { if (mounted.current) setSaveError(error instanceof Error ? error.message : "Your profile could not be saved. Try again."); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className={`dashboard-panel ${styles.profile}`} aria-labelledby="trade-my-profile-title">
    <header><span className={styles.eyebrow}>Your account</span><h1 id="trade-my-profile-title">My profile</h1><p>Your details and dashboard preferences for this business.</p></header>
    <div className={styles.sections}>
      <section aria-labelledby="trade-my-contact-title"><h2 id="trade-my-contact-title">Personal details</h2>
        {loadError ? <div role="alert"><p>{loadError}</p><button type="button" className="btn" onClick={() => { setLoadError(""); setLoaded(false); setAttempt(value => value + 1); }}>Try again</button></div>
          : !loaded ? <p role="status">Loading your profile...</p> : <form onSubmit={save} className={styles.form}>
            <label><span>My name</span><input autoComplete="name" maxLength={120} required={!profile.isOwner} disabled={busy} value={profile.name} onChange={event => setProfile(current => ({ ...current, name: event.target.value }))} /></label>
            <p className={styles.help}>Your teammates see this name in messages and incoming calls.</p>
            <label><span>Contact phone</span><input type="tel" autoComplete="tel" maxLength={40} disabled={busy} value={profile.phone} onChange={event => setProfile(current => ({ ...current, phone: event.target.value }))} /></label>
            <label><span>Sign-in email</span><input type="email" value={user.email || ""} readOnly /></label>
            <button className="btn" type="submit" disabled={busy}>{busy ? "Saving..." : "Save my profile"}</button>
            {status && <p role="status">{status}</p>}{saveError && <p role="alert">{saveError}</p>}
          </form>}
        <a className={styles.security} href="/direct-trade/security">Password and account security</a>
      </section>
      <section aria-labelledby="trade-my-appearance-title"><h2 id="trade-my-appearance-title">My dashboard</h2>
        <div className={styles.form}>
          <label><span>Display mode</span><select aria-label="Display mode" value={appearance.colourMode} onChange={event => onAppearanceChange({ ...appearance, colourMode: event.target.value === "night" ? "night" : "day" })}><option value="day">Day</option><option value="night">Night</option></select></label>
          <label><span>Dashboard colours</span><select aria-label="Dashboard colours" value={appearance.themeKey || ""} onChange={event => onAppearanceChange({ ...appearance, themeKey: TRADE_BRAND_THEME_KEYS.find(theme => theme === event.target.value) ?? null })}>
            <option value="">Use business colours ({TRADE_BRAND_THEME_OPTIONS[employerTheme].label})</option>
            {TRADE_BRAND_THEME_KEYS.map(theme => <option key={theme} value={theme}>{TRADE_BRAND_THEME_OPTIONS[theme].label}</option>)}
          </select></label>
          <button type="button" className="btn secondary" onClick={onResetAppearance}>Reset my dashboard</button>
          <p className={styles.help} role="status">{storageAvailable ? "Your choices are remembered on this device for your account in this business." : "Your choices apply in this tab. Your browser is not allowing them to be remembered."}</p>
        </div>
      </section>
    </div>
  </section>;
}
