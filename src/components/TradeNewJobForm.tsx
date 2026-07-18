"use client";

import type { User } from "firebase/auth";
import { FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { SearchableLookup, type SearchableLookupOption } from "./SearchableLookup";
import { defaultPhotoRequirements, type PhotoRequirement } from "@/lib/trade-photo-requests";

type Template = { id: string; name: string; title: string; serviceCategory: string; priority: string; description: string; taskTitles: string[] };
type Customer = { id: string; customerNumber: string; displayName: string; email: string; phone: string; suburb: string; postcode: string };
type Site = { id: string; siteLabel: string; addressLine1: string; suburb: string; addressState: string; postcode: string; isPrimary: boolean };
type TeamMember = { id: string; displayName: string; role: string; status: string; isOwner: boolean };
type DuplicateCandidate = { customerId: string; customerNumber: string; displayName: string; serviceSiteId: string; siteLabel: string; reasons: string[] };
type AddressSuggestion = { id: string; label: string; addressLine1: string; addressLine2: string; suburb: string; addressState: string; postcode: string };

const serviceLabels: Record<string, string> = { assessment: "Energy assessment", solar: "Rooftop solar", battery: "Home batteries", "heating-cooling": "Heating and cooling", "hot-water": "Hot water", "insulation-draughts": "Insulation and draught control", "ev-charging": "EV charging", electrical: "Electrical services", plumbing: "Plumbing services", "mounting-hardware": "Mounting and hardware", controls: "Energy controls", other: "Other work" };
const appointmentLabels: Record<string, string> = { phone_call: "Phone call", site_visit: "Site visit", quote_review: "Quote review", installation: "Installation", service: "Service visit", admin: "Office task" };
const buildingTypes = [["house_townhouse", "House or townhouse"], ["apartment_unit", "Apartment or unit"], ["commercial_office", "Commercial or office"], ["retail_hospitality", "Retail or hospitality"], ["industrial_warehouse", "Industrial or warehouse"], ["institutional_community_health", "Institutional, community or health"], ["other", "Other"], ["not_sure", "Not sure"]];
const steps = ["Job", "Customer", "Appointment", "Time", "Evidence"];

function localMinimumStart() {
  const date = new Date(Date.now() + 15 * 60 * 1000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function AddressFields({ user }: { user: User }) {
  const id = useId();
  const [value, setValue] = useState({ addressLine1: "", addressLine2: "", suburb: "", addressState: "", postcode: "" });
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [providerMessage, setProviderMessage] = useState("");

  useEffect(() => {
    if (value.addressLine1.trim().length < 3) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void user.getIdToken().then((token) => fetch(`/api/trade-address-suggestions?query=${encodeURIComponent(value.addressLine1)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      })).then(async (response) => {
        const result = await response.json() as { configured?: boolean; suggestions?: AddressSuggestion[]; error?: string };
        if (!response.ok && !result.error) throw new Error("Address search failed");
        if (active) {
          setConfigured(Boolean(result.configured)); setProviderMessage(result.error || "");
          setSuggestions(result.suggestions || []); setActiveIndex(0);
        }
      }).catch(() => {
        if (active) { setProviderMessage("Address suggestions are temporarily unavailable. Enter the address manually."); setSuggestions([]); }
      });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [user, value.addressLine1]);

  function choose(item: AddressSuggestion) {
    setValue({ addressLine1: item.addressLine1, addressLine2: item.addressLine2, suburb: item.suburb, addressState: item.addressState, postcode: item.postcode });
    setSuggestions([]);
  }

  return <div className="crm-address-fields wide">
    <label className="wide"><span>Street address</span><input name="addressLine1" required maxLength={140} autoComplete="street-address" value={value.addressLine1} placeholder="Start typing an Australian address" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls={`${id}-addresses`} aria-activedescendant={suggestions[activeIndex] ? `${id}-address-${activeIndex}` : undefined} onChange={(event) => { const next = event.target.value; setValue((current) => ({ ...current, addressLine1: next })); setProviderMessage(""); if (next.trim().length < 3) setSuggestions([]); }} onKeyDown={(event) => { if (event.key === "Escape") setSuggestions([]); if (!suggestions.length) return; if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); } if (event.key === "Enter") { event.preventDefault(); choose(suggestions[activeIndex]); } }} />
      {suggestions.length > 0 && <div id={`${id}-addresses`} className="crm-address-options" role="listbox">{suggestions.map((item, index) => <button type="button" role="option" aria-selected={activeIndex === index} id={`${id}-address-${index}`} key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>{item.label}</button>)}</div>}
      <small>{providerMessage || (configured === false ? "Address search is not configured yet. You can still enter the address manually." : "Choose a suggestion to fill the suburb, state and postcode.")}</small>
    </label>
    <label className="wide"><span>Unit, level or building, optional</span><input name="addressLine2" maxLength={140} value={value.addressLine2} onChange={(event) => setValue((current) => ({ ...current, addressLine2: event.target.value }))} /></label>
    <label><span>Suburb</span><input name="suburb" required maxLength={80} autoComplete="address-level2" value={value.suburb} onChange={(event) => setValue((current) => ({ ...current, suburb: event.target.value }))} /></label>
    <label><span>State</span><select name="addressState" required autoComplete="address-level1" value={value.addressState} onChange={(event) => setValue((current) => ({ ...current, addressState: event.target.value }))}><option value="">Select state</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((state) => <option key={state}>{state}</option>)}</select></label>
    <label><span>Postcode</span><input name="postcode" required inputMode="numeric" autoComplete="postal-code" maxLength={4} pattern="[0-9]{4}" value={value.postcode} onChange={(event) => setValue((current) => ({ ...current, postcode: event.target.value.replace(/\D/g, "").slice(0, 4) }))} /></label>
  </div>;
}

export function TradeNewJobForm({ user, templates, teamMembers, busy, onSubmit }: { user: User; templates: Template[]; teamMembers: TeamMember[]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [message, setMessage] = useState("");
  const [templateId, setTemplateId] = useState("");
  const template = templates.find((item) => item.id === templateId);
  const [serviceCategory, setServiceCategory] = useState("assessment");
  const [priority, setPriority] = useState("standard");
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [customerType, setCustomerType] = useState("residential");
  const [customerId, setCustomerId] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [serviceSiteId, setServiceSiteId] = useState("");
  const [newSite, setNewSite] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [duplicateReviewed, setDuplicateReviewed] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [appointmentType, setAppointmentType] = useState("site_visit");
  const [assigneeMemberId, setAssigneeMemberId] = useState(teamMembers[0]?.id || "");
  const [duration, setDuration] = useState(60);
  const [selectedRequirementIds, setSelectedRequirementIds] = useState(() => new Set(defaultPhotoRequirements("assessment").map((item) => item.id)));
  const requirements: PhotoRequirement[] = defaultPhotoRequirements(serviceCategory);
  const effectiveAssigneeMemberId = assigneeMemberId || teamMembers[0]?.id || "";

  function changeServiceCategory(value: string) {
    const next = defaultPhotoRequirements(value);
    setServiceCategory(value); setSelectedRequirementIds(new Set(next.map((item) => item.id)));
  }

  const loadCustomers = useCallback(async (query: string, selected: string): Promise<SearchableLookupOption[]> => {
    const token = await user.getIdToken();
    if (selected && !query) {
      const response = await fetch(`/api/trade-crm?mode=detail&resource=customer&id=${encodeURIComponent(selected)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json() as { customer?: Customer }; const customer = result.customer;
      return customer ? [{ id: customer.id, label: customer.displayName, secondary: [customer.customerNumber, customer.phone, customer.suburb, customer.postcode].filter(Boolean).join(" | ") }] : [];
    }
    const response = await fetch(`/api/trade-crm?${new URLSearchParams({ mode: "index", resource: "customers", search: query, pageSize: "25", sort: "name-asc", total: "0" })}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json() as { items?: Customer[] };
    return (result.items || []).map((customer) => ({ id: customer.id, label: customer.displayName, secondary: [customer.customerNumber, customer.phone, customer.suburb, customer.postcode].filter(Boolean).join(" | ") }));
  }, [user]);

  useEffect(() => {
    if (!customerId) return;
    let active = true;
    void user.getIdToken().then((token) => fetch(`/api/trade-crm?mode=detail&resource=customer&id=${encodeURIComponent(customerId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then((response) => response.json()).then((result: { customer?: Customer; sites?: Site[] }) => {
        if (!active) return;
        const next = result.sites || []; setSelectedCustomer(result.customer || null); setSites(next);
        setServiceSiteId((current) => current || next.find((site) => site.isPrimary)?.id || next[0]?.id || ""); setNewSite(!next.length);
      });
    return () => { active = false; };
  }, [customerId, user]);

  function selectCustomer(id: string) {
    setCustomerId(id); setDuplicates([]); setDuplicateReviewed(false);
    if (!id) { setSelectedCustomer(null); setSites([]); setServiceSiteId(""); setNewSite(false); }
  }

  function validateVisibleStep() {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (!panel) return true;
    for (const field of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) {
      if (!field.checkValidity()) { field.reportValidity(); return false; }
    }
    return true;
  }

  async function checkDuplicates() {
    if (customerMode !== "new" || !formRef.current || duplicateReviewed) return [];
    const data = new FormData(formRef.current);
    if (!String(data.get("phone") || "").trim() && !String(data.get("email") || "").trim()) return [];
    setCheckingDuplicates(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-crm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "find_customer_duplicates", ...Object.fromEntries(data) }) });
      const result = await response.json() as { duplicateCandidates?: DuplicateCandidate[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Customer matching is unavailable.");
      const matches = result.duplicateCandidates || []; setDuplicates(matches); return matches;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Customer matching is unavailable."); return []; }
    finally { setCheckingDuplicates(false); }
  }

  async function continueFromCustomer() {
    setMessage("");
    if (customerMode === "existing" && !customerId) { setMessage("Find and select the customer for this job."); return; }
    if (!validateVisibleStep()) return;
    const matches = await checkDuplicates();
    if (matches.length) { setMessage("We found an existing customer. Use the match below or confirm this is a different person."); return; }
    setStep(3);
  }

  function attachDuplicate(candidate: DuplicateCandidate) {
    setCustomerMode("existing"); selectCustomer(candidate.customerId); setServiceSiteId(candidate.serviceSiteId);
    setDuplicates([]); setMessage(`${candidate.displayName} attached. Choose the team member and appointment type.`); setStep(3);
  }

  const selectedRequirements = requirements.filter((item) => selectedRequirementIds.has(item.id));
  const newCustomerName = customerType === "business" ? businessName : `${firstName} ${lastName}`.trim();
  const customerName = selectedCustomer?.displayName || newCustomerName || "Customer";
  const deliveryEmail = selectedCustomer?.email || newCustomerEmail;

  function next(nextStep: number) {
    setMessage(""); if (validateVisibleStep()) setStep(nextStep);
  }

  return <form ref={formRef} className="crm-form crm-new-job crm-job-wizard" onSubmit={(event) => {
    if (!selectedRequirements.length) { event.preventDefault(); setMessage("Choose at least one item for the customer to photograph."); return; }
    onSubmit(event);
  }}>
    <input type="hidden" name="customerMode" value={customerMode} /><input type="hidden" name="crmCustomerId" value={customerId} />
    <input type="hidden" name="duplicateOverride" value={duplicateReviewed ? "true" : "false"} />
    <input type="hidden" name="serviceSiteMode" value={customerMode === "new" || newSite ? "new" : "existing"} /><input type="hidden" name="serviceSiteId" value={newSite ? "" : serviceSiteId} />
    <input type="hidden" name="assigneeMemberId" value={effectiveAssigneeMemberId} /><input type="hidden" name="evidenceRequirements" value={JSON.stringify(selectedRequirements)} />

    <div className="crm-system-id-note"><span>TLink job ID</span><strong>Assigned automatically</strong><small>One global ID is shown to you and TLink support, such as TLJ-00000124.</small></div>
    <ol className="crm-wizard-steps" aria-label="Create and schedule job">{steps.map((label, index) => <li key={label} className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""}><span>{index + 1}</span>{label}</li>)}</ol>
    {message && <div className="crm-wizard-message" role="status">{message}</div>}

    <section data-step="1" hidden={step !== 1} className="crm-wizard-panel"><header><span>1 of 5</span><h3>Create the job</h3><p>Choose the work. The customer name and work type will become the job and appointment title automatically.</p></header>
      {templates.length > 0 && <label className="crm-template-picker"><span>Start from a template, optional</span><select name="templateId" value={templateId} onChange={(event) => { const id = event.target.value; const selected = templates.find((item) => item.id === id); setTemplateId(id); if (selected) { changeServiceCategory(selected.serviceCategory); setPriority(selected.priority); } }}><option value="">Blank job</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{template ? `${template.taskTitles.length} checklist items will be added automatically.` : "Templates keep common scopes and checklists consistent."}</small></label>}
      <div className="crm-form-grid"><label><span>Work type</span><select name="serviceCategory" value={serviceCategory} onChange={(event) => changeServiceCategory(event.target.value)}>{Object.entries(serviceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Building type</span><select name="buildingType" defaultValue="not_sure">{buildingTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Priority</span><select name="priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="standard">Standard</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>
      {template?.description && <input type="hidden" name="description" value={template.description} />}
      <div className="crm-wizard-actions"><button type="button" className="btn" onClick={() => next(2)}>Add customer</button></div>
    </section>

    <section data-step="2" hidden={step !== 2} className="crm-wizard-panel"><header><span>2 of 5</span><h3>Add or attach the customer</h3><p>Search first, or enter a new customer. Matching phone and email details will offer the existing record.</p></header>
      <fieldset className="crm-customer-lookup"><legend>Your customer</legend>{customerMode === "existing" ? <><SearchableLookup label="Find and select a customer" value={customerId} placeholder="Name, number, phone, suburb or postcode" required load={loadCustomers} onChange={selectCustomer} /><button type="button" className="crm-text-action" onClick={() => { setCustomerMode("new"); selectCustomer(""); }}>Create new customer</button></> : <><div className="crm-inline-heading"><strong>New customer</strong><button type="button" onClick={() => setCustomerMode("existing")}>Choose existing instead</button></div><div className="crm-form-grid"><label><span>Customer type</span><select name="customerType" value={customerType} onChange={(event) => setCustomerType(event.target.value)}><option value="residential">Residential</option><option value="business">Business</option></select></label>{customerType === "business" ? <label><span>Business name</span><input name="businessName" required={step === 2} maxLength={140} value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></label> : <><label><span>First name</span><input name="firstName" required={step === 2} maxLength={80} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label><label><span>Last name</span><input name="lastName" maxLength={80} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label></>}<label><span>Mobile, optional</span><input type="tel" name="phone" autoComplete="tel" maxLength={40} onChange={() => { setDuplicates([]); setDuplicateReviewed(false); }} onBlur={() => void checkDuplicates()} /></label><label><span>Email for information request</span><input type="email" name="email" autoComplete="email" required={step === 2} maxLength={180} value={newCustomerEmail} onChange={(event) => { setNewCustomerEmail(event.target.value); setDuplicates([]); setDuplicateReviewed(false); }} onBlur={() => void checkDuplicates()} /></label></div></>}
        <small>AEA protected leads use their authorised workflow and cannot become direct customer records here.</small>
      </fieldset>
      {duplicates.length > 0 && <div className="crm-duplicate-match" role="alert"><strong>Customer already found</strong><p>Use the existing record so the customer and job history stay together.</p>{duplicates.map((candidate) => <div key={candidate.customerId}><span><b>{candidate.displayName}</b><small>{candidate.customerNumber} | matched {candidate.reasons.join(", ")}</small></span><button type="button" onClick={() => attachDuplicate(candidate)}>Use this customer</button></div>)}<button type="button" className="crm-text-action" onClick={() => { setDuplicateReviewed(true); setDuplicates([]); setMessage("Continuing as a different customer."); }}>This is a different customer</button></div>}
      {(customerMode === "new" || customerId) && <fieldset className="crm-service-site"><legend>Job address</legend>{customerMode === "existing" && customerId && !newSite && sites.length > 0 && <label><span>Existing service site</span><select value={serviceSiteId} onChange={(event) => setServiceSiteId(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.siteLabel} | {[site.addressLine1, site.suburb, site.addressState, site.postcode].filter(Boolean).join(", ")}</option>)}</select></label>}{customerMode === "existing" && customerId && <button type="button" className="crm-text-action" onClick={() => setNewSite((value) => !value)}>{newSite ? "Use an existing service site" : "Add a new service site"}</button>}{(customerMode === "new" || newSite) && <div className="crm-form-grid"><label><span>Site name</span><input name="siteLabel" maxLength={100} defaultValue={customerMode === "new" ? "Primary site" : "New service site"} /></label><AddressFields user={user} /></div>}</fieldset>}
      <div className="crm-wizard-actions"><button type="button" onClick={() => setStep(1)}>Back</button><button type="button" className="btn" disabled={checkingDuplicates} onClick={() => void continueFromCustomer()}>{checkingDuplicates ? "Checking customer..." : "Choose appointment"}</button></div>
    </section>

    <section data-step="3" hidden={step !== 3} className="crm-wizard-panel"><header><span>3 of 5</span><h3>Choose who and what</h3><p>Select the team member responsible and the kind of appointment.</p></header><div className="crm-form-grid"><label><span>Team member</span><select required value={effectiveAssigneeMemberId} onChange={(event) => setAssigneeMemberId(event.target.value)}><option value="">Choose team member</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}{member.isOwner ? " (owner)" : ""}{member.status === "invited" ? " (invite pending)" : ""}</option>)}</select></label><label><span>Appointment type</span><select name="appointmentType" value={appointmentType} onChange={(event) => setAppointmentType(event.target.value)}>{Object.entries(appointmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="crm-title-preview"><span>Automatic title</span><strong>{customerName} {serviceLabels[serviceCategory]}</strong><small>{appointmentLabels[appointmentType]}</small></div><div className="crm-wizard-actions"><button type="button" onClick={() => setStep(2)}>Back</button><button type="button" className="btn" onClick={() => next(4)}>Choose time</button></div></section>

    <section data-step="4" hidden={step !== 4} className="crm-wizard-panel"><header><span>4 of 5</span><h3>Schedule the time</h3><p>Set the start and expected duration. This will be added to the TLink calendar.</p></header><div className="crm-form-grid"><label><span>Date and start time</span><input type="datetime-local" name="startsAt" min={localMinimumStart()} step="900" required={step === 4} /></label><label className="schedule-duration"><span>Duration <strong>{duration < 60 ? `${duration} minutes` : duration === 60 ? "1 hour" : `${Math.floor(duration / 60)} hours${duration % 60 ? ` ${duration % 60} minutes` : ""}`}</strong></span><input type="range" name="durationMinutes" min="15" max="480" step="15" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label><label className="wide"><span>Appointment notes, optional</span><textarea name="appointmentNotes" maxLength={1000} rows={3} placeholder="Access, parking or visit notes" /></label></div><div className="crm-wizard-actions"><button type="button" onClick={() => setStep(3)}>Back</button><button type="button" className="btn" onClick={() => next(5)}>Choose evidence</button></div></section>

    <section data-step="5" hidden={step !== 5} className="crm-wizard-panel"><header><span>5 of 5</span><h3>Request information</h3><p>Choose what the customer should photograph before the appointment.</p></header><div className="crm-evidence-choice">{requirements.map((item) => <label key={item.id}><input type="checkbox" checked={selectedRequirementIds.has(item.id)} onChange={(event) => setSelectedRequirementIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><span><strong>{item.label}</strong><small>{item.guidance}</small></span></label>)}</div><label className="crm-consent-confirm"><input type="checkbox" name="deliveryConsent" required={step === 5} /><span><strong>Send by email to {deliveryEmail || "this customer"}</strong><small>I confirm the customer asked to receive this job information request.</small></span></label>{!deliveryEmail && <div className="crm-wizard-message">Add a valid customer email before this request can be sent.</div>}<div className="crm-final-summary"><strong>Ready to schedule</strong><span>{customerName} | {serviceLabels[serviceCategory]} | {appointmentLabels[appointmentType]}</span><small>The job, appointment and secure evidence request are created together.</small></div><div className="crm-wizard-actions"><button type="button" onClick={() => setStep(4)}>Back</button><button type="submit" className="btn" disabled={busy || !deliveryEmail}>{busy ? "Scheduling and sending..." : "Schedule and request info"}</button></div></section>
  </form>;
}
