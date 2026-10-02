"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { CreditexNotification, CreditexNotificationList, CreditexNotificationTarget } from "@/lib/creditex-notifications";
import styles from "./CreditexNotifications.module.css";

export function useCreditexNotifications(user: User | null) {
  const [loaded, setLoaded] = useState<{ uid: string; data: CreditexNotificationList } | null>(null);
  const data = loaded?.uid === user?.uid ? loaded?.data || null : null;
  const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const lock = useRef(false); const generation = useRef(0);
  const api = useCallback(async (body?: { action: "read" | "dismiss"; ids: string[] }, signal?: AbortSignal) => {
    if (!user) throw new Error("Sign in to load notifications.");
    const token = await user.getIdToken();
    const response = await fetch(`/api/creditex/notifications?${new URLSearchParams({ filter: "all", page: String(page) })}`, {
      method: body ? "POST" : "GET", cache: "no-store", signal,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json() as CreditexNotificationList & { ok?: boolean; error?: string };
    if (!response.ok || !value.ok) throw new Error(value.error || "Notifications could not be loaded. Try again.");
    return value;
  }, [user, page]);
  useEffect(() => {
    const version = ++generation.current; const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (!user || document.visibilityState === "hidden" || lock.current || loading) return;
      loading = true;
      try {
        const value = await api(undefined, controller.signal);
        if (!controller.signal.aborted && generation.current === version) { setLoaded({ uid: user.uid, data: value }); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted && generation.current === version) { setLoaded(null); setError(cause instanceof Error ? cause.message : "Notifications could not be loaded."); }
      } finally { loading = false; }
    };
    void load(); const timer = setInterval(() => void load(), 30000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    const changed = () => { setRefresh(value => value + 1); };
    window.addEventListener("creditex-notifications-changed", changed);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("creditex-notifications-changed", changed); };
  }, [api, user, refresh]);
  async function update(action: "read" | "dismiss", ids: string[]) {
    if (lock.current || !ids.length) return;
    lock.current = true; setBusy(true); const version = ++generation.current;
    try { await api({ action, ids }); if (generation.current === version) setError(""); }
    catch (cause) { if (generation.current === version) setError(cause instanceof Error ? cause.message : "Notifications could not be updated."); }
    finally { lock.current = false; setBusy(false); setRefresh(value => value + 1); }
  }
  return { data, page, error, busy, unreadCount: user && data ? data.unreadCount : undefined, setPage,
    refresh() { setRefresh(value => value + 1); }, update };
}
export function CreditexNotifications({ user, onOpen }: {
  user: User;
  onOpen: (target: CreditexNotificationTarget) => boolean | void;
}) {
  const controller = useCreditexNotifications(user);
  const { data, error, busy, unreadCount } = controller;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = triggerRef.current; const dialog = dialogRef.current;
      if (!trigger || !dialog) return;
      const anchor = trigger.getBoundingClientRect();
      const width = dialog.offsetWidth;
      const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12));
      dialog.style.setProperty('--notification-offset', `${left - (anchor.right - width)}px`);
      dialog.style.setProperty('--notification-space', `${Math.max(120, window.innerHeight - anchor.bottom - 22)}px`);
    };
    position(); dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    window.addEventListener('keydown', keydown);
    window.addEventListener('resize', position);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('resize', position); };
  }, [open, close]);
  function openItem(item: CreditexNotification) {
    if (onOpen(item.target) === false) return;
    setOpen(false);
    if (!item.read) void controller.update("read", [item.id]);
  }
  const unreadIds = data?.items.filter(item => !item.read).map(item => item.id) || [];
  return <div className={styles.control}>
    <button ref={triggerRef} type="button" className={styles.trigger} title="Notifications" aria-label={unreadCount ? `${unreadCount} unread work updates` : 'Work updates'} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'creditex-work-updates' : undefined} onClick={() => { if (open) close(); else { setOpen(true); controller.refresh(); } }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0v7l-2 3h16l-2-3zM10 21h4M12 1v1"/></svg>
      {unreadCount !== undefined && unreadCount > 0 && <strong aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</strong>}
    </button>
    {open && <>
      <section ref={dialogRef} id="creditex-work-updates" tabIndex={-1} className={styles.popover} role="dialog" aria-modal="false" aria-labelledby="creditex-work-updates-title">
        <header className={styles.heading}><div><span>Review queue</span><strong id="creditex-work-updates-title">Work updates</strong></div><div className={styles.actions}>
          <button type="button" title="Mark the shown updates read" disabled={busy || !unreadIds.length} onClick={() => void controller.update('read', unreadIds)}>{busy ? 'Clearing...' : 'Clear'}</button>
          <button type="button" onClick={close} aria-label="Close work updates">Close</button>
        </div></header>
        <div className={styles.list}>
          {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={controller.refresh}>Try again</button></p>}
          {!data && !error && <p role="status">Loading updates...</p>}
          {data && !data.items.length && <div className={styles.empty}><strong>You&apos;re up to date</strong><span>Job updates, corrections, tasks, calls and team messages will appear here.</span></div>}
          {data?.items.map(item => <button key={item.id} type="button" className={`${styles.item} ${!item.read ? styles.unread : ''}`} onClick={() => openItem(item)} disabled={busy}>
            <span className={styles.dot} aria-hidden="true"/><span><strong>{item.title}</strong><small>{item.detail}</small><em>{new Date(item.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</em></span>
          </button>)}
        </div>
        {data && data.totalPages > 1 && <nav className={styles.pagination} aria-label="More work updates"><button type="button" disabled={busy || data.page <= 1} onClick={() => controller.setPage(data.page - 1)}>Previous</button><span>{data.page} of {data.totalPages}</span><button type="button" disabled={busy || data.page >= data.totalPages} onClick={() => controller.setPage(data.page + 1)}>Next</button></nav>}
      </section>
      <button type="button" tabIndex={-1} aria-hidden="true" className={styles.dismiss} onClick={close}/>
    </>}
  </div>;
}
