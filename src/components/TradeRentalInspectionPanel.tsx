"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import styles from "./TradeRentalInspectionPanel.module.css";

type MetadataField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "select" | "checkbox";
  required: boolean;
  help: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
};

type AssessmentCheck = {
  key: string;
  prompt: string;
  required: boolean;
  requiredEvidenceCount: number;
  responseType: string;
  repeatBy: string;
  photoGuidance: string;
  help: string;
  credentialGate: string;
};

type AssessmentSection = {
  key: string;
  title: string;
  summary: string;
  checks: AssessmentCheck[];
};

type ModuleTemplate = {
  key: string;
  title: string;
  credentialGate: string;
  reportBoundary: string;
  metadataFields: MetadataField[];
  sections: AssessmentSection[];
};

type AssessmentModule = {
  id: string;
  key: string;
  required: boolean;
  status: string;
  title: string;
  requiredCapability: string;
  template: ModuleTemplate;
  answers: Record<string, unknown>;
  revision: number;
  completedAt: string;
};

type AssessmentItem = {
  id: string;
  moduleId: string;
  itemKey: string;
  sectionKey: string;
  checkKey: string;
  instanceKey: string;
  locationLabel: string;
  outcome: string;
  response: Record<string, unknown>;
  publicNotes: string;
  internalNotes: string;
  requiredEvidenceCount: number;
  sortOrder: number;
  revision: number;
};

type AssessmentFinding = {
  id: string;
  moduleId: string;
  itemId: string;
  title: string;
  description: string;
  standardReference: string;
  status: string;
  severity: string;
  tradeCategory: string;
  recommendedAction: string;
  scopeSummary: string;
  quantityMilli: number;
  unitLabel: string;
  details: Record<string, unknown>;
  internalNotes: string;
  revision: number;
};

type AssessmentEvidence = {
  id: string;
  moduleId: string;
  itemId: string;
  jobMediaId: string;
  purpose: string;
  caption: string;
  status: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  capture: null | {
    source: string;
    capturedAtUtc: string;
    locationCaptured: boolean;
    latitude: number | null;
    longitude: number | null;
    accuracyMetres: number | null;
  };
};

type CompletionBlocker = { key: string; label: string };
type AssessmentItemDraft = { item: LocalItem; body: Record<string, unknown> };
type AssessmentItemDraftProvider = () => AssessmentItemDraft;
type AssessmentResult = {
  ok?: boolean;
  inspection?: {
    id: string;
    inspectionNumber: string;
    status: string;
    rulesEffectiveFrom: string;
    property: { property?: Record<string, unknown>; appointment?: Record<string, unknown> };
    assessor: Record<string, unknown>;
    revision: number;
  };
  modules?: AssessmentModule[];
  items?: AssessmentItem[];
  findings?: AssessmentFinding[];
  evidence?: AssessmentEvidence[];
  evidenceCounts?: Record<string, number>;
  evidenceBudget?: { usedBytes: number; maxBytes: number; remainingBytes: number };
  completion?: Record<string, { complete: boolean; blockers: CompletionBlocker[] }>;
  reports?: Array<{ id: string; reportNumber: string; revision: number; status: string; issuedAt: string; pdfSizeBytes: number;
    internalPdfUrl: string;
    link: null | { id: string; status: string; expiresAt: string; viewCount: number; downloadCount: number; shareUrl: string; pdfUrl: string } }>;
  issuedReport?: { reportId: string; reportNumber: string; issuedAt: string; expiresAt: string; shareUrl: string; pdfUrl: string };
  permissions?: { canEdit: boolean; canIssue: boolean; canRevokeLink: boolean; isAssignedAssessor: boolean };
  blockers?: CompletionBlocker[];
  error?: string;
};

type LocalItem = AssessmentItem & { localOnly?: boolean };
type FieldMedia = { id: string; fileName: string; createdAt: string };
type FieldUploadResult = { ok?: boolean; media?: FieldMedia[]; error?: string };

const outcomeOptions = [
  ["meets", "Meets the standard"],
  ["does_not_meet", "Does not meet"],
  ["specialist_verification_required", "Specialist verification required"],
  ["not_accessible", "Not accessible"],
  ["not_applicable", "Not applicable"],
  ["exemption_evidence_pending", "Claimed exemption, evidence pending"],
] as const;

const severityOptions = [
  ["immediate_safety_risk", "Immediate safety risk"],
  ["urgent", "Urgent"],
  ["required", "Required work"],
  ["recommended", "Recommended improvement"],
  ["information", "Information only"],
] as const;

const tradeOptions = [
  "Assessor follow-up",
  "Builder",
  "Carpenter",
  "Electrician",
  "Gasfitter",
  "Glazier",
  "Heating and cooling technician",
  "Locksmith",
  "Mould or moisture specialist",
  "Painter",
  "Plumber",
  "Roof plumber",
  "Smoke alarm technician",
  "Structural engineer",
  "Window furnishings installer",
];

const adverseOutcomes = new Set([
  "does_not_meet",
  "specialist_verification_required",
  "not_accessible",
  "exemption_evidence_pending",
]);

function dateLabel(value: string) {
  if (!value) return "Not completed";
  return new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" });
}

function bytesLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function prepareRentalEvidenceFile(file: File) {
  if (!file.type.startsWith("image/")) return file;
  if (typeof createImageBitmap !== "function") throw new Error("This browser cannot prepare a privacy-safe assessment photo. Use the TLink field app or a current browser.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the assessment photo.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    if (!blob) throw new Error("This browser could not prepare the assessment photo.");
    const baseName = file.name.replace(/\.[^.]+$/, "") || "rental-evidence";
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    image.close();
  }
}

