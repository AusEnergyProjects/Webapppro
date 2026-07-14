"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type AdminNotificationActivity = {
  id: string;
  action: string;
  summary: string;
  administrator: string;
  createdAt: string;
};

type AdminAssignee = {
  uid: string;
  name: string;
  email: string;
  role: string;
};

type AdminDeliveryHealth = {
  configured: boolean;
  channel: string;
  provider: "google_workspace" | "custom_webhook" | "not_configured";
  counts: {
    total: number;
    delivered: number;
    failed: number;
    pending: number;
    waiting_for_channel: number;
    skipped: number;
  };
};

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
  deliveryStatus: "not_queued" | "pending" | "waiting_for_channel" | "delivered" | "failed" | "skipped";
  deliveryAttempts: number;
  deliveryLastAttemptAt: string;
  deliveryDeliveredAt: string;
  deliveryLastError: string;
  assignedToUid: string;
  assignedToName: string;
  assignedAt: string;
  dueAt: string;
  slaState: "none" | "on_track" | "due_soon" | "overdue";
  activity: AdminNotificationActivity[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AdminNotificationCounts = {
  total: number;
  unread: number;
  action_required: number;
  urgent: number;
  unassigned: number;
  overdue: number;
  due_soon: number;
  mine: number;
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

function localDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const emptyCounts: AdminNotificationCounts = {
  total: 0,
  unread: 0,
  action_required: 0,
  urgent: 0,
  unassigned: 0,
  overdue: 0,
  due_soon: 0,
  mine: 0,
  resolved: 0,
};
const emptyDelivery: AdminDeliveryHealth = {
  configured: false,
  channel: "webhook",
  provider: "not_configured",
  counts: { total: 0, delivered: 0, failed: 0, pending: 0, waiting_for_channel: 0, skipped: 0 },
};

export function AdminNotificationInbox({ api, role, onOpen, onCounts }: Props) {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [counts, setCounts] = useState<AdminNotificationCounts>(emptyCounts);
  const [assignees, setAssignees] = useState<AdminAssignee[]>([]);
  const [currentAdminUid, setCurrentAdminUid] = useState("");
  const [delivery, setDelivery] = useState<AdminDeliveryHealth>(emptyDelivery);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [notificationStatus, setNotificationStatus] = useState("");
  const [assignedFilter, setAssignedFilter] = useState("");
  const [queue, setQueueState] = useState("all");
  const [actionOnly, setActionOnly] = useState(false);
  const [status, setStatus] = useState("");
  const [browserAlerts, setBrowserAlerts] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [caseNote, setCaseNote] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [dueDraft, setDueDraft] = useState("");
  const [assigneeDraft, setAssigneeDraft] = useState("");
  const [priorityDraft, setPriorityDraft] = useState<AdminNotification["priority"]>("normal");
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
      setAssignees((result.assignees || []) as AdminAssignee[]);
      setCurrentAdminUid(String(result.currentAdminUid || ""));
      setDelivery({ ...emptyDelivery, ...((result.delivery || {}) as Partial<AdminDeliveryHealth>), counts: { ...emptyDelivery.counts, ...(((result.delivery as Partial<AdminDeliveryHealth> | undefined)?.counts) || {}) } });
      onCounts(nextCounts);
      if (!background) setStatus("Operations queue refreshed.");
    } catch (error) {
      if (!background) setStatus(error instanceof Error ? error.message : "Notifications could not be loaded.");
    }
  }, [api, browserAlerts, onCounts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBrowserAlerts(window.localStorage.getItem("aea-admin-browser-alerts") === "enabled");
      setQueueState(window.localStorage.getItem("aea-admin-inbox-queue") || "all");
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

  function setQueue(value: string) {
    setQueueState(value);
    window.localStorage.setItem("aea-admin-inbox-queue", value);
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return notifications.filter((item) => {
      const matchesQueue = queue === "all"
        || queue === "mine" && item.assignedToUid === currentAdminUid && item.status !== "resolved"
        || queue === "unassigned" && !item.assignedToUid && item.requiresAction && item.status !== "resolved"
        || queue === "overdue" && item.slaState === "overdue" && item.status !== "resolved"
        || queue === "due_soon" && item.slaState === "due_soon" && item.status !== "resolved"
        || queue === "resolved" && item.status === "resolved";
      return matchesQueue
        && (!term || `${item.title} ${item.summary} ${item.eventType} ${item.entityId}`.toLowerCase().includes(term))
        && (!category || item.category === category)
        && (!priority || item.priority === priority)
        && (!notificationStatus || item.status === notificationStatus)
        && (!assignedFilter || (assignedFilter === "unassigned" ? !item.assignedToUid : item.assignedToUid === assignedFilter))
        && (!actionOnly || item.requiresAction && item.status !== "resolved");
    });
  }, [actionOnly, assignedFilter, category, currentAdminUid, notificationStatus, notifications, priority, queue, search]);

  async function update(action: string, id = "", payload: Record<string, unknown> = {}) {
    setStatus("Updating operations case...");
    try {
      await api("/api/admin/notifications", { method: "PATCH", body: JSON.stringify({ action, id, ...payload }) });
      await load(true);
      setStatus(action === "resolve" ? "Case resolved and added to the audit history." : "Operations case updated and audited.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The operations case could not be updated.");
      return false;
    }
  }

  function manageCase(item: AdminNotification) {
    if (expandedId === item.id) {
      setExpandedId("");
      return;
    }
    setExpandedId(item.id);
    setCaseNote("");
    setResolutionNote("");
    setDueDraft(localDateTimeInput(item.dueAt));
    setAssigneeDraft(item.assignedToUid || "");
    setPriorityDraft(item.priority);
    if (item.status === "open") void update("mark_read", item.id);
  }

  async function saveNote(item: AdminNotification) {
    if (!caseNote.trim()) return;
    if (await update("add_note", item.id, { note: caseNote })) setCaseNote("");
  }

  async function saveDueDate(item: AdminNotification) {
    if (!dueDraft) return;
    await update("set_due", item.id, { dueAt: new Date(dueDraft).toISOString() });
  }

  async function resolve(item: AdminNotification) {
    if (item.requiresAction && !resolutionNote.trim()) {
      setStatus("Record how the required action was completed before resolving this case.");
      return;
    }
    if (await update("resolve", item.id, { note: resolutionNote || "Reviewed in the operations portal." })) {
      setResolutionNote("");
      setExpandedId("");
    }
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
    setStatus(`${visible.length} operations cases shown.`);
  }

  const canManageWorkflow = ["owner", "admin", "reviewer"].includes(role);
  const canResolve = canManageWorkflow;
  const canAssignAnyone = ["owner", "admin"].includes(role);

  return (
    <>
      <header className="admin-page-heading admin-inbox-heading">
        <div>
          <span>Proactive operations</span>
          <h1>Notification and approvals inbox</h1>
          <p>Every actionable event now has clear ownership, a response target, internal notes and a durable case history.</p>
        </div>
        <div className="admin-alert-controls">
          <button type="button" onClick={() => void load()} className="secondary">Refresh now</button>
          {["owner", "admin"].includes(role) && <button type="button" onClick={() => void update("send_test")} disabled={!delivery.configured}>Send test alert</button>}
          <button type="button" onClick={() => void enableBrowserAlerts()}>{browserAlerts ? "Disable browser alerts" : "Enable browser alerts"}</button>
        </div>
      </header>
      {status && <div className="admin-inline-status" role="status">{status}</div>}
      <section className={`admin-delivery-health ${delivery.configured ? "connected" : "waiting"}`} aria-label="Off-screen notification delivery">
        <div>
          <span>Off-screen operations alerts</span>
          <strong>{delivery.provider === "google_workspace" ? "Google Workspace email connected" : delivery.configured ? "Private delivery channel connected" : "Private delivery channel ready for connection"}</strong>
          <p>{delivery.configured
            ? delivery.provider === "google_workspace"
              ? "Signed, privacy-safe operations summaries are sent to the administrator Gmail inbox through the existing Google Apps Script, with duplicate protection and recorded delivery attempts."
              : "Actionable and high-priority events are sent outside the portal with privacy-safe summaries and recorded delivery attempts."
            : "The durable delivery queue is active, but no private destination is connected yet. Customer contacts, addresses, files and account credentials are never placed in alert payloads."}</p>
        </div>
        <dl>
          <div><dt>Delivered</dt><dd>{delivery.counts.delivered || 0}</dd></div>
          <div><dt>Failed</dt><dd>{delivery.counts.failed || 0}</dd></div>
          <div><dt>Waiting</dt><dd>{(delivery.counts.pending || 0) + (delivery.counts.waiting_for_channel || 0)}</dd></div>
        </dl>
      </section>
      <section className="admin-metric-grid admin-notification-metrics">
        <article className={queue === "overdue" ? "active" : ""}><button type="button" onClick={() => setQueue("overdue")}><span>Overdue</span><strong>{counts.overdue || 0}</strong><small>Past their response target</small></button></article>
        <article className={queue === "due_soon" ? "active" : ""}><button type="button" onClick={() => setQueue("due_soon")}><span>Due soon</span><strong>{counts.due_soon || 0}</strong><small>Due within four hours</small></button></article>
        <article className={queue === "unassigned" ? "active" : ""}><button type="button" onClick={() => setQueue("unassigned")}><span>Unassigned</span><strong>{counts.unassigned || 0}</strong><small>Needs a responsible person</small></button></article>
        <article className={queue === "mine" ? "active" : ""}><button type="button" onClick={() => setQueue("mine")}><span>My queue</span><strong>{counts.mine || 0}</strong><small>Open cases assigned to you</small></button></article>
        <article className={queue === "all" ? "active" : ""}><button type="button" onClick={() => setQueue("all")}><span>Action required</span><strong>{counts.action_required || 0}</strong><small>All open follow-up</small></button></article>
        <article className={queue === "resolved" ? "active" : ""}><button type="button" onClick={() => setQueue("resolved")}><span>Resolved</span><strong>{counts.resolved || 0}</strong><small>Completed with an audit trail</small></button></article>
      </section>
      <form className="admin-filterbar admin-notification-filter" onSubmit={submitFilters}>
        <input aria-label="Search notifications" placeholder="Search title, event or record ID" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Notification category" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {["approval", "customer", "trade", "response", "catalogue", "billing", "security", "platform"].map((value) => <option key={value} value={value}>{readable(value)}</option>)}
        </select>
        <select aria-label="Notification priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="">All priorities</option>
          {["urgent", "high", "normal", "low"].map((value) => <option key={value} value={value}>{readable(value)}</option>)}
        </select>
        <select aria-label="Notification status" value={notificationStatus} onChange={(event) => setNotificationStatus(event.target.value)}>
          <option value="">All states</option>
          <option value="open">Unread</option>
          <option value="read">Read</option>
          <option value="resolved">Resolved</option>
        </select>
        <select aria-label="Case assignee" value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value)}>
          <option value="">All assignees</option>
          <option value="unassigned">Unassigned</option>
          {assignees.map((item) => <option key={item.uid} value={item.uid}>{item.name}</option>)}
        </select>
        <label className="admin-check-filter"><input type="checkbox" checked={actionOnly} onChange={(event) => setActionOnly(event.target.checked)} />Action required only</label>
        <button type="submit">Apply filters</button>
        {counts.unread > 0 && <button type="button" className="secondary" onClick={() => void update("mark_all_read")}>Mark all read</button>}
      </form>
      <div className="admin-queue-summary"><strong>{readable(queue)} queue</strong><span>{visible.length} matching cases</span><button type="button" onClick={() => setQueue("all")}>Clear saved queue</button></div>
      <section className="admin-notification-list" aria-label="Operations notifications">
        {visible.length ? visible.map((item) => (
          <article key={item.id} className={`admin-notification-card priority-${item.priority} status-${item.status} sla-${item.slaState}`}>
            <div className="admin-notification-marker" aria-hidden="true" />
            <div className="admin-notification-body">
              <div className="admin-notification-meta">
                <span className={`admin-pill admin-priority-${item.priority}`}>{readable(item.priority)}</span>
                <span>{readable(item.category)}</span>
                {item.requiresAction && item.status !== "resolved" && <strong>Action required</strong>}
                {item.slaState !== "none" && item.status !== "resolved" && <span className={`admin-sla admin-sla-${item.slaState}`}>{readable(item.slaState)}</span>}
                {item.deliveryStatus !== "not_queued" && <span className={`admin-delivery-state state-${item.deliveryStatus}`}>Off-screen: {readable(item.deliveryStatus)}</span>}
                <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
              </div>
              <h2>{item.title}</h2>
              <p>{item.summary}</p>
              <dl className="admin-case-facts">
                <div><dt>Owner</dt><dd>{item.assignedToName || "Unassigned"}</dd></div>
                <div><dt>Response target</dt><dd>{item.dueAt ? dateTime(item.dueAt) : "No due date"}</dd></div>
                <div><dt>Record</dt><dd>{readable(item.entityType)} | {item.entityId}</dd></div>
                <div><dt>Off-screen delivery</dt><dd>{item.deliveryStatus === "not_queued" ? "Inbox only" : readable(item.deliveryStatus)}{item.deliveryAttempts ? ` | ${item.deliveryAttempts} attempt${item.deliveryAttempts === 1 ? "" : "s"}` : ""}</dd></div>
              </dl>
              {item.resolutionNote && <div className="admin-resolution-note"><strong>Resolution</strong><span>{item.resolutionNote}</span></div>}
              {expandedId === item.id && (
                <section className="admin-notification-case" aria-label={`Manage ${item.title}`}>
                  <div className="admin-case-workflow">
                    <div>
                      <label htmlFor={`assignee-${item.id}`}>Responsible administrator</label>
                      {canAssignAnyone ? (
                        <div className="admin-case-control-row">
                          <select id={`assignee-${item.id}`} value={assigneeDraft} onChange={(event) => setAssigneeDraft(event.target.value)}>
                            <option value="">Unassigned queue</option>
                            {assignees.map((assignee) => <option key={assignee.uid} value={assignee.uid}>{assignee.name} | {readable(assignee.role)}</option>)}
                          </select>
                          <button type="button" onClick={() => void update("assign", item.id, { assignedToUid: assigneeDraft })}>Save owner</button>
                        </div>
                      ) : (
                        <div className="admin-case-control-row">
                          <span>{item.assignedToName || "Nobody is responsible yet."}</span>
                          {item.assignedToUid !== currentAdminUid && <button type="button" onClick={() => void update("assign", item.id, { assignedToUid: currentAdminUid })}>Assign to me</button>}
                          {item.assignedToUid === currentAdminUid && <button type="button" className="secondary" onClick={() => void update("assign", item.id, { assignedToUid: "" })}>Return to queue</button>}
                        </div>
                      )}
                    </div>
                    {canManageWorkflow && <div>
                      <label htmlFor={`due-${item.id}`}>Response due date</label>
                      <div className="admin-case-control-row">
                        <input id={`due-${item.id}`} type="datetime-local" value={dueDraft} onChange={(event) => setDueDraft(event.target.value)} />
                        <button type="button" onClick={() => void saveDueDate(item)}>Save due date</button>
                      </div>
                    </div>}
                    {canManageWorkflow && <div>
                      <label htmlFor={`priority-${item.id}`}>Case priority</label>
                      <div className="admin-case-control-row">
                        <select id={`priority-${item.id}`} value={priorityDraft} onChange={(event) => setPriorityDraft(event.target.value as AdminNotification["priority"])}>
                          {["urgent", "high", "normal", "low"].map((value) => <option key={value} value={value}>{readable(value)}</option>)}
                        </select>
                        <button type="button" onClick={() => void update("set_priority", item.id, { priority: priorityDraft })}>Save priority</button>
                      </div>
                    </div>}
                  </div>
                  <div className="admin-case-notes">
                    <label htmlFor={`note-${item.id}`}>Internal case note</label>
                    <textarea id={`note-${item.id}`} rows={3} maxLength={800} value={caseNote} onChange={(event) => setCaseNote(event.target.value)} placeholder="Add context, checks completed or the next action. Notes are visible only to operations users." />
                    <button type="button" onClick={() => void saveNote(item)} disabled={!caseNote.trim()}>Add audited note</button>
                  </div>
                  {canResolve && item.status !== "resolved" && <div className="admin-case-resolution">
                    <label htmlFor={`resolution-${item.id}`}>Resolution record{item.requiresAction ? " required" : ""}</label>
                    <textarea id={`resolution-${item.id}`} rows={2} maxLength={800} value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Record the decision, action taken and any follow-up." />
                    <button type="button" onClick={() => void resolve(item)}>Resolve case</button>
                  </div>}
                  <div className="admin-case-history">
                    <h3>Case history</h3>
                    {item.activity.length ? <ol>{item.activity.map((entry) => <li key={entry.id}><div><strong>{entry.administrator}</strong><time dateTime={entry.createdAt}>{dateTime(entry.createdAt)}</time></div><p>{entry.summary}</p></li>)}</ol> : <p>No workflow actions have been recorded yet.</p>}
                  </div>
                </section>
              )}
            </div>
            <div className="admin-notification-actions">
              <button type="button" onClick={() => { void update("mark_read", item.id); onOpen(item); }}>Open record</button>
              <button type="button" className="secondary" onClick={() => manageCase(item)}>{expandedId === item.id ? "Close case" : "Manage case"}</button>
              {item.status === "open" && <button type="button" className="secondary" onClick={() => void update("mark_read", item.id)}>Mark read</button>}
              {["failed", "waiting_for_channel"].includes(item.deliveryStatus) && delivery.configured && ["owner", "admin"].includes(role) && <button type="button" className="secondary" onClick={() => void update("retry_delivery", item.id)}>Retry alert</button>}
              {item.status === "resolved" && ["owner", "admin"].includes(role) && <button type="button" className="secondary" onClick={() => void update("reopen", item.id)}>Reopen</button>}
            </div>
          </article>
        )) : <div className="admin-empty"><strong>No matching operations cases</strong><p>Choose another queue or clear the filters. New events will continue to arrive automatically.</p></div>}
      </section>
    </>
  );
}
