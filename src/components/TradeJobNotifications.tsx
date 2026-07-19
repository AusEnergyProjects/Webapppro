"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";

type JobNotification = {
  id: string;
  workOrderId: string;
  workNumber: string;
  title: string;
  summary: string;
  createdAt: string;
  read: boolean;
};

type Result = { items?: JobNotification[]; unreadCount?: number; error?: string };

export function TradeJobNotifications({ user, onNavigate }: { user: User; onNavigate: (target: TLinkCommandTarget) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JobNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState("");
  const navigationNonce = useRef(0);

  const load = useCallback(async (background = false) => {
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-job-notifications", {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(result.error || "Job updates could not be loaded.");
      setItems(result.items || []); setUnreadCount(Number(result.unreadCount || 0)); setStatus("");
    } catch (error) {
      if (!background) setStatus(error instanceof Error ? error.message : "Job updates could not be loaded.");
    }
  }, [user]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(true), 60_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function openJob(item: JobNotification) {
    if (!item.read) {
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/trade-job-notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ notificationKey: item.id }),
        });
        const result = await response.json().catch(() => ({})) as Result;
        if (response.ok) {
          setItems(result.items || []); setUnreadCount(Number(result.unreadCount || 0));
        }
      } catch { /* Opening the job remains available if the read receipt cannot be saved. */ }
    }
    setOpen(false);
    navigationNonce.current += 1;
    onNavigate({ workspace: "work", kind: "job", id: item.workOrderId, query: item.workNumber, nonce: navigationNonce.current, jobTab: "field" });
  }

  return <div className="tlink-job-notifications">
    <button type="button" className={unreadCount ? "has-unread" : ""} onClick={() => { setOpen((current) => !current); if (!open) void load(); }} aria-haspopup="dialog" aria-expanded={open} aria-label={unreadCount ? `${unreadCount} unread job updates` : "Job updates"}>
      <span className="tlink-bell-icon" aria-hidden="true" />
      {unreadCount > 0 && <b aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</b>}
    </button>
    {open && <>
      <button type="button" className="tlink-notification-dismiss" aria-label="Close job updates" onClick={() => setOpen(false)} />
      <section className="tlink-notification-popover" role="dialog" aria-modal="false" aria-labelledby="job-update-title">
        <header><div><span>Review queue</span><strong id="job-update-title">Job updates</strong></div><button type="button" onClick={() => setOpen(false)} aria-label="Close job updates">Close</button></header>
        <div className="tlink-notification-list">
          {status && <p role="status">{status}</p>}
          {!status && !items.length && <div className="tlink-notification-empty"><strong>You are up to date</strong><span>Completed customer photo requests will appear here when they are ready to review.</span></div>}
          {items.map((item) => <button type="button" key={item.id} className={item.read ? "read" : "unread"} onClick={() => void openJob(item)}>
            <span className="tlink-notification-dot" aria-hidden="true" />
            <span><strong>{item.title}</strong><small>{item.summary}</small><em>{item.workNumber} | {new Date(item.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</em></span>
          </button>)}
        </div>
      </section>
    </>}
  </div>;
}
