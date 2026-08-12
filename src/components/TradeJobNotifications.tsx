"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";

type JobNotification = {
  id: string;
  targetKind: "job" | "opportunity" | "team";
  targetId: string;
  workOrderId: string;
  workNumber: string;
  title: string;
  summary: string;
  createdAt: string;
  targetTab: "schedule" | "quote" | "field" | "invoice";
  source: "customer" | "field" | "team";
  read: boolean;
};

type Result = { items?: JobNotification[]; unreadCount?: number; error?: string };

export function TradeJobNotifications({
  user,
  onNavigate,
  onOpenOpportunity,
}: {
  user: User;
  onNavigate: (target: TLinkCommandTarget) => void;
  onOpenOpportunity: (matchId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JobNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState("");
  const navigationNonce = useRef(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async (background = false) => {
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-job-notifications", {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(result.error || "Work updates could not be loaded.");
      setItems(result.items || []); setUnreadCount(Number(result.unreadCount || 0)); setStatus("");
    } catch (error) {
      if (!background) setStatus(error instanceof Error ? error.message : "Work updates could not be loaded.");
    }
  }, [user]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(true), 30_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const closeNotifications = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNotifications();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeNotifications, open]);

  async function openItem(item: JobNotification) {
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
    if (item.targetKind === "opportunity") {
      onOpenOpportunity(item.targetId);
      return;
    }
    navigationNonce.current += 1;
    if (item.targetKind === "team") {
      onNavigate({ workspace: "team", kind: "team", id: item.targetId, query: item.summary, nonce: navigationNonce.current });
      return;
    }
    onNavigate({ workspace: "work", kind: "job", id: item.workOrderId, query: item.workNumber, nonce: navigationNonce.current, jobTab: item.targetTab });
  }

  return <div className="tlink-job-notifications">
    <button ref={triggerRef} type="button" className={unreadCount ? "has-unread" : ""} onClick={() => { if (open) closeNotifications(); else { setOpen(true); void load(); } }} aria-haspopup="dialog" aria-expanded={open} aria-label={unreadCount ? `${unreadCount} unread work updates` : "Work updates"}>
      <span className="tlink-bell-icon" aria-hidden="true" />
      {unreadCount > 0 && <b aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</b>}
    </button>
    {open && <>
      <section ref={dialogRef} tabIndex={-1} className="tlink-notification-popover" role="dialog" aria-modal="false" aria-labelledby="job-update-title">
        <header><div><span>Review queue</span><strong id="job-update-title">Work updates</strong></div><button type="button" onClick={closeNotifications} aria-label="Close work updates">Close</button></header>
        <div className="tlink-notification-list">
          {status && <p role="status">{status}</p>}
          {!status && !items.length && <div className="tlink-notification-empty"><strong>You are up to date</strong><span>New leads, customer decisions, questions, uploads, document expiry warnings, schedule requests and field team progress will appear here.</span></div>}
          {items.map((item) => <button type="button" key={item.id} className={item.read ? "read" : "unread"} onClick={() => void openItem(item)}>
            <span className="tlink-notification-dot" aria-hidden="true" />
            <span><strong>{item.title}</strong><small>{item.summary}</small><em>{item.source === "customer" ? "Customer" : item.source === "team" ? "Team" : "Field team"} | {item.workNumber} | {new Date(item.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</em></span>
          </button>)}
        </div>
      </section>
      <button type="button" tabIndex={-1} aria-hidden="true" className="tlink-notification-dismiss" onClick={closeNotifications} />
    </>}
  </div>;
}
