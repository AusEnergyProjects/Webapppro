"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { TradeHandoverCentre } from "./TradeHandoverCentre";
import { InstallerCrmWorkspace } from "./InstallerCrmWorkspace";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";

type PartnerType = "installer" | "supplier";
type WorkTask = {
  id: string;
  title: string;
  dueAt: string;
  status: "pending" | "done";
  completedAt: string;
};
type WorkOrder = {
  id: string;
  workType: "job" | "fulfilment";
  sourceType: "internal" | "opportunity" | "product_enquiry";
  sourceReference: string;
  workNumber: string;
  title: string;
  serviceCategory: string;
  siteArea: string;
  stage: string;
  priority: string;
  scheduledStart: string;
  scheduledEnd: string;
  assigneeLabel: string;
  handoverStatus: string;
  createdAt: string;
  updatedAt: string;
  tasks: WorkTask[];
  lastEvent: null | { summary: string; createdAt: string };
};
type SourceOption = {
  id: string;
  sourceType: "opportunity" | "product_enquiry";
  label: string;
  serviceCategory: string;
  siteArea: string;
};
type HubAccess = {
  fullAccess: boolean;
  teamAccess: boolean;
  activeCount: number;
  activeLimit: number;
  taskLimit: number;
};
type HubResult = {
  workOrders?: WorkOrder[];
  sourceOptions?: SourceOption[];
  recentActivity?: Array<{
    id: string;
    workOrderId: string;
    eventType: string;
    summary: string;
    createdAt: string;
  }>;
  access?: HubAccess;
  error?: string;
};

const serviceLabels: Record<string, string> = {
  assessment: "Energy assessment",
  solar: "Rooftop solar",
  battery: "Home batteries",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  "insulation-draughts": "Insulation and draught control",
  "ev-charging": "EV charging",
  electrical: "Electrical services",
  plumbing: "Plumbing services",
  "mounting-hardware": "Mounting and hardware",
  controls: "Energy controls",
  "product-fulfilment": "Product fulfilment",
  other: "Other work",
};
const stageOrder = [
  "backlog",
  "ready",
  "scheduled",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
];

function stageLabel(stage: string, partnerType: PartnerType) {
  const labels: Record<PartnerType, Record<string, string>> = {
    installer: {
      backlog: "Planning",
      ready: "Ready to schedule",
      scheduled: "Scheduled",
      in_progress: "On site",
      blocked: "Waiting",
      completed: "Handover complete",
      cancelled: "Cancelled",
    },
    supplier: {
      backlog: "New request",
      ready: "Confirmed",
      scheduled: "Pick scheduled",
      in_progress: "Picking or dispatch",
      blocked: "Waiting on stock",
      completed: "Fulfilled",
      cancelled: "Cancelled",
    },
  };
  return labels[partnerType][stage] || stage.replaceAll("_", " ");
}