async function browserEvidenceEnvelope(file: File) {
  const observed = new Date();
  const capture = {
    captureObservedAtUtc: observed.toISOString(),
    utcOffsetMinutes: -observed.getTimezoneOffset(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
  };
  if (!file.type.startsWith("image/")) {
    return {
      schemaVersion: 1,
      kind: "tlink-rental-inspection-document",
      captureSessionId: `capture-${crypto.randomUUID()}`,
      source: "web_file_upload",
      capture,
      location: { state: "not_required", observedAtUtc: "", latitude: null, longitude: null, accuracyMetres: null },
    };
  }
  if (!("geolocation" in navigator)) throw new Error("This browser cannot record the GPS location required for assessment photos. Use the TLink field app or a device with location enabled.");
  const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(
    resolve,
    (error) => {
      if (error.code === 1) return reject(new Error("Location access is off. Allow location for TLink in your browser settings, then try the photo again."));
      if (error.code === 2) return reject(new Error("A GPS position is unavailable. Move to an area with a clearer signal and try the photo again."));
      if (error.code === 3) return reject(new Error("GPS took too long. Move to an open area and try the photo again."));
      return reject(new Error("The GPS location required for this assessment photo could not be recorded. Check location access and try again."));
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    },
  ));
  if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy < 0 || position.coords.accuracy > 100) {
    throw new Error("The GPS position is not accurate enough for an assessment photo. Move to a clearer location and try again (100 m maximum).");
  }
  return {
    schemaVersion: 1,
    kind: "tlink-rental-inspection-photo",
    captureSessionId: `capture-${crypto.randomUUID()}`,
    source: "web_file_upload",
    capture,
    location: {
      state: "captured",
      observedAtUtc: new Date(position.timestamp).toISOString(),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMetres: position.coords.accuracy,
      altitudeMetres: position.coords.altitude,
      altitudeAccuracyMetres: position.coords.altitudeAccuracy,
      headingDegrees: position.coords.heading,
      speedMetresPerSecond: position.coords.speed,
    },
    processing: {
      privacySafeDerivative: file.type.startsWith("image/"),
      exifCopied: false,
    },
  };
}

function propertyAddress(result: AssessmentResult) {
  const property = result.inspection?.property?.property || {};
  return [property.addressLine1, property.addressLine2, property.suburb, property.state, property.postcode]
    .filter(Boolean).join(", ");
}

function initialItem(module: AssessmentModule, section: AssessmentSection, check: AssessmentCheck): LocalItem {
  return {
    id: "",
    moduleId: module.id,
    itemKey: "",
    sectionKey: section.key,
    checkKey: check.key,
    instanceKey: check.repeatBy === "property" ? "property" : "first",
    locationLabel: "",
    outcome: "",
    response: {},
    publicNotes: "",
    internalNotes: "",
    requiredEvidenceCount: check.requiredEvidenceCount,
    sortOrder: 0,
    revision: 0,
    localOnly: true,
  };
}

function localRepeatedItem(module: AssessmentModule, section: AssessmentSection, check: AssessmentCheck): LocalItem {
  return {
    ...initialItem(module, section, check),
    instanceKey: crypto.randomUUID(),
  };
}

function MetadataForm({ module, busy, readOnly, onSave }: {
  module: AssessmentModule;
  busy: boolean;
  readOnly: boolean;
  onSave: (answers: Record<string, unknown>) => Promise<void>;
}) {
  const fields = module.template.metadataFields || [];
  if (!fields.length) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const answers: Record<string, unknown> = {};
    for (const field of fields) {
      answers[field.key] = field.type === "checkbox"
        ? values.has(field.key)
        : String(values.get(field.key) || "");
    }
    await onSave(answers);
  }
  return <details className={styles.moduleDetails} open={module.status === "not_started"}>
    <summary>
      <span>Assessment details and declaration</span>
      <strong>{module.status === "not_started" ? "Complete first" : "Review"}</strong>
    </summary>
    <form onSubmit={submit} className={styles.metadataForm}>
      {fields.map((field) => {
        const value = module.answers[field.key];
        if (field.type === "checkbox") return <label className={styles.checkField} key={field.key}>
          <input type="checkbox" name={field.key} defaultChecked={value === true} disabled={readOnly} />
          <span>{field.label}{field.required ? " *" : ""}{field.help && <small>{field.help}</small>}</span>
        </label>;
        return <label key={field.key}>
          <span>{field.label}{field.required ? " *" : ""}</span>
          {field.type === "textarea"
            ? <textarea name={field.key} defaultValue={String(value || "")} rows={3} maxLength={4000} placeholder={field.placeholder} disabled={readOnly} />
            : field.type === "select"
              ? <select name={field.key} defaultValue={String(value || "")} disabled={readOnly}>
                <option value="">Choose one</option>
                {field.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
              : <input name={field.key} type={field.type} defaultValue={String(value || "")} maxLength={500} placeholder={field.placeholder} disabled={readOnly} />}
          {field.help && <small>{field.help}</small>}
        </label>;
      })}
      {!readOnly && <button className={styles.primaryButton} disabled={busy}>{busy ? "Saving..." : "Save assessment details"}</button>}
    </form>
  </details>;
}

