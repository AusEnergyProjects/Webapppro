"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { ASSET_SERVICE_TYPES, googleCalendarUrl } from "@/lib/asset-lifecycle.mjs";

type Asset = { id: string; assetCategory: string; brand: string; modelNumber: string; warrantyEnd: string; workNumber: string };
type Plan = { id: string; assetId: string; serviceType: string; cadenceMonths: number; nextDueAt: string; status: string; lifecycleStatus: string };
type Event = { id: string; servicePlanId: string; assetId: string; servicedAt: string; summary: string; providerReference: string; nextDueAt: string };
type Notice = { id: string; assetId: string; title: string; summary: string; severity: string; sourceUrl: string; sourceLabel: string; effectiveAt: string; acknowledgedAt: string };
type Preference = { assetId: string; remindersEnabled: boolean; reminderLeadDays: number; recorded: boolean };
type Result = { ok?: boolean; assets?: Asset[]; plans?: Plan[]; events?: Event[]; notices?: Notice[]; preferences?: Preference[]; error?: string };

const serviceLabels = Object.fromEntries(ASSET_SERVICE_TYPES as Array<[string, string]>) as Record<string, string>;
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function CustomerAssetLifecycle({ user, projectId = "", packId = "" }: { user: User; projectId?: string; packId?: string }) {
  const [result, setResult] = useState<Result>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const request = useCallback(async (body?: Record<string, unknown>) => {
    const token = await user.getIdToken();
    const query = packId ? `packId=${encodeURIComponent(packId)}` : `projectId=${encodeURIComponent(projectId)}`;
    const response = await fetch(body ? "/api/customer-asset-lifecycle" : `/api/customer-asset-lifecycle?${query}`, {
      method: body ? "PATCH" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ ...body, projectId, packId }) : undefined,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as Result;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Your asset lifecycle library could not be loaded.");
    setResult(payload);
  }, [packId, projectId, user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void request().catch((error) => active && setStatus(error instanceof Error ? error.message : "Your asset lifecycle library could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [request]);

  async function update(body: Record<string, unknown>, busyKey: string, message: string) {
    setBusy(busyKey); setStatus("Saving your private asset preference...");
    try { await request(body); setStatus(message); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Your private asset preference could not be saved."); }
    finally { setBusy(""); }
  }

  const assets = result.assets || [];
  const plans = result.plans || [];
  const events = result.events || [];
  const notices = result.notices || [];
  const preferences = result.preferences || [];
  const dueCount = plans.filter((plan) => plan.status === "active" && ["due_soon", "overdue"].includes(plan.lifecycleStatus)).length;
  const unacknowledged = notices.filter((notice) => !notice.acknowledgedAt).length;
  const plansByAsset = plans.reduce<Record<string, Plan[]>>((groups, plan) => {
    (groups[plan.assetId] ||= []).push(plan);
    return groups;
  }, {});

  if (loading) return <section className="customer-detail-panel customer-lifecycle-library"><p>Loading care and warranty reminders...</p></section>;
  if (!assets.length) return null;
  return <details className="customer-detail-panel customer-lifecycle-library customer-lifecycle-simple">
    <summary><div><span>Free care reminders</span><strong>Warranty, servicing and product safety</strong><small>{dueCount ? `${dueCount} item${dueCount === 1 ? "" : "s"} need attention` : unacknowledged ? `${unacknowledged} safety notice${unacknowledged === 1 ? "" : "s"} to review` : "Nothing needs attention right now"}</small></div><b>View details</b></summary>
    <div className="customer-lifecycle-simple-body"><div className="customer-panel-heading"><span>Optional details</span><h2>Care and warranty reminders</h2><p>See service dates, warranty cover and trusted safety notices. You choose whether to add anything to Google Calendar.</p></div>
    <div className="customer-lifecycle-metrics"><article><strong>{dueCount}</strong><span>care items due soon</span></article><article><strong>{unacknowledged}</strong><span>safety notices to review</span></article><article><strong>{plans.filter((plan) => plan.status === "active").length}</strong><span>care schedules</span></article><article><strong>{events.length}</strong><span>completed services</span></article></div>
    {notices.length > 0 && <div className="customer-safety-notices"><h3>Matched product safety notices</h3>{notices.map((notice) => { const asset = assets.find((item) => item.id === notice.assetId); return <article className={`severity-${notice.severity}`} key={`${notice.id}:${notice.assetId}`}><div><span>{readable(notice.severity)}</span><h4>{notice.title}</h4><p>{notice.summary}</p><small>Matched to {asset?.brand} {asset?.modelNumber}. No contact details were shared.</small></div><div><a href={notice.sourceUrl} target="_blank" rel="noreferrer">Open {notice.sourceLabel}</a><button type="button" disabled={Boolean(notice.acknowledgedAt) || busy === `notice:${notice.id}:${notice.assetId}`} onClick={() => void update({ action: "acknowledge_notice", noticeId: notice.id, assetId: notice.assetId }, `notice:${notice.id}:${notice.assetId}`, "Safety notice marked as reviewed in your private account.")}>{notice.acknowledgedAt ? "Reviewed" : "Mark reviewed"}</button></div></article>; })}</div>}
    <div className="customer-lifecycle-assets">{assets.map((asset) => {
      const preference = preferences.find((item) => item.assetId === asset.id) || { assetId: asset.id, remindersEnabled: false, reminderLeadDays: 30, recorded: false };
      const assetPlans = plansByAsset[asset.id] || [];
      return <article key={asset.id}><header><div><span>{readable(asset.assetCategory)}</span><h3>{asset.brand} {asset.modelNumber}</h3><small>{asset.workNumber} | {asset.warrantyEnd ? `Warranty ends ${asset.warrantyEnd}` : "Warranty end not recorded"}</small></div><strong>{assetPlans.length} schedule{assetPlans.length === 1 ? "" : "s"}</strong></header>
        <div className="customer-reminder-preference"><label><input type="checkbox" checked={preference.remindersEnabled} disabled={busy === `pref:${asset.id}`} onChange={(event) => void update({ action: "update_reminders", assetId: asset.id, enabled: event.target.checked, leadDays: preference.reminderLeadDays }, `pref:${asset.id}`, event.target.checked ? "Service reminder consent saved." : "Service reminders turned off.")} /><span><strong>Allow service reminders</strong><small>{preference.recorded ? "Saved to this private customer account" : "Off until you explicitly enable it"}</small></span></label><select aria-label={`Reminder window for ${asset.brand} ${asset.modelNumber}`} value={preference.reminderLeadDays} disabled={!preference.remindersEnabled || busy === `pref:${asset.id}`} onChange={(event) => void update({ action: "update_reminders", assetId: asset.id, enabled: true, leadDays: Number(event.target.value) }, `pref:${asset.id}`, "Service reminder window saved.")}><option value="7">7 days before</option><option value="14">14 days before</option><option value="30">30 days before</option><option value="60">60 days before</option><option value="90">90 days before</option></select></div>
        {asset.warrantyEnd && <div className="customer-lifecycle-warranty"><div><span>Warranty reminder</span><strong>Coverage recorded to {asset.warrantyEnd}</strong></div><a href={googleCalendarUrl({ title: `Warranty review: ${asset.brand} ${asset.modelNumber}`, date: asset.warrantyEnd, details: "Review the warranty record in your private AEA Energy customer dashboard." })} target="_blank" rel="noreferrer">Add to Google Calendar</a></div>}
        {assetPlans.map((plan) => <section className={`customer-service-plan status-${plan.lifecycleStatus}`} key={plan.id}><div><span>{serviceLabels[plan.serviceType] || readable(plan.serviceType)}</span><strong>{plan.status === "paused" ? "Schedule paused" : `Next due ${plan.nextDueAt}`}</strong><small>Every {plan.cadenceMonths} months | {readable(plan.lifecycleStatus)}</small></div>{plan.status === "active" && <a href={googleCalendarUrl({ title: `${serviceLabels[plan.serviceType] || "Asset service"}: ${asset.brand} ${asset.modelNumber}`, date: plan.nextDueAt, details: "Open your private AEA Energy dashboard for the asset and service history." })} target="_blank" rel="noreferrer">Add to Google Calendar</a>}<details><summary>Service history</summary>{events.filter((item) => item.servicePlanId === plan.id).length ? <ul>{events.filter((item) => item.servicePlanId === plan.id).map((item) => <li key={item.id}><strong>{item.servicedAt}</strong><span>{item.summary || "Service completed"}</span><small>{item.providerReference ? `Reference ${item.providerReference}` : "No provider reference recorded"}</small></li>)}</ul> : <p>No completed service entries yet.</p>}</details></section>)}
      </article>;
    })}</div>
    {status && <p className="customer-dashboard-status" role="status">{status}</p>}
  </div></details>;
}
