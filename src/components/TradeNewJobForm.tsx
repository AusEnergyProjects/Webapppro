"use client";

import type { User } from "firebase/auth";
import { FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { SearchableLookup, type SearchableLookupOption } from "./SearchableLookup";
import { nextAppointmentSlot } from "@/lib/trade-schedule";
import {
  GOVERNMENT_ACTIVITY_TEMPLATES,
  GOVERNMENT_PROGRAM_TEMPLATES,
  type ComplianceClaimOutputCode,
} from "@/lib/australian-government-program-catalogue";
import { GOVERNMENT_ACTIVITY_CALCULATION_METHODS } from "@/lib/australian-certificate-calculation-catalogue";

type Template = { id: string; name: string; title: string; serviceCategory: string; priority: string; description: string; taskTitles: string[] };
type Customer = { id: string; customerNumber: string; displayName: string; email: string; phone: string; suburb: string; postcode: string };
type Site = {
  id: string;
  siteLabel: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  addressState: string;
  postcode: string;
  isPrimary: boolean;
  addressEntryMode?: string;
  addressProvider?: string;
  addressVerifiedAt?: string;
};
type TeamMember = { id: string; displayName: string; role: string; status: string; isOwner: boolean };
type DuplicateCandidate = { customerId: string; customerNumber: string; displayName: string; serviceSiteId: string; siteLabel: string; reasons: string[] };
type PlannedComplianceActivity = {
  programTemplateId: string;
  activityTemplateId: string;
};
type AddressValue = {
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  addressState: string;
  postcode: string;
  entryMode: "manual_pending_review" | "provider_selected";
  provider: string;
  providerReference: string;
  formattedAddress: string;
  selectionProof: string;
};
type AddressSuggestion = {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  addressState: string;
  postcode: string;
  provider?: string;
  providerReference?: string;
  formattedAddress?: string;
  selectionProof?: string;
};
const serviceOptions = [
  ["assessment", "Energy assessment"], ["solar", "Rooftop solar"], ["battery", "Home batteries"],
  ["heating-cooling", "Heating and cooling"], ["hot-water", "Hot water"],
  ["draught-proofing", "Draught-proofing"], ["insulation", "Insulation"], ["glazing", "Glazing"],
  ["window-coverings", "Blinds, shutters and external shading"], ["ev-charging", "EV charging"],
  ["electrical", "Electrical services"], ["plumbing", "Plumbing services"],
  ["mounting-hardware", "Mounting and hardware"], ["controls", "Energy controls"], ["other", "Other work"],
] as const;
const serviceCategories = new Set<string>(serviceOptions.map(([value]) => value));
const serviceLabels: Record<string, string> = {
  ...Object.fromEntries(serviceOptions),
  "insulation-draughts": "Insulation and draught control",
};
const appointmentLabels: Record<string, string> = { phone_call: "Phone call", site_visit: "Site visit", quote_review: "Quote review", installation: "Installation", service: "Service visit", admin: "Office task" };
const buildingTypes = [["house_townhouse", "House or townhouse"], ["apartment_unit", "Apartment or unit"], ["commercial_office", "Commercial or office"], ["retail_hospitality", "Retail or hospitality"], ["industrial_warehouse", "Industrial or warehouse"], ["institutional_community_health", "Institutional, community or health"], ["other", "Other"], ["not_sure", "Not sure"]];
const steps = ["Work", "Customer", "Program", "Appointment", "Review"];
const MAX_PLANNED_COMPLIANCE_ACTIVITIES = 12;

const emptyAddress: AddressValue = {
  addressLine1: "",
  addressLine2: "",
  suburb: "",
  addressState: "",
  postcode: "",
  entryMode: "manual_pending_review",
  provider: "",
  providerReference: "",
  formattedAddress: "",
  selectionProof: "",
};

function AddressFields({
  user,
  value,
  onChange,
}: {
  user: User;
  value: AddressValue;
  onChange: (value: AddressValue) => void;
}) {
  const id = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [providerMessage, setProviderMessage] = useState("");
  const suppressLookup = useRef(false);

  function manual(next: Partial<AddressValue>) {
    onChange({
      ...value,
      ...next,
      entryMode: "manual_pending_review",
      provider: "",
      providerReference: "",
      formattedAddress: "",
      selectionProof: "",
    });
  }

  useEffect(() => {
    if (suppressLookup.current) {
      suppressLookup.current = false;
      return;
    }
    if (value.addressLine1.trim().length < 3 || value.entryMode === "provider_selected") return;
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
  }, [user, value.addressLine1, value.entryMode]);

  function choose(item: AddressSuggestion) {
    suppressLookup.current = true;
    onChange({
      addressLine1: item.addressLine1,
      addressLine2: item.addressLine2,
      suburb: item.suburb,
      addressState: item.addressState,
      postcode: item.postcode,
      entryMode: "provider_selected",
      provider: item.provider || "",
      providerReference: item.providerReference || item.id,
      formattedAddress: item.formattedAddress || item.label,
      selectionProof: item.selectionProof || "",
    });
    setProviderMessage("");
    setSuggestions([]);
  }

  return <div className="crm-address-fields wide">
    <input type="hidden" name="addressEntryMode" value={value.entryMode} />
    <input type="hidden" name="addressProvider" value={value.provider} />
    <input type="hidden" name="addressProviderReference" value={value.providerReference} />
    <input type="hidden" name="addressFormatted" value={value.formattedAddress} />
    <input type="hidden" name="addressSelectionProof" value={value.selectionProof} />
    <label className="wide"><span>Street address</span><input name="addressLine1" required maxLength={140} autoComplete="street-address" value={value.addressLine1} placeholder="Start typing an Australian address" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls={`${id}-addresses`} aria-activedescendant={suggestions[activeIndex] ? `${id}-address-${activeIndex}` : undefined} onChange={(event) => { const next = event.target.value; manual({ addressLine1: next }); setProviderMessage(""); if (next.trim().length < 3) setSuggestions([]); }} onKeyDown={(event) => { if (event.key === "Escape") setSuggestions([]); if (!suggestions.length) return; if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); } if (event.key === "Enter") { event.preventDefault(); choose(suggestions[activeIndex]); } }} />
      {suggestions.length > 0 && <div id={`${id}-addresses`} className="crm-address-options" role="listbox">{suggestions.map((item, index) => <button type="button" role="option" aria-selected={activeIndex === index} id={`${id}-address-${index}`} key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>{item.label}</button>)}</div>}
      <small className={value.entryMode === "provider_selected" ? "verified" : ""}>{value.entryMode === "provider_selected"
        ? "Address selected from the configured provider. Editing any address field returns it to manual review."
        : providerMessage || (configured === false ? "Address lookup is not configured. Manual addresses are saved for compliance review." : "Choose a suggestion to lock the suburb, state and postcode together.")}</small>
    </label>
    <label className="wide"><span>Unit, level or building, optional</span><input name="addressLine2" maxLength={140} value={value.addressLine2} onChange={(event) => manual({ addressLine2: event.target.value })} /></label>
    <label><span>Suburb</span><input name="suburb" required maxLength={80} autoComplete="address-level2" value={value.suburb} onChange={(event) => manual({ suburb: event.target.value })} /></label>
    <label><span>State</span><select name="addressState" required autoComplete="address-level1" value={value.addressState} onChange={(event) => manual({ addressState: event.target.value })}><option value="">Select state</option>{["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((state) => <option key={state}>{state}</option>)}</select></label>
    <label><span>Postcode</span><input name="postcode" required inputMode="numeric" autoComplete="postal-code" maxLength={4} pattern="[0-9]{4}" value={value.postcode} onChange={(event) => manual({ postcode: event.target.value.replace(/\D/g, "").slice(0, 4) })} /></label>
  </div>;
}

export type TradeNewJobInitial = {
  customerId?: string;
  serviceSiteId?: string;
  serviceCategory?: string;
  sourceEnquiryId?: string;
  createNewSite?: boolean;
};

export function TradeNewJobForm({
  user,
  templates,
  teamMembers,
  busy,
  initial,
  onSubmit,
}: {
  user: User;
  templates: Template[];
  teamMembers: TeamMember[];
  busy: boolean;
  initial?: TradeNewJobInitial;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [highestStep, setHighestStep] = useState(1);
  const [message, setMessage] = useState("");
  const [templateId, setTemplateId] = useState("");
  const selectableTemplates = templates.filter((item) => serviceCategories.has(item.serviceCategory));
  const template = selectableTemplates.find((item) => item.id === templateId);
  const [serviceCategory, setServiceCategory] = useState(
    serviceCategories.has(initial?.serviceCategory || "")
      ? initial?.serviceCategory || "assessment"
      : "assessment",
  );
  const [buildingType, setBuildingType] = useState("not_sure");
  const [priority, setPriority] = useState("standard");
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(initial?.customerId ? "existing" : "new");
  const [customerType, setCustomerType] = useState("residential");
  const [customerId, setCustomerId] = useState(initial?.customerId || "");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [serviceSiteId, setServiceSiteId] = useState(initial?.serviceSiteId || "");
  const [newSite, setNewSite] = useState(Boolean(initial?.createNewSite));
  const [newAddress, setNewAddress] = useState<AddressValue>(emptyAddress);
  const [loadingSites, setLoadingSites] = useState(Boolean(initial?.customerId));
  const [siteLoadError, setSiteLoadError] = useState("");
  const [siteLoadRetry, setSiteLoadRetry] = useState(0);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [duplicateReviewed, setDuplicateReviewed] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [appointmentType, setAppointmentType] = useState("site_visit");
  const [assigneeMemberId, setAssigneeMemberId] = useState(teamMembers[0]?.id || "");
  const [duration, setDuration] = useState(60);
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [minimumStart, setMinimumStart] = useState(() => nextAppointmentSlot());
  const [scheduledStart, setScheduledStart] = useState("");
  const [plannedActivities, setPlannedActivities] = useState<PlannedComplianceActivity[]>([]);
  const [activityDraftOpen, setActivityDraftOpen] = useState(false);
  const [draftClaimOutputCode, setDraftClaimOutputCode] = useState<ComplianceClaimOutputCode | "">("");
  const [draftProgramTemplateId, setDraftProgramTemplateId] = useState("");
  const [draftActivityTemplateId, setDraftActivityTemplateId] = useState("");
  const nonComplianceAppointmentType = useRef("site_visit");
  const stepFocusReady = useRef(false);
  const effectiveAssigneeMemberId = assigneeMemberId || teamMembers[0]?.id || "";
  const selectedTeamMember = teamMembers.find((member) => member.id === effectiveAssigneeMemberId);

  function showStep(nextStep: number) {
    setStep(nextStep);
    setHighestStep((current) => Math.max(current, nextStep));
  }

  function changeServiceCategory(value: string) {
    if (!serviceCategories.has(value) || value === serviceCategory) return;
    setServiceCategory(value);
    clearCompliancePlan();
  }

  function resetActivityDraft() {
    setActivityDraftOpen(false);
    setDraftClaimOutputCode("");
    setDraftProgramTemplateId("");
    setDraftActivityTemplateId("");
  }

  function clearCompliancePlan() {
    setPlannedActivities([]);
    resetActivityDraft();
    setAppointmentType((current) => current === "installation" ? nonComplianceAppointmentType.current : current);
    setHighestStep((current) => Math.min(current, step));
  }

  function chooseClaimOutput(value: string) {
    setHighestStep((current) => Math.min(current, 3));
    setDraftProgramTemplateId("");
    setDraftActivityTemplateId("");
    setDraftClaimOutputCode(value as ComplianceClaimOutputCode | "");
  }

  function beginActivityDraft() {
    setMessage("");
    if (!siteJurisdiction) {
      setMessage("Add the job address state before choosing a government activity.");
      return;
    }
    if (claimOutputOptions.length === 0) {
      setMessage("No current or limited government activity is listed for this job address.");
      return;
    }
    if (plannedActivities.length >= MAX_PLANNED_COMPLIANCE_ACTIVITIES) {
      setMessage(`A job can include up to ${MAX_PLANNED_COMPLIANCE_ACTIVITIES} planned activities.`);
      return;
    }
    setActivityDraftOpen(true);
    setDraftClaimOutputCode("");
    setDraftProgramTemplateId("");
    setDraftActivityTemplateId("");
    setHighestStep((current) => Math.min(current, 3));
  }

  useEffect(() => {
    if (!stepFocusReady.current) {
      stepFocusReady.current = true;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLHeadingElement>(`[data-step="${step}"] h3`)
        ?.focus({ preventScroll: false });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

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
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as { customer?: Customer; sites?: Site[]; error?: string };
        const customer = result.customer;
        if (!response.ok || !customer) {
          throw new Error(result.error || "The customer and service sites could not be loaded.");
        }
        return { customer, sites: result.sites };
      })
      .then((result) => {
        if (!active) return;
        const next = result.sites || [];
        const seededSiteId = customerId === initial?.customerId ? initial?.serviceSiteId || "" : "";
        setSelectedCustomer(result.customer);
        setSites(next);
        setServiceSiteId((current) =>
          next.some((site) => site.id === current)
            ? current
            : next.some((site) => site.id === seededSiteId)
              ? seededSiteId
              : next.find((site) => site.isPrimary)?.id || next[0]?.id || "");
        setNewSite(customerId === initial?.customerId && initial?.createNewSite ? true : !next.length);
        setSiteLoadError("");
      })
      .catch((error) => {
        if (!active) return;
        setSelectedCustomer(null);
        setSites([]);
        setServiceSiteId("");
        setNewSite(false);
        setSiteLoadError(error instanceof Error ? error.message : "The customer and service sites could not be loaded.");
      })
      .finally(() => {
        if (active) setLoadingSites(false);
      });
    return () => { active = false; };
  }, [customerId, initial?.createNewSite, initial?.customerId, initial?.serviceSiteId, siteLoadRetry, user]);

  function selectCustomer(id: string) {
    const changed = id !== customerId;
    setCustomerId(id); setDuplicates([]); setDuplicateReviewed(false);
    if (!changed) return;
    setSelectedCustomer(null);
    setSites([]);
    setServiceSiteId(id === initial?.customerId ? initial?.serviceSiteId || "" : "");
    setNewSite(Boolean(id && id === initial?.customerId && initial?.createNewSite));
    setNewAddress(emptyAddress);
    setLoadingSites(Boolean(id));
    setSiteLoadError("");
    clearCompliancePlan();
  }

  function validateVisibleStep() {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (!panel) return true;
    for (const field of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) {
      if (!field.checkValidity()) {
        const label = field.closest("label")?.querySelector("span")?.textContent?.trim().toLowerCase() || "required field";
        const error = field.validity.valueMissing ? `Add the ${label}.`
          : field.validity.typeMismatch && field.type === "email" ? "Check the customer email address."
            : field.validity.rangeUnderflow && field.type === "datetime-local" ? "Choose a future appointment at least 15 minutes from now."
              : field.validity.stepMismatch && field.type === "datetime-local" ? "Choose a start time on a 15-minute interval."
                : field.validity.patternMismatch ? `Check the ${label}.` : `Check the ${label}.`;
        setMessage(error); field.focus({ preventScroll: false }); return false;
      }
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
    if (customerMode === "existing" && loadingSites) { setMessage("Wait for the customer service sites to finish loading."); return; }
    if (customerMode === "existing" && siteLoadError && !newSite) {
      setMessage("Retry the customer service sites, or add a new service site instead.");
      return;
    }
    if (customerMode === "existing" && !newSite && (!serviceSiteId || !sites.some((site) => site.id === serviceSiteId))) {
      setMessage("Choose an existing service site, or add a new service site for this customer.");
      return;
    }
    if (!validateVisibleStep()) return;
    const matches = await checkDuplicates();
    if (matches.length) { setMessage("We found an existing customer. Use the match below or confirm this is a different person."); return; }
    showStep(3);
  }

  function attachDuplicate(candidate: DuplicateCandidate) {
    setCustomerMode("existing"); selectCustomer(candidate.customerId); setServiceSiteId(candidate.serviceSiteId);
    setDuplicates([]); setMessage(`${candidate.displayName} attached. Choose whether this work has a certificate program.`); showStep(3);
  }

  const newCustomerName = customerType === "business" ? businessName : `${firstName} ${lastName}`.trim();
  const customerName = selectedCustomer?.displayName || newCustomerName || "Customer";
  const selectedSite = sites.find((site) => site.id === serviceSiteId);
  const siteJurisdiction = (
    customerMode === "new" || newSite
      ? newAddress.addressState
      : selectedSite?.addressState || ""
  ).toUpperCase();
  const jurisdictionPrograms = GOVERNMENT_PROGRAM_TEMPLATES
    .filter((program) =>
      Boolean(siteJurisdiction)
      && (program.jurisdiction === "AU" || program.jurisdiction === siteJurisdiction)
      && (program.catalogueState === "current" || program.catalogueState === "limited")
      && GOVERNMENT_ACTIVITY_TEMPLATES.some((activity) =>
        activity.programCode === program.programCode
        && (activity.catalogueState === "current" || activity.catalogueState === "limited")))
    .sort((left, right) =>
      `${left.jurisdiction}|${left.name}`.localeCompare(`${right.jurisdiction}|${right.name}`, "en-AU"));
  const claimOutputOptions = (() => {
    const values = new Map<ComplianceClaimOutputCode, string>();
    for (const program of jurisdictionPrograms) {
      if (!values.has(program.claimOutputCode)) values.set(program.claimOutputCode, program.claimOutputLabel);
    }
    return Array.from(values, ([code, label]) => ({ code, label }))
      .sort((left, right) => `${left.code}|${left.label}`.localeCompare(`${right.code}|${right.label}`, "en-AU"));
  })();
  const selectablePrograms = jurisdictionPrograms
    .filter((program) => program.claimOutputCode === draftClaimOutputCode);
  const draftProgram = selectablePrograms.find((item) => item.templateId === draftProgramTemplateId);
  const selectableActivities = draftProgram
    ? GOVERNMENT_ACTIVITY_TEMPLATES
      .filter((activity) =>
        activity.programCode === draftProgram.programCode
        && (activity.catalogueState === "current" || activity.catalogueState === "limited"))
      .sort((left, right) =>
        `${left.registryActivityCode || left.activityKey}|${left.title}`.localeCompare(
          `${right.registryActivityCode || right.activityKey}|${right.title}`,
          "en-AU",
        ))
    : [];
  const draftActivity = selectableActivities.find((item) => item.templateId === draftActivityTemplateId);
  const draftCalculation = GOVERNMENT_ACTIVITY_CALCULATION_METHODS.find((item) =>
    item.activityTemplateId === draftActivityTemplateId);
  const plannedActivityDetails = plannedActivities.flatMap((selection) => {
    const program = GOVERNMENT_PROGRAM_TEMPLATES.find((item) => item.templateId === selection.programTemplateId);
    const activity = GOVERNMENT_ACTIVITY_TEMPLATES.find((item) =>
      item.templateId === selection.activityTemplateId
      && item.programCode === program?.programCode);
    if (!program || !activity) return [];
    return [{
      selection,
      program,
      activity,
      calculation: GOVERNMENT_ACTIVITY_CALCULATION_METHODS.find((item) =>
        item.activityTemplateId === selection.activityTemplateId),
    }];
  });
  const complianceMode = plannedActivities.length > 0 ? "planned" : "none";
  const legacyComplianceActivity = plannedActivities[0];
  const complianceActivitiesJson = JSON.stringify(plannedActivities);
  const reviewAddress = customerMode === "new" || newSite
    ? [newAddress.addressLine2, newAddress.addressLine1, newAddress.suburb, newAddress.addressState, newAddress.postcode].filter(Boolean).join(", ")
    : selectedSite
      ? [selectedSite.addressLine2, selectedSite.addressLine1, selectedSite.suburb, selectedSite.addressState, selectedSite.postcode].filter(Boolean).join(", ")
      : "Address not selected";
  const addressStatus = customerMode === "new" || newSite
    ? newAddress.entryMode === "provider_selected" ? "Provider selected" : "Manual address, compliance review required"
    : selectedSite?.addressEntryMode === "provider_selected"
      ? `Provider selected${selectedSite.addressProvider ? ` | ${selectedSite.addressProvider}` : ""}`
      : "Existing manual address, compliance review required";

  function addPlannedActivity() {
    setMessage("");
    if (!draftProgram || !draftActivity) {
      setMessage("Choose the certificate or support type, government program and activity.");
      return;
    }
    if (plannedActivities.length >= MAX_PLANNED_COMPLIANCE_ACTIVITIES) {
      setMessage(`A job can include up to ${MAX_PLANNED_COMPLIANCE_ACTIVITIES} planned activities.`);
      return;
    }
    if (plannedActivities.some((item) =>
      item.programTemplateId === draftProgram.templateId
      && item.activityTemplateId === draftActivity.templateId)) {
      setMessage("That exact government program and activity is already added.");
      return;
    }
    setPlannedActivities((current) => [...current, {
      programTemplateId: draftProgram.templateId,
      activityTemplateId: draftActivity.templateId,
    }]);
    if (plannedActivities.length === 0) {
      setAppointmentType((current) => {
        if (current !== "installation") nonComplianceAppointmentType.current = current;
        return "installation";
      });
    }
    resetActivityDraft();
    setHighestStep((current) => Math.min(current, 3));
  }

  function removePlannedActivity(selection: PlannedComplianceActivity) {
    const remaining = plannedActivities.filter((item) =>
      item.programTemplateId !== selection.programTemplateId
      || item.activityTemplateId !== selection.activityTemplateId);
    setPlannedActivities(remaining);
    if (remaining.length === 0) {
      setAppointmentType((current) => current === "installation" ? nonComplianceAppointmentType.current : current);
    }
    setMessage("");
    setHighestStep((current) => Math.min(current, 3));
  }

  function next(nextStep: number) {
    setMessage("");
    if (validateVisibleStep()) {
      if (nextStep === 4) {
        if (activityDraftOpen) {
          setMessage("Add the activity or cancel it before setting the appointment.");
          return;
        }
        if (plannedActivityDetails.length !== plannedActivities.length) {
          setMessage("One or more planned activities are no longer available. Remove them and choose current activities.");
          return;
        }
        setMinimumStart(nextAppointmentSlot());
      }
      showStep(nextStep);
    }
  }

  function chooseWizardStep(target: number) {
    if (target === step) return;
    if (target < step || target <= highestStep) {
      setMessage("");
      setStep(target);
      return;
    }
    if (target !== step + 1) return;
    if (step === 1) next(2);
    else if (step === 2) void continueFromCustomer();
    else if (step === 3) next(4);
    else if (step === 4) next(5);
  }

  return <form ref={formRef} noValidate className="crm-form crm-new-job crm-job-wizard" onSubmit={(event) => {
    if (!validateVisibleStep()) { event.preventDefault(); return; }
    if (activityDraftOpen || plannedActivityDetails.length !== plannedActivities.length) {
      event.preventDefault();
      setMessage(activityDraftOpen
        ? "Add the activity or cancel it before creating the job."
        : "One or more planned activities are no longer available. Remove them and choose current activities.");
      setStep(3);
      return;
    }
    onSubmit(event);
  }}>
    <input type="hidden" name="customerMode" value={customerMode} /><input type="hidden" name="crmCustomerId" value={customerId} />
    <input type="hidden" name="duplicateOverride" value={duplicateReviewed ? "true" : "false"} />
    <input type="hidden" name="serviceSiteMode" value={customerMode === "new" || newSite ? "new" : "existing"} /><input type="hidden" name="serviceSiteId" value={customerMode === "new" || newSite ? "" : serviceSiteId} />
    <input type="hidden" name="sourceEnquiryId" value={initial?.sourceEnquiryId || ""} />
    <input type="hidden" name="complianceIntentMode" value={complianceMode} />
    <input type="hidden" name="complianceActivitiesJson" value={complianceActivitiesJson} />
    <input type="hidden" name="programTemplateId" value={legacyComplianceActivity?.programTemplateId || ""} />
    <input type="hidden" name="activityTemplateId" value={legacyComplianceActivity?.activityTemplateId || ""} />
    <input type="hidden" name="siteLabel" value="Primary site" />

    <div className="crm-system-id-note"><span>TLink job ID</span><strong>Assigned automatically</strong><small>One private global reference is shown to your team, the assigned compliance team and TLink support, such as TLJ-X3KHTUEF.</small></div>
    <ol className="crm-wizard-steps" aria-label="Create and schedule job">{steps.map((label, index) => {
      const target = index + 1;
      const available = target <= highestStep || target === step + 1;
      return <li key={label} className={step === target ? "active" : highestStep > target ? "complete" : ""}>
        <button type="button" aria-current={step === target ? "step" : undefined} disabled={!available} onClick={() => chooseWizardStep(target)}>
          <span>{target}</span>{label}
        </button>
      </li>;
    })}</ol>
    {message && <div className="crm-wizard-message" role="status">{message}</div>}

    <section data-step="1" hidden={step !== 1} className="crm-wizard-panel"><header><span>1 of 5</span><h3 tabIndex={-1}>Choose the work</h3><p>Start with the service. If this is certificate work, the exact activity can refine it after the address is attached.</p></header>
      {selectableTemplates.length > 0 && <label className="crm-template-picker"><span>Start from a template, optional</span><select name="templateId" value={templateId} onChange={(event) => { const id = event.target.value; const selected = selectableTemplates.find((item) => item.id === id); setTemplateId(id); if (selected) { changeServiceCategory(selected.serviceCategory); setPriority(selected.priority); } }}><option value="">Blank job</option>{selectableTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{template ? `${template.taskTitles.length} checklist items will be added automatically.` : "Templates keep common scopes and checklists consistent."}</small></label>}
      <div className="crm-form-grid"><label><span>Work type</span><select name="serviceCategory" value={serviceCategory} onChange={(event) => changeServiceCategory(event.target.value)}>{serviceOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Building type</span><select name="buildingType" value={buildingType} onChange={(event) => setBuildingType(event.target.value)}>{buildingTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Priority</span><select name="priority" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="standard">Standard</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>
      {template?.description && <input type="hidden" name="description" value={template.description} />}
      <div className="crm-wizard-actions"><button type="button" className="btn" onClick={() => next(2)}>Add customer</button></div>
    </section>

    <section data-step="2" hidden={step !== 2} className="crm-wizard-panel"><header><span>2 of 5</span><h3 tabIndex={-1}>Add or attach the customer</h3><p>Create a customer now, or find an existing customer. The service-site state controls which government programs can be planned.</p></header>
      <fieldset className="crm-customer-lookup"><legend>Your customer</legend>
        {customerMode === "existing" ? <>
          <div className="crm-inline-heading"><strong>Find an existing customer</strong><button type="button" className="crm-text-action" onClick={() => { setCustomerMode("new"); selectCustomer(""); clearCompliancePlan(); }}>Create new customer</button></div>
          <SearchableLookup label="Find and select a customer" value={customerId} placeholder="Name, number, phone, suburb or postcode" required load={loadCustomers} onChange={selectCustomer} />
        </> : <>
          <div className="crm-inline-heading"><strong>New customer</strong><button type="button" className="crm-text-action" onClick={() => { setCustomerMode("existing"); selectCustomer(""); clearCompliancePlan(); }}>Find existing customer</button></div>
          <div className="crm-form-grid">
            <label><span>Customer type</span><select name="customerType" value={customerType} onChange={(event) => setCustomerType(event.target.value)}><option value="residential">Residential</option><option value="business">Business</option></select></label>
            {customerType === "business"
              ? <label><span>Business name</span><input name="businessName" required={step === 2} maxLength={140} value={businessName} onChange={(event) => setBusinessName(event.target.value)} /></label>
              : <>
                <label><span>First name</span><input name="firstName" required={step === 2} maxLength={80} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
                <label><span>Last name</span><input name="lastName" maxLength={80} value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
              </>}
            <label><span>Mobile</span><input type="tel" name="phone" required={step === 2} autoComplete="tel" maxLength={40} value={newCustomerPhone} onChange={(event) => { setNewCustomerPhone(event.target.value); setDuplicates([]); setDuplicateReviewed(false); }} onBlur={() => void checkDuplicates()} /></label>
            <label><span>Email</span><input type="email" name="email" required={step === 2} autoComplete="email" maxLength={180} value={newCustomerEmail} onChange={(event) => { setNewCustomerEmail(event.target.value); setDuplicates([]); setDuplicateReviewed(false); }} onBlur={() => void checkDuplicates()} /></label>
          </div>
        </>}
        <small>AEA protected leads use their authorised workflow and cannot become direct customer records here.</small>
      </fieldset>
      {duplicates.length > 0 && <div className="crm-duplicate-match" role="alert"><strong>Customer already found</strong><p>Use the existing record so the customer and job history stay together.</p>{duplicates.map((candidate) => <div key={candidate.customerId}><span><b>{candidate.displayName}</b><small>{candidate.customerNumber} | matched {candidate.reasons.join(", ")}</small></span><button type="button" onClick={() => attachDuplicate(candidate)}>Use this customer</button></div>)}<button type="button" className="crm-text-action" onClick={() => { setDuplicateReviewed(true); setDuplicates([]); setMessage("Continuing as a different customer."); }}>This is a different customer</button></div>}
      {(customerMode === "new" || customerId) && <fieldset className="crm-service-site"><legend>Job address</legend>
        {customerMode === "existing" && customerId && loadingSites && <p role="status">Loading customer service sites...</p>}
        {customerMode === "existing" && customerId && siteLoadError && !newSite && <div className="crm-wizard-message" role="alert"><strong>Customer sites are unavailable</strong><p>{siteLoadError}</p><div className="crm-wizard-actions"><button type="button" onClick={() => { setLoadingSites(true); setSiteLoadError(""); setSiteLoadRetry((current) => current + 1); }}>Retry customer sites</button><button type="button" onClick={() => { setNewSite(true); setServiceSiteId(""); setNewAddress(emptyAddress); clearCompliancePlan(); }}>Add a new service site instead</button></div></div>}
        {customerMode === "existing" && customerId && !loadingSites && !siteLoadError && !newSite && sites.length > 0 && <label><span>Existing service site</span><select value={serviceSiteId} onChange={(event) => { setServiceSiteId(event.target.value); clearCompliancePlan(); }}>{sites.map((site) => <option key={site.id} value={site.id}>{site.siteLabel} | {[site.addressLine1, site.suburb, site.addressState, site.postcode].filter(Boolean).join(", ")}</option>)}</select></label>}
        {customerMode === "existing" && customerId && !loadingSites && !siteLoadError && sites.length > 0 && <button type="button" className="crm-text-action" onClick={() => { setNewSite((value) => !value); setNewAddress(emptyAddress); clearCompliancePlan(); }}>{newSite ? "Use an existing service site" : "Add a new service site"}</button>}
        {(customerMode === "new" || newSite) && <div className="crm-form-grid"><AddressFields user={user} value={newAddress} onChange={(value) => {
          setNewAddress(value);
          clearCompliancePlan();
        }} /></div>}
      </fieldset>}
      <div className="crm-wizard-actions"><button type="button" onClick={() => setStep(1)}>Back</button><button type="button" className="btn" disabled={checkingDuplicates || loadingSites} onClick={() => void continueFromCustomer()}>{checkingDuplicates ? "Checking customer..." : loadingSites ? "Loading customer..." : "Choose program"}</button></div>
    </section>

    <section data-step="3" hidden={step !== 3} className="crm-wizard-panel"><header><span>3 of 5</span><h3 tabIndex={-1}>Choose the program, if relevant</h3><p>Add every government certificate, rebate or support activity planned for this job. The exact published rules remain authoritative.</p></header>
      {plannedActivityDetails.length > 0 && <div className="crm-planned-activity-list" aria-label="Planned government activities">
        {plannedActivityDetails.map(({ selection, program, activity, calculation }, index) => <article className="crm-compliance-notice crm-planned-activity-card" key={`${selection.programTemplateId}:${selection.activityTemplateId}`}>
          <div className="crm-inline-heading">
            <strong>Activity {index + 1} | {program.programCode} | {activity.registryActivityCode || activity.activityKey}</strong>
            <button type="button" className="crm-text-action" onClick={() => removePlannedActivity(selection)}>Remove</button>
          </div>
          <p>{activity.title}</p>
          <dl>
            <div><dt>Output</dt><dd>{program.claimOutputCode} | {program.claimOutputLabel}</dd></div>
            <div><dt>Product</dt><dd>{activity.productCategory || "No product category listed"}</dd></div>
            <div><dt>Evidence</dt><dd>Published governed policy required</dd></div>
            <div><dt>Calculation</dt><dd>{calculation ? `${calculation.unit} | ${calculation.state.replaceAll("_", " ")}` : "Governed calculation not published"}</dd></div>
          </dl>
        </article>)}
      </div>}
      {!activityDraftOpen && plannedActivities.length === 0 && <div className="crm-compliance-notice">
        <strong>No government activity added</strong>
        <p>Continue to create an ordinary job, or add one or more activities for certificate, rebate or support review.</p>
      </div>}
      {!activityDraftOpen && plannedActivities.length < MAX_PLANNED_COMPLIANCE_ACTIVITIES && <div className="crm-wizard-actions crm-add-activity-action">
        <button type="button" className="btn" onClick={beginActivityDraft}>Add activity</button>
      </div>}
      {activityDraftOpen && <div className="crm-activity-builder crm-compliance-notice">
        <strong>Add a controlled activity</strong>
        <div className="crm-form-grid">
          <label><span>Certificate or support type</span><select value={draftClaimOutputCode} required={step === 3} onChange={(event) => chooseClaimOutput(event.target.value)}><option value="">Choose type</option>{claimOutputOptions.map((option) => <option key={option.code} value={option.code}>{option.code} | {option.label}</option>)}</select></label>
          <label><span>Government program</span><select value={draftProgramTemplateId} required={step === 3} disabled={!siteJurisdiction || !draftClaimOutputCode} onChange={(event) => { setHighestStep((current) => Math.min(current, 3)); setDraftProgramTemplateId(event.target.value); setDraftActivityTemplateId(""); }}><option value="">{siteJurisdiction && draftClaimOutputCode ? "Choose program" : "Choose the certificate or support type first"}</option>{selectablePrograms.map((program) => <option key={program.templateId} value={program.templateId}>{program.jurisdiction} | {program.programCode} | {program.name}{program.catalogueState === "limited" ? " (limited)" : ""}</option>)}</select></label>
          <label><span>Planned activity</span><select value={draftActivityTemplateId} required={step === 3} disabled={!draftProgram} onChange={(event) => { setHighestStep((current) => Math.min(current, 3)); setDraftActivityTemplateId(event.target.value); }}><option value="">Choose activity</option>{selectableActivities.map((activity) => <option key={activity.templateId} value={activity.templateId}>{activity.registryActivityCode || activity.activityKey} | {activity.title}{activity.catalogueState === "limited" ? " (limited)" : ""}</option>)}</select></label>
        </div>
        {draftProgram && draftActivity && <div className="crm-compliance-intake-preview">
          <strong>{draftProgram.programCode} | {draftActivity.registryActivityCode || draftActivity.activityKey} | {draftActivity.title}</strong>
          <p>The assigned compliance team can review the customer, site, activity and schedule. A regulated case opens only when the exact published rule, product, evidence policy and calculation pathway are ready.</p>
          <dl>
            <div><dt>Specification</dt><dd>{draftActivity.specificationPart || "No separate specification part"}</dd></div>
            <div><dt>Scenario</dt><dd>{draftActivity.scenarioCode ? `${draftActivity.scenarioCode} | ${draftActivity.scenario}` : draftActivity.scenario || "No separate scenario code"}</dd></div>
            <div><dt>Product category</dt><dd>{draftActivity.productCategory || "No product category listed"}</dd></div>
            <div><dt>Calculation</dt><dd>{draftCalculation ? `${draftCalculation.unit} | ${draftCalculation.state.replaceAll("_", " ")}` : "Governed calculation not published"}</dd></div>
          </dl>
          <a href={draftProgram.officialSourceUrl} target="_blank" rel="noreferrer">Open official program source</a>
        </div>}
        <div className="crm-wizard-actions">
          <button type="button" onClick={resetActivityDraft}>Cancel</button>
          <button type="button" className="btn" onClick={addPlannedActivity}>Add activity</button>
        </div>
      </div>}
      {siteJurisdiction && claimOutputOptions.length === 0 && <div className="crm-wizard-message">No current or limited government certificate or support activity is listed for this state. You can create an ordinary job, but TLink will not invent an activity.</div>}
      <div className="crm-wizard-actions"><button type="button" onClick={() => setStep(2)}>Back</button><button type="button" className="btn" onClick={() => next(4)}>Set appointment</button></div>
    </section>

    <section data-step="4" hidden={step !== 4} className="crm-wizard-panel"><header><span>4 of 5</span><h3 tabIndex={-1}>Set the appointment</h3><p>Set the field visit once. The technician receives the same job, activity and evidence context used by the assigned compliance team.</p></header>
      <div className="crm-form-grid crm-appointment-grid"><label><span>Team member</span><select name="assigneeMemberId" required={step === 4} value={effectiveAssigneeMemberId} onChange={(event) => setAssigneeMemberId(event.target.value)}><option value="">Choose team member</option>{teamMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}{member.isOwner ? " (owner)" : ""}{member.status === "invited" ? " (invite pending)" : ""}</option>)}</select></label><label><span>Date and start time</span><input type="datetime-local" name="startsAt" min={minimumStart} step="900" required={step === 4} value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} /></label>
        <label><span>Appointment type</span><select name="appointmentType" value={appointmentType} onChange={(event) => { const value = event.target.value; if (value !== "installation") nonComplianceAppointmentType.current = value; setAppointmentType(value); }}>{Object.entries(appointmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>{complianceMode === "planned" ? "Installation is recommended for certificate work, but earlier field visits can also start the job." : "Choose the first appointment for this job."}</small></label>
        <label className="schedule-duration"><span>Duration <strong>{duration < 60 ? `${duration} minutes` : duration === 60 ? "1 hour" : `${Math.floor(duration / 60)} hours${duration % 60 ? ` ${duration % 60} minutes` : ""}`}</strong></span><input type="range" name="durationMinutes" min="15" max="480" step="15" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
        <label className="wide"><span>Appointment notes, optional</span><textarea name="appointmentNotes" maxLength={1000} rows={3} placeholder="Access, parking or visit notes" value={appointmentNotes} onChange={(event) => setAppointmentNotes(event.target.value)} /></label>
      </div>
      <div className="crm-wizard-actions"><button type="button" onClick={() => setStep(3)}>Back</button><button type="button" className="btn" onClick={() => next(5)}>Review job</button></div>
    </section>

    <section data-step="5" hidden={step !== 5} className="crm-wizard-panel"><header><span>5 of 5</span><h3 tabIndex={-1}>Review and create</h3><p>Confirm the complete work record. Saving creates the TLink job, field appointment and planned activity review records together.</p></header>
      <div className="crm-review-header"><div><span>New TLink job</span><strong>{customerName} | {serviceLabels[serviceCategory]}</strong><small>{reviewAddress}</small></div><div><span>Compliance review</span><strong>{plannedActivities.length > 0 ? `${plannedActivities.length} ${plannedActivities.length === 1 ? "activity" : "activities"} start immediately` : "Not required"}</strong><small>{plannedActivities.length > 0 ? "Private job data available to the assigned compliance team" : "Ordinary trade job"}</small></div></div>
      <div className="crm-audit-review">
        <section><header><span>Customer and site</span><button type="button" onClick={() => setStep(2)}>Edit</button></header><dl>
          <div><dt>Customer</dt><dd>{customerName}</dd></div>
          <div><dt>Contact</dt><dd>{customerMode === "new" ? [newCustomerPhone, newCustomerEmail].filter(Boolean).join(" | ") || "No contact added" : [selectedCustomer?.phone, selectedCustomer?.email].filter(Boolean).join(" | ") || "No contact added"}</dd></div>
          <div className="wide"><dt>Installation address</dt><dd>{reviewAddress}</dd></div>
          <div><dt>Address status</dt><dd>{addressStatus}</dd></div>
          <div><dt>Jurisdiction</dt><dd>{siteJurisdiction || "Not set"}</dd></div>
        </dl></section>
        <section><header><span>Job and commercial</span><button type="button" onClick={() => setStep(1)}>Edit</button></header><dl>
          <div><dt>Work type</dt><dd>{serviceLabels[serviceCategory]}</dd></div>
          <div><dt>Building</dt><dd>{buildingTypes.find(([value]) => value === buildingType)?.[1] || buildingType}</dd></div>
          <div><dt>Priority</dt><dd>{priority[0]?.toUpperCase() + priority.slice(1)}</dd></div>
          <div><dt>Quote preview</dt><dd>Not issued yet</dd></div>
          <div className="wide"><dt>Commercial flow</dt><dd>The job moves forward now. Quote and invoice details remain attached to this same job ID.</dd></div>
        </dl></section>
        <section className="crm-review-activities"><header><span>Programs and activities</span><button type="button" onClick={() => setStep(3)}>Edit</button></header>
          {plannedActivityDetails.length === 0
            ? <dl><div className="wide"><dt>Government activity</dt><dd>No government certificate, rebate or support activity added</dd></div></dl>
            : <div className="crm-review-activity-list">{plannedActivityDetails.map(({ selection, program, activity, calculation }, index) => <article className="crm-review-activity-card" key={`${selection.programTemplateId}:${selection.activityTemplateId}`}>
              <strong>Activity {index + 1} | {program.programCode} | {activity.registryActivityCode || activity.activityKey}</strong>
              <dl>
                <div><dt>Program</dt><dd>{program.name}</dd></div>
                <div><dt>Activity</dt><dd>{activity.title}</dd></div>
                <div><dt>Certificate output</dt><dd>{program.claimOutputCode} | {program.claimOutputLabel}</dd></div>
                <div><dt>Specification</dt><dd>{activity.specificationPart || "No separate specification part"}</dd></div>
                <div><dt>Scenario</dt><dd>{activity.scenarioCode ? `${activity.scenarioCode} | ${activity.scenario}` : activity.scenario || "No separate scenario"}</dd></div>
                <div><dt>Product category</dt><dd>{activity.productCategory || "No product category listed"}</dd></div>
                <div><dt>Approved product</dt><dd>Current government register selection required</dd></div>
                <div><dt>Evidence form</dt><dd>Published governed policy required</dd></div>
                <div><dt>Calculation</dt><dd>{calculation ? `${calculation.unit} | ${calculation.state.replaceAll("_", " ")}` : "Governed calculation not published"}</dd></div>
                <div><dt>Certificate status</dt><dd>Not created</dd></div>
              </dl>
              <a href={program.officialSourceUrl} target="_blank" rel="noreferrer">Open {program.administeringBody} source</a>
            </article>)}</div>}
        </section>
        <section><header><span>Schedule and field handoff</span><button type="button" onClick={() => setStep(4)}>Edit</button></header><dl>
          <div><dt>Appointment</dt><dd>{appointmentLabels[appointmentType]}</dd></div>
          <div><dt>Date and time</dt><dd>{scheduledStart ? new Date(scheduledStart).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Not set"}</dd></div>
          <div><dt>Technician</dt><dd>{selectedTeamMember?.displayName || "Not assigned"}</dd></div>
          <div><dt>Duration</dt><dd>{duration < 60 ? `${duration} minutes` : duration === 60 ? "1 hour" : `${Math.floor(duration / 60)}h ${duration % 60 ? `${duration % 60}m` : ""}`.trim()}</dd></div>
          <div className="wide"><dt>Visit notes</dt><dd>{appointmentNotes || "No visit notes"}</dd></div>
        </dl></section>
      </div>
      <div className="crm-wizard-actions"><button type="button" onClick={() => setStep(4)}>Back</button><button type="submit" className="btn" disabled={busy}>{busy ? "Creating job..." : "Create job"}</button></div>
    </section>
  </form>;
}
