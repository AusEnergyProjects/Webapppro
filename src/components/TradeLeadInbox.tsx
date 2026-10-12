"use client";

import { enquiryCompletionLabel } from "@/lib/enquiry-timing.mjs";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import type { ReactNode } from "react";

export type TradeLeadOpportunity = {
  matchId: string;
  matchStatus:
    "offered" | "viewed" | "interested" | "declined" | "connected" | "closed";
  matchedAt: string;
  createdAt: string;
  updatedAt: string;
  id: string;
  title: string;
  projectType: string;
  suburb: string;
  postcode: string;
  state: string;
  serviceCategories: string[];
  matchedCategories: string[];
  distanceBand: string;
  allocationRank: number;
  contactAttemptCount: number;
  contactLimit: number;
  lastContactAt: string;
  connectedAt: string;
  expiresAt: string;
  priority: string;
  timing: string;
  requestedWorkBy: string;
  requestedCompletion: string;
  customerSector: string;
  summary: string;
  propertyContext: Record<string, string | string[]>;
  enquiryPack: null | {
    version: string;
    planTitle: string;
    summary: string;
    goals: string[];
    planBoundary: {
      pace: string;
      budget: string;
    };
    homeContext: {
      propertyType: string;
      tenure: string;
      state: string;
      approval: string;
      details: string[];
      consideredWork: string[];
    };
    readiness: {
      answered: number;
      total: number;
      notSure: number;
      missing: number;
      message: string;
      boundary: string;
    };
    actionCount: number;
    privacyNote: string;
    adviceBoundary: string;
  };
  quotePreparation: null | {
    answers: Array<{
      questionId: string;
      label: string;
      answer: string;
      services: string[];
    }>;
    expectedPhotoCount: number;
    availablePhotoCount: number;
  };
  approvedSharedFileCount: number;
  opportunityStatus: string;
  platformOnly: boolean;
  customerContact: null | {
    name: string;
    email: string;
    phone: string;
    addressLine1: string;
    addressLine2: string;
    suburb: string;
    addressState: string;
    postcode: string;
    grantedAt: string;
    message: string;
    releaseScope: "shortlisted_installer" | "all_qualified_trades" | "aea_only";
    redactedFields?: Array<"name" | "phone" | "email">;
  };
  evidence: Array<{
    id: string;
    category: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
    sharingScope: "allocated-installers";
    promptLabel: string;
    downloadHref: string;
  }>;
  arrivalProposal: null | {
    id: string;
    status: "proposed" | "selected" | "direct_contact" | "withdrawn";
    windows: Array<{ id: string; startsAt: string; endsAt: string }>;
    installerNote: string;
    selectedWindow: null | { id: string; startsAt: string; endsAt: string };
    revision: number;
    proposedAt: string;
    selectedAt: string;
    crmWorkOrderId: string;
    crmAppointmentId: string;
    preparationAcknowledgedAt: string;
  };
  quote: null | {
    productListId: string;
    inclusions: string[];
    productSubtotalCentsExGst: number;
    labourCentsExGst: number;
    otherCentsExGst: number;
    totalCentsExGst: number;
    quoteType: string;
    startWindow: string;
    durationWeeks: number;
    workmanshipWarrantyYears: number;
    status: string;
    customerDecision: string;
  };
};

const serviceLabels: Record<string, string> = { ...ENERGY_SERVICE_LABELS,
  "mounting-hardware": "Mounting and hardware", controls: "Energy controls" };

export function tradeLeadContactIsRedacted(contact: TradeLeadOpportunity["customerContact"], field: "name" | "phone" | "email") {
  return !contact || !contact[field].trim() || Boolean(contact.redactedFields?.includes(field));
}

export function tradeLeadLocation(lead: TradeLeadOpportunity) {
  const contact = lead.customerContact;
  const locality = [contact?.suburb || lead.suburb, contact?.postcode || lead.postcode].filter(Boolean).join(" ");
  return locality ? `${locality}, ${contact?.addressState || lead.state}` : `${lead.state} region`;
}

