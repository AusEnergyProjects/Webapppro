"use client";

/* eslint-disable @next/next/no-html-link-for-pages */

import { FormEvent, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, sendEmailVerification, signOut, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { createHomeEnergyPlan, homeEnergyPlanOptions as rawHomeEnergyPlanOptions } from "@/lib/home-energy-plan.mjs";
import { customerProjectOptions as rawCustomerProjectOptions, platformQuoteOptions as rawPlatformQuoteOptions } from "@/lib/customer-projects.mjs";
import { Field, SiteFooter, SiteHeader } from "./ComparatorChrome";
import { FirebaseAccountPanel } from "./FirebaseAccountPanel";
import { CustomerAssetLifecycle } from "./CustomerAssetLifecycle";
import { CustomerAssetOwnershipCentre } from "./CustomerAssetOwnershipCentre";
import { CustomerTradeQuotes } from "./CustomerTradeQuotes";
import { CustomerAppointmentRescheduling } from "./CustomerAppointmentRescheduling";

type DashboardView = "overview" | "editor" | "profile" | "detail" | "assets" | "quotes" | "appointments";
type Option = [string, string];

const homeEnergyPlanOptions = rawHomeEnergyPlanOptions as {
  goals: Option[];
  paces: Option[];
  situations: Option[];
  features: Option[];
};
const customerProjectOptions = rawCustomerProjectOptions as {
  states: string[];
  propertyTypes: Option[];
  serviceCategories: Option[];
  priorities: Option[];
  stages: Option[];
  timings: Option[];
  budgets: Option[];
  storeys: Option[];
  ageBands: Option[];
  floorAreas: Option[];
  roofTypes: Option[];
  switchboards: Option[];
  occupancies: Option[];
  accessConstraints: Option[];
};
const platformQuoteOptions = rawPlatformQuoteOptions as {
  quoteTypes: Option[];
  inclusions: Option[];
  startWindows: Option[];
};

type CustomerProfile = {
  displayName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  postcode: string;
  addressState: string;
  propertyType: string;
  householdSituation: string;
  accountUpdates: boolean;
  accountStatus: string;
  accountTier: string;
  updatedAt: string;
};

type ProjectQuote = {
  id: string;
  optionLabel: string;
  installerBusinessName: string;
  installerVerified: boolean;
  inclusions: string[];
  products: Array<{ brand: string; name: string; modelNumber: string; quantity: number; unitLabel: string; unitPriceCentsExGst: number }>;
  productSubtotalCentsExGst: number;
  labourCentsExGst: number;
  otherCentsExGst: number;
  totalCentsExGst: number;
  quoteType: string;
  startWindow: string;
  durationWeeks: number;
  workmanshipWarrantyYears: number;
  customerDecision: "reviewing" | "shortlisted" | "declined" | "accepted";
  contactRelease: null | { status: "active" | "withdrawn"; grantedAt: string; withdrawnAt: string };
  arrivalProposal: null | {
    id: string;
    status: "proposed" | "selected" | "withdrawn";
    windows: Array<{ id: string; startsAt: string; endsAt: string }>;
    installerNote: string;
    selectedWindow: null | { id: string; startsAt: string; endsAt: string };
    revision: number;
    proposedAt: string;
    selectedAt: string;
  };
  submittedAt: string;
};

type CustomerHandoverPack = {
  id: string;
  workNumber: string;
  serviceCategory: string;
  publishedAt: string;
  updatedAt: string;
  assets: Array<{
    id: string;
    assetCategory: string;
    brand: string;
    modelNumber: string;
    serialNumber: string;
    quantity: number;
    installedAt: string;
    warrantyProvider: string;
    warrantyReference: string;
    warrantyStart: string;
    warrantyEnd: string;
  }>;
  complianceItems: Array<{ id: string; label: string; status: string; completedAt: string }>;
  documents: Array<{ id: string; category: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string }>;
  corrections: Array<{ id: string; assetId: string; versionNumber: number; fieldKey: string; previousValue: string; approvedValue: string; reason: string; publishedAt: string }>;
};

type CustomerProject = {
  id: string;
  title: string;
  homeNickname: string;
  postcode: string;
  addressState: string;
  propertyType: string;
  householdSituation: string;
  goal: string;
  pace: string;
  existingFeatures: string[];
  serviceCategories: string[];
  priorities: string[];
  projectStage: string;
  timing: string;
  budgetRange: string;
  propertyContext: {
    storeys: string;
    ageBand: string;
    floorArea: string;
    roofType: string;
    switchboard: string;
    occupancy: string;
    accessConstraints: string[];
  };
  privateNotes: string;
  planSnapshot: { title?: string; summary?: string; items?: Array<{ id: string; stage: string; title: string; text: string; href: string; action: string }> };
  completedPlanItems: string[];
  status: string;
  displayStatus: string;
  submittedAt: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
  hasRetainedAssetHistory: boolean;
  contactReady: boolean;
  progress: { installerCount: number; reviewingCount: number; responseCount: number; quoteCount: number; opportunityStatus: string; expiresAt: string };
  quotes: ProjectQuote[];
  evidence: Array<{ id: string; category: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string }>;
  handoverPacks: CustomerHandoverPack[];
};

type ProjectDraft = Pick<CustomerProject, "title" | "homeNickname" | "postcode" | "addressState" | "propertyType" | "householdSituation" | "goal" | "pace" | "existingFeatures" | "serviceCategories" | "priorities" | "projectStage" | "timing" | "budgetRange" | "propertyContext" | "privateNotes">;
type PendingProjectEvidence = { id: string; file: File; category: string };

type AccountResult = {
  profile: CustomerProfile | null;
  emailVerified: boolean;
  tradeWorkspace: null | { partnerType: "installer" | "supplier" };
};

const optionLabel = (options: Array<[string, string]>, value: string) => options.find(([key]) => key === value)?.[1] || value.replaceAll("_", " ");
const currency = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
async function prepareEvidenceUpload(item: PendingProjectEvidence) {
  const quotingPhotoCategories = new Set(["property-photo", "existing-equipment", "switchboard"]);
  if (!quotingPhotoCategories.has(item.category) || !item.file.type.startsWith("image/")) return item.file;
  const objectUrl = URL.createObjectURL(item.file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("PHOTO_CONVERSION_FAILED"));
      element.src = objectUrl;
    });
    const maximumDimension = 2400;
    const scale = Math.min(1, maximumDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PHOTO_CONVERSION_FAILED");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("PHOTO_CONVERSION_FAILED")), "image/jpeg", 0.88,
    ));
    const baseName = item.file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "property-photo";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
const statusLabels: Record<string, string> = {
  draft: "Draft",
  matching: "Installer matching",
  responses: "Responses received",
  quote_review: "Quote review",
  completed: "Complete",
  withdrawn: "Withdrawn",
  archived: "Archived",
};

function projectDefaults(profile: CustomerProfile | null): ProjectDraft {
  return {
    title: "",
    homeNickname: "My home",
    postcode: profile?.postcode || "",
    addressState: profile?.addressState || "",
    propertyType: profile?.propertyType || "house",
    householdSituation: profile?.householdSituation || "owner",
    goal: "lower-bills",
    pace: "staged",
    existingFeatures: [],
    serviceCategories: [],
    priorities: ["lower-bills"],
    projectStage: "exploring",
    timing: "planning",
    budgetRange: "not_set",
    propertyContext: { storeys: "", ageBand: "", floorArea: "", roofType: "", switchboard: "", occupancy: "", accessConstraints: [] },
    privateNotes: "",
  };
}