function AssessmentItemCard({
  module,
  section,
  check,
  item,
  finding,
  evidence,
  busy,
  readOnly,
  onSave,
  onUpload,
  onUnlink,
  onDirtyChange,
  onRegisterDraft,
}: {
  module: AssessmentModule;
  section: AssessmentSection;
  check: AssessmentCheck;
  item: LocalItem;
  finding?: AssessmentFinding;
  evidence: AssessmentEvidence[];
  busy: string;
  readOnly: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onUpload: (item: AssessmentItem, file: File, purpose: string) => Promise<void>;
  onUnlink: (item: AssessmentItem, evidenceId: string) => Promise<void>;
  onDirtyChange: (itemKey: string, dirty: boolean) => void;
  onRegisterDraft: (itemKey: string, provider: AssessmentItemDraftProvider | null) => void;
}) {
  const [outcome, setOutcome] = useState(item.outcome || "");
  const [severity, setSeverity] = useState(finding?.severity || "required");
  const isAdverse = adverseOutcomes.has(outcome);
  const repeated = check.repeatBy !== "property";
  const itemBusy = busy === `item:${item.instanceKey}`;
  const uploadBusy = busy === `upload:${item.id}`;
  const dirtyKey = item.id || `${module.id}:${section.key}:${check.key}:${item.instanceKey}`;
  const formRef = useRef<HTMLFormElement>(null);

  function mutationBody(form: HTMLFormElement) {
    if (!form.reportValidity()) throw new Error("Finish the required fields in this answer before saving the section.");
    if (!outcome) throw new Error("Choose an assessment result before saving the section.");
    const values = new FormData(form);
    const response = {
      make: String(values.get("make") || ""),
      model: String(values.get("model") || ""),
      serialNumber: String(values.get("serialNumber") || ""),
      measurement: String(values.get("measurement") || ""),
      measurementUnit: String(values.get("measurementUnit") || ""),
      testMethod: String(values.get("testMethod") || ""),
      testInstrument: String(values.get("testInstrument") || ""),
      testResult: String(values.get("testResult") || ""),
      credentialType: String(values.get("credentialType") || ""),
      credentialNumber: String(values.get("credentialNumber") || ""),
      credentialVerified: values.has("credentialVerified"),
    };
    const findingBody = isAdverse ? {
      title: String(values.get("findingTitle") || ""),
      description: String(values.get("findingDescription") || ""),
      standardReference: String(values.get("standardReference") || ""),
      status: String(values.get("findingStatus") || ""),
      severity,
      tradeCategory: String(values.get("tradeCategory") || ""),
      recommendedAction: String(values.get("recommendedAction") || ""),
      scopeSummary: String(values.get("scopeSummary") || ""),
      quantityMilli: Math.round(Math.max(0, Number(values.get("quantity") || 1)) * 1000),
      unitLabel: String(values.get("unitLabel") || "each"),
      internalNotes: String(values.get("findingInternalNotes") || ""),
      details: {
        immediateAction: String(values.get("immediateAction") || ""),
        responsiblePeopleNotified: values.has("responsiblePeopleNotified"),
        notificationRecipient: String(values.get("notificationRecipient") || ""),
        notificationTime: String(values.get("notificationTime") || ""),
      },
    } : undefined;
    return {
      action: "save_item",
      moduleId: module.id,
      expectedModuleRevision: module.revision,
      expectedItemRevision: item.revision,
      sectionKey: section.key,
      checkKey: check.key,
      instanceKey: item.instanceKey,
      locationLabel: String(values.get("locationLabel") || ""),
      outcome,
      response,
      publicNotes: String(values.get("publicNotes") || ""),
      internalNotes: String(values.get("internalNotes") || ""),
      sortOrder: item.sortOrder,
      finding: findingBody,
    };
  }

  useEffect(() => {
    const provider = () => {
      const form = formRef.current;
      if (!form) throw new Error("This assessment answer is not ready to save.");
      return { item, body: mutationBody(form) };
    };
    onRegisterDraft(dirtyKey, provider);
    return () => onRegisterDraft(dirtyKey, null);
  });

  useEffect(() => () => onDirtyChange(dirtyKey, false), [dirtyKey, onDirtyChange]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave(mutationBody(event.currentTarget));
    onDirtyChange(dirtyKey, false);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item.id) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    if (!(file instanceof File) || !file.name) return;
    await onUpload(item, file, String(values.get("purpose") || check.prompt));
    form.reset();
  }

  const response = item.response || {};
  return <article className={`${styles.itemCard} ${outcome ? styles.answered : ""}`}>
    <header>
      <div>
        <span>{repeated ? "Repeatable check" : "Property check"}</span>
        <h5>{check.prompt}</h5>
      </div>
      <strong>{item.id ? `Saved v${item.revision}` : "Not saved"}</strong>
    </header>
    <form ref={formRef} className={styles.itemForm} onSubmit={submit} onChange={() => onDirtyChange(dirtyKey, true)}>
      {repeated && <label>
        <span>Exact location *</span>
        <input name="locationLabel" required defaultValue={item.locationLabel} maxLength={300} placeholder="For example, Bedroom 2 north window" disabled={readOnly} />
      </label>}
      <fieldset className={styles.outcomes} disabled={readOnly}>
        <legend>Result *</legend>
        {outcomeOptions.map(([value, label]) => <label className={outcome === value ? styles.selectedOutcome : ""} key={value}>
          <input type="radio" name="outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} />
          <span>{label}</span>
        </label>)}
      </fieldset>

      <aside className={styles.guidance}>
        <strong>What to photograph</strong>
        <p>{check.photoGuidance}</p>
        <small>{check.help}</small>
      </aside>

      <label>
        <span>Report detail{outcome === "not_applicable" ? " *" : ""}</span>
        <textarea name="publicNotes" required={outcome === "not_applicable"} rows={3} maxLength={4000} defaultValue={item.publicNotes} placeholder={outcome === "not_applicable" ? "Explain why this standard does not apply at this property. This appears in the final report." : "Describe what was observed, tested or measured. This appears in the final report."} disabled={readOnly} />
        <small>This is visible to the agent, rental provider and trades viewing the issued report.</small>
      </label>

      <details className={styles.technicalDetails}>
        <summary>Measurements, equipment and specialist verification</summary>
        <div className={styles.detailGrid}>
          <label><span>Make</span><input name="make" defaultValue={String(response.make || "")} maxLength={500} disabled={readOnly} /></label>
          <label><span>Model</span><input name="model" defaultValue={String(response.model || "")} maxLength={500} disabled={readOnly} /></label>
          <label><span>Serial number</span><input name="serialNumber" defaultValue={String(response.serialNumber || "")} maxLength={500} disabled={readOnly} /></label>
          <label><span>Measurement</span><input name="measurement" defaultValue={String(response.measurement || "")} maxLength={500} disabled={readOnly} /></label>
          <label><span>Unit</span><input name="measurementUnit" defaultValue={String(response.measurementUnit || "")} maxLength={100} placeholder="mm, ohm, seconds" disabled={readOnly} /></label>
          <label><span>Test method</span><input name="testMethod" defaultValue={String(response.testMethod || "")} maxLength={500} disabled={readOnly} /></label>
          <label><span>Test instrument</span><input name="testInstrument" defaultValue={String(response.testInstrument || "")} maxLength={500} disabled={readOnly} /></label>
          <label><span>Test result</span><input name="testResult" defaultValue={String(response.testResult || "")} maxLength={500} disabled={readOnly} /></label>
          <label><span>Specialist credential type</span><input name="credentialType" defaultValue={String(response.credentialType || "")} maxLength={500} disabled={readOnly} /></label>
          <label><span>Specialist credential number</span><input name="credentialNumber" defaultValue={String(response.credentialNumber || "")} maxLength={500} disabled={readOnly} /></label>
          <label className={styles.checkField}><input type="checkbox" name="credentialVerified" defaultChecked={response.credentialVerified === true} disabled={readOnly} /><span>I checked the specialist credential used for this result</span></label>
        </div>
      </details>

      {isAdverse && <section className={styles.findingFields}>
        <header><span>Finding and work scope</span><strong>Required before completion</strong></header>
        <label><span>Finding title *</span><input name="findingTitle" required defaultValue={finding?.title || ""} maxLength={240} placeholder="Short description a trade can scan" disabled={readOnly} /></label>
        <label><span>What is wrong or still unverified *</span><textarea name="findingDescription" required rows={3} maxLength={8000} defaultValue={finding?.description || ""} disabled={readOnly} /></label>
        <div className={styles.detailGrid}>
          <label><span>Severity *</span><select name="severity" value={severity} onChange={(event) => setSeverity(event.target.value)} disabled={readOnly}>{severityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>Responsible trade *</span><select name="tradeCategory" required defaultValue={finding?.tradeCategory || ""} disabled={readOnly}><option value="">Choose a trade</option>{tradeOptions.map((trade) => <option value={trade} key={trade}>{trade}</option>)}</select></label>
          <label><span>Finding status</span><input value={severity === "immediate_safety_risk" ? "Safety issue" : outcome === "does_not_meet" ? "Non-compliant" : "Requires verification"} readOnly aria-describedby={`status-${item.instanceKey}`} /><small id={`status-${item.instanceKey}`}>Set automatically from the assessment result and safety severity.</small></label>
          <label><span>Rule or standard reference</span><input name="standardReference" defaultValue={finding?.standardReference || ""} maxLength={500} disabled={readOnly} /></label>
        </div>
        <label><span>Recommended action</span><textarea name="recommendedAction" rows={2} maxLength={4000} defaultValue={finding?.recommendedAction || ""} disabled={readOnly} /></label>
        <label><span>Quote-ready scope *</span><textarea name="scopeSummary" required rows={3} maxLength={8000} defaultValue={finding?.scopeSummary || ""} placeholder="State what needs to be repaired, replaced, tested or confirmed, including the exact location." disabled={readOnly} /></label>
        <div className={styles.detailGrid}>
          <label><span>Quantity</span><input name="quantity" type="number" min="0" max="1000000" step="0.001" defaultValue={(finding?.quantityMilli || 1000) / 1000} disabled={readOnly} /></label>
          <label><span>Unit</span><input name="unitLabel" defaultValue={finding?.unitLabel || "each"} maxLength={40} disabled={readOnly} /></label>
        </div>
        {severity === "immediate_safety_risk" && <aside className={styles.safetyStop}>
          <strong>Stop and make the situation safe</strong>
          <p>Do not leave this as a quote item only. Record the immediate action and who was told.</p>
          <label><span>Make-safe or isolation action *</span><textarea name="immediateAction" required rows={3} defaultValue={String(finding?.details.immediateAction || "")} maxLength={2000} disabled={readOnly} /></label>
          <label className={styles.checkField}><input type="checkbox" name="responsiblePeopleNotified" defaultChecked={finding?.details.responsiblePeopleNotified === true} disabled={readOnly} /><span>I notified the responsible people</span></label>
          <label><span>Who was notified</span><input name="notificationRecipient" defaultValue={String(finding?.details.notificationRecipient || "")} maxLength={500} disabled={readOnly} /></label>
          <label><span>When</span><input name="notificationTime" type="datetime-local" defaultValue={String(finding?.details.notificationTime || "")} disabled={readOnly} /></label>
        </aside>}
        <label className={styles.internalField}><span>Internal finding note</span><textarea name="findingInternalNotes" rows={2} maxLength={4000} defaultValue={finding?.internalNotes || ""} disabled={readOnly} /><small>Private to your business. Never included in the public report or PDF.</small></label>
      </section>}

      <label className={styles.internalField}>
        <span>Internal assessment note</span>
        <textarea name="internalNotes" rows={2} maxLength={4000} defaultValue={item.internalNotes} placeholder="Private coordination, costing or follow-up notes" disabled={readOnly} />
        <small>Private to your business. Never included in the public report or PDF.</small>
      </label>
      {!readOnly && <button className={styles.primaryButton} disabled={itemBusy || !outcome}>{itemBusy ? "Saving..." : item.id ? "Save changes" : "Save this answer"}</button>}
    </form>

    <section className={styles.evidenceArea}>
      <header><div><span>Evidence</span><strong>{evidence.length} of {item.requiredEvidenceCount || check.requiredEvidenceCount} required file{(item.requiredEvidenceCount || check.requiredEvidenceCount) === 1 ? "" : "s"}</strong></div></header>
      {evidence.length > 0 && <ul>{evidence.map((entry) => <li key={entry.id}><div><strong>{entry.fileName}</strong><small>{entry.caption || entry.purpose} | {bytesLabel(entry.sizeBytes)}</small>{entry.capture && <small>{entry.capture.source === "in_app_camera" ? "Captured" : "Added"} {dateLabel(entry.capture.capturedAtUtc)}{entry.capture.locationCaptured && entry.capture.latitude !== null && entry.capture.longitude !== null && entry.capture.accuracyMetres !== null ? ` | device-reported GPS ${entry.capture.latitude.toFixed(6)}, ${entry.capture.longitude.toFixed(6)} | accuracy ${Math.round(entry.capture.accuracyMetres)} m` : ""}</small>}</div>{!readOnly && <button type="button" disabled={busy === `unlink:${entry.id}`} onClick={() => void onUnlink(item, entry.id)}>{busy === `unlink:${entry.id}` ? "Removing..." : "Remove link"}</button>}</li>)}</ul>}
      {!item.id ? <p className={styles.saveFirst}>Save the answer first, then attach the required photo or document.</p>
        : !readOnly && <form className={styles.uploadForm} onSubmit={upload}>
          <label><span>Photo or PDF</span><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" required /></label>
          <p>A fresh device-reported GPS position within 100 metres is required for every assessment photo. TLink records the time, coordinates and accuracy in the issued report. PDFs record the time they were added.</p>
          <label><span>What this evidence shows</span><input name="purpose" defaultValue={check.prompt} maxLength={300} /></label>
          <button type="submit" disabled={uploadBusy}>{uploadBusy ? "Uploading..." : "Take photo or add file"}</button>
        </form>}
    </section>
  </article>;
}

