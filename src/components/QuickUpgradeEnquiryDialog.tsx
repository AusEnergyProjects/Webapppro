"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ENERGY_SERVICE_CATALOGUE } from "@/lib/energy-service-catalogue.mjs";
import {
  AustralianAddressLookup,
  type AustralianAddressSuggestion,
} from "./AustralianAddressLookup";
import {
  QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
  QUICK_UPGRADE_CONSENT_PURPOSE,
  QUICK_UPGRADE_ENQUIRY_KIND,
} from "@/lib/quick-upgrade-enquiry.mjs";
import styles from "./QuickUpgradeEnquiry.module.css";

type AddressLocality = { suburb: string; state: string };
type LookupState = "idle" | "loading" | "ready" | "error";
type SubmitState = {
  kind: "idle" | "sending" | "error" | "success";
  message: string;
  reference?: string;
};

function createSubmissionId() {
  return `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.${crypto.randomUUID()}`;
}

function localityValue(locality: AddressLocality) {
  return JSON.stringify([locality.suburb, locality.state]);
}

function serviceLabel(id: string, label: string) {
  return id === "other" ? "Something else or not sure" : label;
}

export function QuickUpgradeEnquiryDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const firstServiceRef = useRef<HTMLInputElement>(null);
  const postcodeRef = useRef<HTMLInputElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);
  const clientStartedAt = useRef(0);
  const submissionId = useRef("");
  const consentGrantedAt = useRef("");
  const lastAttemptCore = useRef("");
  const [step, setStep] = useState<1 | 2>(1);
  const [services, setServices] = useState<string[]>([]);
  const [postcode, setPostcode] = useState("");
  const [localities, setLocalities] = useState<AddressLocality[]>([]);
  const [locality, setLocality] = useState<AddressLocality | null>(null);
  const [lookupState, setLookupState] = useState<LookupState>("idle");
  const [lookupError, setLookupError] = useState("");
  const selectedAddressLocality = useRef<{ postcode: string; suburb: string; state: string } | null>(null);
  const [localityLookupRequest, setLocalityLookupRequest] = useState(0);
  const [streetAddress, setStreetAddress] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [shareEmail, setShareEmail] = useState(false);
  const [shareName, setShareName] = useState(false);
  const [sharePhone, setSharePhone] = useState(false);
  const [notes, setNotes] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle", message: "" });

  useEffect(() => {
    clientStartedAt.current = Date.now();
    submissionId.current = createSubmissionId();
    const previousOverflow = document.body.style.overflow;
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => firstServiceRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, []);

  useEffect(() => {
    if (submitState.kind !== "success") return;
    const frame = window.requestAnimationFrame(() => successCloseRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [submitState.kind]);

  useEffect(() => {
    if (step !== 2 || submitState.kind === "success") return;
    const frame = window.requestAnimationFrame(() => postcodeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [step, submitState.kind]);

  useEffect(() => {
    if (!/^\d{4}$/.test(postcode)) return;
    const controller = new AbortController();
    void fetch(`/api/address-localities?postcode=${encodeURIComponent(postcode)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        postcode?: unknown;
        localities?: unknown;
        error?: unknown;
      };
      if (!response.ok || !result.ok || result.postcode !== postcode) {
        throw new Error(typeof result.error === "string" && result.error.trim()
          ? result.error.trim()
          : "Suburbs could not be loaded for this postcode.");
      }
      const seen = new Set<string>();
      const next = Array.isArray(result.localities) ? result.localities.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as { suburb?: unknown; state?: unknown };
        const suburb = typeof record.suburb === "string" ? record.suburb.trim() : "";
        const state = typeof record.state === "string" ? record.state.trim().toUpperCase() : "";
        const key = `${suburb.toLocaleLowerCase("en-AU")}:${state}`;
        if (!suburb || !/^(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(state) || seen.has(key)) return [];
        seen.add(key);
        return [{ suburb, state }];
      }) : [];
      if (!next.length) throw new Error("No matching suburbs were found for this postcode.");
      const pendingLocality = selectedAddressLocality.current;
      if (pendingLocality?.postcode === postcode) {
        const canonicalLocality = next.find((entry) =>
          entry.state === pendingLocality.state
          && entry.suburb.toLocaleLowerCase("en-AU") === pendingLocality.suburb.toLocaleLowerCase("en-AU"));
        if (!canonicalLocality) {
          throw new Error("The selected address suburb is not listed for this postcode.");
        }
        selectedAddressLocality.current = null;
        setLocality(canonicalLocality);
      }
      setLocalities(next);
      setLookupState("ready");
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      if (selectedAddressLocality.current?.postcode === postcode) {
        selectedAddressLocality.current = null;
      }
      setLocalities([]);
      setLocality(null);
      setLookupState("error");
      setLookupError(caught instanceof Error ? caught.message : "Suburbs could not be loaded.");
    });
    return () => controller.abort();
  }, [localityLookupRequest, postcode]);

  const dismissible = submitState.kind !== "sending";

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (dismissible) {
        event.preventDefault();
        onClose();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialogRef.current?.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function toggleService(serviceId: string) {
    setServices((current) => current.includes(serviceId)
      ? current.filter((entry) => entry !== serviceId)
      : [...current, serviceId]);
    setError("");
  }

  function continueToDetails() {
    if (!services.length) {
      setError("Choose at least one service, or choose ‘Something else or not sure’.");
      firstServiceRef.current?.focus();
      return;
    }
    setError("");
    setStep(2);
  }

  function changePostcode(value: string) {
    const nextPostcode = value.replace(/\D/g, "").slice(0, 4);
    selectedAddressLocality.current = null;
    setPostcode(nextPostcode);
    setLocalities([]);
    setLocality(null);
    setLookupError("");
    setLookupState(/^\d{4}$/.test(nextPostcode) ? "loading" : "idle");
  }

  function selectAddress(selection: AustralianAddressSuggestion) {
    selectedAddressLocality.current = {
      postcode: selection.postcode,
      suburb: selection.suburb,
      state: selection.addressState.toUpperCase(),
    };
    setStreetAddress(selection.addressLine1);
    setUnitNumber(selection.addressLine2);
    setPostcode(selection.postcode);
    setLocalities([]);
    setLocality(null);
    setLookupState("loading");
    setLookupError("");
    setLocalityLookupRequest((current) => current + 1);
  }

  function changeLocality(value: string) {
    if (!value) {
      setLocality(null);
      return;
    }
    const [suburb, state] = JSON.parse(value) as [string, string];
    setLocality({ suburb, state });
  }

  function changeConsent(accepted: boolean) {
    setConsentAccepted(accepted);
    consentGrantedAt.current = accepted ? new Date().toISOString() : "";
    if (!accepted && lastAttemptCore.current) {
      submissionId.current = createSubmissionId();
      lastAttemptCore.current = "";
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!locality || lookupState !== "ready") {
      setSubmitState({ kind: "error", message: "Choose the suburb listed for the property postcode." });
      return;
    }
    const core = JSON.stringify({
      services: [...services].sort(), postcode, locality, streetAddress: streetAddress.trim(),
      unitNumber: unitNumber.trim(), email: email.trim().toLowerCase(), firstName: firstName.trim(),
      lastName: lastName.trim(), phone: phone.trim(), shareEmail, shareName, sharePhone, notes: notes.trim(), consentAccepted,
    });
    if (!submissionId.current || (lastAttemptCore.current && lastAttemptCore.current !== core)) {
      submissionId.current = createSubmissionId();
      consentGrantedAt.current = "";
      setConsentAccepted(false);
      setSubmitState({ kind: "error", message: "Your details changed. Please confirm the sharing notice again." });
      lastAttemptCore.current = core;
      return;
    }
    lastAttemptCore.current = core;
    if (!consentAccepted || !consentGrantedAt.current) {
      setSubmitState({ kind: "error", message: "Confirm the sharing notice before sending your request." });
      return;
    }
    setSubmitState({ kind: "sending", message: "Sending your request securely..." });
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionType: "upgrade",
          enquiry: QUICK_UPGRADE_ENQUIRY_KIND,
          submissionId: submissionId.current,
          name: [firstName.trim(), lastName.trim()].filter(Boolean).join(" "),
          email: email.trim(),
          phone: phone.trim(),
          customerFirstName: firstName.trim(),
          customerLastName: lastName.trim(),
          customerUnitNumber: unitNumber.trim(),
          customerStreetAddress: streetAddress.trim(),
          customerSuburb: locality.suburb,
          customerState: locality.state,
          postcode,
          projectCategories: services,
          projectNotes: notes.trim(),
          tradeSharing: {
            email: shareEmail,
            postcode: true,
            address: true,
            name: shareName,
            phone: sharePhone,
          },
          website,
          clientStartedAt: clientStartedAt.current,
          consent: {
            accepted: true,
            purpose: QUICK_UPGRADE_CONSENT_PURPOSE,
            noticeVersion: QUICK_UPGRADE_CONSENT_NOTICE_VERSION,
            grantedAt: consentGrantedAt.current,
          },
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        reference?: string;
      };
      if (!response.ok || !result.ok) throw new Error(result.error || "Your request could not be sent.");
      setSubmitState({
        kind: "success",
        reference: result.reference,
        message: "Your request has been saved for matching. Australian Energy Assessments will help if no suitable business is available.",
      });
    } catch (caught) {
      setSubmitState({
        kind: "error",
        message: caught instanceof Error ? caught.message : "Your request could not be sent.",
      });
    }
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header className={styles.header}>
          <div>
            <span>Independent service matching</span>
            <h2 id={titleId}>Get upgrade options without the runaround</h2>
            <p id={descriptionId}>Choose what you need and send one clear request to approved TLink trade businesses that cover your area.</p>
          </div>
          <button className={styles.closeButton} type="button" onClick={onClose} disabled={!dismissible} aria-label="Close upgrade options">Close</button>
        </header>

        {submitState.kind === "success" ? (
          <div className={styles.success}>
            <span aria-hidden="true">✓</span>
            <div><h3>Request sent</h3><p>{submitState.message}</p>{submitState.reference ? <small>Reference {submitState.reference}</small> : null}</div>
            <button ref={successCloseRef} type="button" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className={styles.progress} aria-label={`Step ${step} of 2`}><span className={step >= 1 ? styles.current : ""}>1 <b>Services</b></span><i /><span className={step >= 2 ? styles.current : ""}>2 <b>Property and contact</b></span></div>
            {step === 1 ? (
              <div className={styles.body}>
                <div className={styles.stepHeading}><span>Step 1 of 2</span><h3>What would you like help with?</h3><p>Select one service or combine several. It is fine if you are not sure yet.</p></div>
                <fieldset className={styles.serviceGrid}>
                  <legend className="sr-only">Choose one or more services</legend>
                  {ENERGY_SERVICE_CATALOGUE.map((service, index) => (
                    <label className={services.includes(service.id) ? styles.selected : ""} key={service.id}>
                      <input ref={index === 0 ? firstServiceRef : undefined} type="checkbox" checked={services.includes(service.id)} onChange={() => toggleService(service.id)} />
                      <span>{serviceLabel(service.id, service.label)}</span>
                    </label>
                  ))}
                </fieldset>
                {error ? <p className={styles.error} role="alert">{error}</p> : null}
                <p className={styles.reassurance}>No account. About one minute. No obligation.</p>
              </div>
            ) : (
              <div className={styles.body}>
                <div className={styles.stepHeading}><span>Step 2 of 2</span><h3>Where is the property?</h3><p>We use the address to find approved businesses that service the right area.</p></div>
                <div className={styles.addressGrid}>
                  <label><span>Postcode *</span><input ref={postcodeRef} value={postcode} onChange={(event) => changePostcode(event.target.value)} inputMode="numeric" autoComplete="postal-code" pattern="\d{4}" maxLength={4} required /></label>
                  <label className={styles.suburb}><span>Suburb *</span><select value={locality ? localityValue(locality) : ""} onChange={(event) => changeLocality(event.target.value)} disabled={lookupState !== "ready"} required><option value="">{lookupState === "loading" ? "Loading suburbs..." : "Choose the listed suburb"}</option>{localities.map((entry) => <option value={localityValue(entry)} key={localityValue(entry)}>{entry.suburb}, {entry.state}</option>)}</select>{lookupError ? <small className={styles.fieldError}>{lookupError}</small> : null}</label>
                  <label><span>Unit</span><input value={unitNumber} onChange={(event) => setUnitNumber(event.target.value)} autoComplete="address-line2" maxLength={40} /></label>
                  <AustralianAddressLookup className={styles.street} label="Street address *" value={streetAddress} onChange={setStreetAddress} onSelect={selectAddress} required />
                </div>

                <div className={styles.stepHeading}><h3>Your contact details</h3><p>Australian Energy Assessments needs these details to manage the request and help if something gets stuck. You choose which contact details matching businesses can see.</p></div>
                <div className={styles.contactGrid}>
                  <label className={styles.full}><span>Email *</span><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (!event.target.value.trim()) setShareEmail(false); }} autoComplete="email" maxLength={254} required /></label>
                  <label><span>First name *</span><input value={firstName} onChange={(event) => { setFirstName(event.target.value); if (!event.target.value.trim() || !lastName.trim()) setShareName(false); }} autoComplete="given-name" maxLength={60} required /></label>
                  <label><span>Last name *</span><input value={lastName} onChange={(event) => { setLastName(event.target.value); if (!event.target.value.trim() || !firstName.trim()) setShareName(false); }} autoComplete="family-name" maxLength={60} required /></label>
                  <label className={styles.full}><span>Phone *</span><input type="tel" value={phone} onChange={(event) => { setPhone(event.target.value); if (!event.target.value.trim()) setSharePhone(false); }} autoComplete="tel" maxLength={40} required /></label>
                </div>
                <div className={styles.optionalSharing}>
                  <span>Choose contact details to share with matching businesses</span>
                  <label><input type="checkbox" checked={shareEmail} disabled={!email.trim()} onChange={(event) => setShareEmail(event.target.checked)} /> Share my email</label>
                  <label><input type="checkbox" checked={shareName} disabled={!firstName.trim() || !lastName.trim()} onChange={(event) => setShareName(event.target.checked)} /> Share my name</label>
                  <label><input type="checkbox" checked={sharePhone} disabled={!phone.trim()} onChange={(event) => setSharePhone(event.target.checked)} /> Share my phone number</label>
                </div>
                <label className={styles.notes}><span>Anything useful to add?</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={500} placeholder="For example: what you want to improve, when you hope to start, or what you are unsure about." /><small>Do not include account numbers, meter numbers, access codes or payment details.</small></label>
                <div className={styles.sharingSummary}><strong>What matching businesses will receive</strong><p>Your selected services, full property address and anything you write above go to approved TLink businesses that match the services and area. Your email, name and phone are included only if you tick them.</p><p>Australian Energy Assessments securely keeps all contact details so we can manage the request and help if needed. We do not sell leads or let businesses pay for placement.</p></div>
                <label className={styles.consent}><input type="checkbox" checked={consentAccepted} onChange={(event) => changeConsent(event.target.checked)} required /><span><strong>I agree to send this request *</strong><small>{QUICK_UPGRADE_CONSENT_PURPOSE} This is a request for options, not an agreement to buy or authorise work.</small></span></label>
                <label className={styles.honeypot} aria-hidden="true"><span>Website</span><input value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" /></label>
                {submitState.kind === "error" ? <p className={styles.error} role="alert">{submitState.message}</p> : null}
              </div>
            )}
            <footer className={styles.actions}>
              {step === 1 ? <button type="button" onClick={onClose}>Not now</button> : <button type="button" onClick={() => { setStep(1); setSubmitState({ kind: "idle", message: "" }); }}>Back</button>}
              {step === 1
                ? <button className={styles.primary} type="button" onClick={continueToDetails}>Continue</button>
                : <button className={styles.primary} type="submit" disabled={submitState.kind === "sending"}>{submitState.kind === "sending" ? "Sending securely..." : "Send my request"}</button>}
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
