"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  PUBLIC_RENTAL_ASSESSMENT_CONSENT_NOTICE_VERSION,
  PUBLIC_RENTAL_ASSESSMENT_CONSENT_PURPOSE,
  PUBLIC_RENTAL_ASSESSMENT_DEFAULT_MODULES,
  PUBLIC_RENTAL_ASSESSMENT_MODULES,
  PUBLIC_RENTAL_ASSESSMENT_REQUEST_KIND,
} from "@/lib/public-rental-assessment-request.mjs";
import styles from "./PublicRentalAssessmentRequestForm.module.css";

type AddressLocality = { suburb: string; state: string };
type LookupState = "idle" | "loading" | "ready" | "error";
type SubmitState = { kind: "idle" | "sending" | "error" | "success"; message: string; reference?: string };

const moduleLabels: Record<string, { title: string; detail: string }> = {
  minimum_standards: {
    title: "Victorian rental minimum standards assessment",
    detail: "Selected by default. Untick it when the visit is only for one or more separate safety checks.",
  },
  electrical_safety_check: {
    title: "Electrical safety check",
    detail: "Adds the separate electrical safety workflow and credential requirements.",
  },
  gas_safety_check: {
    title: "Gas safety check",
    detail: "Adds the separate gas safety workflow when the property has gas installations or appliances.",
  },
  smoke_alarm_check: {
    title: "Smoke alarm check",
    detail: "Adds the separate smoke alarm workflow and its qualified-worker record.",
  },
};

function createSubmissionId() {
  return `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.${crypto.randomUUID()}`;
}

function localityValue(locality: AddressLocality) {
  return JSON.stringify([locality.suburb, locality.state]);
}