function projectDefaultsWithSelection(profile: CustomerProfile | null, selection?: { goal?: string; pace?: string; situation?: string; features?: string[]; categories?: string[]; postcode?: string }): ProjectDraft {
  const draft = projectDefaults(profile);
  if (!selection) return draft;
  return {
    ...draft,
    goal: selection.goal || draft.goal,
    pace: selection.pace || draft.pace,
    householdSituation: selection.situation || draft.householdSituation,
    existingFeatures: selection.features || draft.existingFeatures,
    serviceCategories: selection.categories || draft.serviceCategories,
    postcode: selection.postcode || draft.postcode,
  };
}

function ProfileForm({ user, profile, onSaved }: { user: User; profile: CustomerProfile | null; onSaved: (profile: CustomerProfile) => void }) {
  const [draft, setDraft] = useState(() => ({
    displayName: profile?.displayName || user.displayName || "",
    phone: profile?.phone || "",
    addressLine1: profile?.addressLine1 || "",
    addressLine2: profile?.addressLine2 || "",
    suburb: profile?.suburb || "",
    postcode: profile?.postcode || "",
    addressState: profile?.addressState || "",
    propertyType: profile?.propertyType || "house",
    householdSituation: profile?.householdSituation || "owner",
    accountUpdates: profile?.accountUpdates ?? false,
    consent: Boolean(profile),
  }));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("Saving your private household profile...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/customer-account", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(draft) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Your profile could not be saved.");
      onSaved(result.profile);
      setStatus("Saved. Your customer account remains free and your household details stay private.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Your profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="customer-profile-panel" aria-labelledby="customer-profile-title">
    <div className="customer-panel-heading"><span>{profile ? "Privacy and profile" : "One quick setup step"}</span><h2 id="customer-profile-title">Set the defaults for your home projects</h2><p>Your phone and service address stay private while you plan and while installers review an anonymised lead. They are required only when requesting trades, and are released only when you deliberately connect with one shortlisted installer.</p></div>
    <form onSubmit={save} noValidate>
      <div className="customer-field-grid">
        <Field label="Name shown in your account"><input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} autoComplete="name" /></Field>
        <Field label="Account email"><input value={user.email || ""} readOnly aria-readonly="true" /></Field>
        <Field label="Contact phone" optional="required before requesting trades"><input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} inputMode="tel" autoComplete="tel" /></Field>
        <Field label="Service street address" optional="required before requesting trades"><input value={draft.addressLine1} onChange={(event) => setDraft({ ...draft, addressLine1: event.target.value })} autoComplete="address-line1" /></Field>
        <Field label="Address line 2" optional="optional"><input value={draft.addressLine2} onChange={(event) => setDraft({ ...draft, addressLine2: event.target.value })} autoComplete="address-line2" /></Field>
        <Field label="Service suburb" optional="required before requesting trades"><input value={draft.suburb} onChange={(event) => setDraft({ ...draft, suburb: event.target.value })} autoComplete="address-level2" /></Field>
        <Field label="Home postcode"><input value={draft.postcode} onChange={(event) => setDraft({ ...draft, postcode: event.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" maxLength={4} autoComplete="postal-code" /></Field>
        <Field label="State or territory"><select value={draft.addressState} onChange={(event) => setDraft({ ...draft, addressState: event.target.value })}><option value="">Choose one</option>{customerProjectOptions.states.map((state: string) => <option value={state} key={state}>{state}</option>)}</select></Field>
        <Field label="Usual property type"><select value={draft.propertyType} onChange={(event) => setDraft({ ...draft, propertyType: event.target.value })}>{customerProjectOptions.propertyTypes.map(([value, label]: [string, string]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        <Field label="Property situation"><select value={draft.householdSituation} onChange={(event) => setDraft({ ...draft, householdSituation: event.target.value })}>{homeEnergyPlanOptions.situations.map(([value, label]: [string, string]) => <option value={value} key={value}>{label}</option>)}</select></Field>
      </div>
      <label className="customer-check-row"><input type="checkbox" checked={draft.accountUpdates} onChange={(event) => setDraft({ ...draft, accountUpdates: event.target.checked })} /><span><strong>Optional project updates</strong><small>Allow helpful project progress emails. Security and account notices are separate. No marketing list is created.</small></span></label>
      <label className="customer-check-row"><input type="checkbox" checked={draft.consent} onChange={(event) => setDraft({ ...draft, consent: event.target.checked })} /><span><strong>Private account notice</strong><small>I understand my contact details are stored privately. No trade can access them unless I later confirm a release to that specific shortlisted installer.</small></span></label>
      <div className="customer-form-actions"><button className="btn" disabled={busy}>{busy ? "Saving..." : profile ? "Update private profile" : "Open my free dashboard"}</button></div>
      {status && <p className="customer-inline-status" role="status">{status}</p>}
    </form>
  </section>;
}

function ProjectEditor({ initial, existingId, emailVerified, onCancel, onSave, onSubmit }: {
  initial: ProjectDraft;
  existingId?: string;
  emailVerified: boolean;
  onCancel: () => void;
  onSave: (draft: ProjectDraft, id?: string) => Promise<string>;
  onSubmit: (draft: ProjectDraft, evidence: PendingProjectEvidence[], confirmInstallerPhotoSharing: boolean, id?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(initial);
  const [step, setStep] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [savedId, setSavedId] = useState(existingId || "");
  const [pendingEvidence, setPendingEvidence] = useState<PendingProjectEvidence[]>([]);
  const [confirmInstallerPhotoSharing, setConfirmInstallerPhotoSharing] = useState(false);
  const plan = useMemo(() => createHomeEnergyPlan({ goal: draft.goal, pace: draft.pace, situation: draft.householdSituation, features: draft.existingFeatures }), [draft.goal, draft.pace, draft.householdSituation, draft.existingFeatures]);
  const set = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setDirty(true); setStatus(""); };
  const toggle = (key: "existingFeatures" | "serviceCategories" | "priorities", value: string) => set(key, draft[key].includes(value) ? draft[key].filter((item) => item !== value) : [...draft[key], value]);
  const setPropertyContext = (key: keyof ProjectDraft["propertyContext"], value: string | string[]) => {
    set("propertyContext", { ...draft.propertyContext, [key]: value });
  };
  const toggleAccessConstraint = (value: string) => setPropertyContext("accessConstraints",
    draft.propertyContext.accessConstraints.includes(value)
      ? draft.propertyContext.accessConstraints.filter((item) => item !== value)
      : [...draft.propertyContext.accessConstraints, value]);
  const addEvidence = (files: FileList | null, camera = false) => {
    if (!files?.length) return;
    const next = [...files].slice(0, Math.max(0, 5 - pendingEvidence.length)).map((file) => ({
      id: crypto.randomUUID(),
      file,
      category: camera || file.type.startsWith("image/") ? "property-photo" : "supporting-document",
    }));
    setPendingEvidence((current) => [...current, ...next]);
    setStatus(next.length < files.length ? "Up to five new files can be added with one request. Remove one to choose another." : "Files selected. They upload only when you request installer responses.");
  };

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  function validate(nextStep: number) {
    if (step === 1 && (!draft.title.trim() || !/^\d{4}$/.test(draft.postcode) || !draft.addressState)) { setStatus("Add a private project name, postcode and state before continuing."); return false; }
    if (step === 4 && (!draft.serviceCategories.length || !draft.priorities.length)) { setStatus("Choose at least one type of work and one priority before reviewing the enquiry."); return false; }
    if (step === 4 && ![draft.propertyContext.storeys, draft.propertyContext.ageBand, draft.propertyContext.floorArea,
      draft.propertyContext.roofType, draft.propertyContext.switchboard, draft.propertyContext.occupancy].every(Boolean)) {
      setStatus("Complete the property details before reviewing the enquiry. Choose Not sure where needed."); return false;
    }
    setStatus(""); setStep(nextStep); window.scrollTo({ top: 0, behavior: "smooth" }); return true;
  }

  async function saveDraft() {
    setBusy(true); setStatus("Saving your draft...");
    try {
      const id = await onSave(draft, savedId || undefined);
      setSavedId(id); setDirty(false); setStatus("Draft saved to your private account.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The draft could not be saved."); }
    finally { setBusy(false); }
  }

  async function submitProject() {
    if (!emailVerified) { setStatus("Verify your account email before requesting installer responses."); return; }
    if (!confirmInstallerPhotoSharing) { setStatus("Confirm the quoting photo sharing notice before requesting installer responses."); return; }
    if (!draft.serviceCategories.length || !draft.priorities.length) { setStatus("Choose the work and priorities before submitting."); setStep(4); return; }
    setBusy(true); setStatus("Creating the anonymised installer scope...");
    try { await onSubmit(draft, pendingEvidence, confirmInstallerPhotoSharing, savedId || undefined); setDirty(false); setPendingEvidence([]); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The enquiry could not be submitted."); }
    finally { setBusy(false); }
  }

  const propertyLabel = optionLabel(customerProjectOptions.propertyTypes, draft.propertyType);
  const categoryLabels = draft.serviceCategories.map((item) => optionLabel(customerProjectOptions.serviceCategories, item));
  return <section className="customer-project-editor" aria-labelledby="project-editor-title">
    <header className="customer-editor-header"><div><span>{savedId ? "Edit your saved project" : "Create a home project"}</span><h1 id="project-editor-title">{draft.title || "Build a simple project plan"}</h1><p>Answer one small step at a time. Save whenever you want and come back later.</p></div><button type="button" onClick={onCancel}>Exit project</button></header>
    <div className="customer-stepper" aria-label={`Project builder step ${step} of 5`}><div style={{ width: `${step * 20}%` }} /><ol>{["Home", "Goals", "Your plan", "Work", "Privacy"].map((label, index) => <li className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""} key={label}><span>{index + 1}</span>{label}</li>)}</ol></div>
    {status && <p className="customer-editor-status" role="alert">{status}</p>}
    <div className="customer-editor-body">
      {step === 1 && <section className="customer-editor-step"><div className="customer-step-heading"><span>Step 1</span><h2>Which home and project is this?</h2><p>The name and home nickname stay inside your account. Installers receive no customer-created titles.</p></div><div className="customer-field-grid"><Field label="Private project name"><input value={draft.title} onChange={(event) => set("title", event.target.value)} placeholder="Example: Winter comfort plan" /></Field><Field label="Home nickname"><input value={draft.homeNickname} onChange={(event) => set("homeNickname", event.target.value)} placeholder="My home" /></Field><Field label="Project postcode"><input value={draft.postcode} onChange={(event) => set("postcode", event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} /></Field><Field label="State or territory"><select value={draft.addressState} onChange={(event) => set("addressState", event.target.value)}><option value="">Choose one</option>{customerProjectOptions.states.map((state: string) => <option key={state}>{state}</option>)}</select></Field><Field label="Property type"><select value={draft.propertyType} onChange={(event) => set("propertyType", event.target.value)}>{customerProjectOptions.propertyTypes.map(([value, label]: [string, string]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="Property situation"><select value={draft.householdSituation} onChange={(event) => set("householdSituation", event.target.value)}>{homeEnergyPlanOptions.situations.map(([value, label]: [string, string]) => <option value={value} key={value}>{label}</option>)}</select></Field></div></section>}
      {step === 2 && <section className="customer-editor-step"><div className="customer-step-heading"><span>Step 2</span><h2>What would you like to improve?</h2><p>Your answers build a private step-by-step plan. Nothing is sent to an installer yet.</p></div><fieldset className="customer-choice-group"><legend>Main goal</legend><div className="customer-choice-grid">{homeEnergyPlanOptions.goals.map(([value, label]: [string, string]) => <label className={draft.goal === value ? "selected" : ""} key={value}><input type="radio" name="customer-goal" checked={draft.goal === value} onChange={() => set("goal", value)} /><span>{label}</span></label>)}</div></fieldset><fieldset className="customer-choice-group"><legend>What is already in the home?</legend><div className="customer-choice-grid">{homeEnergyPlanOptions.features.map(([value, label]: [string, string]) => <label className={draft.existingFeatures.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={draft.existingFeatures.includes(value)} onChange={() => toggle("existingFeatures", value)} /><span>{label}</span></label>)}</div></fieldset><fieldset className="customer-choice-group"><legend>Preferred pace</legend><div className="customer-choice-grid compact">{homeEnergyPlanOptions.paces.map(([value, label]: [string, string]) => <label className={draft.pace === value ? "selected" : ""} key={value}><input type="radio" name="customer-pace" checked={draft.pace === value} onChange={() => set("pace", value)} /><span>{label}</span></label>)}</div></fieldset></section>}
      {step === 3 && <section className="customer-editor-step"><div className="customer-step-heading"><span>Step 3</span><h2>{plan.title}</h2><p>{plan.summary}</p></div><ol className="customer-roadmap-preview">{plan.items.map((item: { id: string; stage: string; title: string; text: string }, index: number) => <li key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{item.stage}</small><h3>{item.title}</h3><p>{item.text}</p></div></li>)}</ol><div className="customer-guidance-note"><strong>Keep this plan even if you do not request prices</strong><p>Save it, tick off completed steps and keep private notes. Installer options are completely optional and start only after the privacy check.</p></div></section>}
      {step === 4 && <section className="customer-editor-step">
        <div className="customer-step-heading"><span>Step 4</span><h2>Describe the property and the work you may want priced</h2><p>These structured property facts help matched installers judge suitability without receiving your identity or exact location.</p></div>
        <div className="customer-field-grid customer-property-context-grid">
          <Field label="Home height"><select value={draft.propertyContext.storeys} onChange={(event) => setPropertyContext("storeys", event.target.value)}><option value="">Choose one</option>{customerProjectOptions.storeys.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
          <Field label="Approximate home age"><select value={draft.propertyContext.ageBand} onChange={(event) => setPropertyContext("ageBand", event.target.value)}><option value="">Choose one</option>{customerProjectOptions.ageBands.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
          <Field label="Approximate floor area"><select value={draft.propertyContext.floorArea} onChange={(event) => setPropertyContext("floorArea", event.target.value)}><option value="">Choose one</option>{customerProjectOptions.floorAreas.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
          <Field label="Main roof type"><select value={draft.propertyContext.roofType} onChange={(event) => setPropertyContext("roofType", event.target.value)}><option value="">Choose one</option>{customerProjectOptions.roofTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
          <Field label="Switchboard"><select value={draft.propertyContext.switchboard} onChange={(event) => setPropertyContext("switchboard", event.target.value)}><option value="">Choose one</option>{customerProjectOptions.switchboards.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
          <Field label="Usual access timing"><select value={draft.propertyContext.occupancy} onChange={(event) => setPropertyContext("occupancy", event.target.value)}><option value="">Choose one</option>{customerProjectOptions.occupancies.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
        </div>
        <fieldset className="customer-choice-group"><legend>Access considerations, optional</legend><div className="customer-choice-grid">{customerProjectOptions.accessConstraints.map(([value, label]) => <label className={draft.propertyContext.accessConstraints.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={draft.propertyContext.accessConstraints.includes(value)} onChange={() => toggleAccessConstraint(value)} /><span>{label}</span></label>)}</div></fieldset>
        <fieldset className="customer-choice-group"><legend>Types of work</legend><div className="customer-choice-grid">{customerProjectOptions.serviceCategories.map(([value, label]: [string, string]) => <label className={draft.serviceCategories.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={draft.serviceCategories.includes(value)} onChange={() => toggle("serviceCategories", value)} /><span>{label}</span></label>)}</div></fieldset>
        <fieldset className="customer-choice-group"><legend>Priorities</legend><div className="customer-choice-grid">{customerProjectOptions.priorities.map(([value, label]: [string, string]) => <label className={draft.priorities.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={draft.priorities.includes(value)} onChange={() => toggle("priorities", value)} /><span>{label}</span></label>)}</div></fieldset>
        <div className="customer-field-grid"><Field label="Project stage"><select value={draft.projectStage} onChange={(event) => set("projectStage", event.target.value)}>{customerProjectOptions.stages.map(([value, label]: [string, string]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="Timing"><select value={draft.timing} onChange={(event) => set("timing", event.target.value)}>{customerProjectOptions.timings.map(([value, label]: [string, string]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="Private planning budget"><select value={draft.budgetRange} onChange={(event) => set("budgetRange", event.target.value)}>{customerProjectOptions.budgets.map(([value, label]: [string, string]) => <option value={value} key={value}>{label}</option>)}</select></Field></div>
        <section className="customer-project-evidence-picker" aria-labelledby="project-evidence-title"><header><div><span>Optional property evidence</span><h3 id="project-evidence-title">Add photos or supporting files</h3><p>On a phone or tablet you can take a new photo with the device camera. Property photos help quoting and are shared with every verified installer allocated to this enquiry. PDF supporting documents stay restricted until you accept one installer.</p></div><strong>{pendingEvidence.length} selected</strong></header><div className="customer-project-evidence-actions"><label><span>Choose photos or files</span><input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={(event) => { addEvidence(event.target.files); event.target.value = ""; }} /></label><label><span>Take a property photo</span><input type="file" accept="image/*" capture="environment" onChange={(event) => { addEvidence(event.target.files, true); event.target.value = ""; }} /></label></div>{pendingEvidence.length > 0 && <ul>{pendingEvidence.map((item) => <li key={item.id}><span><strong>{item.file.name}</strong><small>{fileSize(item.file.size)} | {item.category.replaceAll("-", " ")}</small></span><button type="button" onClick={() => setPendingEvidence((current) => current.filter((entry) => entry.id !== item.id))}>Remove</button></li>)}</ul>}<small>Up to five new files in one request, 8 MB each. Do not photograph people, mail, licence plates, identity documents, bills, meter identifiers, passwords or anything that reveals information you do not want the allocated installers to see.</small></section>
        <Field label="Private project notes" optional="never shared with trades" hint="Use this for questions, product ideas or reminders. Do not store passwords, identity documents, bills or meter identifiers."><textarea rows={6} maxLength={2000} value={draft.privateNotes} onChange={(event) => set("privateNotes", event.target.value)} /></Field>
      </section>}
      {step === 5 && <section className="customer-editor-step"><div className="customer-step-heading"><span>Step 5</span><h2>Review exactly what installers can see</h2><p>The platform generates this summary from controlled choices. Your name, email, home nickname, project name, private notes and exact postcode stay hidden during matching and quote review.</p></div><div className="customer-privacy-preview"><div className="customer-preview-visible"><span>Installer view</span><h3>{categoryLabels.length === 1 ? `${categoryLabels[0]} project` : "Multi-upgrade home project"}</h3><dl><div><dt>Region</dt><dd>{draft.addressState}, exact location withheld</dd></div><div><dt>Property</dt><dd>{propertyLabel}</dd></div><div><dt>Home context</dt><dd>{[optionLabel(customerProjectOptions.storeys, draft.propertyContext.storeys), optionLabel(customerProjectOptions.ageBands, draft.propertyContext.ageBand), optionLabel(customerProjectOptions.floorAreas, draft.propertyContext.floorArea), optionLabel(customerProjectOptions.roofTypes, draft.propertyContext.roofType), optionLabel(customerProjectOptions.switchboards, draft.propertyContext.switchboard)].join(", ")}</dd></div><div><dt>Stage</dt><dd>{optionLabel(customerProjectOptions.stages, draft.projectStage)}</dd></div><div><dt>Timing</dt><dd>{optionLabel(customerProjectOptions.timings, draft.timing)}</dd></div><div><dt>Work</dt><dd>{categoryLabels.join(", ") || "Choose work types"}</dd></div><div><dt>Priorities</dt><dd>{draft.priorities.map((item) => optionLabel(customerProjectOptions.priorities, item)).join(", ") || "Choose priorities"}</dd></div><div><dt>Quoting photos</dt><dd>{pendingEvidence.filter((item) => item.category === "property-photo").length || "None attached"}</dd></div></dl></div><aside><strong>Withheld during matching</strong><ul><li>Name or account email</li><li>Phone or street address</li><li>Exact postcode or precise distance</li><li>Private project names and notes</li><li>PDF supporting documents until one installer is accepted</li><li>Bills, NMI or meter data</li></ul></aside></div><label className="customer-submit-consent"><input type="checkbox" checked={confirmInstallerPhotoSharing} onChange={(event) => setConfirmInstallerPhotoSharing(event.target.checked)} /><span>I understand that every verified installer allocated to this enquiry can view attached quoting photos. Supporting documents remain restricted until I accept one connected installer.</span></label></section>}
    </div>
    <footer className="customer-editor-actions"><div><button type="button" onClick={() => void saveDraft()} disabled={busy}>{busy ? "Working..." : savedId ? "Save changes" : "Save private draft"}</button><small>{dirty ? "Changes not yet saved" : savedId ? "Saved to your account" : "Nothing is sent until you choose"}</small></div><div>{step > 1 && <button type="button" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>}{step < 5 ? <button className="primary" type="button" onClick={() => validate(step + 1)} disabled={busy}>Continue</button> : <button className="primary" type="button" onClick={() => void submitProject()} disabled={busy || !emailVerified}>{busy ? "Submitting..." : emailVerified ? "Request private installer responses" : "Verify email to submit"}</button>}</div></footer>
  </section>;
}

function ProjectDetail({ user, project, busy, onAction, onDownloadHandover, onDownloadEvidence, onDeleteEvidence }: { user: User; project: CustomerProject; busy: boolean; onAction: (action: string, extra?: Record<string, unknown>) => Promise<void>; onDownloadHandover: (document: CustomerHandoverPack["documents"][number]) => Promise<void>; onDownloadEvidence: (item: CustomerProject["evidence"][number]) => Promise<void>; onDeleteEvidence: (item: CustomerProject["evidence"][number]) => Promise<void> }) {
  const [releaseConfirmations, setReleaseConfirmations] = useState<Record<string, boolean>>({});
  const [acceptConfirmations, setAcceptConfirmations] = useState<Record<string, boolean>>({});
  const planItems = project.planSnapshot.items || [];
  const progressSteps = [
    ["Scope saved", Boolean(project.submittedAt)],
    ["Eligible installers matched", project.progress.installerCount > 0],
    ["Structured response received", project.progress.responseCount > 0],
    ["Quote option ready", project.quotes.length > 0],
    ["Digital handover published", project.handoverPacks.length > 0],
  ] as const;
  return <section className="customer-project-detail" aria-labelledby="customer-project-title">
    <header className="customer-project-detail-header"><div><span>{statusLabels[project.displayStatus] || project.displayStatus}</span><h1 id="customer-project-title">{project.title}</h1><p>{project.homeNickname} | {project.addressState} {project.postcode} | Updated {new Date(project.updatedAt).toLocaleDateString("en-AU")}</p></div><div><a href="/account">All projects</a>{project.status === "draft" && <a className="primary" href={`/account/projects/${project.id}?edit=1`}>Edit draft</a>}</div></header>
    <div className="customer-project-detail-grid">
      <div className="customer-project-primary">
        <section className="customer-detail-panel"><div className="customer-panel-heading"><span>Saved roadmap</span><h2>{project.planSnapshot.title || "Your ordered home energy plan"}</h2><p>{project.planSnapshot.summary}</p></div><ol className="customer-saved-roadmap">{planItems.map((item, index) => { const complete = project.completedPlanItems.includes(item.id); return <li className={complete ? "complete" : ""} key={item.id}><button type="button" aria-pressed={complete} onClick={() => void onAction("toggle_milestone", { itemId: item.id, complete: !complete })} disabled={busy}><span>{complete ? "✓" : String(index + 1).padStart(2, "0")}</span></button><div><small>{item.stage}</small><h3>{item.title}</h3><p>{item.text}</p><a href={item.href}>{item.action}</a></div></li>; })}</ol></section>
        {project.status !== "draft" && <section className="customer-detail-panel"><div className="customer-panel-heading"><span>Platform progress</span><h2>Your enquiry stays inside the platform</h2><p>Installers can review and submit structured options without seeing your identity or exact location. Direct contact becomes available only to an installer you deliberately connect with.</p></div><ol className="customer-progress-list">{progressSteps.map(([label, complete], index) => <li className={complete ? "complete" : ""} key={label}><span>{complete ? "✓" : index + 1}</span><div><strong>{label}</strong><small>{complete ? "Complete" : "Waiting"}</small></div></li>)}</ol><div className="customer-progress-stats"><div><strong>{project.progress.installerCount}</strong><span>eligible installers allocated</span></div><div><strong>{project.progress.responseCount}</strong><span>expressions of interest</span></div><div><strong>{project.progress.quoteCount}</strong><span>structured quote options</span></div></div></section>}
        {project.evidence.length > 0 && <section className="customer-detail-panel customer-project-evidence-library"><div className="customer-panel-heading"><span>Property evidence</span><h2>Your project photos and files</h2><p>Property photos are shared with the verified installers allocated to this enquiry so they can quote. Supporting documents remain restricted until you accept one connected installer.</p></div><div>{project.evidence.map((item) => <article key={item.id}><div><span>{item.category.replaceAll("-", " ")}</span><strong>{item.fileName}</strong><small>{fileSize(item.sizeBytes)} | Added {new Date(item.createdAt).toLocaleDateString("en-AU")}</small></div><div><button type="button" disabled={busy} onClick={() => void onDownloadEvidence(item)}>Download</button><button type="button" disabled={busy} onClick={() => void onDeleteEvidence(item)}>Remove future access</button></div></article>)}</div><small>Removing a file stops future portal downloads. It cannot erase information the installer already viewed or saved.</small></section>}
        {project.quotes.length > 0 && <section className="customer-detail-panel"><div className="customer-panel-heading"><span>Compare safely</span><h2>Structured quote options</h2><p>Review the verified business behind each option before deciding whether to share your contact details. Product lines preserve the wholesaler price selected by the installer at submission.</p></div><div className="customer-quote-grid">{project.quotes.map((quote) => <article className={quote.customerDecision === "accepted" ? "accepted" : quote.customerDecision === "shortlisted" ? "shortlisted" : quote.customerDecision === "declined" ? "declined" : ""} key={quote.id}><header><div><span>{quote.installerVerified ? "Verified installer" : quote.optionLabel}</span><h3>{quote.installerBusinessName}</h3><small>{optionLabel(platformQuoteOptions.quoteTypes, quote.quoteType)}</small></div>{quote.customerDecision === "accepted" ? <strong>Accepted for next step</strong> : quote.customerDecision === "shortlisted" && <strong>Shortlisted</strong>}</header><div className="customer-quote-total"><span>Indicative total</span><strong>{currency(Math.round(quote.totalCentsExGst * 1.1))}</strong><small>{currency(quote.totalCentsExGst)} ex GST</small></div><dl><div><dt>Products</dt><dd>{currency(quote.productSubtotalCentsExGst)} ex GST</dd></div><div><dt>Labour</dt><dd>{currency(quote.labourCentsExGst)} ex GST</dd></div><div><dt>Other services</dt><dd>{currency(quote.otherCentsExGst)} ex GST</dd></div><div><dt>Start window</dt><dd>{optionLabel(platformQuoteOptions.startWindows, quote.startWindow)}</dd></div><div><dt>Expected duration</dt><dd>{quote.durationWeeks ? `${quote.durationWeeks} week${quote.durationWeeks === 1 ? "" : "s"}` : "To confirm"}</dd></div><div><dt>Workmanship warranty</dt><dd>{quote.workmanshipWarrantyYears ? `${quote.workmanshipWarrantyYears} years` : "To confirm"}</dd></div></dl>{quote.products.length > 0 && <details><summary>Fixed-price products ({quote.products.length})</summary><ul>{quote.products.map((product) => <li key={`${product.brand}-${product.modelNumber}`}><span>{product.brand} {product.name}<small>{product.modelNumber} | {product.quantity} {product.unitLabel}</small></span><strong>{currency(product.quantity * product.unitPriceCentsExGst)} ex GST</strong></li>)}</ul></details>}<details><summary>Included services</summary><ul>{quote.inclusions.map((item) => <li key={item}>{optionLabel(platformQuoteOptions.inclusions, item)}</li>)}</ul></details>{quote.customerDecision !== "accepted" && <div className="customer-quote-actions"><button type="button" className="primary" disabled={busy || quote.customerDecision === "shortlisted"} onClick={() => void onAction("quote_decision", { quoteId: quote.id, decision: "shortlisted" })}>{quote.customerDecision === "shortlisted" ? "Shortlisted" : "Shortlist this option"}</button><button type="button" disabled={busy || quote.customerDecision === "declined"} onClick={() => void onAction("quote_decision", { quoteId: quote.id, decision: "declined" })}>Not for me</button></div>}{quote.customerDecision === "shortlisted" && quote.contactRelease?.status !== "active" && <div className="customer-contact-release"><strong>Connect with {quote.installerBusinessName}</strong>{project.contactReady ? <><label className="customer-check-row"><input type="checkbox" checked={Boolean(releaseConfirmations[quote.id])} onChange={(event) => setReleaseConfirmations((current) => ({ ...current, [quote.id]: event.target.checked }))} /><span><small>I authorise AEA to release my account name, email, phone and full service address to this specific verified installer so they can contact me about this project. Other installers remain anonymised.</small></span></label><button type="button" className="primary" disabled={busy || !releaseConfirmations[quote.id]} onClick={() => void onAction("release_contact", { quoteId: quote.id, confirmContactRelease: true })}>Share details with this installer</button></> : <p>Add your phone and complete service address in <a href="/account/profile">Privacy and profile</a>, matching this project postcode, before connecting.</p>}</div>}{quote.customerDecision === "shortlisted" && quote.contactRelease?.status === "active" && <div className="customer-contact-release active"><strong>Choose {quote.installerBusinessName} for the next step</strong><p>Accepting this installer lets them view restricted supporting documents and propose arrival windows. It does not accept a final contract or authorise installation work.</p><label className="customer-check-row"><input type="checkbox" checked={Boolean(acceptConfirmations[quote.id])} onChange={(event) => setAcceptConfirmations((current) => ({ ...current, [quote.id]: event.target.checked }))} /><span><small>I choose this verified installer for site assessment and scheduling preparation.</small></span></label><button type="button" className="primary" disabled={busy || !acceptConfirmations[quote.id]} onClick={() => void onAction("quote_decision", { quoteId: quote.id, decision: "accepted", confirmInstallerAcceptance: true })}>Accept installer for next step</button></div>}{quote.customerDecision === "accepted" && quote.contactRelease?.status === "active" && <div className="customer-contact-release active"><strong>{quote.installerBusinessName} is accepted for the next step</strong><p>This installer can view your released contact details and supporting documents. They provide the arrival windows for you to review.</p><button type="button" disabled={busy} onClick={() => void onAction("withdraw_contact", { quoteId: quote.id })}>Stop future platform access</button><small>This cannot erase information already viewed or saved.</small></div>}{quote.customerDecision === "accepted" && quote.arrivalProposal?.status === "proposed" && <div className="customer-arrival-proposal"><strong>Choose an installer-proposed arrival window</strong>{quote.arrivalProposal.installerNote && <p>{quote.arrivalProposal.installerNote}</p>}<div>{quote.arrivalProposal.windows.map((window) => <button type="button" key={window.id} disabled={busy} onClick={() => void onAction("select_arrival_window", { proposalId: quote.arrivalProposal?.id, windowId: window.id, expectedRevision: quote.arrivalProposal?.revision })}><span>{new Date(window.startsAt).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}</span><strong>{window.startsAt.slice(11)} to {window.endsAt.slice(11)}</strong></button>)}</div><small>The installer supplies these options. Your selection is recorded before any CRM appointment is created or changed.</small></div>}{quote.customerDecision === "accepted" && quote.arrivalProposal?.status === "selected" && quote.arrivalProposal.selectedWindow && <div className="customer-arrival-proposal selected"><strong>Arrival window selected</strong><p>{new Date(quote.arrivalProposal.selectedWindow.startsAt).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, {quote.arrivalProposal.selectedWindow.startsAt.slice(11)} to {quote.arrivalProposal.selectedWindow.endsAt.slice(11)}</p><small>The installer can now use this reviewed window when preparing the CRM appointment.</small></div>}</article>)}</div><div className="customer-guidance-note"><strong>You control the handover</strong><p>Shortlisting alone does not create a contract, release your contact details, supporting documents or authorise work. Quoting photos are already shared with the allocated verified installers under the submission notice.</p></div></section>}
        {project.handoverPacks.length > 0 && <section className="customer-detail-panel customer-handover-library"><div className="customer-panel-heading"><span>Keep for the life of your home</span><h2>Your digital asset and handover library</h2><p>Approved installed products, warranty records, completion checks and documents stay in this free household account. Only an installer you explicitly connected with received contact details for this project.</p></div><div className="customer-handover-list">{project.handoverPacks.map((handover) => <article key={handover.id}>
          <header><div><span>{handover.workNumber}</span><h3>{optionLabel(customerProjectOptions.serviceCategories, handover.serviceCategory)}</h3><small>Platform reviewed and published {new Date(handover.publishedAt).toLocaleDateString("en-AU")}</small></div><strong>Approved handover</strong></header>
          <div className="customer-handover-metrics"><span>{handover.assets.length} installed asset{handover.assets.length === 1 ? "" : "s"}</span><span>{handover.complianceItems.length} completion checks</span><span>{handover.documents.length} protected document{handover.documents.length === 1 ? "" : "s"}</span></div>
          <div className="customer-handover-assets">{handover.assets.map((asset) => <section key={asset.id}><div><span>{asset.assetCategory.replaceAll("-", " ")}</span><h4>{asset.brand} {asset.modelNumber}</h4><small>{asset.serialNumber ? `Serial ${asset.serialNumber}` : "Serial not recorded"} | Quantity {asset.quantity}</small></div><dl><div><dt>Installed</dt><dd>{asset.installedAt || "Not recorded"}</dd></div><div><dt>Warranty provider</dt><dd>{asset.warrantyProvider || "Not recorded"}</dd></div><div><dt>Warranty reference</dt><dd>{asset.warrantyReference || "Not recorded"}</dd></div><div><dt>Warranty end</dt><dd>{asset.warrantyEnd || "Not recorded"}</dd></div></dl></section>)}</div>
          <details><summary>Completion record</summary><ul>{handover.complianceItems.map((item) => <li key={item.id}><span>{item.label}</span><strong>{item.status === "not_applicable" ? "Not applicable" : "Complete"}</strong></li>)}</ul></details>
          <div className="customer-handover-documents"><h4>Documents to keep</h4>{handover.documents.map((document) => <section key={document.id}><div><span>{document.category.replaceAll("-", " ")}</span><strong>{document.fileName}</strong><small>{fileSize(document.sizeBytes)}</small></div><button type="button" disabled={busy} onClick={() => void onDownloadHandover(document)}>Download</button></section>)}</div>
          {handover.corrections.length > 0 && <details className="customer-correction-history"><summary>Approved record corrections ({handover.corrections.length})</summary><ol>{handover.corrections.map((correction) => <li key={correction.id}><span>Version {correction.versionNumber}</span><strong>{correction.fieldKey.replaceAll("_", " ")}: {correction.previousValue || "Not recorded"} to {correction.approvedValue || "Not recorded"}</strong><p>{correction.reason}</p><small>Published {new Date(correction.publishedAt).toLocaleDateString("en-AU")}</small></li>)}</ol></details>}
        </article>)}</div></section>}
        {project.handoverPacks.length > 0 && <CustomerAssetLifecycle user={user} projectId={project.id} />}
      </div>
      <aside className="customer-project-sidebar"><section><span>Private project record</span><h2>Scope at a glance</h2><dl><div><dt>Work</dt><dd>{project.serviceCategories.map((item) => optionLabel(customerProjectOptions.serviceCategories, item)).join(", ") || "Not selected"}</dd></div><div><dt>Timing</dt><dd>{optionLabel(customerProjectOptions.timings, project.timing)}</dd></div><div><dt>Private budget</dt><dd>{optionLabel(customerProjectOptions.budgets, project.budgetRange)}</dd></div><div><dt>Completed roadmap steps</dt><dd>{project.completedPlanItems.length} of {planItems.length}</dd></div></dl></section><section className="customer-private-notes"><span>Only you can see this</span><h2>Private notes</h2><p>{project.privateNotes || "No private notes saved yet."}</p></section><section className="customer-project-controls"><span>Project controls</span>{project.status === "draft" && !project.contactReady && <small>Add a phone number and service address matching this project in <a href="/account/profile">Privacy and profile</a> before requesting trades.</small>}{project.status === "draft" && <button className="primary" type="button" onClick={() => void onAction("submit")} disabled={busy || !project.contactReady}>Request installer responses</button>}<button type="button" onClick={() => void onAction("duplicate")} disabled={busy}>Duplicate as a new draft</button>{["matching", "quote_review"].includes(project.status) && <button type="button" onClick={() => void onAction("withdraw")} disabled={busy}>Withdraw enquiry</button>}{["matching", "quote_review"].includes(project.status) && <button type="button" onClick={() => void onAction("complete")} disabled={busy}>Mark project complete</button>}{project.hasRetainedAssetHistory ? <small>Asset and handover history stays in your completed project library. Live asset access may belong to another household after an approved transfer.</small> : ["draft", "withdrawn", "completed"].includes(project.status) && <button type="button" onClick={() => void onAction("archive")} disabled={busy}>Archive project</button>}</section></aside>
    </div>
  </section>;
}

export function CustomerDashboard({ initialView = "overview", initialProjectId = "", initialEdit = false, initialPlannerSelection }: { initialView?: "overview" | "new" | "profile" | "assets" | "quotes" | "appointments"; initialProjectId?: string; initialEdit?: boolean; initialPlannerSelection?: { goal?: string; pace?: string; situation?: string; features?: string[]; categories?: string[]; postcode?: string } }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<AccountResult>({ profile: null, emailVerified: false, tradeWorkspace: null });
  const [projects, setProjects] = useState<CustomerProject[]>([]);
  const [view, setView] = useState<DashboardView>(initialProjectId ? initialEdit ? "editor" : "detail" : initialView === "new" ? "editor" : initialView === "profile" ? "profile" : initialView === "assets" ? "assets" : initialView === "quotes" ? "quotes" : initialView === "appointments" ? "appointments" : "overview");
  const [selectedId, setSelectedId] = useState(initialProjectId);
  const [editingId, setEditingId] = useState(initialEdit ? initialProjectId : "");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged(firebaseAuth, (nextUser) => { setUser(nextUser); setAuthReady(true); if (!nextUser) { setAccount({ profile: null, emailVerified: false, tradeWorkspace: null }); setProjects([]); } }), []);

  async function load(nextUser: User) {
    setLoading(true); setStatus("");
    try {
      const token = await nextUser.getIdToken();
      const accountResponse = await fetch("/api/customer-account", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const accountResult = await accountResponse.json().catch(() => ({}));
      if (!accountResponse.ok || !accountResult.ok) throw new Error(accountResult.error || "The customer account could not be loaded.");
      setAccount({ profile: accountResult.profile, emailVerified: Boolean(accountResult.emailVerified), tradeWorkspace: accountResult.tradeWorkspace || null });
      if (!accountResult.profile) { setView("profile"); return; }
      const projectsResponse = await fetch("/api/customer-projects", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const projectsResult = await projectsResponse.json().catch(() => ({}));
      if (!projectsResponse.ok || !projectsResult.ok) throw new Error(projectsResult.error || "Your projects could not be loaded.");
      setProjects(projectsResult.projects || []);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Your dashboard could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!user) return;
    const frame = window.requestAnimationFrame(() => void load(user));
    return () => window.cancelAnimationFrame(frame);
  }, [user]);

  async function saveProfile(profile: CustomerProfile) {
    setAccount((current) => ({ ...current, profile }));
    setView(initialView === "new" ? "editor" : initialView === "assets" ? "assets" : "overview");
    if (user) await load(user);
  }

  async function projectRequest(method: "POST" | "PATCH", body: Record<string, unknown>) {
    if (!user) throw new Error("Sign in to continue.");
    const token = await user.getIdToken();
    const response = await fetch("/api/customer-projects", { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "The project could not be updated.");
    setProjects(result.projects || []);
    return result;
  }

  async function saveProject(draft: ProjectDraft, id?: string) {
    const result = await projectRequest(id ? "PATCH" : "POST", id ? { ...draft, id, action: "update" } : draft);
    return id || String(result.id);
  }

  async function submitProject(draft: ProjectDraft, evidence: PendingProjectEvidence[], confirmInstallerPhotoSharing: boolean, id?: string) {
    const projectId = await saveProject(draft, id);
    if (!user) throw new Error("Sign in to continue.");
    const token = await user.getIdToken();
    for (const item of evidence) {
      const uploadFile = await prepareEvidenceUpload(item);
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("clientUploadId", item.id);
      form.set("category", item.category);
      form.set("file", uploadFile);
      const uploadResponse = await fetch("/api/customer-project-evidence", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const uploadResult = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok || !uploadResult.ok) throw new Error(uploadResult.error || `${item.file.name} could not be uploaded.`);
    }
    const result = await projectRequest("PATCH", { id: projectId, action: "submit", confirmInstallerPhotoSharing });
    setSelectedId(projectId); setEditingId(""); setView("detail"); setStatus("Your anonymised project is now in private installer matching.");
    setProjects(result.projects || []);
    window.history.replaceState({}, "", `/account/projects/${projectId}`);
  }

  async function projectAction(project: CustomerProject, action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setStatus("");
    try {
      const result = await projectRequest("PATCH", { id: project.id, action, ...extra });
      const nextProjects = result.projects || [];
      setProjects(nextProjects);
      if (action === "duplicate") { setEditingId(result.id); setSelectedId(""); setView("editor"); window.history.replaceState({}, "", `/account/projects/${result.id}?edit=1`); }
      else if (action === "archive") { setView("overview"); setSelectedId(""); window.history.replaceState({}, "", "/account"); }
      else if (action === "quote_decision" && extra.decision === "accepted") setStatus("Installer accepted for the next step. They can now review supporting documents and propose arrival windows.");
      else if (action === "quote_decision") setStatus("Quote preference saved. Your details remain private until you separately confirm a connection.");
      else if (action === "release_contact") setStatus("Contact details released only to the selected verified installer.");
      else if (action === "withdraw_contact") setStatus("Future portal access to those contact details has been removed.");
      else if (action === "select_arrival_window") setStatus("Installer arrival window selected and recorded for scheduling preparation.");
      else setStatus("Project updated.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The project could not be updated."); }
    finally { setBusy(false); }
  }

  async function downloadHandoverDocument(document: CustomerHandoverPack["documents"][number]) {
    if (!user) return;
    setBusy(true); setStatus("Preparing your protected handover document...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-handover/documents?download=${encodeURIComponent(document.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "The handover document could not be downloaded.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Protected handover document download started.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The handover document could not be downloaded.");
    } finally { setBusy(false); }
  }

  async function downloadProjectEvidence(item: CustomerProject["evidence"][number]) {
    if (!user) return;
    setBusy(true); setStatus("Preparing your protected project file...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/customer-project-evidence?download=${encodeURIComponent(item.id)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "The project file could not be downloaded."); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = item.fileName; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Protected project file download started.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The project file could not be downloaded."); }
    finally { setBusy(false); }
  }

  async function deleteProjectEvidence(item: CustomerProject["evidence"][number]) {
    if (!user) return;
    setBusy(true); setStatus("Removing the project file...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/customer-project-evidence?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The project file could not be removed.");
      await load(user); setStatus("Future portal access to that project file has been removed.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The project file could not be removed."); }
    finally { setBusy(false); }
  }

  async function verifyEmail() {
    if (!user) return;
    setBusy(true);
    try { await sendEmailVerification(user); setStatus("A fresh verification link has been sent to your account email."); }
    catch { setStatus("The verification email could not be sent. Try again shortly."); }
    finally { setBusy(false); }
  }

  const selected = projects.find((project) => project.id === selectedId);
  const editing = projects.find((project) => project.id === editingId);
  const activeProjects = projects.filter((project) => ["draft", "matching", "quote_review"].includes(project.status));
  const completedSteps = projects.reduce((sum, project) => sum + project.completedPlanItems.length, 0);
  const responseCount = projects.reduce((sum, project) => sum + project.progress.responseCount, 0);

  return <main id="main-content" className="wrap customer-account-page">
    <SiteHeader active="account" />
    {!authReady || loading ? <section className="customer-loading-state" aria-live="polite"><span /><div><strong>Preparing your private dashboard</strong><p>Loading saved homes, projects and roadmaps...</p></div></section> : !user ? <>
      <header className="customer-account-hero"><div><span>Private home energy workspace</span><h1>Plan every upgrade without opening the door to sales calls</h1><p>Create projects, save a whole-home roadmap and request structured installer options. Your identity stays private until you choose a specific installer.</p><div><strong>Always free for households</strong><small>No paid tier, lead fee or feature paywall.</small></div></div><aside><span>What trades can see first</span><strong>An anonymised project scope</strong><ul><li>Controlled work categories and timing</li><li>State and service-area eligibility</li><li>No name, email, phone or exact address until you connect</li></ul></aside></header>
      <FirebaseAccountPanel />
      <section className="customer-public-benefits"><article><span>01</span><h2>Build more than one project</h2><p>Keep heating, solar, hot water, insulation and EV plans separate or coordinate them as one staged roadmap.</p></article><article><span>02</span><h2>Return to your decisions</h2><p>Save recommendations, mark roadmap steps complete and keep private notes without resubmitting your details.</p></article><article><span>03</span><h2>Control each connection</h2><p>Review structured options anonymously, then release contact details only to the verified installer you choose.</p></article></section>
    </> : !account.profile || view === "profile" ? <>
      <header className="customer-compact-hero"><div><span>{account.profile ? "Household settings" : "Welcome to your free account"}</span><h1>{account.profile ? "Keep your defaults and privacy choices current" : "Set up your private household workspace"}</h1><p>{account.profile ? "Changes apply to future projects. Existing submitted scopes remain locked." : "A few private defaults make each new project faster. Nothing is sent to installers during setup."}</p></div><div className="customer-account-controls"><span>{user.email}</span>{account.profile && <a href="/account">Back to dashboard</a>}<button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></div></header>
      <ProfileForm user={user} profile={account.profile} onSaved={(profile) => void saveProfile(profile)} />
    </> : <>
      <header className="customer-dashboard-hero"><div><span>Welcome back, {account.profile.displayName}</span><h1>Your home upgrade plans</h1><p>See what to do next, start another project or review installer options before choosing any direct contact handover.</p></div><aside><span>Household account</span><strong>Always free</strong><small>All planning, projects and response tools are included.</small></aside></header>
      <nav className="customer-dashboard-nav" aria-label="Customer account"><a className={view === "overview" ? "active" : ""} href="/account">Overview</a><a className={view === "assets" ? "active" : ""} href="/account/assets">Home records</a><a className={view === "quotes" ? "active" : ""} href="/account/quotes">Direct quotes</a><a className={view === "appointments" ? "active" : ""} href="/account/appointments">Appointments</a><a className={view === "editor" && !editingId ? "active" : ""} href="/account/projects/new">New project</a><a href="/account/profile">Privacy and profile</a>{account.tradeWorkspace && <a href="/direct-trade/dashboard">Trade workspace</a>}<button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></nav>
      {!account.emailVerified && <section className="customer-verification-banner" role="status"><div><strong>Verify your email before sending an enquiry or accepting a direct quote</strong><p>You can create and save projects now. Verification protects installer responses and binding quote decisions.</p></div><button type="button" onClick={() => void verifyEmail()} disabled={busy}>Send verification link</button></section>}
      {status && <p className="customer-dashboard-status" role="status">{status}</p>}
      {view === "editor" ? <ProjectEditor key={editing?.id || "new"} initial={editing ? { title: editing.title, homeNickname: editing.homeNickname, postcode: editing.postcode, addressState: editing.addressState, propertyType: editing.propertyType, householdSituation: editing.householdSituation, goal: editing.goal, pace: editing.pace, existingFeatures: editing.existingFeatures, serviceCategories: editing.serviceCategories, priorities: editing.priorities, projectStage: editing.projectStage, timing: editing.timing, budgetRange: editing.budgetRange, propertyContext: { ...projectDefaults(account.profile).propertyContext, ...(editing.propertyContext || {}) }, privateNotes: editing.privateNotes } : projectDefaultsWithSelection(account.profile, initialPlannerSelection)} existingId={editing?.id} emailVerified={account.emailVerified} onCancel={() => { setView("overview"); setEditingId(""); }} onSave={saveProject} onSubmit={submitProject} /> : view === "detail" && selected ? <ProjectDetail user={user} project={selected} busy={busy} onAction={(action, extra) => projectAction(selected, action, extra)} onDownloadHandover={downloadHandoverDocument} onDownloadEvidence={downloadProjectEvidence} onDeleteEvidence={deleteProjectEvidence} /> : view === "assets" ? <CustomerAssetOwnershipCentre user={user} /> : view === "quotes" ? <CustomerTradeQuotes user={user} /> : view === "appointments" ? <CustomerAppointmentRescheduling user={user} /> : <>
        <section className="customer-metric-grid"><article><span>Active projects</span><strong>{activeProjects.length}</strong><small>{projects.length ? `${projects.length} saved in total` : "Create your first saved plan"}</small></article><article><span>Plan progress</span><strong>{completedSteps}</strong><small>steps completed across your homes</small></article><article><span>Installer options</span><strong>{responseCount}</strong><small>replies kept inside AEA</small></article><article className="privacy"><span>Your details</span><strong>You decide</strong><small>released only to a selected installer</small></article></section>
        <div className="customer-overview-grid"><section className="customer-project-list-panel"><div className="customer-panel-heading"><span>My projects</span><h2>Continue where you left off</h2><p>Each saved plan and price enquiry stays separate in your free account.</p></div>{projects.filter((project) => project.status !== "archived").length ? <div className="customer-project-list">{projects.filter((project) => project.status !== "archived").map((project) => <article key={project.id}><header><div><span>{statusLabels[project.displayStatus] || project.displayStatus}</span><h3>{project.title}</h3></div><strong>{project.addressState}</strong></header><p>{project.serviceCategories.length ? project.serviceCategories.map((item) => optionLabel(customerProjectOptions.serviceCategories, item)).join(", ") : "Planning only, no installer work selected"}</p><div className="customer-project-card-progress"><span><i style={{ width: `${Math.round((project.completedPlanItems.length / Math.max(1, project.planSnapshot.items?.length || 1)) * 100)}%` }} /></span><small>{project.completedPlanItems.length} of {project.planSnapshot.items?.length || 0} plan steps complete</small></div><footer><small>Updated {new Date(project.updatedAt).toLocaleDateString("en-AU")}</small><a href={`/account/projects/${project.id}`}>{project.status === "draft" ? "Continue project" : "Open project"}</a></footer></article>)}</div> : <div className="customer-empty-state"><span>Start with one decision</span><h3>Create your first home project</h3><p>Build a step-by-step plan first. You decide later whether to request installer options.</p><a className="btn" href="/account/projects/new">Create a project</a></div>}</section><aside className="customer-overview-sidebar"><section><span>Your privacy boundary</span><h2>Personal information stays on this side</h2><ul><li>Trades cannot browse your account profile</li><li>Exact postcode is used for matching, then hidden</li><li>Private notes never enter the trade scope</li><li>Each real contact handover requires your named-installer confirmation</li></ul><a href="/account/profile">Review privacy settings</a></section><section><span>Recommended next step</span><h2>{activeProjects.length ? "Complete the next plan step" : "Start a whole-home plan"}</h2><p>{activeProjects.length ? `Open ${activeProjects[0].title} and mark the next decision you have completed.` : "A saved project gives you a clear order of work you can return to."}</p><a href={activeProjects.length ? `/account/projects/${activeProjects[0].id}` : "/account/projects/new"}>{activeProjects.length ? "Continue project" : "Build a project"}</a></section></aside></div>
      </>}
    </>}
    <SiteFooter>Customer accounts, saved roadmaps and project enquiries remain free. Installer responses are indicative until the complete property, products, approvals and installed scope are confirmed in writing.</SiteFooter>
  </main>;
}
