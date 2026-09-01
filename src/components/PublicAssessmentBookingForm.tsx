"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  isPublicAssessmentBookingContactMethod,
  isPublicAssessmentBookingPathway,
  isPublicAssessmentBookingStage,
  isPublicAssessmentBookingSubmissionId,
  PUBLIC_ASSESSMENT_BOOKING_CONSENT_NOTICE_VERSION,
  PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE,
  PUBLIC_ASSESSMENT_BOOKING_CONTACT_METHODS,
  PUBLIC_ASSESSMENT_BOOKING_PATHWAYS,
  PUBLIC_ASSESSMENT_BOOKING_REQUEST_KIND,
  PUBLIC_ASSESSMENT_BOOKING_STAGES,
} from "@/lib/public-assessment-booking.mjs";
import styles from "./PublicAssessmentBookingForm.module.css";

type SubmitState = {
  kind: "idle" | "sending" | "error" | "success";
  message: string;
  reference?: string;
};

const pathwayLabels: Record<string, { title: string; detail: string }> = {
  "new-home-nathers": {
    title: "New-home NatHERS",
    detail: "Plan-based assessment for a proposed home or applicable major renovation.",
  },
  "existing-home-rating": {
    title: "Existing-home Home Energy Rating",
    detail: "On-site assessment for a home that is already built.",
  },
  "basix-nsw": {
    title: "NSW BASIX",
    detail: "Assessment support for an applicable NSW residential planning pathway.",
  },
  unsure: {
    title: "I am not sure",
    detail: "We will review the building stage, location and purpose before confirming the pathway.",
  },
};

const stageLabels: Record<string, string> = {
  "early-planning": "Early planning",
  "plans-ready": "Plans and specifications are ready",
  "approval-in-progress": "Approval is in progress",
  "home-already-built": "The home is already built",
  unsure: "I am not sure",
};

const contactLabels: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  either: "Either email or phone",
};

const states = [
  ["ACT", "Australian Capital Territory"],
  ["NSW", "New South Wales"],
  ["NT", "Northern Territory"],
  ["QLD", "Queensland"],
  ["SA", "South Australia"],
  ["TAS", "Tasmania"],
  ["VIC", "Victoria"],
  ["WA", "Western Australia"],
] as const;

function createSubmissionId() {
  return `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.${crypto.randomUUID()}`;
}

