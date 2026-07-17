"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type Enquiry = {
  id: string; sourceType: string; sourceReference: string; externalRecordId: string; status: string; customerId: string;
  customerType: string; firstName: string; lastName: string; businessName: string; businessNumber: string; email: string;
  phone: string; addressLine1: string; addressLine2: string; suburb: string; addressState: string; postcode: string;
  serviceCategory: string; description: string; urgency: string; preferredDate: string; serviceRegion: string;
  protectedSource: number; duplicateDecision: string; createdAt: string; updatedAt: string;
};
type Message = { id: string; channel: string; direction: string; body: string; occurredAt: string };
type Event = { id: string; eventType: string; summary: string; createdAt: string };
type Duplicate = { customerId: string; customerNumber: string; displayName: string; serviceSiteId: string; siteLabel: string; reasons: string[] };
type Result = { ok?: boolean; enquiries?: Enquiry[]; enquiry?: Enquiry; messages?: Message[]; events?: Event[]; duplicateCandidates?: Duplicate[]; id?: string; customerId?: string; error?: string };

const STATUS_LABELS: Record<string, string> = {
  new: "New", contacted: "Contacted", site_visit: "Site visit", quote_required: "Quote required",
  quoted: "Quoted", booked: "Booked", won: "Won", lost: "Lost",
};
const SERVICES = ["assessment", "solar", "battery", "heating-cooling", "hot-water", "insulation-draughts", "ev-charging", "electrical", "plumbing", "other"];
const displayName = (enquiry: Enquiry) => enquiry.businessName || [enquiry.firstName, enquiry.lastName].filter(Boolean).join(" ") || "Protected marketplace enquiry";
const readable = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value: string) => value ? new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Not set";

