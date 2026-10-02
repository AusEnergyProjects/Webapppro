"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import type { PortalWorkspace } from "@/lib/portal-team-workspace";
import { customerEmailHref, customerPhoneHref, type PortalConnectCustomer, type PortalConnectCustomers } from "@/lib/portal-customer-connect";
import { PortalTeamWorkspace } from "./PortalTeamWorkspace";
import { CreditexAuditCallPanel } from "./CreditexAuditCallPanel";
import styles from "./PortalConnectWorkspace.module.css";

type Props = { workspace: PortalWorkspace; user: User; onActiveChange?: (active: boolean) => void; initialPeerId?: string; initialIntentId?: string; canViewCustomers?: boolean; canMessageTeam?: boolean };
export function PortalConnectWorkspace(props: Props) {
  return <ConnectWorkspace key={`${props.workspace}-${props.user.uid}`} {...props} />;
}

function ConnectWorkspace({ workspace, user, onActiveChange, initialPeerId, initialIntentId, canViewCustomers = true, canMessageTeam = true }: Props) {
  const [view, setView] = useState<"customers" | "team">(initialPeerId || !canViewCustomers ? 'team' : 'customers');
  const [callActive, setCallActive] = useState(false);
  useEffect(() => { onActiveChange?.(callActive); }, [onActiveChange, callActive]);
  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);
  useEffect(() => {
    if (!callActive) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [callActive]);
  return <section className={styles.workspace}>
    <header className={styles.heading}><span>Conversations</span><h2>Connect</h2><p>Contact a customer or catch up with your team.</p></header>
    <nav className={styles.tabs} aria-label="Connect audience">
      {canViewCustomers && <button type="button" aria-pressed={view === "customers"} onClick={() => setView("customers")}>Customers</button>}
      {canMessageTeam && <button type="button" disabled={callActive} aria-pressed={view === "team"} onClick={() => setView("team")}>Team</button>}
    </nav>
    {callActive && <p role="status" className={styles.muted}>Finish the active call before changing customer or conversation.</p>}
    {view === "customers" && canViewCustomers ? <Customers workspace={workspace} user={user} initialIntentId={initialIntentId} callActive={callActive} onCallActiveChange={setCallActive} /> : canMessageTeam && <PortalTeamWorkspace workspace={workspace} user={user} view="connect" initialPeerId={initialPeerId} />}
  </section>;
}

type CallState = { callActive: boolean; onCallActiveChange: (active: boolean) => void };
function Customers({ workspace, user, callActive, onCallActiveChange, initialIntentId }: Props & CallState) {
  const [source, setSource] = useState<"certificate" | "enquiry" | "account">(workspace === "admin" ? "enquiry" : "certificate");
  return <>{workspace === "admin" && <label className={styles.source}>Customer list<select disabled={callActive} value={source} onChange={event => {
    const value = event.target.value; if (value === "certificate" || value === "enquiry" || value === "account") setSource(value);
  }}><option value="enquiry">Enquiries</option><option value="account">Customer accounts</option><option value="certificate">Certificate jobs</option></select></label>}
    <CustomerDirectory key={source} workspace={workspace} user={user} source={source} initialIntentId={initialIntentId} callActive={callActive} onCallActiveChange={onCallActiveChange} /></>;
}

