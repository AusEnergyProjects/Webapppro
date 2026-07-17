"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type Member = { id: string; displayName: string; role: string; status: string };
type Delivery = { id: string; channel: string; provider: string; contentRevision: number; status: string; attempts: number; providerStatus: string; lastError: string; queuedAt: string; sentAt: string; deliveredAt: string; failedAt: string; updatedAt: string };
type Channel = { channel: string; provider: string; enabled: boolean; configured: boolean; senderLabel: string; dailyLimit: number; revision: number; updatedAt: string };
type FollowUp = {
  key: string; id: string; servicePlanId: string; assetId: string; customerId: string; serviceSiteId: string; workOrderId: string;
  workNumber: string; customerNumber: string; customerName: string; siteLabel: string; siteSummary: string; assetCategory: string;
  brand: string; modelNumber: string; serviceType: string; cadenceMonths: number; dueAt: string; dueState: string; readiness: string;
  consentStatus: string; reminderLeadDays: number; status: string; storedStatus: string; assigneeMemberId: string; assigneeLabel: string;
  suppressionReason: string; internalNotes: string; reminderSubject: string; reminderBody: string; revision: number; lastServicedAt: string;
  protectedJob: boolean; updatedAt: string;
  channelEligibility: { email: boolean; sms: boolean }; deliveries: Delivery[];
};
type Result = { ok?: boolean; error?: string; followUps?: FollowUp[]; members?: Member[]; businessName?: string; channels?: Channel[] };
type Edit = { memberId: string; internalNotes: string; suppressionReason: string };