export function PublicRentalAssessmentRequestForm() {
  const [requesterRole, setRequesterRole] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [suburb, setSuburb] = useState("");
  const [localities, setLocalities] = useState<AddressLocality[]>([]);
  const [lookupState, setLookupState] = useState<LookupState>("idle");
  const [lookupError, setLookupError] = useState("");
  const [requestedAssessmentModules, setRequestedAssessmentModules] = useState<string[]>([...PUBLIC_RENTAL_ASSESSMENT_DEFAULT_MODULES]);
  const [notes, setNotes] = useState("");
  const [authorityConfirmed, setAuthorityConfirmed] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [website, setWebsite] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle", message: "" });
  const submissionId = useRef("");
  const clientStartedAt = useRef(0);
  const lastAttemptCore = useRef("");
  const consentGrantedAt = useRef("");

  useEffect(() => {
    submissionId.current = createSubmissionId();
    clientStartedAt.current = Date.now();
  }, []);

  useEffect(() => {
    if (!/^\d{4}$/.test(postcode)) return;
    const controller = new AbortController();
    void fetch(`/api/address-localities?postcode=${encodeURIComponent(postcode)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json().catch(() => ({})) as { ok?: boolean; postcode?: unknown; localities?: unknown; error?: unknown };
      if (!response.ok || !result.ok || result.postcode !== postcode) throw new Error(typeof result.error === "string" ? result.error : "Suburbs could not be loaded.");
      const seen = new Set<string>();
      const next = Array.isArray(result.localities) ? result.localities.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as { suburb?: unknown; state?: unknown };
        const nextSuburb = typeof record.suburb === "string" ? record.suburb.trim() : "";
        const state = typeof record.state === "string" ? record.state.trim().toUpperCase() : "";
        const key = `${nextSuburb.toLowerCase()}:${state}`;
        if (!nextSuburb || state !== "VIC" || seen.has(key)) return [];
        seen.add(key);
        return [{ suburb: nextSuburb, state }];
      }) : [];
      if (!next.length) throw new Error("Enter a Victorian postcode with a listed suburb.");
      setLocalities(next);
      setLookupState("ready");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setLocalities([]);
      setSuburb("");
      setLookupState("error");
      setLookupError(error instanceof Error ? error.message : "Suburbs could not be loaded.");
    });
    return () => controller.abort();
  }, [postcode]);

  function toggleAssessmentModule(moduleKey: string) {
    setRequestedAssessmentModules((current) => current.includes(moduleKey)
      ? current.filter((entry) => entry !== moduleKey)
      : [...current, moduleKey]);
  }

  function changePostcode(value: string) {
    const nextPostcode = value.replace(/\D/g, "").slice(0, 4);
    setPostcode(nextPostcode);
    setLocalities([]);
    setSuburb("");
    setLookupError("");
    setLookupState(/^\d{4}$/.test(nextPostcode) ? "loading" : "idle");
  }

  function changeConsent(accepted: boolean) {
    setConsentAccepted(accepted);
    if (accepted) {
      consentGrantedAt.current = new Date().toISOString();
      return;
    }
    consentGrantedAt.current = "";
    if (lastAttemptCore.current) {
      submissionId.current = createSubmissionId();
      lastAttemptCore.current = "";
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lookupState !== "ready" || !suburb) {
      setSubmitState({ kind: "error", message: "Choose the Victorian suburb listed for the property postcode." });
      return;
    }
    if (!requestedAssessmentModules.length) {
      setSubmitState({ kind: "error", message: "Choose at least one assessment or safety-check service." });
      return;
    }
    const core = JSON.stringify({ requesterRole, agencyName: requesterRole === "agent-property-manager" ? agencyName.trim() : "", name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), unitNumber: unitNumber.trim(), streetAddress: streetAddress.trim(), postcode, suburb, requestedAssessmentModules: [...requestedAssessmentModules].sort(), notes: notes.trim(), authorityConfirmed, consentAccepted });
    if (!submissionId.current || (lastAttemptCore.current && lastAttemptCore.current !== core)) {
      submissionId.current = createSubmissionId();
      consentGrantedAt.current = "";
    }
    lastAttemptCore.current = core;
    consentGrantedAt.current ||= new Date().toISOString();
    setSubmitState({ kind: "sending", message: "Sending your request securely..." });
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionType: "upgrade",
          enquiry: PUBLIC_RENTAL_ASSESSMENT_REQUEST_KIND,
          submissionId: submissionId.current,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          requesterRole,
          agencyName: requesterRole === "agent-property-manager" ? agencyName.trim() : "",
          customerUnitNumber: unitNumber.trim(),
          customerStreetAddress: streetAddress.trim(),
          customerSuburb: suburb,
          customerState: "VIC",
          postcode,
          requestedAssessmentModules,
          projectNotes: notes.trim(),
          authorityConfirmed,
          website,
          clientStartedAt: clientStartedAt.current,
          consent: {
            accepted: consentAccepted,
            purpose: PUBLIC_RENTAL_ASSESSMENT_CONSENT_PURPOSE,
            noticeVersion: PUBLIC_RENTAL_ASSESSMENT_CONSENT_NOTICE_VERSION,
            grantedAt: consentGrantedAt.current,
          },
        }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; reference?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Your request could not be sent.");
      setSubmitState({
        kind: "success",
        reference: result.reference,
        message: "Request received. This has not booked or scheduled an inspection. We will contact you to confirm authority, scope, price, access and appointment details.",
      });
    } catch (error) {
      setSubmitState({ kind: "error", message: error instanceof Error ? error.message : "Your request could not be sent." });
    }
  }

  return <form className={styles.form} onSubmit={submit}>
    <section className={styles.section}>
      <div className={styles.sectionHeading}><span>1</span><div><h2>Who is requesting the assessment?</h2><p>No account is required. We use this to confirm authority before anything is booked.</p></div></div>
      <fieldset className={styles.roleGrid}>
        <legend>Your role *</legend>
        <label className={requesterRole === "rental-provider" ? styles.selectedCard : styles.choiceCard}><input type="radio" name="requesterRole" value="rental-provider" checked={requesterRole === "rental-provider"} onChange={() => setRequesterRole("rental-provider")} required /><span><strong>Rental provider</strong><small>I own or legally provide the rental property.</small></span></label>
        <label className={requesterRole === "agent-property-manager" ? styles.selectedCard : styles.choiceCard}><input type="radio" name="requesterRole" value="agent-property-manager" checked={requesterRole === "agent-property-manager"} onChange={() => setRequesterRole("agent-property-manager")} required /><span><strong>Agent / property manager</strong><small>I am authorised to act for the rental provider.</small></span></label>
      </fieldset>
      <div className={styles.fieldGrid}>
        <label><span>Your full name *</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={120} required /></label>
        <label><span>Email *</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} required /></label>
        <label><span>Phone</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" maxLength={40} /></label>
        {requesterRole === "agent-property-manager" && <label><span>Agency / business name *</span><input value={agencyName} onChange={(event) => setAgencyName(event.target.value)} autoComplete="organization" maxLength={160} required /></label>}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHeading}><span>2</span><div><h2>Which Victorian property?</h2><p>Enter the exact assessment address. Do not add tenant names, access codes or identity documents here.</p></div></div>
      <div className={styles.addressGrid}>
        <label><span>Unit</span><input value={unitNumber} onChange={(event) => setUnitNumber(event.target.value)} autoComplete="address-line2" maxLength={40} /></label>
        <label className={styles.streetField}><span>Street address *</span><input value={streetAddress} onChange={(event) => setStreetAddress(event.target.value)} autoComplete="address-line1" maxLength={140} required /></label>
        <label><span>Postcode *</span><input value={postcode} onChange={(event) => changePostcode(event.target.value)} inputMode="numeric" autoComplete="postal-code" pattern="\d{4}" maxLength={4} required /></label>
        <label className={styles.suburbField}><span>Suburb *</span><select value={suburb ? JSON.stringify([suburb, "VIC"]) : ""} onChange={(event) => { const [nextSuburb] = JSON.parse(event.target.value || "[\"\"]"); setSuburb(nextSuburb); }} disabled={lookupState !== "ready"} required><option value="">{lookupState === "loading" ? "Loading Victorian suburbs..." : "Choose the listed suburb"}</option>{localities.map((locality) => <option value={localityValue(locality)} key={localityValue(locality)}>{locality.suburb}, VIC</option>)}</select>{lookupError && <small className={styles.errorText}>{lookupError}</small>}</label>
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHeading}><span>3</span><div><h2>Choose the assessment scope</h2><p>Minimum standards are selected by default, but every service can be selected or unselected. Choose one service or combine several for the same visit.</p></div></div>
      <fieldset className={styles.optionalGrid}>
        <legend>Select one or more services *</legend>
        {PUBLIC_RENTAL_ASSESSMENT_MODULES.map((moduleKey) => <label className={requestedAssessmentModules.includes(moduleKey) ? styles.selectedCard : styles.choiceCard} key={moduleKey}><input type="checkbox" checked={requestedAssessmentModules.includes(moduleKey)} onChange={() => toggleAssessmentModule(moduleKey)} /><span><strong>{moduleLabels[moduleKey].title}</strong><small>{moduleLabels[moduleKey].detail}</small></span></label>)}
      </fieldset>
      {!requestedAssessmentModules.length && <p className={styles.errorText} role="alert">Choose at least one service before sending the request.</p>}
      <label className={styles.notesField}><span>Anything useful for our review?</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={1200} placeholder="For example: vacant property, preferred timing, known access limitation or the reason the assessment is needed." /><small>Do not include keysafe codes, tenant identity details, payment information or documents.</small></label>
    </section>

    <section className={styles.confirmSection}>
      <label className={styles.confirmation}><input type="checkbox" checked={authorityConfirmed} onChange={(event) => setAuthorityConfirmed(event.target.checked)} required /><span><strong>I am authorised to request this assessment *</strong><small>I am the rental provider or an agent/property manager authorised to act for them.</small></span></label>
      <label className={styles.confirmation}><input type="checkbox" checked={consentAccepted} onChange={(event) => changeConsent(event.target.checked)} required /><span><strong>You may use these details to contact me about this request *</strong><small>We will use the information to review authority, scope, price, access and appointment options. This form does not create a booking.</small></span></label>
      <label className={styles.honeypot} aria-hidden="true"><span>Website</span><input value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label>
      <button className={styles.submitButton} type="submit" disabled={submitState.kind === "sending" || submitState.kind === "success"}>{submitState.kind === "sending" ? "Sending request..." : submitState.kind === "success" ? "Request received" : "Request an assessment review"}</button>
      {submitState.kind !== "idle" && <div className={submitState.kind === "error" ? styles.errorStatus : styles.status} role={submitState.kind === "error" ? "alert" : "status"}><strong>{submitState.kind === "success" ? "Received" : submitState.kind === "error" ? "Not sent" : "Working"}</strong><span>{submitState.message}</span>{submitState.reference && <small>Reference {submitState.reference}</small>}</div>}
    </section>
  </form>;
}
