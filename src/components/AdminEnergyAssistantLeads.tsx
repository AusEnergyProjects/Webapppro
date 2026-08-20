"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type QuoteAnswer = { questionId: string; label: string; answer: string };
type QuoteFact = { kind: string; value: string };
type QuoteConstraint = { kind: string; detail: string };
type QuoteBrief = {
  propertyType?: string;
  tenure?: string;
  budgetRange?: string;
  contactPreference?: string;
  bestContactTime?: string;
  answers?: QuoteAnswer[];
  knownFacts?: QuoteFact[];
  siteConstraints?: QuoteConstraint[];
  explicitUnknowns?: string[];
  additionalContext?: string;
  readiness?: {
    state?: string;
    requiredQuestionIds?: string[];
    capturedQuestionIds?: string[];
    capturedUnknownQuestionIds?: string[];
    knownQuestionIds?: string[];
    missingQuestionIds?: string[];
    insufficientKnownServiceIds?: string[];
  };
};
type LeadEvent = {
  id: string;
  actorType: string;
  actorName?: string;
  action: string;
  note: string;
  createdAt: string;
};

type LeadSummary = {
  id: string;
  name: string;
  email: string;
  phone: string;
  postcode: string;
  suburb: string;
  state: string;
  services: string[];
  quoteBrief: QuoteBrief;
  marketingConsent: boolean;
  tradeSharing: {
    accepted: boolean;
    disclosedFields: string[];
    snapshotSha256: string;
    grantedAt: string;
  };
  opportunityId: string;
  status: string;
  assignedToUid: string;
  assigneeName: string;
  dueAt: string;
  latestNote: string;
  createdAt: string;
  updatedAt: string;
  events?: LeadEvent[];
};

type ApiResult = { leads?: LeadSummary[]; lead?: LeadSummary } & Record<string, unknown>;
type Api = (path: string, init?: RequestInit) => Promise<ApiResult>;

const STATUS_OPTIONS = [
  ["acknowledged", "Acknowledged"],
  ["contacting", "Contacting"],
  ["quote_ready", "Quote ready"],
  ["resolved", "Resolved"],
  ["withdrawn", "Withdrawn"],
] as const;