function readable(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export function TradeServiceFollowUpWorkspace({ user }: { user: User }) {
  const [data, setData] = useState<Result>({}); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState(""); const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [customerFilter, setCustomerFilter] = useState(""); const [siteFilter, setSiteFilter] = useState("");
  const [assetFilter, setAssetFilter] = useState(""); const [dueFilter, setDueFilter] = useState("");
  const [memberFilter, setMemberFilter] = useState(""); const [consentFilter, setConsentFilter] = useState(""); const [statusFilter, setStatusFilter] = useState("");
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true); setMessage("");
    try {
      const token = await user.getIdToken(); const response = await fetch("/api/trade-service-follow-ups", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) throw new Error(result.error || "The service follow-up queue could not be loaded.");
      setData(result); setEdits({});
    } catch (error) { setMessage(error instanceof Error ? error.message : "The service follow-up queue could not be loaded."); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { const frame = window.requestAnimationFrame(() => void load()); return () => window.cancelAnimationFrame(frame); }, [load]);

  async function update(item: FollowUp, action: string, success: string, extra: Record<string, unknown> = {}) {
    const edit = edits[item.key] || { memberId: item.assigneeMemberId, internalNotes: item.internalNotes, suppressionReason: item.suppressionReason };
    setBusy(`${action}:${item.key}`); setMessage("");
    try {
      const token = await user.getIdToken(); const response = await fetch("/api/trade-service-follow-ups", {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, servicePlanId: item.servicePlanId, dueAt: item.dueAt, expectedRevision: item.revision, ...edit, ...extra }),
      });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) throw new Error(result.error || "The service follow-up could not be saved.");
      setData(result); setEdits({}); setMessage(success);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The service follow-up could not be saved."); }
    finally { setBusy(""); }
  }

  const followUps = useMemo(() => data.followUps || [], [data.followUps]); const members = useMemo(() => data.members || [], [data.members]); const channels = data.channels || [];
  const sites = useMemo(() => [...new Set(followUps.map((item) => item.siteLabel))].sort(), [followUps]);
  const categories = useMemo(() => [...new Set(followUps.map((item) => item.assetCategory))].sort(), [followUps]);
  const customerQuery = customerFilter.trim().toLowerCase();
  const visible = followUps.filter((item) => (!customerQuery || `${item.customerName} ${item.customerNumber}`.toLowerCase().includes(customerQuery))
    && (!siteFilter || item.siteLabel === siteFilter) && (!assetFilter || item.assetCategory === assetFilter)
    && (!dueFilter || item.dueState === dueFilter) && (!memberFilter || (memberFilter === "unassigned" ? !item.assigneeMemberId : item.assigneeMemberId === memberFilter))
    && (!consentFilter || item.consentStatus === consentFilter) && (!statusFilter || item.status === statusFilter));
  const ready = followUps.filter((item) => item.status === "ready" && item.readiness === "eligible").length;
  const blocked = followUps.filter((item) => ["missing", "withdrawn"].includes(item.consentStatus)).length;

  if (loading) return <section className="dashboard-panel follow-up-workspace"><div className="crm-empty"><strong>Building the service follow-up queue</strong><span>Checking asset schedules, customer consent and assigned staff.</span></div></section>;
  return <section className="dashboard-panel follow-up-workspace">
    <header className="follow-up-heading"><div><span>Service follow-ups</span><h2>Prepare, review and send service reminders</h2><p>Every send requires current customer consent, an enabled channel and a deliberate review confirmation. Delivery receipts and opt-outs are audited.</p></div><button type="button" onClick={() => void load()}>Refresh queue</button></header>
    <section className="follow-up-metrics"><article><strong>{followUps.length}</strong><span>active service plans</span></article><article><strong>{followUps.filter((item) => item.dueState === "overdue").length}</strong><span>overdue</span></article><article><strong>{ready}</strong><span>ready for review</span></article><article><strong>{blocked}</strong><span>blocked by consent</span></article></section>
    <div className="follow-up-filters"><label><span>Customer</span><input value={customerFilter} placeholder="Name or number" onChange={(event) => setCustomerFilter(event.target.value)} /></label><label><span>Site</span><select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="">All sites</option>{sites.map((site) => <option key={site}>{site}</option>)}</select></label><label><span>Asset</span><select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}><option value="">All categories</option>{categories.map((category) => <option key={category}>{readable(category)}</option>)}</select></label><label><span>Due state</span><select value={dueFilter} onChange={(event) => setDueFilter(event.target.value)}><option value="">All due states</option><option value="overdue">Overdue</option><option value="due_soon">Due soon</option><option value="upcoming">Upcoming</option></select></label><label><span>Assignee</span><select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}><option value="">All staff</option><option value="unassigned">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><label><span>Consent</span><select value={consentFilter} onChange={(event) => setConsentFilter(event.target.value)}><option value="">All consent states</option><option value="confirmed">Confirmed</option><option value="missing">Missing</option><option value="withdrawn">Withdrawn</option></select></label><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All preparation states</option><option value="preparing">Preparing</option><option value="ready">Ready</option><option value="blocked_consent">Blocked</option><option value="suppressed">Suppressed</option><option value="completed">Completed</option></select></label></div>
    <div className="follow-up-list">{visible.map((item) => { const edit = edits[item.key] || { memberId: item.assigneeMemberId, internalNotes: item.internalNotes, suppressionReason: item.suppressionReason }; const eligible = item.readiness === "eligible"; const email = channels.find((channel) => channel.channel === "email"); const sms = channels.find((channel) => channel.channel === "sms"); return <article key={item.key} className={`due-${item.dueState}`}><header><div><span>{readable(item.dueState)} | due {item.dueAt}</span><h3>{item.customerName}</h3><p>{item.customerNumber} | {item.siteLabel}{item.siteSummary ? ` | ${item.siteSummary}` : ""}</p></div><div><strong>{readable(item.status)}</strong><small>Consent: {readable(item.consentStatus)}{item.readiness === "too_early" ? ` | opens ${item.reminderLeadDays} days before due` : ""}</small></div></header><section className="follow-up-asset"><div><span>{readable(item.assetCategory)}</span><strong>{item.brand} {item.modelNumber}</strong><small>{readable(item.serviceType)} | every {item.cadenceMonths} months{item.lastServicedAt ? ` | last serviced ${item.lastServicedAt}` : ""}</small></div><div><span>Source record</span><strong>{item.workNumber || "Asset register"}</strong><small>{item.protectedJob ? "Authorised customer ownership" : "Direct customer record"}</small></div></section><div className="follow-up-controls"><label><span>Assigned staff</span><select value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [item.key]: { ...edit, memberId: event.target.value } }))}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><label><span>Internal preparation notes</span><textarea maxLength={1000} value={edit.internalNotes} placeholder="Internal context only" onChange={(event) => setEdits((current) => ({ ...current, [item.key]: { ...edit, internalNotes: event.target.value } }))} /></label><label><span>Suppression reason</span><input maxLength={300} value={edit.suppressionReason} placeholder="Required only when suppressing" onChange={(event) => setEdits((current) => ({ ...current, [item.key]: { ...edit, suppressionReason: event.target.value } }))} /></label></div>{item.reminderSubject && <section className="follow-up-draft"><span>Prepared reminder for review</span><strong>{item.reminderSubject}</strong><p>{item.reminderBody}</p><label><input type="checkbox" checked={Boolean(reviewed[item.key])} onChange={(event) => setReviewed((current) => ({ ...current, [item.key]: event.target.checked }))} />I reviewed this exact reminder and want to send it now</label><small>Customer contact details remain server-side and are released only to the selected provider.</small></section>}{Boolean(item.deliveries.length) && <section className="follow-up-deliveries">{item.deliveries.map((delivery) => <article key={delivery.id}><strong>{delivery.channel.toUpperCase()} | {readable(delivery.status)}</strong><span>{delivery.providerStatus || delivery.lastError || delivery.provider}</span><small>{delivery.deliveredAt || delivery.sentAt || delivery.queuedAt}</small>{delivery.status === "failed" && delivery.attempts < 3 && <button type="button" disabled={Boolean(busy)} onClick={() => void update(item, "retry_delivery", "Delivery retry submitted.", { channel: delivery.channel })}>Retry</button>}</article>)}</section>}<footer><button type="button" disabled={Boolean(busy)} onClick={() => void update(item, "save_preparation", "Preparation details saved.")}>Save preparation</button><button type="button" className="primary" disabled={!eligible || Boolean(busy)} onClick={() => void update(item, "prepare_reminder", "Consent-eligible reminder prepared for review.")}>Prepare reminder</button><button type="button" className="primary" disabled={!reviewed[item.key] || !item.channelEligibility.email || !email?.enabled || !email.configured || item.status !== "ready" || Boolean(busy)} onClick={() => void update(item, "send_reminder", "Email reminder accepted for delivery.", { channel: "email" })}>Send email</button><button type="button" className="primary" disabled={!reviewed[item.key] || !item.channelEligibility.sms || !sms?.enabled || !sms.configured || item.status !== "ready" || Boolean(busy)} onClick={() => void update(item, "send_reminder", "SMS reminder accepted for delivery.", { channel: "sms" })}>Send SMS</button><button type="button" disabled={!edit.suppressionReason || Boolean(busy)} onClick={() => void update(item, "suppress", "Follow-up suppressed and audited.")}>Suppress</button>{item.status === "completed" ? <button type="button" disabled={Boolean(busy)} onClick={() => void update(item, "reopen", "Follow-up reopened.")}>Reopen</button> : <button type="button" disabled={Boolean(busy)} onClick={() => void update(item, "complete", "Follow-up preparation completed.")}>Complete</button>}</footer></article>; })}{!visible.length && <div className="crm-empty"><strong>No follow-ups match this view</strong><span>Change a filter or add an active service plan to a confirmed customer asset.</span></div>}</div>
    {message && <p className="crm-status" role="status">{message}</p>}
  </section>;
}
