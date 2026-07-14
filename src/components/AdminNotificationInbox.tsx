"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AdminNotification = {
  id: string;
  eventType: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  title: string;
  summary: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorUid: string;
  requiresAction: boolean;
  status: "open" | "read" | "resolved";
  readAt: string;
  resolvedAt: string;
  resolutionNote: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AdminNotificationCounts = {
  total: number;
  unread: number;
  action_required: number;
  urgent: number;
  resolved: number;
};

type Props = {
  api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  role: "owner" | "admin" | "reviewer" | "support";
  onOpen: (notification: AdminNotification) => void;
  onCounts: (counts: AdminNotificationCounts) => void;
};

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

const emptyCounts: AdminNotificationCounts = { total: 0, unread: 0, action_required: 0, urgent: 0, resolved: 0 };

export function AdminNotificationInbox({ api, role, onOpen, onCounts }: Props) {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [counts, setCounts] = useState<AdminNotificationCounts>(emptyCounts);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("");
  const [actionOnly, setActionOnly] = useState(false);
  const [status, setStatus] = useState("");
  const [browserAlerts, setBrowserAlerts] = useState(false);
  const seen = useRef(new Set<string>());
  const initialised = useRef(false);

  const load = useCallback(async (background = false) => {
    try {
      const result = await api("/api/admin/notifications");
      const next = (result.notifications || []) as AdminNotification[];
      const nextCounts = { ...emptyCounts, ...((result.counts || {}) as Partial<AdminNotificationCounts>) };
      if (initialised.current && browserAlerts && "Notification" in window && window.Notification.permission === "granted") {
        next.filter((item) => !seen.current.has(item.id) && item.status === "open" && ["high", "urgent"].includes(item.priority))
          .slice(0, 3)
          .forEach((item) => new window.Notification(item.title, { body: item.summary, tag: item.id }));
      }
      next.forEach((item) => seen.current.add(item.id));
      initialised.current = true;
      setNotifications(next);
      setCounts(nextCounts);
      onCounts(nextCounts);
      if (!background) setStatus("Notifications refreshed.");
    } catch (error) {
      if (!background) setStatus(error instanceof Error ? error.message : "Notifications could not be loaded.");
    }
  }, [api, browserAlerts, onCounts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBrowserAlerts(window.localStorage.getItem("aea-admin-browser-alerts") === "enabled");
      void load(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return notifications.filter((item) =>
      (!term || `${item.title} ${item.summary} ${item.eventType}`.toLowerCase().includes(term)) &&
      (!category || item.category === category) &&
      (!notificationStatus || item.status === notificationStatus) &&
      (!actionOnly || item.requiresAction && item.status !== "resolved"),
    );
  }, [actionOnly, category, notificationStatus, notifications, search]);

  async function update(action: string, id = "", note = "") {
    setStatus("Updating notification...");
    try {
      await api("/api/admin/notifications", { method: "PATCH", body: JSON.stringify({ action, id, note }) });
      await load(true);
      setStatus(action === "resolve" ? "Notification resolved and audited." : "Notification updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The notification could not be updated.");
    }
  }

  async function resolve(item: AdminNotification) {
    const note = item.requiresAction
      ? window.prompt("Record how this item was resolved:", "Reviewed and actioned in the operations portal.") || ""
      : window.prompt("Optional resolution note:", "Reviewed in the operations portal.") || "";
    if (item.requiresAction && !note.trim()) return;
    await update("resolve", item.id, note);
  }

  async function enableBrowserAlerts() {
    if (!("Notification" in window)) {
      setStatus("Browser alerts are not supported on this device.");
      return;
    }
    if (browserAlerts) {
      window.localStorage.removeItem("aea-admin-browser-alerts");
      setBrowserAlerts(false);
      setStatus("Browser alerts disabled on this device. The operations inbox remains active.");
      return;
    }
    const permission = await window.Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Browser permission was not granted. The operations inbox remains active.");
      return;
    }
    window.localStorage.setItem("aea-admin-browser-alerts", "enabled");
    setBrowserAlerts(true);
    setStatus("Browser alerts enabled on this device while the operations portal is open.");
  }

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    setStatus(`${visible.length} notifications shown.`);
  }

  return (
    <>
      <header className="admin-page-heading admin-inbox-heading">
        <div>
          <span>Proactive operations</span>
          <h1>Notification and approvals inbox</h1>
          <p>Customer enquiries, account signups, evidence, catalogue reviews and trade responses arrive here as durable operational events.</p>
        </div>
        <div className="admin-alert-controls">
          <button type="button" onClick={() => void load()} className="secondary">Refresh now</button>
          <button type="button" onClick={() => void enableBrowserAlerts()}>{browserAlerts ? "Disable browser alerts" : "Enable browser alerts"}</button>
        </div>
      </header>
      {status && <div className="admin-inline-status" role="status">{status}</div>}
      <section className="admin-metric-grid admin-notification-metrics">
        <article><span>Unread</span><strong>{counts.unread || 0}</strong><small>New events not yet opened</small></article>
        <article><span>Action required</span><strong>{counts.action_required || 0}</strong><small>Approvals and follow-up still open</small></article>
        <article><span>Urgent</span><strong>{counts.urgent || 0}</strong><small>Highest priority unresolved items</small></article>
        <article><span>Resolved</span><strong>{counts.resolved || 0}</strong><small>Completed with an audit note</small></article>
      </section>
      <form className="admin-filterbar admin-notification-filter" onSubmit={submitFilters}>
        <input aria-label="Search notifications" placeholder="Search notifications" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Notification category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {['approval', 'customer', 'trade', 'response', 'catalogue', 'platform'].map((value) => <option key={value} value={value}>{readable(value)}</option>)}
        </select>
        <select aria-label="Notification status" value={notificationStatus} onChange={(event) => setNotificationStatus(event.target.value)}>
          <option value="">All states</option>
          <option value="open">Unread</option>
          <option value="read">Read</option>
          <option value="resolved">Resolved</option>
        </select>
        <label className="admin-check-filter"><input type="checkbox" checked={actionOnly} onChange={(event) => setActionOnly(event.target.checked)} />Action required only</label>
        <button type="submit">Apply filters</button>
        {counts.unread > 0 && <button type="button" className="secondary" onClick={() => void update("mark_all_read")}>Mark all read</button>}
      </form>
      <section className="admin-notification-list" aria-label="Operations notifications">
        {visible.length ? visible.map((item) => (
          <article key={item.id} className={`admin-notification-card priority-${item.priority} status-${item.status}`}>
            <div className="admin-notification-marker" aria-hidden="true" />
            <div className="admin-notification-body">
              <div className="admin-notification-meta">
                <span className={`admin-pill admin-priority-${item.priority}`}>{readable(item.priority)}</span>
                <span>{readable(item.category)}</span>
                {item.requiresAction && item.status !== "resolved" && <strong>Action required</strong>}
                <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
              </div>
              <h2>{item.title}</h2>
              <p>{item.summary}</p>
              {item.resolutionNote && <div className="admin-resolution-note"><strong>Resolution</strong><span>{item.resolutionNote}</span></div>}
            </div>
            <div className="admin-notification-actions">
              <button type="button" onClick={() => { void update("mark_read", item.id); onOpen(item); }}>Open record</button>
              {item.status === "open" && <button type="button" className="secondary" onClick={() => void update("mark_read", item.id)}>Mark read</button>}
              {item.status !== "resolved" && ["owner", "admin", "reviewer"].includes(role) && <button type="button" className="secondary" onClick={() => void resolve(item)}>Resolve</button>}
              {item.status === "resolved" && ["owner", "admin"].includes(role) && <button type="button" className="secondary" onClick={() => void update("reopen", item.id)}>Reopen</button>}
            </div>
          </article>
        )) : <div className="admin-empty"><strong>No matching notifications</strong><p>New operational events will appear here automatically.</p></div>}
      </section>
    </>
  );
}