export function TradeLeadFilters({ opportunities, visibleCount, search, status, service, state, onSearch, onStatus, onService, onState }: {
  opportunities: TradeLeadOpportunity[]; visibleCount: number; search: string; status: string; service: string; state: string;
  onSearch: (value: string) => void; onStatus: (value: string) => void; onService: (value: string) => void; onState: (value: string) => void;
}) {
  return <div className="dashboard-lead-filters" aria-label="Lead filters">
    <label><span>Search</span><input aria-label="Search leads" placeholder="Customer, scope, service or region" value={search} onChange={event => onSearch(event.target.value)} /></label>
    <label><span>Status</span><select value={status} onChange={event => onStatus(event.target.value)}><option value="">All statuses</option>{["offered", "viewed", "interested", "connected"].map(value => <option key={value} value={value}>{value === "offered" ? "New" : value.replaceAll("_", " ")}</option>)}</select></label>
    <label><span>Service</span><select value={service} onChange={event => onService(event.target.value)}><option value="">All services</option>{Object.entries(serviceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label><span>State</span><select value={state} onChange={event => onState(event.target.value)}><option value="">All states</option>{[...new Set(opportunities.map(item => item.state))].sort().map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    <div><strong>{visibleCount}</strong><span>matching lead{visibleCount === 1 ? "" : "s"}</span><span>Newest first</span>{(search || status || service || state) && <button type="button" onClick={() => { onSearch(""); onStatus(""); onService(""); onState(""); }}>Clear</button>}</div>
  </div>;
}

export function TradeLeadList({ opportunities, selectedMatchId, onSelect }: {
  opportunities: TradeLeadOpportunity[]; selectedMatchId: string; onSelect: (matchId: string) => void;
}) {
  return <nav className="dashboard-lead-list" aria-label="Available leads">
    {opportunities.map(opportunity => {
      const selected = selectedMatchId === opportunity.matchId;
      const customerName = (!tradeLeadContactIsRedacted(opportunity.customerContact, "name") ? opportunity.customerContact?.name.trim() : "") || opportunity.title || "Customer enquiry";
      return <button key={opportunity.matchId} type="button" className={selected ? "active" : ""} aria-current={selected ? "true" : undefined} aria-controls={`opportunity-${opportunity.matchId}`} onClick={() => onSelect(opportunity.matchId)}>
        <span>{opportunity.platformOnly ? "Australian Energy Assessments protected lead" : "Australian Energy Assessments supplied lead"} | {opportunity.matchStatus === "offered" ? "New" : !opportunity.platformOnly && opportunity.matchStatus === "interested" ? "Customer added" : opportunity.matchStatus.replaceAll("_", " ")}</span>
        <strong>{customerName}</strong><small><time dateTime={opportunity.createdAt}>Enquired {new Date(opportunity.createdAt).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</time></small>
        <p>{opportunity.enquiryPack?.summary || opportunity.summary}</p><small>{tradeLeadLocation(opportunity)} | {enquiryCompletionLabel(opportunity.requestedWorkBy, opportunity.requestedCompletion)}</small>
      </button>;
    })}
  </nav>;
}

export function TradeLeadReadOnlyDetails({ opportunity, children, onOpenEvidence, busy }: {
  opportunity: TradeLeadOpportunity; children?: ReactNode; onOpenEvidence: (evidence: TradeLeadOpportunity["evidence"][number]) => void; busy: boolean;
}) {
  const contact = opportunity.customerContact;
  const name = !tradeLeadContactIsRedacted(contact, "name") ? contact?.name : opportunity.title || "Customer enquiry";
  const services = opportunity.matchedCategories.length ? opportunity.matchedCategories : opportunity.serviceCategories;
  return <article id={`opportunity-${opportunity.matchId}`} className="dashboard-opportunity-card" aria-labelledby={`lead-heading-${opportunity.matchId}`}>
    <header><h3 id={`lead-heading-${opportunity.matchId}`}>{name}</h3><p>{tradeLeadLocation(opportunity)} | {opportunity.matchStatus === "offered" ? "New" : opportunity.matchStatus.replaceAll("_", " ")}</p></header>
    <div className="dashboard-opportunity-compact-summary"><p>{opportunity.enquiryPack?.summary || opportunity.summary}</p><dl>
      <div><dt>Work</dt><dd>{services.map(value => serviceLabels[value] || value).join(", ")}</dd></div>
      <div><dt>When</dt><dd>{enquiryCompletionLabel(opportunity.requestedWorkBy, opportunity.requestedCompletion)}</dd></div>
      <div><dt>Files shared</dt><dd>{opportunity.approvedSharedFileCount}</dd></div>
    </dl></div>
    <section className="dashboard-connected-customer-contact" aria-label="Customer details"><h4>Customer details</h4>{contact ? <dl className="dashboard-connected-customer-contact-grid">
      {(["name", "email", "phone"] as const).map(field => <div key={field}><dt>{field === "name" ? "Name" : field === "email" ? "Email" : "Phone"}</dt><dd>{tradeLeadContactIsRedacted(contact, field) ? "Redacted by the customer" : field === "email" ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : field === "phone" ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : contact.name}</dd></div>)}
      <div><dt>Address</dt><dd>{[contact.addressLine1, contact.addressLine2, contact.suburb, contact.addressState, contact.postcode].filter(Boolean).join(", ") || "Not released by the customer"}</dd></div>
    </dl> : <p>Contact details stay protected until the customer chooses this business.</p>}</section>
    {opportunity.enquiryPack && <section aria-label="Customer project"><h4>The customer&apos;s project</h4><p>{opportunity.enquiryPack.planTitle}</p>{opportunity.enquiryPack.goals.length > 0 && <ul>{opportunity.enquiryPack.goals.map(goal => <li key={goal}>{goal}</li>)}</ul>}<p>{opportunity.enquiryPack.homeContext.details.join(". ")}</p><p>{opportunity.enquiryPack.readiness.message}</p></section>}
    {opportunity.quotePreparation && opportunity.quotePreparation.answers.length > 0 && <section aria-label="Customer answers"><h4>Customer answers</h4><dl>{opportunity.quotePreparation.answers.map(answer => <div key={answer.questionId}><dt>{answer.label}</dt><dd>{answer.answer}</dd></div>)}</dl></section>}
    {opportunity.evidence.length > 0 && <section aria-label="Customer files"><h4>Customer files</h4>{opportunity.evidence.map(file => <button type="button" key={file.id} disabled={busy} onClick={() => onOpenEvidence(file)}>{file.promptLabel || file.fileName}</button>)}</section>}
    {children}
  </article>;
}