export function PublicAssessmentBookingForm() {
  const [assessmentPathway, setAssessmentPathway] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [postcode, setPostcode] = useState("");
  const [state, setState] = useState("");
  const [assessmentStage, setAssessmentStage] = useState("");
  const [preferredContact, setPreferredContact] = useState("");
  const [preferredTiming, setPreferredTiming] = useState("");
  const [notes, setNotes] = useState("");
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

  function changePostcode(value: string) {
    setPostcode(value.replace(/\D/g, "").slice(0, 4));
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
    if (!isPublicAssessmentBookingPathway(assessmentPathway)) {
      setSubmitState({ kind: "error", message: "Choose the assessment pathway you want to discuss." });
      return;
    }
    if (!isPublicAssessmentBookingStage(assessmentStage)) {
      setSubmitState({ kind: "error", message: "Choose the current home or project stage." });
      return;
    }
    if (!isPublicAssessmentBookingContactMethod(preferredContact)) {
      setSubmitState({ kind: "error", message: "Choose how you prefer to be contacted." });
      return;
    }
    if (!/^\d{4}$/.test(postcode)) {
      setSubmitState({ kind: "error", message: "Enter the property's four-digit postcode." });
      return;
    }
    if (!state) {
      setSubmitState({ kind: "error", message: "Choose the state or territory for the property." });
      return;
    }
    if (assessmentPathway === "basix-nsw" && state !== "NSW") {
      setSubmitState({ kind: "error", message: "BASIX booking requests must be for a New South Wales property." });
      return;
    }
    if (!consentAccepted) {
      setSubmitState({ kind: "error", message: "Confirm that we may use your details for this request." });
      return;
    }

    const core = JSON.stringify({
      assessmentPathway,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      postcode,
      state,
      assessmentStage,
      preferredContact,
      preferredTiming: preferredTiming.trim(),
      notes: notes.trim(),
      consentAccepted,
    });
    if (
      !isPublicAssessmentBookingSubmissionId(submissionId.current)
      || (lastAttemptCore.current && lastAttemptCore.current !== core)
    ) {
      submissionId.current = createSubmissionId();
      consentGrantedAt.current = "";
    }
    lastAttemptCore.current = core;
    consentGrantedAt.current ||= new Date().toISOString();
    setSubmitState({ kind: "sending", message: "Sending your booking request securely..." });

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionType: "upgrade",
          enquiry: PUBLIC_ASSESSMENT_BOOKING_REQUEST_KIND,
          submissionId: submissionId.current,
          assessmentPathway,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          postcode,
          state,
          assessmentStage,
          preferredContact,
          preferredTiming: preferredTiming.trim(),
          projectNotes: notes.trim(),
          website,
          clientStartedAt: clientStartedAt.current,
          consent: {
            accepted: consentAccepted,
            purpose: PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE,
            noticeVersion: PUBLIC_ASSESSMENT_BOOKING_CONSENT_NOTICE_VERSION,
            grantedAt: consentGrantedAt.current,
          },
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        reference?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Your booking request could not be sent.");
      }
      setSubmitState({
        kind: "success",
        reference: result.reference,
        message: "Request received. This requests a booking, but the appointment is confirmed only after the pathway, scope, price, access and appointment time are agreed with you.",
      });
    } catch (error) {
      setSubmitState({
        kind: "error",
        message: error instanceof Error ? error.message : "Your booking request could not be sent.",
      });
    }
  }

  return (
    <section className={styles.shell} aria-labelledby="assessment-booking-form-title">
      <header className={styles.introduction}>
        <span>Request an assessment booking</span>
        <h2 id="assessment-booking-form-title">Send the details needed for a pathway and appointment review</h2>
        <p>Submitting this form requests a booking. An appointment is confirmed only after the assessment pathway, scope, price, property access and appointment time are agreed with you.</p>
      </header>

      <form className={styles.form} onSubmit={submit}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}><span>1</span><div><h3>Which assessment do you want to discuss?</h3><p>Choose the closest option. Select unsure when the building stage or approval pathway is not yet clear.</p></div></div>
          <fieldset className={styles.pathwayGrid}>
            <legend>Assessment pathway *</legend>
            {PUBLIC_ASSESSMENT_BOOKING_PATHWAYS.map((pathway) => (
              <label className={assessmentPathway === pathway ? styles.selectedCard : styles.choiceCard} key={pathway}>
                <input type="radio" name="assessmentPathway" value={pathway} checked={assessmentPathway === pathway} onChange={() => setAssessmentPathway(pathway)} required />
                <span><strong>{pathwayLabels[pathway].title}</strong><small>{pathwayLabels[pathway].detail}</small></span>
              </label>
            ))}
          </fieldset>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><span>2</span><div><h3>Who should we contact?</h3><p>Provide the person who can discuss the assessment scope, property access, price and appointment options.</p></div></div>
          <div className={styles.fieldGrid}>
            <label><span>Full name *</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={120} required /></label>
            <label><span>Email *</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} required /></label>
            <label><span>Phone *</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" maxLength={40} required /></label>
            <label><span>Preferred contact *</span><select value={preferredContact} onChange={(event) => setPreferredContact(event.target.value)} required><option value="">Choose email or phone</option>{PUBLIC_ASSESSMENT_BOOKING_CONTACT_METHODS.map((method) => <option value={method} key={method}>{contactLabels[method]}</option>)}</select></label>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}><span>3</span><div><h3>Where is the property and what stage is it at?</h3><p>The state, postcode and project stage help identify the right assessment and approval pathway.</p></div></div>
          <div className={styles.fieldGrid}>
            <label><span>Postcode *</span><input value={postcode} onChange={(event) => changePostcode(event.target.value)} inputMode="numeric" autoComplete="postal-code" pattern="\d{4}" maxLength={4} required /></label>
            <label><span>State or territory *</span><select value={state} onChange={(event) => setState(event.target.value)} autoComplete="address-level1" required><option value="">Choose state or territory</option>{states.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>
            <label className={styles.wideField}><span>Project stage *</span><select value={assessmentStage} onChange={(event) => setAssessmentStage(event.target.value)} required><option value="">Choose the current stage</option>{PUBLIC_ASSESSMENT_BOOKING_STAGES.map((stage) => <option value={stage} key={stage}>{stageLabels[stage]}</option>)}</select></label>
            <label className={styles.wideField}><span>Preferred appointment timing</span><input value={preferredTiming} onChange={(event) => setPreferredTiming(event.target.value)} maxLength={160} placeholder="For example: weekday mornings, after 3 pm, or a date range to discuss" /></label>
          </div>
          <label className={styles.notesField}><span>Optional notes</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} maxLength={1200} placeholder="For example: why the assessment is needed, approval stage, known access limits or questions for the assessment team." /><small>Do not include identity documents, payment details, access codes or unrelated private information.</small></label>
        </section>

        <section className={styles.confirmSection}>
          <label className={styles.confirmation}>
            <input type="checkbox" checked={consentAccepted} onChange={(event) => changeConsent(event.target.checked)} required />
            <span><strong>You may use these details to review and contact me about this request *</strong><small>{PUBLIC_ASSESSMENT_BOOKING_CONSENT_PURPOSE}</small></span>
          </label>
          <p className={styles.bookingBoundary}><strong>This is a booking request, not an appointment confirmation.</strong><span>The assessment pathway, scope, price, property access and appointment time must be agreed before the appointment is confirmed.</span></p>
          <label className={styles.honeypot} aria-hidden="true"><span>Website</span><input value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label>
          <button className={styles.submitButton} type="submit" disabled={submitState.kind === "sending" || submitState.kind === "success"}>{submitState.kind === "sending" ? "Sending request..." : submitState.kind === "success" ? "Request received" : "Request an assessment booking"}</button>
          {submitState.kind !== "idle" && (
            <div className={submitState.kind === "error" ? styles.errorStatus : styles.status} role={submitState.kind === "error" ? "alert" : "status"} aria-live="polite">
              <strong>{submitState.kind === "success" ? "Request received" : submitState.kind === "error" ? "Request not sent" : "Sending request"}</strong>
              <span>{submitState.message}</span>
              {submitState.reference && <small>Reference {submitState.reference}</small>}
            </div>
          )}
        </section>
      </form>
    </section>
  );
}