function readable(value: unknown) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime())
    ? "Not set"
    : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function AdminEnergyAssistantLeads({
  api,
  target,
  setStatus,
}: {
  api: Api;
  target: { id: string; nonce: number } | null;
  setStatus: (message: string) => void;
}) {
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [selected, setSelected] = useState<LeadSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [dueDraft, setDueDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set("search", search.trim());
      if (statusFilter) query.set("status", statusFilter);
      if (assignmentFilter) query.set("assignment", assignmentFilter);
      const result = await api(`/api/admin/energy-assistant-leads?${query}`);
      setLeads((result.leads || []) as LeadSummary[]);
    } finally {
      setLoading(false);
    }
  }, [api, assignmentFilter, search, statusFilter]);

  const openLead = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const result = await api(`/api/admin/energy-assistant-leads?id=${encodeURIComponent(id)}`);
      const lead = result.lead as LeadSummary;
      setSelected(lead);
      setStatusDraft("");
      setDueDraft(localDateTime(lead.dueAt));
      setNoteDraft("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The follow-up request could not be opened.");
    } finally {
      setBusy(false);
    }
  }, [api, setStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(), 180);
    return () => window.clearTimeout(timer);
  }, [loadList]);

  useEffect(() => {
    if (!target?.id) return undefined;
    const timer = window.setTimeout(() => void openLead(target.id), 0);
    return () => window.clearTimeout(timer);
  }, [openLead, target]);

  const openCount = useMemo(
    () => leads.filter((lead) => !["resolved", "withdrawn"].includes(lead.status)).length,
    [leads],
  );

  async function patchLead(body: Record<string, unknown>, success: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await api("/api/admin/energy-assistant-leads", {
        method: "PATCH",
        body: JSON.stringify({ id: selected.id, ...body }),
      });
      setSelected(result.lead as LeadSummary);
      setStatusDraft("");
      setNoteDraft("");
      await loadList();
      setStatus(success);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The follow-up request could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkflow(event: FormEvent) {
    event.preventDefault();
    await patchLead({
      ...(statusDraft ? { status: statusDraft } : {}),
      dueAt: dueDraft ? new Date(dueDraft).toISOString() : "",
      ...(noteDraft.trim() ? { note: noteDraft.trim() } : {}),
    }, "The Energy Guide follow-up workflow was updated and audited.");
  }

  const quoteBrief = selected?.quoteBrief || {};
  const answers = Array.isArray(quoteBrief.answers) ? quoteBrief.answers : [];
  const knownFacts = Array.isArray(quoteBrief.knownFacts) ? quoteBrief.knownFacts : [];
  const constraints = Array.isArray(quoteBrief.siteConstraints) ? quoteBrief.siteConstraints : [];
  const unknowns = Array.isArray(quoteBrief.explicitUnknowns) ? quoteBrief.explicitUnknowns : [];
  const readiness = quoteBrief.readiness || {};
  const missingQuestions = Array.isArray(readiness.missingQuestionIds) ? readiness.missingQuestionIds : [];
  const insufficientServices = Array.isArray(readiness.insufficientKnownServiceIds)
    ? readiness.insufficientKnownServiceIds
    : [];
  const readinessIssues = [
    missingQuestions.length ? `Unanswered items: ${missingQuestions.map(readable).join(", ")}.` : "",
    insufficientServices.length
      ? `More known property details are needed for: ${insufficientServices.map(readable).join(", ")}.`
      : "",
  ].filter(Boolean).join(" ");
  const isQuoteReady = readiness.state === "quote_ready"
    && missingQuestions.length === 0
    && insufficientServices.length === 0;

  return (
    <section className="admin-panel" aria-labelledby="energy-guide-follow-ups-title">
      <div className="admin-panel-heading">
        <span>Optional human follow-up</span>
        <h1 id="energy-guide-follow-ups-title">Energy Guide follow-up requests</h1>
        <p>
          These records exist only when a visitor explicitly asks AEA to follow up.
          Information and advice remain available without submitting contact details.
        </p>
      </div>

      <div className="admin-metric-grid">
        <article><span>In this view</span><strong>{leads.length}</strong><small>Maximum 200 recent requests</small></article>
        <article><span>Still active</span><strong>{openCount}</strong><small>Not resolved or withdrawn</small></article>
        <article><span>Trade consent</span><strong>{leads.filter((lead) => lead.tradeSharing.accepted).length}</strong><small>Accepted separately; readiness still controls release</small></article>
      </div>

      <form className="admin-filter-bar" onSubmit={(event) => { event.preventDefault(); void loadList(); }}>
        <label>
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, phone, suburb or postcode" />
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            {["new", "needs_information", "acknowledged", "contacting", "quote_ready", "shared_with_trades", "resolved", "withdrawn"].map((value) => (
              <option value={value} key={value}>{readable(value)}</option>
            ))}
          </select>
        </label>
        <label>
          Assignment
          <select value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)}>
            <option value="">All</option>
            <option value="unassigned">Unassigned</option>
            <option value="assigned">Assigned</option>
          </select>
        </label>
        <button type="submit" disabled={loading}>Refresh</button>
      </form>

      <div className="admin-overview-grid">
        <div className="admin-queue-list" aria-busy={loading}>
          {loading ? <p>Loading follow-up requests...</p> : leads.length ? leads.map((lead) => (
            <button type="button" key={lead.id} onClick={() => void openLead(lead.id)}>
              <strong>{lead.name}</strong>
              <span>{lead.suburb} {lead.postcode}, {lead.state} | {lead.services.map(readable).join(", ")}</span>
              <small>{readable(lead.status)} | {lead.assigneeName || "Unassigned"} | {dateTime(lead.createdAt)}</small>
            </button>
          )) : <p>No explicit Energy Guide follow-up requests match this view.</p>}
        </div>

        {selected ? (
          <article className="admin-panel" aria-busy={busy}>
            <div className="admin-panel-heading">
              <span>{readable(selected.status)}</span>
              <h2>{selected.name}</h2>
              <p>{selected.email || "No email"} | {selected.phone || "No phone"}<br />{selected.suburb} {selected.postcode}, {selected.state}</p>
            </div>

            <dl>
              <dt>Requested services</dt><dd>{selected.services.map(readable).join(", ")}</dd>
              <dt>Structured quote readiness</dt>
              <dd>
                {isQuoteReady
                  ? "Ready for desktop quote triage, including any items explicitly marked not sure."
                  : `Needs information. ${readinessIssues || "Readiness details are unavailable."}`}
              </dd>
              <dt>Property and relationship</dt><dd>{readable(quoteBrief.propertyType)} | {readable(quoteBrief.tenure)}</dd>
              <dt>Budget</dt><dd>{readable(quoteBrief.budgetRange)}</dd>
              <dt>Contact preference</dt><dd>{readable(quoteBrief.contactPreference)} | {readable(quoteBrief.bestContactTime)}</dd>
              <dt>AEA updates</dt><dd>{selected.marketingConsent ? "Opted in separately" : "Not requested"}</dd>
              <dt>Trade sharing</dt>
              <dd>
                {selected.tradeSharing.accepted
                  ? selected.opportunityId
                    ? `Explicitly accepted and released at ${dateTime(selected.tradeSharing.grantedAt)}. Snapshot ${selected.tradeSharing.snapshotSha256}.`
                    : `Explicitly accepted at ${dateTime(selected.tradeSharing.grantedAt)}, but held by AEA because the brief needs information. No trade visibility exists. Snapshot ${selected.tradeSharing.snapshotSha256}.`
                  : "Not requested. This record is visible to AEA operations only."}
              </dd>
              <dt>Trade opportunity</dt><dd>{selected.opportunityId || "None. No trade record was created."}</dd>
            </dl>

            {answers.length > 0 && <section><h3>Quote answers</h3><ul>{answers.map((item) => <li key={item.questionId}><strong>{item.label}:</strong> {item.answer}</li>)}</ul></section>}
            {knownFacts.length > 0 && <section><h3>Known facts</h3><ul>{knownFacts.map((item, index) => <li key={`${item.kind}-${index}`}><strong>{readable(item.kind)}:</strong> {item.value}</li>)}</ul></section>}
            {constraints.length > 0 && <section><h3>Site constraints</h3><ul>{constraints.map((item, index) => <li key={`${item.kind}-${index}`}><strong>{readable(item.kind)}:</strong> {item.detail}</li>)}</ul></section>}
            {unknowns.length > 0 && <section><h3>Explicit unknowns</h3><p>{unknowns.map(readable).join(", ")}</p></section>}
            {quoteBrief.additionalContext && <section><h3>Additional quote context</h3><p>{quoteBrief.additionalContext}</p></section>}

            <div className="admin-action-row">
              <button type="button" disabled={busy} onClick={() => void patchLead({ assignedToUid: "self" }, "The follow-up request is assigned to you.")}>Assign to me</button>
              {selected.assignedToUid && <button type="button" disabled={busy} onClick={() => void patchLead({ assignedToUid: "" }, "The follow-up request is unassigned.")}>Unassign</button>}
              {selected.opportunityId && <button type="button" onClick={() => setStatus(`Open opportunity ${selected.opportunityId} from the Leads workspace.`)}>Copy opportunity reference</button>}
            </div>

            <form onSubmit={saveWorkflow} className="admin-auth-form">
              <label>
                Workflow status
                <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)}>
                  <option value="">Keep current status ({readable(selected.status)})</option>
                  {STATUS_OPTIONS.map(([value, label]) => (
                    <option
                      value={value}
                      key={value}
                      disabled={value === "quote_ready" && !isQuoteReady}
                    >
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Response due
                <input type="datetime-local" value={dueDraft} onChange={(event) => setDueDraft(event.target.value)} />
              </label>
              <label>
                Audited note
                <textarea rows={4} maxLength={1000} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Record contact attempts, decisions or next actions." />
              </label>
              <button type="submit" disabled={busy}>{busy ? "Saving..." : "Save workflow update"}</button>
            </form>

            <section>
              <h3>Audit history</h3>
              <div className="admin-audit-list">
                {(selected.events || []).map((event) => (
                  <article key={String(event.id)}>
                    <strong>{readable(event.action)}</strong>
                    <span>{event.note || "Structured workflow change"}</span>
                    <small>{event.actorName || readable(event.actorType)} | {dateTime(event.createdAt)}</small>
                  </article>
                ))}
              </div>
            </section>
          </article>
        ) : (
          <article className="admin-panel"><h2>Open a follow-up request</h2><p>The full quote brief, consent boundary and immutable audit history will appear here.</p></article>
        )}
      </div>
    </section>
  );
}