type AdminLeadResponse = { ok: boolean; error?: string; leads: { id: string; name: string; email: string; phone: string; suburb: string; state: string; postcode: string; status: string }[] };
type AdminAccountResponse = { ok: boolean; error?: string; accounts: { accountKey: string; name: string; email: string; addressState: string; postcode: string }[]; pagination: { hasNext: boolean; nextCursor: string } };
function CustomerDirectory({ workspace, user, source, callActive, onCallActiveChange, initialIntentId = '' }: Props & CallState & { source: "certificate" | "enquiry" | "account" }) {
  const [linkedIntent, setLinkedIntent] = useState(initialIntentId);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [cursors, setCursors] = useState<string[]>([""]);
  const requestKey = JSON.stringify([workspace, user.uid, source, query, page, version, cursors[page - 1], linkedIntent]);
  const [responseState, setResponseState] = useState<{ key: string; data: PortalConnectCustomers | null; error: string } | null>(null);
  const [selection, setSelection] = useState<{ key: string; customer: PortalConnectCustomer } | null>(null);
  const loading = responseState?.key !== requestKey;
  const result = !loading ? responseState.data : null;
  const error = !loading ? responseState.error : "";
  const selected = !loading && !error ? selection?.key === requestKey ? selection.customer : result?.customers.find(customer => customer.id === linkedIntent) || null : null;

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      const params = new URLSearchParams({ actorMode: workspace === "admin" ? "admin" : "compliance", search: query, page: String(page) });
      if (linkedIntent && source === 'certificate') params.set('intentId', linkedIntent);
      let endpoint = "/api/portal-customer-connect";
      if (source === "enquiry") endpoint = "/api/admin/energy-assistant-leads";
      if (source === "account") { endpoint = "/api/admin/directory"; params.set("type", "customer"); params.set("status", "active"); params.set("pageSize", "25"); params.set("cursor", cursors[page - 1] || ""); }
      const token = await user.getIdToken();
      if (abort.signal.aborted) return;
      const response = await fetch(`${endpoint}?${params}`, { cache: "no-store", signal: abort.signal, headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json() as (PortalConnectCustomers & { ok: boolean; error?: string }) | AdminLeadResponse | AdminAccountResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "Customers could not be loaded. Try again.");
      let next: PortalConnectCustomers;
      if ("leads" in data) next = { page: 1, hasNext: false, searchLimited: data.leads.length === 200, customers: data.leads.filter(lead => lead.status !== "withdrawn").map(lead => ({
        id: lead.id, name: lead.name, phone: lead.phone || "", email: lead.email || "", address: [lead.suburb, lead.state, lead.postcode].filter(Boolean).join(" "),
        jobNumber: "Enquiry", jobTitle: "Customer enquiry", activity: lead.status.replaceAll("_", " "), installer: "", headsetAllowed: false, source: "enquiry",
      })) };
      else if ("accounts" in data) next = { page, hasNext: data.pagination.hasNext, nextCursor: data.pagination.nextCursor, customers: data.accounts.map(account => ({
        id: account.accountKey, name: account.name, phone: "", email: account.email || "", address: [account.addressState, account.postcode].filter(Boolean).join(" "),
        jobNumber: "Customer account", jobTitle: "Customer account", activity: "", installer: "", headsetAllowed: false, source: "account",
      })) };
      else next = data;
      if (!abort.signal.aborted) setResponseState({ key: requestKey, data: next, error: "" });
    })().catch(reason => { if (!abort.signal.aborted) setResponseState({ key: requestKey, data: null, error: reason instanceof Error ? reason.message : "Customers could not be loaded." }); });
    return () => abort.abort();
  }, [workspace, user, source, query, page, cursors, requestKey, linkedIntent]);

  return <div className={styles.customers}>
    <div className={styles.directory}>
      {linkedIntent && <button type="button" disabled={callActive} onClick={() => { setLinkedIntent(''); setSelection(null); }}>All customers</button>}
      <form className={styles.search} onSubmit={event => { event.preventDefault(); if (callActive) return; setQuery(search.trim()); setPage(1); setCursors([""]); setVersion(current => current + 1); }}>
        <label>Find a customer<input type="search" disabled={callActive} value={search} placeholder="Name, job, email or address" maxLength={120} onChange={event => setSearch(event.target.value)} /></label>
        <button type="submit" disabled={callActive}>Search</button>
      </form>
      <p className={styles.muted}>{source === "certificate" ? "Customers from your authorised certificate jobs." : source === "enquiry" ? "Current customer enquiries available to your Admin role." : "Customer accounts available to your Admin role."}</p>
      {loading && <p role="status">Loading customers...</p>}
      {error && <div role="alert" className={styles.error}><p>{error}</p><button type="button" onClick={() => setVersion(current => current + 1)}>Try again</button></div>}
      {!loading && !error && !result?.customers.length && <p className={styles.empty}>No customers found.{source === "certificate" ? " Customers appear here when certificate work is added to your jobs." : " Try a different search or customer list."}</p>}
      {result?.searchLimited && <p className={styles.muted}>Showing up to 200 current results. Search by customer name, phone or email to narrow this list.</p>}
      <div className={styles.list}>{result?.customers.map(customer => <button type="button" disabled={callActive} key={customer.id} aria-pressed={selected?.id === customer.id} onClick={() => setSelection({ key: requestKey, customer })}>
        <strong>{customer.name}</strong><span>{customer.jobNumber} · {customer.activity || customer.jobTitle}</span><small>{customer.address}</small>
      </button>)}</div>
      {result && (page > 1 || result.hasNext) && <div className={styles.pagination}>
        <button type="button" disabled={callActive || loading || page === 1} onClick={() => setPage(current => current - 1)}>Previous</button><span>Page {page}</span>
        <button type="button" disabled={callActive || loading || !result.hasNext} onClick={() => { setCursors(current => [...current.slice(0, page), result.nextCursor || ""]); setPage(current => current + 1); }}>Next</button>
      </div>}
    </div>
    <div className={styles.detail}>{selected ? <CustomerContact key={selected.id} customer={selected} user={user} onCallActiveChange={onCallActiveChange} /> : <div className={styles.empty}><h3>Choose a customer</h3><p>Open their contact details, call controls and call history here.</p></div>}</div>
  </div>;
}

function CustomerContact({ customer, user, onCallActiveChange }: { customer: PortalConnectCustomer; user: User; onCallActiveChange: (active: boolean) => void }) {
  const emailHref = customerEmailHref(customer.email);
  const phoneHref = customerPhoneHref(customer.phone);
  return <>
    <header className={styles.customerHeading}><span>{customer.jobNumber} · {customer.activity}</span><h3>{customer.name}</h3><p>{customer.address}</p><small>{customer.installer}</small></header>
    <div className={styles.contactActions}>
      {emailHref && <a href={emailHref}>Email customer</a>}
      {phoneHref && <a href={phoneHref}>Open phone app</a>}
      {(!emailHref && !phoneHref) && <p>No current email or phone number is saved on this job.</p>}
      <p>{customer.phone}{customer.phone && customer.email ? " · " : ""}{customer.email}</p>
      {emailHref && <small>Email opens your email app. It is not sent automatically or stored in TLink.</small>}
    </div>
    {customer.headsetAllowed ? <CreditexAuditCallPanel user={user} jobIntentId={customer.id} onActiveChange={onCallActiveChange} /> : (!customer.source || customer.source === "certificate") ? <p className={styles.callAccess}>Headset calls and private recordings require your own Creditex team access to this job. You can use the contact options above.</p> : phoneHref && <p className={styles.callAccess}>This enquiry uses your phone app. Recorded headset calls are available for authorised Creditex certificate jobs.</p>}
  </>;
}