function displayDate(value: string) {
  if (!value) return "Not scheduled";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function TradeBusinessHub(props: {
  user: User;
  partnerType: PartnerType;
  fullAccess: boolean;
  teamAccess: boolean;
  navigationTarget?: TLinkCommandTarget | null;
}) {
  if (props.partnerType === "installer" && props.fullAccess) {
    return <InstallerCrmWorkspace user={props.user} teamAccess={props.teamAccess} navigationTarget={props.navigationTarget} />;
  }
  return <BusinessHubFoundation {...props} />;
}

function BusinessHubFoundation({
  user,
  partnerType,
  fullAccess,
  teamAccess,
}: {
  user: User;
  partnerType: PartnerType;
  fullAccess: boolean;
  teamAccess: boolean;
}) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [recentActivity, setRecentActivity] = useState<HubResult["recentActivity"]>([]);
  const [access, setAccess] = useState<HubAccess>({
    fullAccess,
    teamAccess,
    activeCount: 0,
    activeLimit: fullAccess ? 500 : 5,
    taskLimit: fullAccess ? 50 : 10,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("active");
  const [sourceSelection, setSourceSelection] = useState("internal");
  const [title, setTitle] = useState("");
  const [serviceCategory, setServiceCategory] = useState("other");
  const [siteArea, setSiteArea] = useState("");
  const [priority, setPriority] = useState("standard");
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");

  function applyResult(result: HubResult) {
    setWorkOrders(result.workOrders || []);
    setSourceOptions(result.sourceOptions || []);
    setRecentActivity(result.recentActivity || []);
    if (result.access) setAccess(result.access);
  }

  async function requestHub(method: "POST" | "PATCH", body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setStatus("Saving the Business Hub update...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-work-orders", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as HubResult;
      if (!response.ok) throw new Error(result.error || "The Business Hub update could not be saved.");
      applyResult(result);
      setStatus("Business Hub updated.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The Business Hub update could not be saved.");
      return false;
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/trade-work-orders", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({})) as HubResult;
        if (!response.ok) throw new Error(result.error || "The Business Hub could not be loaded.");
        if (!cancelled) applyResult(result);
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "The Business Hub could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [user]);

  const selectedSource = sourceSelection === "internal"
    ? null
    : sourceOptions.find((item) => `${item.sourceType}:${item.id}` === sourceSelection) || null;
  const visibleOrders = useMemo(() => workOrders.filter((item) => {
    if (filter === "all") return true;
    if (filter === "scheduled") return Boolean(item.scheduledStart) && !["completed", "cancelled"].includes(item.stage);
    if (filter === "completed") return ["completed", "cancelled"].includes(item.stage);
    return !["completed", "cancelled"].includes(item.stage);
  }), [filter, workOrders]);
  const openTasks = workOrders.flatMap((item) => item.tasks).filter((item) => item.status === "pending").length;
  const scheduledCount = workOrders.filter((item) => item.scheduledStart && !["completed", "cancelled"].includes(item.stage)).length;
  const blockedCount = workOrders.filter((item) => item.stage === "blocked").length;
  const recordNoun = partnerType === "supplier" ? "fulfilment record" : "work record";

  async function createWorkOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceType = selectedSource?.sourceType || "internal";
    const saved = await requestHub("POST", {
      action: "create_work_order",
      sourceType,
      sourceReference: selectedSource?.id || "",
      title: selectedSource?.label || title,
      serviceCategory: selectedSource?.serviceCategory || serviceCategory,
      siteArea: selectedSource?.siteArea || siteArea,
      priority,
      scheduledStart,
      scheduledEnd,
    }, "create");
    if (saved) {
      setSourceSelection("internal");
      setTitle("");
      setServiceCategory("other");
      setSiteArea("");
      setPriority("standard");
      setScheduledStart("");
      setScheduledEnd("");
    }
  }

  async function addTask(event: FormEvent<HTMLFormElement>, workOrderId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await requestHub("POST", {
      action: "add_task",
      workOrderId,
      title: data.get("taskTitle"),
      dueAt: data.get("taskDueAt"),
    }, `task:${workOrderId}`);
    if (saved) form.reset();
  }

  return (
    <section id="business-hub" className="dashboard-panel trade-business-hub" aria-labelledby="business-hub-title">
      <div className="dashboard-panel-heading business-hub-heading">
        <div>
          <span>Business operations</span>
          <h2 id="business-hub-title">{partnerType === "supplier" ? "Move supply work from request to completion" : "Run work without turning customer details into a contact list"}</h2>
          <p>
            {partnerType === "supplier"
              ? "Track allocations, commercial follow-up, dates and internal tasks without mixing catalogue work with household enquiries."
              : "Track stages, dates, checklists and handover progress. Business Hub stores operational references only. Customer names, emails, phone numbers and street addresses stay outside this workspace."}
          </p>
        </div>
        <div className={`business-hub-access ${access.fullAccess ? "is-member" : "is-free"}`}>
          <strong>{access.fullAccess ? "Expanded access" : "Free foundation"}</strong>
          <span>{access.activeCount} of {access.activeLimit} active records</span>
          {!access.fullAccess && <a href="#membership">Unlock platform conversion</a>}
        </div>
      </div>

      <div className="business-hub-boundary">
        <strong>Protected by design</strong>
        <span>Only this signed-in business can read these records.</span>
        <span>Platform opportunities convert without customer contact fields.</span>
        <span>Wholesalers convert product requests, never household leads.</span>
      </div>

      <div className="business-hub-metrics" aria-label="Business Hub summary">
        <article><span>Active</span><strong>{access.activeCount}</strong><small>{partnerType === "supplier" ? "Orders moving" : "Jobs moving"}</small></article>
        <article><span>Scheduled</span><strong>{scheduledCount}</strong><small>With a start date</small></article>
        <article><span>Open tasks</span><strong>{openTasks}</strong><small>Across all records</small></article>
        <article className={blockedCount ? "attention" : ""}><span>Waiting</span><strong>{blockedCount}</strong><small>Needs attention</small></article>
      </div>

      <details className="business-hub-create">
        <summary>Create a new {recordNoun}</summary>
        <form onSubmit={createWorkOrder}>
          <div className="business-hub-form-grid">
            <label>
              <span>Starting point</span>
              <select value={sourceSelection} onChange={(event) => setSourceSelection(event.target.value)}>
                <option value="internal">Internal work with no customer details</option>
                {sourceOptions.map((item) => (
                  <option key={`${item.sourceType}:${item.id}`} value={`${item.sourceType}:${item.id}`}>{item.label}</option>
                ))}
              </select>
              <small>{access.fullAccess ? "Eligible platform work appears here when it is ready." : "Paid access or an admin grant adds platform conversion."}</small>
            </label>
            <label>
              <span>Work title</span>
              <input required={!selectedSource} disabled={Boolean(selectedSource)} maxLength={160} value={selectedSource?.label || title} onChange={(event) => setTitle(event.target.value)} placeholder={partnerType === "supplier" ? "Heat pump stock allocation" : "Heat pump hot water installation"} />
              <small>Describe the work, not the customer.</small>
            </label>
            <label>
              <span>Work category</span>
              <select disabled={Boolean(selectedSource)} value={selectedSource?.serviceCategory || serviceCategory} onChange={(event) => setServiceCategory(event.target.value)}>
                {Object.entries(serviceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>General service area</span>
              <input disabled={Boolean(selectedSource)} maxLength={80} value={selectedSource?.siteArea || siteArea} onChange={(event) => setSiteArea(event.target.value)} placeholder="Region, state or postcode only" />
              <small>No street address.</small>
            </label>
            <label>
              <span>Priority</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option><option value="urgent">Urgent</option>
              </select>
            </label>
            <label><span>Planned start</span><input type="date" value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} /></label>
            <label><span>Planned finish</span><input type="date" value={scheduledEnd} onChange={(event) => setScheduledEnd(event.target.value)} /></label>
          </div>
          <button className="btn" disabled={busy === "create" || access.activeCount >= access.activeLimit}>
            {busy === "create" ? "Creating..." : `Create ${recordNoun}`}
          </button>
        </form>
      </details>

      <div className="business-hub-toolbar">
        <div role="group" aria-label="Filter work records">
          {[
            ["active", "Active"],
            ["scheduled", "Scheduled"],
            ["completed", "Completed"],
            ["all", "All"],
          ].map(([value, label]) => <button key={value} type="button" className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <span>{visibleOrders.length} shown</span>
      </div>

      {loading ? (
        <div className="business-hub-empty">Loading secure business records...</div>
      ) : visibleOrders.length ? (
        <div className="business-hub-list">
          {visibleOrders.map((order) => {
            const completedTasks = order.tasks.filter((task) => task.status === "done").length;
            return (
              <article key={order.id} className={`business-work-card stage-${order.stage}`}>
                <header>
                  <div>
                    <span>{order.workNumber}</span>
                    <h3>{order.title}</h3>
                    <small>{serviceLabels[order.serviceCategory] || order.serviceCategory}{order.siteArea ? ` | ${order.siteArea}` : ""}</small>
                  </div>
                  <div className="business-work-badges">
                    <span>{stageLabel(order.stage, partnerType)}</span>
                    <span>{order.priority} priority</span>
                    {order.sourceType !== "internal" && <span>Platform sourced</span>}
                  </div>
                </header>
                <div className="business-work-controls">
                  <label>
                    <span>Stage</span>
                    <select value={order.stage} disabled={busy === order.id} onChange={(event) => void requestHub("PATCH", { action: "update_work_order", workOrderId: order.id, stage: event.target.value }, order.id)}>
                      {stageOrder.map((stage) => <option key={stage} value={stage}>{stageLabel(stage, partnerType)}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Priority</span>
                    <select value={order.priority} disabled={busy === order.id} onChange={(event) => void requestHub("PATCH", { action: "update_work_order", workOrderId: order.id, priority: event.target.value }, order.id)}>
                      <option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option><option value="urgent">Urgent</option>
                    </select>
                  </label>
                  <label>
                    <span>Start</span>
                    <input type="date" value={order.scheduledStart} disabled={busy === order.id} onChange={(event) => void requestHub("PATCH", { action: "update_work_order", workOrderId: order.id, scheduledStart: event.target.value }, order.id)} />
                  </label>
                  <label>
                    <span>Finish</span>
                    <input type="date" value={order.scheduledEnd} disabled={busy === order.id} onChange={(event) => void requestHub("PATCH", { action: "update_work_order", workOrderId: order.id, scheduledEnd: event.target.value }, order.id)} />
                  </label>
                </div>

                <div className="business-work-schedule">
                  <span>Schedule</span>
                  <strong>{displayDate(order.scheduledStart)}{order.scheduledEnd ? ` to ${displayDate(order.scheduledEnd)}` : ""}</strong>
                  <small>{order.assigneeLabel ? `Crew: ${order.assigneeLabel}` : access.teamAccess ? "No crew assigned" : "Team assignment is a premium feature"}</small>
                </div>

                <div className="business-work-tasks">
                  <div><strong>Checklist</strong><span>{completedTasks} of {order.tasks.length} complete</span></div>
                  {order.tasks.length ? <ul>{order.tasks.map((task) => (
                    <li key={task.id} className={task.status === "done" ? "done" : ""}>
                      <label><input type="checkbox" checked={task.status === "done"} disabled={busy === `task-toggle:${task.id}`} onChange={(event) => void requestHub("PATCH", { action: "update_task", taskId: task.id, status: event.target.checked ? "done" : "pending" }, `task-toggle:${task.id}`)} /><span>{task.title}</span></label>
                      <small>{task.dueAt ? `Due ${displayDate(task.dueAt)}` : "No due date"}</small>
                    </li>
                  ))}</ul> : <p>No checklist items yet.</p>}
                  <form onSubmit={(event) => void addTask(event, order.id)}>
                    <input name="taskTitle" required maxLength={180} placeholder="Add a privacy-safe checklist item" />
                    <input name="taskDueAt" type="date" aria-label="Checklist due date" />
                    <button type="submit" disabled={busy === `task:${order.id}` || order.tasks.length >= access.taskLimit}>Add task</button>
                  </form>
                </div>

                {access.teamAccess && (
                  <form className="business-work-assignee" onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void requestHub("PATCH", { action: "update_work_order", workOrderId: order.id, assigneeLabel: data.get("assigneeLabel") }, order.id);
                  }}>
                    <label><span>Crew or staff initials</span><input name="assigneeLabel" defaultValue={order.assigneeLabel} maxLength={80} placeholder="Crew A" /></label>
                    <button type="submit" disabled={busy === order.id}>Save assignment</button>
                  </form>
                )}

                {partnerType === "installer" && <TradeHandoverCentre
                  user={user}
                  workOrderId={order.id}
                  fullAccess={access.fullAccess}
                />}

                <footer>
                  <span>{order.lastEvent?.summary || "Work record created."}</span>
                  <small>Updated {new Date(order.updatedAt).toLocaleDateString("en-AU")}</small>
                  {order.handoverStatus
                    ? <small>Asset and warranty history retained</small>
                    : ["completed", "cancelled"].includes(order.stage) && <button type="button" disabled={busy === order.id} onClick={() => void requestHub("PATCH", { action: "archive_work_order", workOrderId: order.id }, order.id)}>Archive</button>}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="business-hub-empty">
          <strong>No {filter === "all" ? "work" : filter} records yet</strong>
          <span>Create an internal record above. Keep customer contact details out of every label and checklist.</span>
        </div>
      )}

      {recentActivity && recentActivity.length > 0 && (
        <details className="business-hub-activity">
          <summary>Recent Business Hub activity</summary>
          <ol>{recentActivity.map((item) => <li key={item.id}><span>{item.summary}</span><small>{new Date(item.createdAt).toLocaleString("en-AU")}</small></li>)}</ol>
        </details>
      )}
      {status && <p className="dashboard-settings-status" role="status">{status}</p>}
    </section>
  );
}
