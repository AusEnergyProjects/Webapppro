"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { AeaProductLink, TLinkBrand } from "./TLinkChrome";
import type { PortalWorkspacePreferencesController } from "./PortalWorkspacePreferences";
import styles from "./PortalWorkspaceHeader.module.css";
import { PortalProfileAvatar } from './PortalProfileAvatar';
import { TLinkPortalSwitcher } from "./TLinkPortalSwitcher";

export function PortalWorkspaceHeader({ context, organisation, displayName, preferences, onSearch, onNotifications, notificationCount, notificationControl, onSettings, onProfile, onSignOut, onPortalSwitch }: {
  context: string; organisation: string; displayName: string;
  preferences: PortalWorkspacePreferencesController;
  onSearch: (query: string) => boolean; onNotifications?: () => void; notificationCount?: number; notificationControl?: ReactNode;
  onSettings: () => void; onProfile?: () => void; onSignOut: () => void;
  onPortalSwitch?: () => boolean;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const target = header.current;
    const shell = target?.closest<HTMLElement>("[data-portal-theme]");
    if (!target || !shell) return;
    const measure = () => shell.style.setProperty("--portal-header-height", `${target.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(target);
    return () => { observer.disconnect(); shell.style.removeProperty("--portal-header-height"); };
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); input.current?.focus(); input.current?.select(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const night = preferences.profile.colourMode === "night";
  return <header ref={header} className={styles.header} aria-label={`${context} header`}>
    <div className={styles.businessBar}><TLinkPortalSwitcher current={preferences.workspace} user={preferences.user} onBeforeSwitch={onPortalSwitch} /><span>Working with <strong>{organisation}</strong></span><span>Welcome {displayName}</span></div>
    <div className={styles.bar}>
      <div className={styles.brand}><TLinkBrand context={context} /></div>
      <form className={styles.search} role="search" aria-label="Search workspace jobs" onSubmit={event => { event.preventDefault(); onSearch(query.trim()); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
        <input ref={input} type="search" aria-label="Search jobs and customers" placeholder="Search jobs and customers" value={query} maxLength={160} onChange={event => setQuery(event.target.value)} />
        <button type="submit" aria-label="Search workspace">Search</button><kbd>Ctrl K</kbd>
      </form>
      <div className={styles.actions}>
        {notificationControl ?? (onNotifications && <button type="button" className={styles.bell} aria-label={notificationCount === undefined ? "Open notifications" : `Open inbox, ${notificationCount} unread alerts`} title="Notifications" onClick={onNotifications}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0v7l-2 3h16l-2-3zM10 21h4M12 1v1"/></svg>{notificationCount !== undefined && notificationCount > 0 && <strong>{notificationCount}</strong>}
        </button>)}
        <button type="button" className={styles.mode} aria-label="Night mode" aria-pressed={night} title={night ? "Switch to day mode" : "Switch to night mode"} disabled={preferences.loading || preferences.savingProfile} onClick={() => void preferences.saveProfile({ ...preferences.profile, colourMode: night ? "day" : "night" })}>
          <span data-selected={!night}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3.3"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg></span>
          <span data-selected={night}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.4 15.1A8.7 8.7 0 0 1 8.9 3.6 8.8 8.8 0 1 0 20.4 15.1Z"/></svg></span>
        </button>
        <div className={styles.aea}><AeaProductLink placement="trade-portal" /></div>
        <div className={styles.account}><small>{context}</small><strong>{organisation}</strong></div>
        <span className={styles.signedIn}><i aria-hidden="true"/>Signed in</span>
        <a className={styles.app} href="/direct-trade/field-app" aria-label="Get the TLink app"><Image src="/tlink-icon-192.png" width={24} height={24} alt=""/><span>Get the app</span></a>
        {onProfile && <button type="button" className={styles.profile} onClick={onProfile}>{preferences.user && <PortalProfileAvatar workspace={preferences.workspace} user={preferences.user} name={displayName}/>}<span>My profile</span></button>}
        <button type="button" className={styles.settings} aria-label="Workspace settings" onClick={onSettings}><span className={styles.settingsPrefix}>Workspace </span>settings</button>
        <button type="button" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
    {preferences.error && <p role="alert" className={styles.error}>{preferences.error} <button type="button" onClick={onSettings}>Open settings</button></p>}
  </header>;
}