export function TradeRentalInspectionPanel({ user, workOrderId, readOnly = false, onChanged }: {
  user: User;
  workOrderId: string;
  readOnly?: boolean;
  onChanged?: () => Promise<void>;
}) {
  const [data, setData] = useState<AssessmentResult>({ modules: [], items: [], findings: [], evidence: [], completion: {} });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [activeModuleId, setActiveModuleId] = useState("");
  const [activeSectionKey, setActiveSectionKey] = useState("");
  const [localItems, setLocalItems] = useState<Record<string, LocalItem[]>>({});
  const [dirtyItems, setDirtyItems] = useState<Set<string>>(() => new Set());
  const itemDraftProviders = useRef(new Map<string, AssessmentItemDraftProvider>());

  const markItemDirty = useCallback((itemKey: string, dirty: boolean) => {
    setDirtyItems((current) => {
      const next = new Set(current);
      if (dirty) next.add(itemKey);
      else next.delete(itemKey);
      return next;
    });
  }, []);

  const registerItemDraft = useCallback((itemKey: string, provider: AssessmentItemDraftProvider | null) => {
    if (provider) itemDraftProviders.current.set(itemKey, provider);
    else itemDraftProviders.current.delete(itemKey);
  }, []);

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/trade-rental-inspections?workOrderId=${encodeURIComponent(workOrderId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as AssessmentResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "The rental assessment could not be loaded.");
    setData(result);
    setActiveModuleId((current) => current && result.modules?.some((module) => module.id === current)
      ? current : result.modules?.[0]?.id || "");
    return result;
  }, [user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "The rental assessment could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  const activeModule = data.modules?.find((module) => module.id === activeModuleId) || data.modules?.[0];
  const sections = useMemo(() => activeModule?.template.sections || [], [activeModule]);

  const activeSection = sections.find((section) => section.key === activeSectionKey);
  const canEdit = !readOnly && data.permissions?.canEdit === true;
  const moduleCompletion = activeModule ? data.completion?.[activeModule.id] : undefined;
  const allModulesComplete = (data.modules || []).length > 0 && (data.modules || []).every((module) => module.status === "complete");
  const latestReport = data.reports?.find((report) => report.status === "issued");

  const progress = useMemo(() => {
    const allChecks = (data.modules || []).flatMap((module) => module.template.sections.flatMap((section) => section.checks.map((check) => ({ moduleId: module.id, sectionKey: section.key, checkKey: check.key }))));
    const assessed = allChecks.filter((check) => data.items?.some((item) => item.moduleId === check.moduleId && item.sectionKey === check.sectionKey && item.checkKey === check.checkKey && item.outcome)).length;
    const completeModules = (data.modules || []).filter((module) => module.status === "complete").length;
    return { assessed, total: allChecks.length, completeModules, moduleTotal: data.modules?.length || 0,
      percent: allChecks.length ? Math.round(assessed / allChecks.length * 100) : 0 };
  }, [data.items, data.modules]);

  async function mutate(body: Record<string, unknown>, busyKey: string, success: string) {
    setBusy(busyKey);
    setStatus("Saving securely...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-rental-inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workOrderId, ...body }),
      });
      const result = await response.json().catch(() => ({})) as AssessmentResult;
      if (!response.ok || !result.ok) {
        const blockerText = result.blockers?.length ? ` ${result.blockers.map((blocker) => blocker.label).join(" ")}` : "";
        throw new Error(`${result.error || "The assessment could not be saved."}${blockerText}`);
      }
      setData(result);
      setStatus(success);
      await onChanged?.().catch(() => undefined);
      return result;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The assessment could not be saved.");
      throw error;
    } finally {
      setBusy("");
    }
  }

  async function saveMetadata(answers: Record<string, unknown>) {
    if (!activeModule) return;
    await mutate({ action: "save_module_answers", moduleId: activeModule.id, expectedRevision: activeModule.revision, answers }, `metadata:${activeModule.id}`, "Assessment details saved.");
  }

  async function saveItem(item: LocalItem, body: Record<string, unknown>) {
    await mutate(body, `item:${item.instanceKey}`, "Assessment answer saved.");
    if (item.localOnly) {
      const key = `${item.moduleId}:${item.sectionKey}:${item.checkKey}`;
      setLocalItems((current) => ({ ...current, [key]: (current[key] || []).filter((candidate) => candidate.instanceKey !== item.instanceKey) }));
    }
  }

  async function uploadEvidence(item: AssessmentItem, file: File, purpose: string) {
    if (!activeModule) return;
    setBusy(`upload:${item.id}`);
    setStatus("Uploading private assessment evidence...");
    try {
      const preparedFile = await prepareRentalEvidenceFile(file);
      if (preparedFile.size > 8 * 1024 * 1024) throw new Error("Each evidence file must be no larger than 8 MB.");
      const usedBytes = data.evidenceBudget?.usedBytes || 0;
      const maxBytes = data.evidenceBudget?.maxBytes || 32 * 1024 * 1024;
      if (usedBytes + preparedFile.size > maxBytes) {
        throw new Error(`This assessment has ${bytesLabel(Math.max(0, maxBytes - usedBytes))} of evidence space left. Compress or remove another file before adding this one.`);
      }
      const token = await user.getIdToken();
      const evidenceEnvelope = await browserEvidenceEnvelope(preparedFile);
      const form = new FormData();
      form.set("workOrderId", workOrderId);
      form.set("category", "progress");
      form.set("caption", purpose);
      form.set("evidenceEnvelope", JSON.stringify(evidenceEnvelope));
      form.set("file", preparedFile);
      const uploadResponse = await fetch("/api/trade-field-work", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const uploadResult = await uploadResponse.json().catch(() => ({})) as FieldUploadResult;
      if (!uploadResponse.ok || !uploadResult.ok || !uploadResult.media?.[0]?.id) throw new Error(uploadResult.error || "The evidence file could not be uploaded.");
      const latest = uploadResult.media[0];
      const response = await fetch("/api/trade-rental-inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workOrderId, action: "link_evidence", itemId: item.id,
          jobMediaId: latest.id, purpose, expectedModuleRevision: activeModule.revision }),
      });
      const result = await response.json().catch(() => ({})) as AssessmentResult;
      if (!response.ok || !result.ok) {
        await fetch(`/api/trade-field-work?id=${encodeURIComponent(latest.id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => undefined);
        throw new Error(result.error || "The uploaded file could not be linked to this answer.");
      }
      setData(result);
      setStatus("Evidence uploaded and linked to this answer.");
      await onChanged?.().catch(() => undefined);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The evidence file could not be uploaded.");
    } finally {
      setBusy("");
    }
  }

  async function unlinkEvidence(item: AssessmentItem, evidenceId: string) {
    if (!activeModule) return;
    await mutate({ action: "unlink_evidence", evidenceId, expectedModuleRevision: activeModule.revision }, `unlink:${evidenceId}`, "Evidence link removed. The original job file was retained.");
  }

  async function changeModuleStatus() {
    if (!activeModule) return;
    const action = activeModule.status === "complete" ? "reopen_module" : "complete_module";
    await mutate({ action, moduleId: activeModule.id, expectedRevision: activeModule.revision }, `module:${activeModule.id}`,
      action === "complete_module" ? "Module completed and locked." : "Module reopened for correction.");
  }

  async function issueReport() {
    await mutate({ action: "issue_report" }, "issue-report", "Report issued. The secure link is ready to share for 60 days.");
  }

  async function copyReportLink() {
    const shareUrl = latestReport?.link?.shareUrl;
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("Secure report link copied.");
    } catch {
      setStatus("Copy the secure link from the report card.");
    }
  }

  async function revokeReportLink() {
    if (!latestReport?.link?.id) return;
    if (!window.confirm("Stop public access to this report link? Anyone using it will immediately lose access.")) return;
    await mutate({ action: "revoke_report_link", linkId: latestReport.link.id }, "revoke-report-link", "Public access to this report was stopped.");
  }

  async function renewReportLink() {
    if (!latestReport) return;
    await mutate({ action: "renew_report_link", reportId: latestReport.id }, "renew-report-link", "A new no-account report link is ready for 60 days.");
  }

  async function downloadIssuedReport() {
    if (!latestReport?.internalPdfUrl) return;
    setBusy("download-report");
    setStatus("Checking and downloading the immutable report...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(latestReport.internalPdfUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error || "The issued report could not be downloaded.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${latestReport.reportNumber}.pdf`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setStatus("Issued report PDF downloaded.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The issued report could not be downloaded.");
    } finally {
      setBusy("");
    }
  }

  function addRepeatedItem(section: AssessmentSection, check: AssessmentCheck) {
    if (!activeModule) return;
    const key = `${activeModule.id}:${section.key}:${check.key}`;
    setLocalItems((current) => ({ ...current, [key]: [...(current[key] || []), localRepeatedItem(activeModule, section, check)] }));
  }

  function returnToSectionOverview() {
    if (dirtyItems.size > 0 && !window.confirm("Return to all sections without saving the changes still open on this screen?")) return;
    setDirtyItems(new Set());
    setActiveSectionKey("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveSectionAndContinue() {
    if (!activeSection) return;
    setBusy("section-continue");
    setStatus(dirtyItems.size > 0 ? "Saving every changed answer in this section..." : "Confirming saved section progress...");
    let savedCount = 0;
    try {
      let current = data;
      const drafts = [...dirtyItems].map((itemKey) => {
        const provider = itemDraftProviders.current.get(itemKey);
        if (!provider) throw new Error("One changed answer could not be prepared. Reopen the section and try again.");
        return { dirtyKey: itemKey, ...provider() };
      });
      if (drafts.length) {
        const token = await user.getIdToken();
        for (const draft of drafts) {
          const currentModule = current.modules?.find((module) => module.id === draft.item.moduleId);
          if (!currentModule) throw new Error("The assessment module changed. Reload the job and try again.");
          const currentItem = current.items?.find((candidate) => draft.item.id
            ? candidate.id === draft.item.id
            : candidate.moduleId === draft.item.moduleId
              && candidate.sectionKey === draft.item.sectionKey
              && candidate.checkKey === draft.item.checkKey
              && candidate.instanceKey === draft.item.instanceKey);
          const response = await fetch("/api/trade-rental-inspections", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              workOrderId,
              ...draft.body,
              expectedModuleRevision: currentModule.revision,
              expectedItemRevision: currentItem?.revision || 0,
            }),
          });
          const result = await response.json().catch(() => ({})) as AssessmentResult;
          if (!response.ok || !result.ok) throw new Error(result.error || "The section could not be saved.");
          current = result;
          savedCount += 1;
          setData(result);
          setDirtyItems((existing) => {
            const next = new Set(existing);
            next.delete(draft.dirtyKey);
            return next;
          });
          itemDraftProviders.current.delete(draft.dirtyKey);
          if (draft.item.localOnly) {
            setLocalItems((existing) => Object.fromEntries(Object.entries(existing)
              .map(([key, entries]) => [key, entries.filter((entry) => entry.instanceKey !== draft.item.instanceKey)])));
          }
        }
        await onChanged?.().catch(() => undefined);
      } else {
        current = await load();
      }
      const currentIndex = sections.findIndex((section) => section.key === activeSection.key);
      const nextSection = sections[currentIndex + 1];
      setActiveSectionKey(nextSection?.key || "");
      setStatus(nextSection ? `${activeSection.title} saved. Opening ${nextSection.title}.` : `${activeSection.title} saved. Back at all sections.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Saved progress could not be confirmed.";
      setStatus(savedCount > 0 ? `${savedCount} answer${savedCount === 1 ? " was" : "s were"} saved before this stopped. ${message}` : message);
    } finally {
      setBusy("");
    }
  }

  if (loading) return <section className={styles.loading}><strong>Opening the rental assessment...</strong><span>Loading the frozen form and saved evidence.</span></section>;
  if (!data.inspection || !activeModule) return <section className={styles.loading}><strong>Rental assessment unavailable</strong><span>{status || "No assessment is attached to this job."}</span></section>;

  return <section className={styles.workspace} aria-label="Rental inspection workflow">
    <header className={styles.hero}>
      <div>
        <span>Victorian rental assessment</span>
        <h3>{data.inspection.inspectionNumber}</h3>
        <p>{propertyAddress(data) || "Property address is stored with the job."}</p>
      </div>
      <div className={styles.heroStatus}>
        <strong>{progress.percent}% assessed</strong>
        <span>{progress.completeModules} of {progress.moduleTotal} modules complete</span>
      </div>
      <div className={styles.progressTrack} aria-label={`${progress.percent}% of checks assessed`}><span style={{ width: `${progress.percent}%` }} /></div>
      <small>Rule version effective {new Date(`${data.inspection.rulesEffectiveFrom}T00:00:00`).toLocaleDateString("en-AU", { dateStyle: "medium" })}. The saved job keeps this exact form version.</small>
    </header>

    {!activeSection && <><nav className={styles.moduleNav} aria-label="Assessment modules">
      {(data.modules || []).map((module) => <button type="button" className={module.id === activeModule.id ? styles.activeModule : ""} onClick={() => { setActiveModuleId(module.id); setActiveSectionKey(""); }} key={module.id}>
        <span>{module.required ? "Included" : "Optional"}</span>
        <strong>{module.title}</strong>
        <small>{module.status === "complete" ? "Complete" : data.completion?.[module.id]?.blockers.length ? `${data.completion[module.id].blockers.length} items to finish` : "Ready to complete"}</small>
      </button>)}
    </nav>

    <aside className={styles.boundary}>
      <strong>{activeModule.template.title}</strong>
      <p>{activeModule.template.reportBoundary}</p>
      <span>Required issuer capability: {activeModule.requiredCapability.replaceAll("_", " ")}</span>
    </aside>

    <MetadataForm module={activeModule} busy={busy === `metadata:${activeModule.id}`} readOnly={!canEdit || activeModule.status === "complete"} onSave={saveMetadata} /></>}

    <div className={styles.sectionLayout}>
      {!activeSection ? <section className={styles.sectionOverview}>
        <header><span>Assessment workflow</span><h4>Choose a section</h4><p>Each section opens on its own screen. Saved answers stay attached to this job, and Back always returns to this list.</p></header>
        <nav className={styles.sectionNav} aria-label="Assessment sections">
          {sections.map((section, index) => {
            const assessed = section.checks.filter((check) => data.items?.some((item) => item.moduleId === activeModule.id && item.sectionKey === section.key && item.checkKey === check.key && item.outcome)).length;
            const complete = assessed === section.checks.length;
            return <button type="button" onClick={() => { setActiveSectionKey(section.key); window.scrollTo({ top: 0, behavior: "smooth" }); }} key={section.key}>
              <span>{index + 1}</span><span><strong>{section.title}</strong><small>{assessed} of {section.checks.length} checks saved</small></span><b aria-label={complete ? "Section answers saved" : "Section in progress"}>{complete ? "✓" : "›"}</b>
            </button>;
          })}
        </nav>
      </section> : <main className={styles.sectionContent}>
        <button type="button" className={styles.backToSections} onClick={returnToSectionOverview}>← Back to all sections</button>
        <header className={styles.sectionHeader}>
          <span>Section {sections.findIndex((section) => section.key === activeSection.key) + 1} of {sections.length}</span>
          <h4>{activeSection.title}</h4>
          <p>{activeSection.summary}</p>
        </header>
        {activeSection.checks.map((check, checkIndex) => {
          const key = `${activeModule.id}:${activeSection.key}:${check.key}`;
          const stored = (data.items || []).filter((item) => item.moduleId === activeModule.id && item.sectionKey === activeSection.key && item.checkKey === check.key);
          const workingItems: LocalItem[] = [
            ...(stored.length ? stored : [initialItem(activeModule, activeSection, check)]),
            ...(localItems[key] || []),
          ];
          return <section className={styles.checkGroup} key={check.key}>
            {workingItems.map((item, instanceIndex) => {
              const finding = data.findings?.find((candidate) => candidate.itemId === item.id);
              const evidence = (data.evidence || []).filter((entry) => entry.itemId === item.id && entry.status === "active");
               return <AssessmentItemCard key={`${item.id || item.instanceKey}:${item.revision}`}
                module={activeModule} section={activeSection} check={check} item={{ ...item, sortOrder: (sections.findIndex((section) => section.key === activeSection.key) + 1) * 100 + checkIndex * 10 + instanceIndex }}
                finding={finding} evidence={evidence} busy={busy} readOnly={!canEdit || activeModule.status === "complete"}
                onSave={(body) => saveItem(item, body)} onUpload={uploadEvidence} onUnlink={unlinkEvidence} onDirtyChange={markItemDirty} onRegisterDraft={registerItemDraft} />;
            })}
            {check.repeatBy !== "property" && canEdit && activeModule.status !== "complete" && <button type="button" className={styles.addInstance} onClick={() => addRepeatedItem(activeSection, check)}>Add another {check.repeatBy.replaceAll("_", " ")}</button>}
          </section>;
        })}
        <div className={styles.sectionActions}>
          <button type="button" onClick={returnToSectionOverview}>Back to all sections</button>
          <button type="button" className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => void saveSectionAndContinue()}>{busy === "section-continue" ? "Saving section..." : sections.findIndex((section) => section.key === activeSection.key) < sections.length - 1 ? "Save section and continue" : "Save section and return"}</button>
          <small>This saves every changed answer on the screen before moving forward. The smaller Save button remains available when you want to save one answer immediately.</small>
        </div>
      </main>}
    </div>

    {!activeSection && <><section className={styles.completionCard}>
      <header><div><span>Server-checked completion</span><h4>{activeModule.title}</h4></div><strong>{activeModule.status === "complete" ? "Complete" : moduleCompletion?.complete ? "Ready" : "Not ready"}</strong></header>
      {activeModule.status === "complete" ? <p>Completed {dateLabel(activeModule.completedAt)}. Reopen it only when a correction is required before issue.</p>
        : moduleCompletion?.blockers?.length ? <><p>The report cannot be issued until these items are cleared:</p><ul>{moduleCompletion.blockers.slice(0, 12).map((blocker) => <li key={blocker.key}>{blocker.label}</li>)}</ul>{moduleCompletion.blockers.length > 12 && <small>{moduleCompletion.blockers.length - 12} more blockers remain in the relevant sections.</small>}</>
          : <p>All required answers, evidence, findings, scope details and declarations pass the current completion rules.</p>}
      {canEdit && <button type="button" className={activeModule.status === "complete" ? styles.secondaryButton : styles.primaryButton} disabled={Boolean(busy) || (activeModule.status !== "complete" && !moduleCompletion?.complete)} onClick={() => void changeModuleStatus()}>{busy === `module:${activeModule.id}` ? "Saving..." : activeModule.status === "complete" ? "Reopen module" : "Complete and lock module"}</button>}
    </section>

    <section className={styles.issueCard}>
      <header><div><span>Final assessor issue</span><h4>{latestReport ? latestReport.reportNumber : "Issue the complete rental report"}</h4></div><strong>{latestReport ? "Issued" : allModulesComplete ? "Ready" : "Waiting"}</strong></header>
      {latestReport?.link?.status === "active" && latestReport.link.shareUrl ? <>
        <p>The immutable PDF and quick-view report contain all issued details and evidence, except internal notes. The no-account link expires {dateLabel(latestReport.link.expiresAt)}.</p>
        <div className={styles.shareRow}><input aria-label="Secure rental report link" readOnly value={latestReport.link.shareUrl} /><button type="button" onClick={() => void copyReportLink()}>Copy link</button><a href={latestReport.link.shareUrl} target="_blank" rel="noreferrer">Open report</a></div>
        <div className={styles.reportActions}>{latestReport.internalPdfUrl && <button type="button" disabled={Boolean(busy)} onClick={() => void downloadIssuedReport()}>{busy === "download-report" ? "Downloading..." : "Download issued PDF"}</button>}<small>{latestReport.link.viewCount} public views | {latestReport.link.downloadCount} public PDF downloads</small>{data.permissions?.canRevokeLink && <button type="button" disabled={Boolean(busy)} onClick={() => void revokeReportLink()}>{busy === "revoke-report-link" ? "Stopping access..." : "Stop sharing"}</button>}</div>
      </> : <>
        <p>{latestReport
          ? latestReport.link?.status === "active"
            ? "The issued report is available, but only the owner or assigned assessor can reveal its secure sharing link."
            : `The issued report is retained, but its public link is ${latestReport.link?.status || "not active"}.`
          : allModulesComplete
            ? "The assigned assessor can now create the immutable PDF and the no-account 60-day quick-view link."
            : "Complete and lock every selected module before issuing. The server will recheck every answer, evidence requirement, finding, trade scope and credential declaration."}</p>
        {!data.permissions?.isAssignedAssessor && <small>Only the assigned assessor can issue the final report.</small>}
        {!latestReport && data.permissions?.canIssue && <button type="button" className={styles.primaryButton} disabled={Boolean(busy) || !allModulesComplete} onClick={() => void issueReport()}>{busy === "issue-report" ? "Creating and verifying report..." : "Issue report and create 60-day link"}</button>}
        {latestReport?.internalPdfUrl && <button type="button" className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => void downloadIssuedReport()}>{busy === "download-report" ? "Downloading..." : "Download issued PDF"}</button>}
        {latestReport && data.permissions?.canRevokeLink && latestReport.link?.status !== "active" && <button type="button" className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => void renewReportLink()}>{busy === "renew-report-link" ? "Creating link..." : "Create a new 60-day link"}</button>}
      </>}
      <small>Evidence package: {bytesLabel(data.evidenceBudget?.usedBytes || 0)} of {bytesLabel(data.evidenceBudget?.maxBytes || 32 * 1024 * 1024)}. Large browser photos are reduced before upload so the issued PDF remains reliable.</small>
    </section></>}

    {status && <p className={styles.status} role="status">{status}</p>}
  </section>;
}
