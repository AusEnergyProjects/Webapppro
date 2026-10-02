"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { CreditexNotification, CreditexNotificationList, CreditexNotificationTarget } from "@/lib/creditex-notifications";
import styles from "./CreditexNotificationInbox.module.css";

export function useCreditexNotifications(user: User | null) {
  const [loaded, setLoaded] = useState<{ uid: string; data: CreditexNotificationList } | null>(null);
  const data = loaded?.uid === user?.uid ? loaded?.data || null : null;
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const lock = useRef(false); const generation = useRef(0);
  const api = useCallback(async (body?: { action: "read" | "dismiss"; ids: string[] }, signal?: AbortSignal) => {
    if (!user) throw new Error("Sign in to load notifications.");
    const token = await user.getIdToken();
    const response = await fetch(`/api/creditex/notifications?${new URLSearchParams({ filter, page: String(page) })}`, {
      method: body ? "POST" : "GET", cache: "no-store", signal,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await response.json() as CreditexNotificationList & { ok?: boolean; error?: string };
    if (!response.ok || !value.ok) throw new Error(value.error || "Notifications could not be loaded. Try again.");
    return value;
  }, [user, filter, page]);
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
  return { data, filter, page, error, busy, unreadCount: user && data ? data.unreadCount : undefined,
    setFilter(value: "unread" | "all") { setFilter(value); setPage(1); }, setPage,
    refresh() { setRefresh(value => value + 1); }, update };
}
export function CreditexNotificationInbox({ controller, onOpen }: {
  controller: ReturnType<typeof useCreditexNotifications>;
  onOpen: (target: CreditexNotificationTarget) => boolean | void;
}) {
  const { data, filter, error, busy } = controller;
  function open(item: CreditexNotification) {
    if (onOpen(item.target) !== false && !item.read) void controller.update("read", [item.id]);
  }
  return <section className={styles.inbox} aria-label="Creditex notifications">
    <header className={styles.heading}><div><h2>Notifications</h2><p>Job updates, tasks, calls and team messages for you.</p></div><button type="button" onClick={controller.refresh} disabled={busy}>Refresh</button></header>
    <div className={styles.toolbar}><div role="group" aria-label="Notification filter"><button type="button" aria-pressed={filter === "unread"} onClick={() => controller.setFilter("unread")}>Unread{data ? ` (${data.unreadCount})` : ""}</button><button type="button" aria-pressed={filter === "all"} onClick={() => controller.setFilter("all")}>All</button></div>
      {data?.items.some(item => !item.read) && <button type="button" disabled={busy} onClick={() => void controller.update("read", data.items.filter(item => !item.read).map(item => item.id))}>Mark this page read</button>}
    </div>
    {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={controller.refresh}>Try again</button></p>}
    {!data && !error && <p role="status">Loading notifications...</p>}
    {data && !data.items.length && <div className={styles.empty}><h3>{filter === "unread" ? "You're up to date" : "No notifications"}</h3><p>New updates will appear here when there is something for you to review.</p></div>}
    <ul className={styles.list}>{data?.items.map(item => <li key={item.id} className={item.read ? styles.read : styles.unread}>
      <button type="button" className={styles.open} onClick={() => open(item)} disabled={busy}><span><strong>{item.title}</strong><small>{new Date(item.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</small></span><p>{item.detail}</p></button>
      <div className={styles.actions}>{!item.read && <button type="button" disabled={busy} onClick={() => void controller.update("read", [item.id])}>Mark read</button>}<button type="button" disabled={busy} onClick={() => void controller.update("dismiss", [item.id])}>Dismiss</button></div>
    </li>)}</ul>
    {data && data.totalPages > 1 && <nav className={styles.pagination} aria-label="Notification pages"><button type="button" disabled={busy || data.page <= 1} onClick={() => controller.setPage(data.page - 1)}>Previous</button><span>Page {data.page} of {data.totalPages} · {data.total} notifications</span><button type="button" disabled={busy || data.page >= data.totalPages} onClick={() => controller.setPage(data.page + 1)}>Next</button></nav>}
  </section>;
}
