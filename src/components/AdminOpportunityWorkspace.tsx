"use client";

import { Fragment, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceListControls, type WorkspaceListPreferences } from "@/components/WorkspaceListControls";
import { downloadWorkspaceCsv } from "@/components/WorkspaceTableTools";
import { SearchableLookup, type SearchableLookupOption } from "@/components/SearchableLookup";
import { AUSTRALIAN_STATE_CODES } from "@/lib/australian-postcodes.mjs";
import {
  ENERGY_SERVICE_LABELS,
  ENERGY_SERVICE_OPTIONS,
} from "@/lib/energy-service-catalogue.mjs";
import { dateTime, readable, resetWorkspaceListView, saveWorkspaceListView, workspaceError as errorMessage } from "@/components/admin-workspace";
import { requiresAeaDelivery } from "@/lib/aea-service-identity.mjs";
import { tradeOpportunityServiceScopeAllowed } from "@/lib/aea-trade-routing.mjs";
import styles from "./AdminOpportunityWorkspace.module.css";

type AdminRole = "owner" | "admin" | "reviewer" | "support";
type ListPagination = { page: number; pageSize: number; total: number; pageCount: number; hasNext?: boolean; nextCursor?: string };
type OpportunityAllocation = {
  id: string;
  firebaseUid: string;
  businessName: string;
  status: string;
  matchedCategories: string[];
  distanceKm: number;
  allocationRank: number;
  matchSource: string;
  contactAttemptCount: number;
  lastContactAt: string;
  connectedAt: string;
  matchedAt: string;
  notificationStatus: string;
  notificationSentAt: string;
  notificationDeliveredAt: string;
  businessEligible: boolean;
};
type Opportunity = {
  id: string;
  sourceReference: string;
  title: string;
  projectType: string;
  postcode: string;
  state: string;
  serviceCategories: string[];
  priority: string;
  timing: string;
  summary: string;
  status: string;
  matchCount: number;
  interestedCount: number;
  connectedCount: number;
  contactLimit: number;
  maximumConnectedInstallers: number;
  isSynthetic: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  allocations: OpportunityAllocation[];
};
type RetainedContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  unitNumber: string;
  streetAddress: string;
  suburb: string;
  state: string;
  postcode: string;
  grantedAt: string;
};
type AdminApiResult = {
  allocated?: unknown[];
  eligibleCount?: number;
  opportunities?: Opportunity[];
  options?: unknown;
  pagination?: Partial<ListPagination>;
  preferences?: WorkspaceListPreferences;
  saved?: boolean;
  retainedContact?: RetainedContact;
};

const states = AUSTRALIAN_STATE_CODES;
const categories = ENERGY_SERVICE_OPTIONS;
const capabilityLabels = ENERGY_SERVICE_LABELS;
const emptyPagination: ListPagination = { page: 1, pageSize: 25, total: 0, pageCount: 1 };

export type AdminOpportunityWorkspaceProps = {
  api: (path: string, init?: RequestInit) => Promise<AdminApiResult>;
  role: AdminRole;
  setStatus: (status: string) => void;
};

