"use client";

import { useTradeBusinessFetch } from "./TradeBusinessProvider";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";
import { useTradeMessageAlerts } from "./TradeMessageAlerts";

type JobNotification = {
  id: string;
  targetKind: "job" | "customer" | "opportunity" | "team" | "network";
  targetId: string;
  workOrderId: string;
  questionId?: string;
  workNumber: string;
  title: string;
  summary: string;
  createdAt: string;
  targetTab: "schedule" | "quote" | "field" | "invoice";
  source: "customer" | "field" | "team" | "network";
  read: boolean;
};

type Result = { items?: JobNotification[]; unreadCount?: number; error?: string };

export function TradeJobNotifications({
  user,
  onNavigate,
  onOpenOpportunity,
  onOpenNetwork,
}: {
  user: User;
  onNavigate: (target: TLinkCommandTarget) => void;
  onOpenOpportunity: (matchId: string) => void;
  onOpenNetwork: (postId: string) => void;
}) {
  const fetch = useTradeBusinessFetch();
  const messages = useTradeMessageAlerts();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<JobNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState("");
  const [clearing, setClearing] = useState(false);
  const navigationNonce = useRef(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async (background = false) => {
    if (document.visibilityState === "hidden" || loadController.current) return;
    const controller = new AbortController();
    loadController.current = controller;
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (loadController.current !== controller) return;
      loadController.current = null;
      if (!background) setStatus("Work updates took too long to load. Open notifications again to retry.");
    }, 15_000);
    try {
      const token = await user.getIdToken();
      if (controller.signal.aborted) return;
      const response = await fetch("/api/trade-job-notifications", {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
      });
      const result = await response.json().catch(() => ({})) as Result;
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(result.error || "Work updates could not be loaded.");
      setItems(result.items || []); setUnreadCount(Number(result.unreadCount || 0)); setStatus("");
    } catch (error) {
      if (!background && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Work updates could not be loaded.");
    } finally {
      window.clearTimeout(timeout);
      if (loadController.current === controller) loadController.current = null;
    }
  }, [fetch, user]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(true), 30_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      loadController.current?.abort();
      loadController.current = null;
    };
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
      } catch { /* Opening the record remains available if the read receipt cannot be saved. */ }
    }
    setOpen(false);
    if (item.targetKind === "network") {
      onOpenNetwork(item.targetId);
      return;
    }
    if (item.targetKind === "opportunity") {
      onOpenOpportunity(item.targetId);
      return;
    }
    navigationNonce.current += 1;
    if (item.targetKind === "customer") {
      onNavigate({workspace:"work",kind:"customer",id:item.targetId,query:"",nonce:navigationNonce.current,customerSection:"qa",workOrderId:item.workOrderId,questionId:item.questionId});
      return;
    }
    if (item.targetKind === "team") {
      onNavigate({ workspace: "team", kind: "team", id: item.targetId, query: item.summary, nonce: navigationNonce.current });
      return;
    }
    onNavigate({ workspace: "work", kind: "job", id: item.workOrderId, query: item.workNumber, nonce: navigationNonce.current, jobTab: item.targetTab });
  }

  async function clearNotifications() {
    if (clearing || unreadCount < 1) return;
    setClearing(true);
    setStatus("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-job-notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(result.error || "Work updates could not be cleared.");
      setItems(result.items || []);
      setUnreadCount(Number(result.unreadCount || 0));
      setStatus("Work updates cleared. Their records remain available below.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Work updates could not be cleared.");
    } finally {
      setClearing(false);
    }
  }

  const totalUnread = unreadCount + messages.unreadCount;
  return <div className="tlink-job-notifications">
    <button ref={triggerRef} type="button" className={totalUnread ? "has-unread" : ""} onClick={() => { if (open) closeNotifications(); else { setOpen(true); void load(); messages.refresh(); } }} aria-haspopup="dialog" aria-expanded={open} aria-label={totalUnread ? `${totalUnread} unread updates, including ${messages.unreadCount} team messages` : "Work updates"}>
      <span className="tlink-bell-icon" aria-hidden="true" />
      {totalUnread > 0 && <b aria-hidden="true">{totalUnread > 99 ? "99+" : totalUnread}</b>}
    </button>
    {open && <>
      <section ref={dialogRef} tabIndex={-1} className="tlink-notification-popover" role="dialog" aria-modal="false" aria-labelledby="job-update-title">
        <header>
          <div><span>Review queue</span><strong id="job-update-title">Work updates</strong></div>
          <div className="tlink-notification-header-actions" style={{ display: "flex", gap: 8 }}>
            <button type="button" className="tlink-notification-clear" onClick={() => void clearNotifications()} disabled={clearing || unreadCount < 1}>{clearing ? "Clearing..." : "Clear"}</button>
            <button type="button" onClick={closeNotifications} aria-label="Close work updates">Close</button>
          </div>
        </header>
        <div className="tlink-notification-list">
          {messages.threads.map(thread => <button key={`message:${thread.id}`} type="button" className="unread" onClick={() => { closeNotifications(); messages.open(thread.id); }}><span className="tlink-notification-dot" aria-hidden="true" /><span><strong>{thread.name}</strong><small>{thread.unread} unread team {thread.unread === 1 ? "message" : "messages"}</small><em>Open chat</em></span></button>)}
          {status && <p role="status">{status}</p>}
          {!status && !items.length && !messages.threads.length && <div className="tlink-notification-empty"><strong>You are up to date</strong><span>New team messages, leads, customer decisions, quote delivery issues, questions, uploads, document expiry warnings, schedule requests and field team progress will appear here.</span></div>}
          {items.map((item) => <button type="button" key={item.id} className={item.read ? "read" : "unread"} onClick={() => void openItem(item)}>
            <span className="tlink-notification-dot" aria-hidden="true" />
            <span><strong>{item.title}</strong><small>{item.summary}</small><em>{item.source === "network" ? "Trade network" : item.source === "customer" ? "Customer" : item.source === "team" ? "Team" : "Field team"} | {item.workNumber} | {new Date(item.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</em></span>
          </button>)}
        </div>
      </section>
      <button type="button" tabIndex={-1} aria-hidden="true" className="tlink-notification-dismiss" onClick={closeNotifications} />
    </>}
  </div>;
}
