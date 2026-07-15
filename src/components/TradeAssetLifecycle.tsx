"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { ASSET_SERVICE_TYPES } from "@/lib/asset-lifecycle.mjs";

type Asset = { id: string; assetCategory: string; brand: string; modelNumber: string; serialNumber: string; installedAt: string; warrantyEnd: string };
type ServicePlan = { id: string; assetId: string; serviceType: string; cadenceMonths: number; nextDueAt: string; status: string; lifecycleStatus: string; jobTemplateId: string; autoCreateEnabled: boolean; jobLeadDays: number; lastGeneratedDueAt: string; lastGeneratedWorkOrderId: string };
type ServiceEvent = { id: string; servicePlanId: string; assetId: string; servicedAt: string; summary: string; providerReference: string; nextDueAt: string };
type SafetyNotice = { id: string; title: string; summary: string; severity: string; sourceUrl: string; sourceLabel: string; affectedAssetIds: string[] };
type JobTemplate = { id: string; name: string; title: string; serviceCategory: string; taskCount: number };
type LifecycleResult = { ok?: boolean; assets?: Asset[]; plans?: ServicePlan[]; events?: ServiceEvent[]; notices?: SafetyNotice[]; jobTemplates?: JobTemplate[]; generation?: { checked: number; created: number }; error?: string };