export function TradeEnquiryInbox({ user, onConverted }: { user: User; onConverted?: () => void | Promise<void> }) {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Enquiry | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [decision, setDecision] = useState<"create_new" | "use_existing">("create_new");
  const [existingCustomerId, setExistingCustomerId] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = await user.getIdToken();
    const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok || result.ok === false) throw new Error(result.error || "The enquiry request could not be completed.");
    return result;
  }, [user]);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ search, status: statusFilter, source: sourceFilter });
    const result = await request(`/api/trade-enquiries?${params}`);
    const items = result.enquiries || []; setEnquiries(items);
    setSelectedId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id || "");
  }, [request, search, sourceFilter, statusFilter]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    const result = await request(`/api/trade-enquiries?id=${encodeURIComponent(id)}`);
    setDetail(result.enquiry || null); setMessages(result.messages || []); setEvents(result.events || []); setDuplicates(result.duplicateCandidates || []);
    const first = result.duplicateCandidates?.[0]; setExistingCustomerId(first?.customerId || ""); setDecision(first ? "use_existing" : "create_new");
  }, [request]);

  useEffect(() => { const timer = window.setTimeout(() => void loadList().catch((error) => setStatus(error.message)), 150); return () => window.clearTimeout(timer); }, [loadList]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void loadDetail(selectedId).catch((error) => setStatus(error.message)));
    return () => window.cancelAnimationFrame(frame);
  }, [loadDetail, selectedId]);

  async function act(body: Record<string, unknown>, key: string, success: string) {
    setBusy(key); setStatus("");
    try { await request("/api/trade-enquiries", { method: "POST", body: JSON.stringify(body) }); await loadList(); if (selectedId) await loadDetail(selectedId); setStatus(success); return true; }
    catch (error) { setStatus(error instanceof Error ? error.message : "The enquiry could not be updated."); return false; }
    finally { setBusy(""); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy("create");
    try {
      const result = await request("/api/trade-enquiries", { method: "POST", body: JSON.stringify({ action: "create", ...Object.fromEntries(data) }) });
      form.reset(); setCreating(false); await loadList(); if (result.id) setSelectedId(result.id); setStatus("Direct enquiry added to the inbox.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The enquiry could not be added."); }
    finally { setBusy(""); }
  }

  async function addMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail) return; const form = event.currentTarget; const data = new FormData(form);
    if (await act({ action: "add_message", enquiryId: detail.id, message: data.get("message"), channel: data.get("channel"), direction: data.get("direction") }, "message", "Conversation history updated.")) form.reset();
  }

  async function convert() {
    if (!detail) return;
    const result = await act({ action: "convert", enquiryId: detail.id, duplicateDecision: decision, customerId: decision === "use_existing" ? existingCustomerId : "" }, "convert", decision === "create_new" ? "Customer, primary contact and service site created." : "Enquiry linked to the selected customer after duplicate review.");
    if (result) await onConverted?.();
  }

  return <section className="enquiry-workspace" aria-labelledby="enquiry-inbox-title">
    <header className="enquiry-hero"><div><span>One intake queue</span><h2 id="enquiry-inbox-title">Enquiry inbox</h2><p>Track direct and protected marketplace enquiries without crossing the customer privacy boundary.</p></div><button type="button" onClick={() => setCreating((value) => !value)}>{creating ? "Close form" : "New direct enquiry"}</button></header>
    {creating && <form className="crm-form enquiry-create" onSubmit={create}><div className="crm-form-grid"><label><span>Source</span><input name="sourceType" required placeholder="website, referral, phone" /></label><label><span>External record ID</span><input name="externalRecordId" placeholder="Optional source ID" /></label><label><span>Customer type</span><select name="customerType"><option value="residential">Residential</option><option value="business">Business</option></select></label><label><span>First name</span><input name="firstName" /></label><label><span>Last name</span><input name="lastName" /></label><label><span>Business name</span><input name="businessName" /></label><label><span>Business number</span><input name="businessNumber" inputMode="numeric" /></label><label><span>Email</span><input type="email" name="email" /></label><label><span>Phone</span><input type="tel" name="phone" /></label><label className="wide"><span>Street address</span><input name="addressLine1" /></label><label><span>Suburb</span><input name="suburb" /></label><label><span>State</span><select name="addressState" defaultValue=""><option value="">Select state</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Postcode</span><input name="postcode" pattern="[0-9]{4}" /></label><label><span>Service</span><select name="serviceCategory">{SERVICES.map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label><label><span>Urgency</span><select name="urgency"><option value="standard">Standard</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label><span>Preferred date</span><input type="date" name="preferredDate" /></label><label className="wide"><span>Enquiry details</span><textarea name="description" required rows={4} /></label></div><p className="crm-form-note">Only add identity and address details supplied directly to your business.</p><button className="btn" disabled={busy === "create"}>{busy === "create" ? "Adding..." : "Add enquiry"}</button></form>}
    <div className="enquiry-filters"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, contact, scope or reference" aria-label="Search enquiries" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter enquiry status"><option value="">All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Filter enquiry source"><option value="">All sources</option><option value="tlink_marketplace">TLink marketplace</option><option value="direct">Direct</option><option value="import">Import</option></select></div>
    <div className="enquiry-layout"><aside className="enquiry-list">{enquiries.length ? enquiries.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span>{item.protectedSource ? "Protected marketplace" : readable(item.sourceType)} | {STATUS_LABELS[item.status] || readable(item.status)}</span><strong>{displayName(item)}</strong><p>{item.description}</p><small>{item.protectedSource ? item.serviceRegion || "Broad region only" : [item.suburb, item.addressState, item.postcode].filter(Boolean).join(" ") || item.email || item.phone || "Contact not added"}</small></button>) : <div className="crm-empty"><strong>No enquiries match this view</strong><span>Add a direct enquiry or clear a filter.</span></div>}</aside>
      {detail ? <article className="enquiry-detail"><header><div><span>{detail.protectedSource ? "AEA protected marketplace" : `${readable(detail.sourceType)} | ${detail.externalRecordId || detail.sourceReference}`}</span><h3>{displayName(detail)}</h3><p>{detail.description}</p></div><strong>{STATUS_LABELS[detail.status] || readable(detail.status)}</strong></header>{detail.protectedSource ? <div className="enquiry-protected"><strong>Privacy boundary active</strong><p>Only the protected reference, project scope and broad service region are stored here. Continue response, quote and job actions in the marketplace lead workflow.</p><span>{detail.serviceRegion || "Region withheld"} | Reference {detail.sourceReference}</span></div> : <div className="enquiry-contact"><strong>Direct contact and service site</strong><p>{[detail.email, detail.phone].filter(Boolean).join(" | ") || "No email or phone supplied"}</p><span>{[detail.addressLine1, detail.addressLine2, detail.suburb, detail.addressState, detail.postcode].filter(Boolean).join(", ") || "Address not supplied"}</span></div>}
        <section className="enquiry-stage"><label><span>Inbox status</span><select value={detail.status} disabled={Boolean(busy)} onChange={(event) => void act({ action: "update_status", enquiryId: detail.id, status: event.target.value }, "status", "Enquiry status updated.")}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><small>Updated {dateTime(detail.updatedAt)}</small></section>
        {!detail.protectedSource && !detail.customerId && <section className="enquiry-duplicates"><header><div><span>Duplicate review</span><h4>Choose the customer destination</h4></div></header>{duplicates.length ? <div className="enquiry-duplicate-list">{duplicates.map((candidate) => <label key={`${candidate.customerId}:${candidate.serviceSiteId}`}><input type="radio" name="duplicate" checked={decision === "use_existing" && existingCustomerId === candidate.customerId} onChange={() => { setDecision("use_existing"); setExistingCustomerId(candidate.customerId); }} /><span><strong>{candidate.displayName} | {candidate.customerNumber}</strong><small>Matched by {candidate.reasons.join(", ")}{candidate.siteLabel ? ` | ${candidate.siteLabel}` : ""}</small></span></label>)}</div> : <p>No matching email, phone, business number or service address was found.</p>}<label className="enquiry-new-choice"><input type="radio" name="duplicate" checked={decision === "create_new"} onChange={() => setDecision("create_new")} /><span><strong>Create a new customer</strong><small>Creates one customer account, primary contact and primary service site.</small></span></label><button className="btn" type="button" disabled={busy === "convert" || (decision === "use_existing" && !existingCustomerId)} onClick={() => void convert()}>{busy === "convert" ? "Converting..." : "Confirm conversion"}</button></section>}
        {!detail.protectedSource && detail.customerId && <div className="enquiry-converted"><strong>Converted customer</strong><span>This enquiry remains the source and conversation record. Customer ID {detail.customerId}</span></div>}
        <section className="enquiry-history"><div><span>Conversation record</span><h4>Notes and contact history</h4></div><form onSubmit={addMessage}>{!detail.protectedSource && <><select name="channel" aria-label="Conversation channel"><option value="note">Internal note</option><option value="email">Email record</option><option value="phone">Phone record</option><option value="sms">SMS record</option></select><select name="direction" aria-label="Conversation direction"><option value="internal">Internal</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></>}<textarea name="message" required rows={3} placeholder={detail.protectedSource ? "Add an internal scope note only" : "Record the conversation without sending a message"} /><button disabled={busy === "message"}>Add record</button></form>{messages.length ? <ol>{messages.map((message) => <li key={message.id}><span>{readable(message.channel)} | {readable(message.direction)}</span><p>{message.body}</p><small>{dateTime(message.occurredAt)}</small></li>)}</ol> : <p>No conversation records yet.</p>}</section>
        <details className="enquiry-events"><summary>Source and audit history ({events.length})</summary>{events.map((event) => <p key={event.id}><strong>{readable(event.eventType)}</strong><span>{event.summary} | {dateTime(event.createdAt)}</span></p>)}</details>
      </article> : <section className="crm-card"><div className="crm-empty"><strong>Select an enquiry</strong><span>The source, duplicate review and conversion actions will open here.</span></div></section>}
    </div>{status && <p className="trade-import-status" role="status">{status}</p>}
  </section>;
}