export function AdminOpportunityWorkspace({ api, role, setStatus }: AdminOpportunityWorkspaceProps) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [opportunitySynthetic, setOpportunitySynthetic] = useState("");
  const [opportunitySearch, setOpportunitySearch] = useState("");
  const [opportunityStatusFilter, setOpportunityStatusFilter] = useState("");
  const [opportunityServiceFilter, setOpportunityServiceFilter] = useState("");
  const [opportunityStateFilter, setOpportunityStateFilter] = useState("");
  const [opportunitySort, setOpportunitySort] = useState("created-desc");
  const [opportunityPage, setOpportunityPage] = useState(1);
  const [opportunityPageSize, setOpportunityPageSize] = useState(25);
  const [opportunityPagination, setOpportunityPagination] = useState<ListPagination>(emptyPagination);
  const opportunityCursors = useRef<string[]>([""]);
  const opportunityTotalReady = useRef(false);
  const [opportunityViewReady, setOpportunityViewReady] = useState(false);
  const [opportunityViewSaved, setOpportunityViewSaved] = useState(false);
  const [opportunityViewBusy, setOpportunityViewBusy] = useState(false);
  const [expandedOpportunity, setExpandedOpportunity] = useState("");
  const [selectedOpportunity, setSelectedOpportunity] = useState("");
  const [selectedBusiness, setSelectedBusiness] = useState("");
  const [retainedContact, setRetainedContact] = useState<{ opportunityId: string; details: RetainedContact } | null>(null);
  const [retainedContactBusy, setRetainedContactBusy] = useState("");
  const retainedContactRequest = useRef(0);
  const [opportunityDraft, setOpportunityDraft] = useState({
    title: "", projectType: "", postcode: "", state: "", categories: [] as string[],
    priority: "standard", timing: "planning", summary: "", status: "draft",
  });

  const loadInstallerOptions = useCallback(async (query: string, selected: string): Promise<SearchableLookupOption[]> => {
    const params = new URLSearchParams({ type: "installer", q: query });
    if (selected) params.set("selected", selected);
    const result = await api(`/api/admin/lookups?${params}`);
    return (result.options || []) as SearchableLookupOption[];
  }, [api]);

  const loadOpportunityOptions = useCallback(async (query: string, selected: string): Promise<SearchableLookupOption[]> => {
    const params = new URLSearchParams({ type: "opportunity", q: query });
    if (selected) params.set("selected", selected);
    const result = await api(`/api/admin/lookups?${params}`);
    return (result.options || []) as SearchableLookupOption[];
  }, [api]);

  const loadOpportunities = useCallback(async (announce = false) => {
    retainedContactRequest.current += 1;
    setRetainedContact(null);
    setRetainedContactBusy("");
    const params = new URLSearchParams({ page: String(opportunityPage), pageSize: String(opportunityPageSize), sort: opportunitySort });
    const cursor = opportunityCursors.current[opportunityPage - 1] || "";
    if (cursor) params.set("cursor", cursor);
    if (opportunityTotalReady.current) params.set("total", "0");
    if (opportunitySearch.trim()) params.set("search", opportunitySearch.trim());
    if (opportunityStatusFilter) params.set("status", opportunityStatusFilter);
    if (opportunityServiceFilter) params.set("service", opportunityServiceFilter);
    if (opportunityStateFilter) params.set("state", opportunityStateFilter);
    if (opportunitySynthetic) params.set("synthetic", opportunitySynthetic);
    try {
      const result = await api(`/api/admin/opportunities?${params}`);
      setOpportunities(result.opportunities || []);
      setOpportunityPagination((current) => {
        const next = { ...current, ...(result.pagination || {}), page: opportunityPage, pageSize: opportunityPageSize };
        if (typeof result.pagination?.total === "number") opportunityTotalReady.current = true;
        if (next.hasNext && next.nextCursor) opportunityCursors.current[opportunityPage] = next.nextCursor;
        opportunityCursors.current.length = Math.max(opportunityPage, next.hasNext ? opportunityPage + 1 : opportunityPage);
        return next;
      });
      if (announce) setStatus(`${result.pagination?.total || 0} leads and opportunities match this view.`);
    } catch (error) { setStatus(errorMessage(error)); }
  }, [api, opportunityPage, opportunityPageSize, opportunitySearch, opportunityServiceFilter, opportunitySort, opportunityStateFilter, opportunityStatusFilter, opportunitySynthetic, setStatus]);

  useEffect(() => () => { retainedContactRequest.current += 1; }, []);

  async function showRetainedContact(opportunityId: string) {
    const requestNumber = ++retainedContactRequest.current;
    setRetainedContact(null);
    setRetainedContactBusy(opportunityId);
    try {
      const result = await api(`/api/admin/opportunities?contact=${encodeURIComponent(opportunityId)}`);
      if (requestNumber !== retainedContactRequest.current) return;
      if (!result.retainedContact) throw new Error("The retained contact record could not be opened.");
      setRetainedContact({ opportunityId, details: result.retainedContact });
      setStatus("Retained contact opened. This access has been recorded in the audit log.");
    } catch (error) {
      if (requestNumber === retainedContactRequest.current) setStatus(errorMessage(error));
    } finally {
      if (requestNumber === retainedContactRequest.current) setRetainedContactBusy("");
    }
  }

  useEffect(() => {
    let cancelled = false;
    void api("/api/admin/list-views?view=admin-opportunities").then((result) => {
      if (cancelled) return;
      const preferences = result.preferences as WorkspaceListPreferences;
      setOpportunitySearch(preferences.search || "");
      setOpportunityStatusFilter(preferences.filter === "all" ? "" : preferences.filter || "");
      setOpportunityServiceFilter(preferences.service || "");
      setOpportunityStateFilter(preferences.state || "");
      setOpportunitySynthetic(preferences.synthetic || "");
      setOpportunitySort(preferences.sort || "created-desc");
      setOpportunityPageSize(preferences.pageSize || 25);
      setOpportunityViewSaved(Boolean(result.saved));
    }).catch((error) => setStatus(errorMessage(error))).finally(() => {
      if (!cancelled) setOpportunityViewReady(true);
    });
    return () => { cancelled = true; };
  }, [api, setStatus]);

  useEffect(() => {
    opportunityCursors.current = [""]; opportunityTotalReady.current = false;
  }, [opportunityPageSize, opportunitySearch, opportunityServiceFilter, opportunitySort, opportunityStateFilter, opportunityStatusFilter, opportunitySynthetic]);

  useEffect(() => {
    if (!opportunityViewReady) return;
    const timer = window.setTimeout(() => { void loadOpportunities(); }, 180);
    return () => window.clearTimeout(timer);
  }, [loadOpportunities, opportunityViewReady]);

  function refreshOpportunities() {
    opportunityCursors.current = [""];
    opportunityTotalReady.current = false;
    setExpandedOpportunity("");
    if (opportunityPage === 1) void loadOpportunities();
    else setOpportunityPage(1);
  }

  function applyOpportunityView(preferences: WorkspaceListPreferences) {
    setOpportunitySearch(preferences.search || "");
    setOpportunityStatusFilter(preferences.filter === "all" ? "" : preferences.filter || "");
    setOpportunityServiceFilter(preferences.service || "");
    setOpportunityStateFilter(preferences.state || "");
    setOpportunitySynthetic(preferences.synthetic || "");
    setOpportunitySort(preferences.sort || "created-desc");
    setOpportunityPageSize(preferences.pageSize || 25);
    setOpportunityPage(1);
  }

  async function saveOpportunityView() {
    setOpportunityViewBusy(true);
    try {
      await saveWorkspaceListView(api, "admin-opportunities", { search: opportunitySearch, filter: opportunityStatusFilter || "all", sort: opportunitySort, pageSize: opportunityPageSize, service: opportunityServiceFilter, state: opportunityStateFilter, synthetic: opportunitySynthetic });
      setOpportunityViewSaved(true);
      setStatus("Your default table view has been saved.");
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setOpportunityViewBusy(false); }
  }

  async function resetOpportunityView() {
    setOpportunityViewBusy(true);
    try {
      applyOpportunityView(await resetWorkspaceListView(api, "admin-opportunities"));
      setOpportunityViewSaved(false);
      setStatus("The table view has been reset to the TLink default.");
    } catch (error) { setStatus(errorMessage(error)); }
    finally { setOpportunityViewBusy(false); }
  }

  function toggleCategory(value: string) {
    setOpportunityDraft((current) => ({ ...current, categories: current.categories.includes(value) ? current.categories.filter((item) => item !== value) : [...current.categories, value] }));
  }

  async function createOpportunity(event: FormEvent) {
    event.preventDefault(); setStatus("Creating opportunity...");
    try {
      await api("/api/admin/opportunities", { method: "POST", body: JSON.stringify({ ...opportunityDraft, serviceCategories: opportunityDraft.categories }) });
      setOpportunityDraft({ title: "", projectType: "", postcode: "", state: "", categories: [], priority: "standard", timing: "planning", summary: "", status: "draft" });
      setOpportunityPage(1); await loadOpportunities();
      setStatus("Opportunity created. Open it when the scope is ready for matching.");
    } catch (error) { setStatus(errorMessage(error)); }
  }

  async function setOpportunityStatus(id: string, nextStatus: string) {
    setStatus("Updating opportunity...");
    try {
      await api("/api/admin/opportunities", { method: "PATCH", body: JSON.stringify({ id, status: nextStatus }) });
      await loadOpportunities(); setStatus(`Opportunity marked ${nextStatus}.`);
    } catch (error) { setStatus(errorMessage(error)); }
  }

  async function allocateOpportunity(id: string, aeaOnly = false) {
    setStatus(aeaOnly ? "Sending this enquiry to the verified Australian Energy Assessments trade account..." : "Finding every verified installer whose service area and capabilities match...");
    try {
      const result = await api("/api/admin/opportunities/allocate", { method: "POST", body: JSON.stringify({ opportunityId: id, ...(aeaOnly ? { routing: "aea" } : {}) }) });
      await loadOpportunities();
      setStatus(aeaOnly ? result.allocated?.length ? "This enquiry is in the Australian Energy Assessments trade account's Leads workspace." : "No new assignment was created. Check existing assignments, business verification, operations access, service area, availability and current customer consent." : `${result.allocated?.length || 0} new installer${result.allocated?.length === 1 ? "" : "s"} allocated. ${result.eligibleCount || 0} verified businesses currently match the service area and capability requirements.`);
    } catch (error) { setStatus(errorMessage(error)); }
  }

  async function updateAllocation(id: string, nextStatus: string) {
    setStatus(nextStatus === "connected" ? "Opening platform coordination for this option..." : "Updating the installer allocation...");
    try {
      await api("/api/admin/opportunities/matches", { method: "PATCH", body: JSON.stringify({ id, status: nextStatus }) });
      await loadOpportunities();
      setStatus(nextStatus === "connected" ? "Platform coordination opened. Customer contact details remain private." : `Installer allocation marked ${nextStatus}.`);
    } catch (error) { setStatus(errorMessage(error)); }
  }

  async function assignOpportunity(event: FormEvent) {
    event.preventDefault(); setStatus("Assigning opportunity...");
    try {
      await api("/api/admin/opportunities/matches", { method: "POST", body: JSON.stringify({ opportunityId: selectedOpportunity, firebaseUid: selectedBusiness }) });
      await loadOpportunities(); setStatus("Opportunity assigned. The business can now respond from its dashboard.");
    } catch (error) { setStatus(errorMessage(error)); }
  }

  function exportOpportunities() {
    downloadWorkspaceCsv("tlink-admin-leads-and-opportunities.csv", [
      { key: "id", label: "Opportunity ID" }, { key: "title", label: "Title" }, { key: "projectType", label: "Project type" },
      { key: "services", label: "Services" }, { key: "state", label: "State" }, { key: "postcode", label: "Postcode" },
      { key: "status", label: "Status" }, { key: "priority", label: "Priority" }, { key: "timing", label: "Timing" },
      { key: "received", label: "Received" }, { key: "routing", label: "Routing" },
      { key: "assigned", label: "Assigned" }, { key: "interested", label: "Interested" }, { key: "connected", label: "Connected" }, { key: "updated", label: "Updated" },
    ], opportunities.map((item) => ({ id: item.id, title: item.title, projectType: item.projectType, services: item.serviceCategories.map((service) => capabilityLabels[service] || readable(service)).join(", "), state: item.state, postcode: item.postcode, status: readable(item.status), priority: readable(item.priority), timing: readable(item.timing), received: dateTime(item.createdAt), routing: requiresAeaDelivery(item.serviceCategories) ? "Australian Energy Assessments follow-up" : "Trade matching", assigned: item.matchCount, interested: item.interestedCount, connected: item.connectedCount, updated: dateTime(item.updatedAt) })));
  }

  return <div className={styles.workspace}>
    <header className="admin-page-heading"><span>Customer demand and matching</span><h1>Leads and opportunities</h1><p>Review every submitted customer enquiry and privacy-safe lead, then coordinate matching with suitable verified installers.</p></header>
    <div className="admin-context-filter admin-opportunity-filters">
      <label>Search enquiries<input aria-label="Search opportunities" placeholder="Title, scope, type or postcode" value={opportunitySearch} onChange={(event) => { setOpportunitySearch(event.target.value); setOpportunityPage(1); }} /></label>
      <label>Status<select value={opportunityStatusFilter} onChange={(event) => { setOpportunityStatusFilter(event.target.value); setOpportunityPage(1); }}><option value="">All statuses</option>{["draft", "open", "paused", "closed", "expired"].map((value) => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
      <label>Service<select value={opportunityServiceFilter} onChange={(event) => { setOpportunityServiceFilter(event.target.value); setOpportunityPage(1); }}><option value="">All services</option>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>State<select value={opportunityStateFilter} onChange={(event) => { setOpportunityStateFilter(event.target.value); setOpportunityPage(1); }}><option value="">All states</option>{states.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Opportunity data<select aria-label="Opportunity data marker" value={opportunitySynthetic} onChange={(event) => { setOpportunitySynthetic(event.target.value); setOpportunityPage(1); }}><option value="">Live and demo enquiries</option><option value="exclude">Live enquiries only</option><option value="only">Demo enquiries only</option></select></label>
      <label>Sort by<select value={opportunitySort} onChange={(event) => { setOpportunitySort(event.target.value); setOpportunityPage(1); }}><option value="created-desc">Newest received</option><option value="created-asc">Oldest received</option><option value="updated-desc">Recently updated</option><option value="updated-asc">Oldest updated</option><option value="title-asc">Title A to Z</option><option value="title-desc">Title Z to A</option><option value="status-asc">Status</option><option value="state-asc">State and postcode</option><option value="expires-asc">Expiry date</option></select></label>
      <span>{opportunityPagination.total} enquiries match</span>
      {(opportunitySearch || opportunityStatusFilter || opportunityServiceFilter || opportunityStateFilter || opportunitySynthetic) && <button type="button" className="secondary" onClick={() => { setOpportunitySearch(""); setOpportunityStatusFilter(""); setOpportunityServiceFilter(""); setOpportunityStateFilter(""); setOpportunitySynthetic(""); setOpportunityPage(1); }}>Clear filters</button>}
    </div>
    <WorkspaceListControls page={opportunityPagination.page} pageCount={opportunityPagination.pageCount} pageSize={opportunityPagination.pageSize} total={opportunityPagination.total} hasNext={opportunityPagination.hasNext} saved={opportunityViewSaved} busy={opportunityViewBusy} onPage={setOpportunityPage} onPageSize={(size) => { setOpportunityPageSize(size); setOpportunityPage(1); }} onSave={saveOpportunityView} onReset={resetOpportunityView} />
    <div className="workspace-table-actionbar"><button type="button" onClick={refreshOpportunities}>Refresh leads</button><button className="workspace-csv-export" type="button" disabled={!opportunities.length} onClick={exportOpportunities}>Export visible leads CSV</button></div>
    <div className="admin-opportunity-layout">
      <details className={styles.createPanel}><summary>Create an opportunity</summary><form className="admin-panel admin-opportunity-form" onSubmit={createOpportunity}>
        <div className="admin-panel-heading"><span>New scope</span><h2>Create an opportunity</h2><p>Do not include household names, contact details or street addresses.</p></div>
        <label>Opportunity title<input value={opportunityDraft.title} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, title: event.target.value })} required /></label>
        <label>Project type<input value={opportunityDraft.projectType} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, projectType: event.target.value })} placeholder="Whole-home electrification" required /></label>
        <div className="admin-form-row"><label>State<select value={opportunityDraft.state} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, state: event.target.value })} required><option value="">Choose</option>{states.map((state) => <option key={state}>{state}</option>)}</select></label><label>Postcode (optional)<input inputMode="numeric" maxLength={4} value={opportunityDraft.postcode} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, postcode: event.target.value.replace(/\D/g, "") })} /></label></div>
        <fieldset><legend>Required services</legend><div className="admin-category-grid">{categories.map(([value, label]) => <label className={opportunityDraft.categories.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={opportunityDraft.categories.includes(value)} onChange={() => toggleCategory(value)} />{label}</label>)}</div></fieldset>
        <div className="admin-form-row"><label>Priority<select value={opportunityDraft.priority} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, priority: event.target.value })}><option value="standard">Standard</option><option value="priority">Priority</option><option value="urgent">Urgent</option></select></label><label>Timing<select value={opportunityDraft.timing} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, timing: event.target.value })}><option value="planning">Planning</option><option value="within_3_months">Within 3 months</option><option value="within_30_days">Within 30 days</option><option value="urgent">Urgent</option></select></label></div>
        <label>Privacy-safe summary<textarea value={opportunityDraft.summary} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, summary: event.target.value })} placeholder="Describe the scope, dwelling constraints, expected outcome and known equipment without personal information." required /></label>
        <label>Initial status<select value={opportunityDraft.status} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, status: event.target.value })}><option value="draft">Draft</option><option value="open">Open for matching</option></select></label>
        <button type="submit">Create opportunity</button>
      </form></details>
      <section className="admin-panel admin-opportunity-list tlink-data-table">
        <div className="admin-panel-heading"><span>Pipeline</span><h2>Current leads and opportunities</h2></div>
        <p>Received times use your local time zone. Expand a lead for its full scope, business assignments and follow-up actions.</p>
        {opportunities.length ? <div className={styles.tableScroll}><table className={styles.leadTable} aria-label="Leads and opportunities"><thead><tr><th>Received</th><th>Enquiry and services</th><th>Location</th><th>Routing and status</th><th>Businesses</th><th>Actions</th></tr></thead><tbody>{opportunities.map((opportunity) => {
          const contact = retainedContact?.opportunityId === opportunity.id ? retainedContact.details : null;
          const aeaOnly = requiresAeaDelivery(opportunity.serviceCategories);
          const tradeAllowed = tradeOpportunityServiceScopeAllowed(opportunity.serviceCategories);
          const expanded = expandedOpportunity === opportunity.id;
          const summary = aeaOnly ? opportunity.summary
            .replace("Only the request and contact fields they consented to share are available to approved matching TLink trades.", "")
            .replace("Only the contact fields the customer consented to share are available to approved matching TLink trades.", "") : opportunity.summary;
          const emailSent = opportunity.allocations.filter(item => item.notificationSentAt).length;
          return <Fragment key={opportunity.id}><tr>
            <td><time dateTime={opportunity.createdAt}>{dateTime(opportunity.createdAt)}</time><small>Updated {dateTime(opportunity.updatedAt)}</small></td>
            <th scope="row"><button type="button" className={styles.leadTitle} aria-expanded={expanded} aria-controls={`lead-details-${opportunity.id}`} onClick={() => setExpandedOpportunity(expanded ? "" : opportunity.id)}>{opportunity.title}</button>{opportunity.isSynthetic && <b className="admin-synthetic-marker">Demo</b>}<div className={styles.services}>{opportunity.serviceCategories.map(service => <span key={service}>{capabilityLabels[service] || readable(service)}</span>)}</div><small>{readable(opportunity.timing)} · {readable(opportunity.priority)} priority</small></th>
            <td><strong>{opportunity.state} {opportunity.postcode || "Postcode not supplied"}</strong></td>
            <td><strong>{aeaOnly ? "Australian Energy Assessments follow-up" : tradeAllowed ? "Trade matching" : "Review service scope"}</strong><span className={`admin-pill admin-pill-${opportunity.status}`}>{aeaOnly && opportunity.status === "draft" ? "Awaiting Australian Energy Assessments follow-up" : readable(opportunity.status)}</span><small>{aeaOnly ? "Kept with Australian Energy Assessments. Not available to other businesses." : opportunity.matchCount ? "See assignments and email status below." : opportunity.status === "open" ? "No businesses assigned yet." : "Not open for trade matching."}</small></td>
            <td><strong>{opportunity.matchCount} assigned</strong><small>{opportunity.interestedCount} interested · {opportunity.connectedCount} connected</small><small>{emailSent} email{emailSent === 1 ? "" : "s"} sent</small></td>
            <td><button type="button" aria-expanded={expanded} onClick={() => setExpandedOpportunity(expanded ? "" : opportunity.id)}>{expanded ? "Hide details" : "View lead"}</button></td>
          </tr>{expanded && <tr id={`lead-details-${opportunity.id}`}><td colSpan={6}><section className={styles.leadDetails} aria-label={`Lead details: ${opportunity.title}`}>
            {aeaOnly && <div className={styles.routingNotice}><strong>This enquiry stays with Australian Energy Assessments</strong><p>It includes an Australian Energy Assessments assessment or safety service. The whole request, including the other upgrades, goes only to the verified Australian Energy Assessments trade account. It is not available for distribution to other TLink businesses. Use Send to Australian Energy Assessments trade account to recover an unassigned enquiry; sharing it with other businesses needs the customer&apos;s separate permission.</p></div>}
            <p>{summary}</p>
            <dl className={styles.detailMeta}><div><dt>Received</dt><dd>{dateTime(opportunity.createdAt)}</dd></div><div><dt>Last updated</dt><dd>{dateTime(opportunity.updatedAt)}</dd></div><div><dt>Expires</dt><dd>{dateTime(opportunity.expiresAt)}</dd></div><div><dt>Reference</dt><dd>{opportunity.sourceReference || opportunity.id}</dd></div><div><dt>Project type</dt><dd>{opportunity.projectType}</dd></div></dl>
            {opportunity.allocations?.length > 0 && <div className="admin-allocation-list">{opportunity.allocations.map((allocation) => <article key={allocation.id}><div><strong>{allocation.allocationRank}. {allocation.businessName}</strong><span>{aeaOnly ? "Australia-wide" : `${allocation.distanceKm.toFixed(1)} km`} · {readable(allocation.status)} · {readable(allocation.matchSource)}</span><span>Assigned {dateTime(allocation.matchedAt)}</span>{!allocation.businessEligible && <span>Business eligibility needs attention. Check current business setup, insurance, services and regions.</span>}<span>Email status: {allocation.notificationStatus ? readable(allocation.notificationStatus) : "Not queued"}</span>{allocation.notificationSentAt && <span>Sent {dateTime(allocation.notificationSentAt)}</span>}{allocation.notificationDeliveredAt && <span>Delivery receipt {dateTime(allocation.notificationDeliveredAt)}</span>}</div><div>{allocation.status === "interested" && opportunity.connectedCount < opportunity.maximumConnectedInstallers && <button type="button" onClick={() => void updateAllocation(allocation.id, "connected")}>Progress in platform</button>}</div></article>)}</div>}
            <div className="admin-opportunity-actions">
              {opportunity.sourceReference && ["owner", "admin", "support"].includes(role) && <button type="button" disabled={Boolean(retainedContactBusy)} aria-expanded={Boolean(contact)} onClick={() => contact ? setRetainedContact(null) : void showRetainedContact(opportunity.id)}>{retainedContactBusy === opportunity.id ? "Opening contact..." : contact ? "Hide retained contact" : "Show retained contact"}</button>}
              {["owner", "admin"].includes(role) && <>{aeaOnly && ["draft", "open"].includes(opportunity.status) && <button type="button" onClick={() => void allocateOpportunity(opportunity.id, true)}>Send to Australian Energy Assessments trade account</button>}{tradeAllowed && opportunity.status === "open" && <button type="button" onClick={() => void allocateOpportunity(opportunity.id)}>Send to every eligible service-area trade</button>}
              {tradeAllowed && ["draft", "paused"].includes(opportunity.status) && <button onClick={() => void setOpportunityStatus(opportunity.id, "open")}>Open for matching</button>}
              {tradeAllowed && opportunity.status === "open" && <button onClick={() => void setOpportunityStatus(opportunity.id, "paused")}>Pause</button>}
              {opportunity.status !== "closed" && <button onClick={() => void setOpportunityStatus(opportunity.id, "closed")}>Close enquiry</button>}</>}
            </div>
            {contact && <section className={styles.retainedContact} aria-label="Retained customer contact"><strong>For Australian Energy Assessments support</strong><p>This access is audited. Trades only receive the contact details the customer chose to share.</p><dl>
              <div><dt>Name</dt><dd>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Not provided"}</dd></div><div><dt>Email</dt><dd>{contact.email}</dd></div><div><dt>Phone</dt><dd>{contact.phone || "Not provided"}</dd></div><div><dt>Property</dt><dd>{[contact.unitNumber, contact.streetAddress, contact.suburb, contact.state, contact.postcode].filter(Boolean).join(", ")}</dd></div>
            </dl></section>}
          </section></td></tr>}</Fragment>;
        })}</tbody></table></div> : <p className="admin-empty">No enquiries match these filters.</p>}
      </section>
    </div>
    {["owner", "admin"].includes(role) && <details className={styles.createPanel}><summary>Manual allocation exception</summary><form className="admin-panel admin-assignment-form" onSubmit={assignOpportunity}><div><span>Capability matching</span><h2>Manual allocation exception</h2><p>Use only when an otherwise eligible installer needs to be added manually. Service radius, capability, availability and verified-business checks still apply.</p></div><SearchableLookup label="Open opportunity" value={selectedOpportunity} required placeholder="Search title or postcode" load={loadOpportunityOptions} onChange={setSelectedOpportunity} /><SearchableLookup label="Active installer" value={selectedBusiness} required placeholder="Search business or postcode" load={loadInstallerOptions} onChange={setSelectedBusiness} /><button type="submit">Add eligible installer</button></form></details>}
  </div>;
}
