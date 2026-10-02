"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { DEFAULT_PORTAL_PROFILE, portalProfileInput, type PortalWorkspace, type PortalWorkspaceProfile } from "@/lib/portal-workspace-profile";
import { TRADE_BRAND_THEME_KEYS, TRADE_BRAND_THEME_OPTIONS } from "@/lib/trade-business-branding";
import styles from "./PortalWorkspacePreferences.module.css";
import { PortalProfileAvatar } from "./PortalProfileAvatar";

type Options = { workspace: PortalWorkspace; user: User | null; currentDisplayName: string; onProfileChanged?: (profile: PortalWorkspaceProfile) => void };
export type PortalWorkspacePreferencesController = ReturnType<typeof usePortalWorkspacePreferences>;
type PortalStyle = CSSProperties & Record<`--portal-${string}`, string>;

export function usePortalWorkspacePreferences({ workspace, user, currentDisplayName, onProfileChanged }: Options) {
  const [stored, setStored] = useState<{ identity: string; profile: PortalWorkspaceProfile } | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const savePending = useRef(false);
  const [error, setError] = useState("");
  const identity = `${workspace}:${user?.uid || ""}`;
  const identityRef = useRef(identity);
  useEffect(() => { identityRef.current = identity; }, [identity]);
  const profile = stored?.identity === identity ? stored.profile : { ...DEFAULT_PORTAL_PROFILE, displayName: currentDisplayName };
  const requestProfile = useCallback(async (next?: PortalWorkspaceProfile, signal?: AbortSignal) => {
    if (!user) throw new Error("Sign in to update your profile.");
    const response = await fetch(`/api/portal-workspace-profile?workspace=${workspace}`, {
      method: next ? "PATCH" : "GET", cache: "no-store", signal,
      headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(next ? { "Content-Type": "application/json" } : {}) },
      ...(next ? { body: JSON.stringify(next) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Your profile could not be loaded.");
    const loaded = portalProfileInput(data.profile);
    if (!loaded) throw new Error("Your profile response could not be read. Refresh and try again.");
    return loaded;
  }, [user, workspace]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true); setError("");
      void requestProfile(undefined, controller.signal).then((value) => {
        if (!controller.signal.aborted && identityRef.current === identity) setStored({ identity, profile: value });
      }).catch((failure) => { if (!controller.signal.aborted && identityRef.current === identity) setError(failure instanceof Error ? failure.message : "Your profile could not be loaded."); })
        .finally(() => { if (!controller.signal.aborted && identityRef.current === identity) setLoading(false); });
    }, 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [identity, user, requestProfile]);
  const saveProfile = async (next: PortalWorkspaceProfile) => {
    if (savePending.current) return false;
    savePending.current = true; setSavingProfile(true);
    setError("");
    try {
      const saved = await requestProfile(next);
      if (identityRef.current !== identity) return false;
      setStored({ identity, profile: saved }); onProfileChanged?.(saved); return true;
    } catch (failure) {
      if (identityRef.current === identity) setError(failure instanceof Error ? failure.message : "Your profile could not be saved.");
      return false;
    } finally { savePending.current = false; setSavingProfile(false); }
  };
  const night = profile.colourMode === "night";
  const gradient = TRADE_BRAND_THEME_OPTIONS[profile.themeKey].gradient;
  const style: PortalStyle = { "--portal-gradient": gradient, "--portal-sidebar": gradient.match(/#[a-f\d]{6}/i)?.[0] || "#062d3d",
    "--portal-surface": night ? "#172b34" : "#ffffff", "--portal-background": night ? "#10212a" : "#f3f8f7",
    "--portal-ink": night ? "#edf8f4" : "#123b3c", "--portal-muted": night ? "#bdd0d2" : "#567074",
    "--portal-line": night ? "#38525b" : "#d6e4e4", "--portal-soft": night ? "#203a43" : "#f3f7f8",
    "--portal-text": night ? "#d6e7e6" : "#24464a", "--portal-input": night ? "#1d343e" : "#ffffff",
    "--portal-raised": night ? "#203a43" : "#f6faf8", "--portal-green": night ? "#73e0bc" : "#138263",
    "--portal-green-dark": night ? "#9beacf" : "#116c53", "--portal-line-strong": night ? "#627e87" : "#a7c6c2",
    "--portal-button-ink": night ? "#123b3c" : "#ffffff",
    "--portal-selected-bg": night ? "#284c50" : "#e6f3ef", "--portal-selected-ink": night ? "#b7f4de" : "#145744", "--portal-selected-line": night ? "#57827b" : "#96cdbb",
    "--portal-success-bg": night ? "#123c31" : "#edf9f1", "--portal-success-ink": night ? "#a0e8bd" : "#1b6441", "--portal-success-line": night ? "#39775a" : "#b7dec6",
    "--portal-error-bg": night ? "#452629" : "#fff1f0", "--portal-error-ink": night ? "#ffb9b2" : "#983b35", "--portal-error-line": night ? "#925054" : "#e7b5b0",
    "--portal-warning-bg": night ? "#3d331e" : "#fff8e5", "--portal-warning-ink": night ? "#f0d397" : "#795818", "--portal-warning-line": night ? "#857043" : "#e2d09d" };
  return { workspace, user, profile, loading, savingProfile, error, saveProfile, rootProps: { "data-portal-theme": profile.themeKey, "data-portal-mode": profile.colourMode, style } };
}

export function PortalWorkspacePreferences({ controller }: { controller: PortalWorkspacePreferencesController }) {
  const { profile, loading, savingProfile, error, saveProfile } = controller;
  const [draft, setDraft] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { displayName, themeKey, colourMode } = profile;
  useEffect(() => { const timer = window.setTimeout(() => setDraft({ displayName, themeKey, colourMode }), 0); return () => window.clearTimeout(timer); }, [displayName, themeKey, colourMode]);
  useEffect(() => { if (!saved) return; const timer = window.setTimeout(() => setSaved(false), 2500); return () => window.clearTimeout(timer); }, [saved]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setSaved(false);
    if (await saveProfile(draft)) setSaved(true);
    setSaving(false);
  }
  return <section className={styles.panel} aria-labelledby="portal-profile-heading">
    <header><span>Make it yours</span><h1 id="portal-profile-heading">My profile</h1><p>Choose your team photo, display name, workspace colours and appearance.</p></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <form onSubmit={(event) => void submit(event)}>
      {controller.user && <PortalProfileAvatar workspace={controller.workspace} user={controller.user} name={draft.displayName} editable />}
      <label className={styles.name}>Your display name<input value={draft.displayName} maxLength={120} required autoComplete="name" onChange={(event) => setDraft((value) => ({ ...value, displayName: event.target.value }))} /><small>Your account identity and permissions stay managed by your workspace administrator.</small></label>
      <fieldset><legend>Workspace colours</legend><div className={styles.palettes}>{TRADE_BRAND_THEME_KEYS.map((key) => <label key={key} className={draft.themeKey === key ? styles.selected : ""}><input type="radio" name="portal-theme" value={key} checked={draft.themeKey === key} onChange={() => setDraft((value) => ({ ...value, themeKey: key }))} /><span aria-hidden="true" style={{ background: TRADE_BRAND_THEME_OPTIONS[key].gradient }} /><strong>{TRADE_BRAND_THEME_OPTIONS[key].label}</strong></label>)}</div></fieldset>
      <fieldset><legend>Appearance</legend><div className={styles.modes}>{(["day", "night"] as const).map((mode) => <label key={mode}><input type="radio" name="portal-mode" checked={draft.colourMode === mode} onChange={() => setDraft((value) => ({ ...value, colourMode: mode }))} />{mode === "day" ? "Day" : "Night"}</label>)}</div></fieldset>
      <div className={styles.actions}><button type="submit" disabled={loading || saving || savingProfile}>{saving || savingProfile ? "Saving..." : "Save profile"}</button>{loading && <span role="status">Loading your profile...</span>}{saved && <span role="status">Saved</span>}</div>
    </form>
  </section>;
}
