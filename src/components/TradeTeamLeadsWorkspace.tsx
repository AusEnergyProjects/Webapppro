"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import dynamic from "next/dynamic";
import { useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";
import { TradeLeadFilters, TradeLeadList, TradeLeadReadOnlyDetails, type TradeLeadOpportunity } from "./TradeLeadInbox";
import type { TradeTeamPermissions } from "./TradeTeamSettings";
import { PortalWorkspaceLoading } from "./PortalWorkspaceLoading";
import { publicLeadQuoteNavigationTarget } from "@/lib/public-lead-quote-workflow.mjs";
import { MFA_SETUP_URL, isMfaRequiredResponse } from "@/lib/firebase-mfa";

const InstallerPlatformQuote = dynamic(() => import("./InstallerPlatformQuote").then(module => module.InstallerPlatformQuote), {
  loading: ({ error, retry }) => <PortalWorkspaceLoading message="Opening quote..." error={error} retry={retry} />,
});

type LeadsResponse = { ok?: boolean; error?: string; permissions?: { canViewLeads: boolean; canManageLeads: boolean }; opportunities?: TradeLeadOpportunity[]; quoteWorkflow?: unknown; warning?: string };

export function teamLeadActions(permissions: TradeTeamPermissions, lead: TradeLeadOpportunity) {
  const manage = Boolean(permissions.canViewLeads && permissions.canManageLeads);
  const prepareQuote = manage && permissions.jobScope === "team" && permissions.canCreateJobs && permissions.canViewQuotes && permissions.canManageQuotes;
  return {
    interested: manage && ["offered", "viewed"].includes(lead.matchStatus) && (lead.platformOnly || prepareQuote),
    remove: manage && (["offered", "viewed", "interested"].includes(lead.matchStatus) || (!lead.platformOnly && lead.matchStatus === "connected")),
    publicQuote: prepareQuote && !lead.platformOnly && ["interested", "connected"].includes(lead.matchStatus),
    platformQuote: manage && permissions.canViewQuotes && permissions.canManageQuotes && permissions.canSendQuotes && lead.platformOnly && ["interested", "connected"].includes(lead.matchStatus),
  };
}

export function TradeTeamLeadsWorkspace({ user, permissions, onOpenJob }: {
  user: User; permissions: TradeTeamPermissions; onOpenJob: (workOrderId: string, tab: "summary" | "quote") => void;
}) {
  const business = useTradeBusiness();
  const fetch = useTradeBusinessFetch();
  const [leads, setLeads] = useState<TradeLeadOpportunity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverManage, setServerManage] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [search, setSearch] = useState("");
  const [leadStatus, setLeadStatus] = useState("");
  const [service, setService] = useState("");
  const [state, setState] = useState("");
  const requests = useRef(new Set<AbortController>());
  const mounted = useRef(false);
  const listRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    const pending = requests.current;
    return () => { mounted.current = false; for (const controller of pending) controller.abort(); pending.clear(); listRequest.current = null; };
  }, []);

  const refresh = useCallback(async () => {
    if (!permissions.canViewLeads || listRequest.current) return;
    const controller = new AbortController();
    listRequest.current = controller; requests.current.add(controller);
    try {
      const token = await user.getIdToken();
      if (controller.signal.aborted) return;
      setLoading(true); setError("");
      const response = await fetch("/api/trade-opportunities", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      const result: LeadsResponse = await response.json();
      if (controller.signal.aborted || !mounted.current) return;
      if (isMfaRequiredResponse(result)) setMfaRequired(true);
      if (!response.ok || !result.ok || !result.permissions?.canViewLeads || !Array.isArray(result.opportunities)) {
        if (response.status === 401 || response.status === 403 || result.permissions?.canViewLeads === false) { setLeads([]); setServerManage(false); }
        throw new Error(result.error || "Leads could not be loaded. Try again.");
      }
      setLeads(result.opportunities); setServerManage(Boolean(result.permissions.canManageLeads)); setLoaded(true);
    } catch (requestError) {
      if (!controller.signal.aborted && mounted.current) setError(requestError instanceof Error ? requestError.message : "Leads could not be loaded. Try again.");
    } finally {
      requests.current.delete(controller);
      if (listRequest.current === controller) listRequest.current = null;
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }, [fetch, permissions.canViewLeads, user]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [refresh]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter(item => (!leadStatus || item.matchStatus === leadStatus) && (!state || item.state === state)
      && (!service || (item.matchedCategories.length ? item.matchedCategories : item.serviceCategories).includes(service))
      && (!term || `${item.title} ${item.summary} ${item.projectType} ${item.suburb} ${item.postcode} ${item.state} ${item.customerContact?.name || ""} ${item.customerContact?.email || ""} ${item.customerContact?.phone || ""}`.toLowerCase().includes(term)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.matchedAt.localeCompare(left.matchedAt) || left.matchId.localeCompare(right.matchId));
  }, [leads, leadStatus, search, service, state]);
  const selected = visible.find(item => item.matchId === selectedMatchId) || visible[0] || null;
  const effectivePermissions = { ...permissions, canManageLeads: permissions.canManageLeads && serverManage };
  const actions = selected ? teamLeadActions(effectivePermissions, selected) : null;

  async function respond(lead: TradeLeadOpportunity, action: "interested" | "declined" | "open_public_quote") {
    if (busy || !effectivePermissions.canManageLeads) return;
    const allowed = teamLeadActions(effectivePermissions, lead);
    if ((action === "interested" && !allowed.interested) || (action === "declined" && !allowed.remove) || (action === "open_public_quote" && !allowed.publicQuote)) return;
    if (action === "declined" && !window.confirm(lead.platformOnly && lead.matchStatus === "interested"
      ? "Remove this lead and withdraw its unaccepted quote? This does not remove it for other matched trades."
      : "Remove this lead from your business? Saved customers, jobs and quotes remain available. This does not remove it for other matched trades.")) return;
    const controller = new AbortController(); requests.current.add(controller);
    setBusy(lead.matchId); setStatus("");
    try {
      const token = await user.getIdToken();
      if (controller.signal.aborted) return;
      const response = await fetch("/api/trade-opportunities", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(action === "open_public_quote" ? { action, matchId: lead.matchId } : { status: action, matchId: lead.matchId }), signal: controller.signal });
      const result: LeadsResponse = await response.json();
      if (controller.signal.aborted || !mounted.current) return;
      if (isMfaRequiredResponse(result)) setMfaRequired(true);
      if (!response.ok || !result.ok) { if (response.status === 403) setServerManage(false); throw new Error(result.error || "The lead could not be updated."); }
      const target = publicLeadQuoteNavigationTarget(result.quoteWorkflow);
      if (action === "open_public_quote" || (action === "interested" && !lead.platformOnly)) {
        if (!target) throw new Error("Your interest was saved, but the editable quote could not be opened. Refresh leads and choose Continue quote to try again.");
        onOpenJob(target.id, "quote"); return;
      }
      setLeads(current => action === "declined" ? current.filter(item => item.matchId !== lead.matchId)
        : current.map(item => item.matchId === lead.matchId ? { ...item, matchStatus: "interested" } : item));
      setStatus(action === "declined" ? "Lead removed from this business." : result.warning || "Interest recorded. You can now respond to this project.");
    } catch (requestError) {
      if (!controller.signal.aborted && mounted.current) { setStatus(requestError instanceof Error ? requestError.message : "The lead could not be updated."); void refresh(); }
    } finally { requests.current.delete(controller); if (!controller.signal.aborted && mounted.current) setBusy(""); }
  }

  async function openEvidence(file: TradeLeadOpportunity["evidence"][number]) {
    if (busy || !permissions.canViewLeads) return;
    const evidenceUrl = new URL(file.downloadHref, window.location.origin);
    if (evidenceUrl.origin !== window.location.origin || !["/api/customer-project-evidence", "/api/public-plan-quote-preparation"].some(path => evidenceUrl.pathname === path)) { setStatus("This file link is not available. Refresh the lead and try again."); return; }
    const controller = new AbortController(); requests.current.add(controller); setBusy(file.id); setStatus("");
    try {
      const token = await user.getIdToken(); if (controller.signal.aborted) return;
      const response = await fetch(`${evidenceUrl.pathname}${evidenceUrl.search}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("The customer file could not be opened. Check your access and try again.");
      const blob = await response.blob(); if (controller.signal.aborted || !mounted.current) return;
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = file.fileName; link.click(); URL.revokeObjectURL(url);
    } catch (requestError) { if (!controller.signal.aborted && mounted.current) setStatus(requestError instanceof Error ? requestError.message : "The customer file could not be opened."); }
    finally { requests.current.delete(controller); if (!controller.signal.aborted && mounted.current) setBusy(""); }
  }

  if (!permissions.canViewLeads) return <section className="dashboard-state-card"><p role="alert">Your business owner needs to give you View business leads access.</p></section>;
  return <section id="opportunity-inbox" className="dashboard-panel dashboard-opportunities" aria-labelledby="team-leads-title">
    <div className="dashboard-panel-heading"><span>Australian Energy Assessments and TLink supplied leads</span><h2 id="team-leads-title">Leads for {business?.businessName || "your business"}</h2><p>Customer details are shown according to what the customer agreed to share.</p><button type="button" disabled={loading || Boolean(busy)} onClick={() => void refresh()}>{loading ? "Refreshing leads..." : "Refresh leads"}</button></div>
    {mfaRequired && <p role="alert">Set up account security to continue. <a href={MFA_SETUP_URL}>Open account security</a></p>}
    {error && <p role="alert">{error}</p>}
    {loading && !loaded && <p role="status">Loading leads...</p>}
    {loaded && leads.length === 0 && !error && <div className="dashboard-empty-state"><strong>No leads assigned yet</strong><p>New enquiries for this business will appear here.</p></div>}
    {leads.length > 0 && <><TradeLeadFilters opportunities={leads} visibleCount={visible.length} search={search} status={leadStatus} service={service} state={state} onSearch={setSearch} onStatus={setLeadStatus} onService={setService} onState={setState} />
      {selected && actions ? <div className="dashboard-lead-workspace"><TradeLeadList opportunities={visible} selectedMatchId={selected.matchId} onSelect={setSelectedMatchId} /><div className="dashboard-opportunity-list dashboard-lead-preview" aria-live="polite"><TradeLeadReadOnlyDetails opportunity={selected} onOpenEvidence={file => void openEvidence(file)} busy={Boolean(busy)}>
        {actions.platformQuote && <InstallerPlatformQuote key={selected.matchId} matchId={selected.matchId} initialQuote={selected.quote} onStatus={setStatus} />}
        <div className="dashboard-opportunity-actions dashboard-lead-preview-actions">
          {actions.interested && <button type="button" disabled={Boolean(busy)} onClick={() => void respond(selected, "interested")}>{selected.platformOnly ? "Interested" : "Prepare quote"}</button>}
          {actions.publicQuote && <button type="button" disabled={Boolean(busy)} onClick={() => void respond(selected, "open_public_quote")}>Continue quote</button>}
          {actions.remove && <button type="button" disabled={Boolean(busy)} onClick={() => void respond(selected, "declined")}>Remove lead</button>}
        </div>
        {!effectivePermissions.canManageLeads && <p>You have view access. Your business owner can enable lead responses in Team access.</p>}
        {effectivePermissions.canManageLeads && !selected.platformOnly && !(effectivePermissions.jobScope === "team" && effectivePermissions.canCreateJobs && effectivePermissions.canViewQuotes && effectivePermissions.canManageQuotes) && <p>Preparing a quote also needs all team jobs, Create jobs and quote editing access.</p>}
      </TradeLeadReadOnlyDetails></div></div> : <div className="dashboard-empty-state"><strong>No leads match these filters</strong><p>Clear a filter to see the full list.</p></div>}
    </>}
    {status && <p className="dashboard-settings-status" role="status">{status}</p>}
  </section>;
}