const serviceTypes = ASSET_SERVICE_TYPES as Array<[string, string]>;
const serviceLabels = Object.fromEntries(serviceTypes) as Record<string, string>;

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function TradeAssetLifecycle({ user, workOrderId, assets: handoverAssets }: { user: User; workOrderId: string; assets: Array<Pick<Asset, "id" | "brand" | "modelNumber">> }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [notices, setNotices] = useState<SafetyNotice[]>([]);
  const [jobTemplates, setJobTemplates] = useState<JobTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const apply = useCallback((result: LifecycleResult) => {
    setAssets(result.assets || []);
    setPlans(result.plans || []);
    setEvents(result.events || []);
    setNotices(result.notices || []);
    setJobTemplates(result.jobTemplates || []);
  }, []);

  const request = useCallback(async (method: "GET" | "POST" | "PATCH" = "GET", body?: Record<string, unknown>) => {
    const token = await user.getIdToken();
    const response = await fetch(method === "GET" ? `/api/trade-asset-lifecycle?workOrderId=${encodeURIComponent(workOrderId)}` : "/api/trade-asset-lifecycle", {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...body, workOrderId }) : undefined,
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as LifecycleResult;
    if (!response.ok || result.ok === false) throw new Error(result.error || "The asset lifecycle workspace could not be loaded.");
    apply(result);
  }, [apply, user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void request().catch((error) => active && setStatus(error instanceof Error ? error.message : "The asset lifecycle workspace could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [request]);

  async function submit(method: "POST" | "PATCH", body: Record<string, unknown>, busyKey: string, message: string) {
    setBusy(busyKey); setStatus("Saving the privacy-safe lifecycle record...");
    try { await request(method, body); setStatus(message); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The lifecycle record could not be saved."); }
    finally { setBusy(""); }
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submit("POST", {
      action: "create_plan",
      assetId: data.get("assetId"),
      serviceType: data.get("serviceType"),
      cadenceMonths: data.get("cadenceMonths"),
      nextDueAt: data.get("nextDueAt"),
      jobTemplateId: data.get("jobTemplateId"),
      autoCreateEnabled: data.get("autoCreateEnabled") === "yes",
      jobLeadDays: Number(data.get("jobLeadDays") || 14),
    }, "new-plan", "Service schedule saved. Automated jobs will be created once each due date enters its lead window.");
    form.reset();
  }

  async function recordService(event: FormEvent<HTMLFormElement>, planId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await submit("POST", { action: "record_service", planId, servicedAt: data.get("servicedAt"), summary: data.get("summary"), providerReference: data.get("providerReference"), nextDueAt: data.get("nextDueAt") }, `service:${planId}`, "Service history saved and the next due date updated.");
    form.reset();
  }

  const sourceAssets = assets.length ? assets : handoverAssets.map((asset) => ({ ...asset, assetCategory: "", serialNumber: "", installedAt: "", warrantyEnd: "" }));
  const activePlans = plans.filter((plan) => plan.status === "active").length;
  const duePlans = plans.filter((plan) => ["due_soon", "overdue"].includes(plan.lifecycleStatus)).length;
  const automatedPlans = plans.filter((plan) => plan.status === "active" && plan.autoCreateEnabled).length;
  const plansByAsset = plans.reduce<Record<string, ServicePlan[]>>((groups, plan) => {
    (groups[plan.assetId] ||= []).push(plan);
    return groups;
  }, {});

  return <section className="trade-lifecycle-workspace">
    <header><div><span>Aftercare and asset lifecycle</span><h4>Maintain service schedules without opening customer contact access</h4></div><small>Schedules and service history contain product records only. Customers receive private dashboard reminders and control their own calendar actions.</small></header>
    {loading ? <p className="handover-empty">Loading asset lifecycle schedules...</p> : <>
      <div className="trade-lifecycle-metrics"><div><strong>{activePlans}</strong><span>active schedules</span></div><div><strong>{automatedPlans}</strong><span>creating jobs automatically</span></div><div><strong>{duePlans}</strong><span>due or overdue</span></div><div><strong>{events.length}</strong><span>service records</span></div></div>
      {automatedPlans > 0 && <div className="trade-lifecycle-automation"><div><strong>Recurring job automation is active</strong><small>A daily check creates one job per due date. System job numbers, customer privacy rules and your chosen task template are applied automatically.</small></div><button type="button" disabled={busy === "generate"} onClick={() => void submit("POST", { action: "generate_due_jobs" }, "generate", "Due schedules checked. Any eligible service jobs are now in Jobs.")}>{busy === "generate" ? "Checking..." : "Create due jobs now"}</button></div>}
      {notices.length > 0 && <div className="trade-safety-notices"><h5>Product safety notices</h5>{notices.map((notice) => <article className={`severity-${notice.severity}`} key={notice.id}><div><span>{readable(notice.severity)}</span><strong>{notice.title}</strong><p>{notice.summary}</p><small>{notice.affectedAssetIds.length} asset record{notice.affectedAssetIds.length === 1 ? "" : "s"} matched in this work order. No household identity was used.</small></div><a href={notice.sourceUrl} target="_blank" rel="noreferrer">Open {notice.sourceLabel}</a></article>)}</div>}
      <div className="trade-lifecycle-assets">{sourceAssets.map((asset) => <article key={asset.id}><header><div><span>{asset.assetCategory ? readable(asset.assetCategory) : "Installed asset"}</span><h5>{asset.brand} {asset.modelNumber}</h5><small>{asset.warrantyEnd ? `Warranty ends ${asset.warrantyEnd}` : "Warranty end not recorded"}</small></div><strong>{plansByAsset[asset.id]?.length || 0} schedule{plansByAsset[asset.id]?.length === 1 ? "" : "s"}</strong></header>
        {(plansByAsset[asset.id] || []).map((plan) => <section className={`lifecycle-plan status-${plan.lifecycleStatus}`} key={plan.id}><div className="lifecycle-plan-summary"><div><span>{serviceLabels[plan.serviceType] || readable(plan.serviceType)}</span><strong>Next due {plan.nextDueAt}</strong><small>Every {plan.cadenceMonths} month{plan.cadenceMonths === 1 ? "" : "s"} | {readable(plan.lifecycleStatus)}</small>{plan.autoCreateEnabled && <small>Job creation: {plan.jobLeadDays} days before due{plan.jobTemplateId ? " using your saved template" : " using standard service tasks"}</small>}{plan.lastGeneratedDueAt && <small>Last job created for {plan.lastGeneratedDueAt}</small>}</div><button type="button" disabled={busy === `status:${plan.id}`} onClick={() => void submit("PATCH", { planId: plan.id, status: plan.status === "active" ? "paused" : "active" }, `status:${plan.id}`, plan.status === "active" ? "Schedule paused." : "Schedule reactivated.")}>{plan.status === "active" ? "Pause" : "Reactivate"}</button></div>
          <details><summary>Service history and completion entry</summary><div className="lifecycle-event-list">{events.filter((item) => item.servicePlanId === plan.id).map((item) => <article key={item.id}><strong>{item.servicedAt}</strong><span>{item.summary || "Service completed"}</span><small>{item.providerReference ? `Reference ${item.providerReference} | ` : ""}Next due {item.nextDueAt || "not set"}</small></article>)}</div><form onSubmit={(event) => void recordService(event, plan.id)}><label><span>Completed date</span><input name="servicedAt" type="date" required /></label><label><span>Service summary</span><input name="summary" maxLength={500} placeholder="Product work only, no customer details" /></label><label><span>Provider reference</span><input name="providerReference" maxLength={120} /></label><label><span>Override next due</span><input name="nextDueAt" type="date" /></label><button type="submit" disabled={busy === `service:${plan.id}`}>Record service</button></form></details>
        </section>)}
      </article>)}</div>
      {sourceAssets.length > 0 && <details className="handover-add-record trade-lifecycle-add"><summary>Add or update a service schedule</summary><p>Choose whether this schedule should only remind the customer or also create a ready-to-plan job for your team.</p><form onSubmit={createPlan}><label><span>Installed asset</span><select name="assetId" required>{sourceAssets.map((asset) => <option value={asset.id} key={asset.id}>{asset.brand} {asset.modelNumber}</option>)}</select></label><label><span>Service type</span><select name="serviceType" required>{serviceTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Repeat every</span><select name="cadenceMonths" defaultValue="12"><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="18">18 months</option><option value="24">24 months</option><option value="60">5 years</option></select></label><label><span>Next due</span><input name="nextDueAt" type="date" required /></label><label><span>Job task template</span><select name="jobTemplateId" defaultValue=""><option value="">Standard service tasks</option>{jobTemplates.map((template) => <option value={template.id} key={template.id}>{template.name} ({template.taskCount} tasks)</option>)}</select></label><label><span>Create job this early</span><select name="jobLeadDays" defaultValue="14"><option value="0">On the due date</option><option value="7">7 days before</option><option value="14">14 days before</option><option value="30">30 days before</option><option value="60">60 days before</option></select></label><label className="trade-lifecycle-toggle"><input name="autoCreateEnabled" type="checkbox" value="yes" /><span><strong>Create recurring jobs automatically</strong><small>One job per due date, protected against duplicates.</small></span></label><button type="submit" disabled={busy === "new-plan"}>Save schedule</button></form></details>}
    </>}
    {status && <p className="handover-inline-status" role="status">{status}</p>}
  </section>;
}
