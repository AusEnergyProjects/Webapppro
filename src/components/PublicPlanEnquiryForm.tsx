"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  isPublicPlanUpgradeInterest,
  PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
  PUBLIC_PLAN_CONSENT_PURPOSE,
  PUBLIC_PLAN_ENQUIRY_KIND,
} from "@/lib/public-plan-enquiry.mjs";
import { residentialStateFromPostcode } from "@/lib/australian-postcodes.mjs";
import styles from "./PublicPlanEnquiryForm.module.css";

export type PublicPlanUpgradeInterest =
  | "assessment"
  | "solar"
  | "battery"
  | "heating-cooling"
  | "hot-water"
  | "draught-proofing"
  | "insulation"
  | "glazing"
  | "window-coverings"
  | "ev-charging"
  | "other";

export type PublicPlanSnapshot = {
  goals: string[];
  pace: string;
  situation: string;
  approvalContext: string;
  budgetRange: string;
  addressState: string;
  features: string[];
  propertyContext?: {
    propertyType?: string;
    storeys?: string;
    ageBand?: string;
    floorArea?: string;
    occupants?: string;
    sharedWalls?: string;
    roofType?: string;
    roofColour?: string;
    roofForm?: string;
    roofCondition?: string;
    switchboard?: string;
    wallConstruction?: string;
    floorConstruction?: string;
  };
};

const INTEREST_LABELS: Record<PublicPlanUpgradeInterest, string> = {
  assessment: "An independent home energy assessment",
  solar: "Rooftop solar",
  battery: "A home battery",
  "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water",
  "draught-proofing": "Draught proofing",
  insulation: "Insulation",
  glazing: "Windows and glazing",
  "window-coverings": "Blinds, shutters or external shading",
  "ev-charging": "Electric vehicle charging",
  other: "Another home energy upgrade",
};

type PublicPlanEnquiryFormProps = {
  initialPostcode?: string;
  suggestedInterests?: readonly string[];
  planSnapshot: PublicPlanSnapshot;
  className?: string;
};

type SubmissionStatus =
  | { kind: "idle"; message: "" }
  | { kind: "sending"; message: string }
  | { kind: "error"; message: string }
  | { kind: "received"; message: string; reference: string }
  | { kind: "success"; message: string; reference: string };

function firstAllowedInterest(
  suggestedInterests: readonly string[] | undefined,
): PublicPlanUpgradeInterest {
  const suggested = suggestedInterests?.find((value) =>
    isPublicPlanUpgradeInterest(value));
  return (suggested as PublicPlanUpgradeInterest | undefined) ?? "assessment";
}

function createSubmissionId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${date}.${crypto.randomUUID()}`;
}

function submissionCoreKey({
  name,
  email,
  phone,
  postcode,
  interest,
  message,
  tradeSharing,
  planSnapshot,
}: {
  name: string;
  email: string;
  phone: string;
  postcode: string;
  interest: PublicPlanUpgradeInterest;
  message: string;
  tradeSharing: {
    name: boolean;
    phone: boolean;
  };
  planSnapshot: PublicPlanSnapshot;
}) {
  return JSON.stringify({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    postcode: postcode.trim(),
    interest,
    message: message.trim(),
    tradeSharing,
    planSnapshot: {
      goals: [...planSnapshot.goals].sort(),
      pace: planSnapshot.pace,
      situation: planSnapshot.situation,
      approvalContext: planSnapshot.approvalContext,
      budgetRange: planSnapshot.budgetRange,
      addressState: planSnapshot.addressState,
      features: [...planSnapshot.features].sort(),
      propertyContext: {
        propertyType: planSnapshot.propertyContext?.propertyType || "",
        storeys: planSnapshot.propertyContext?.storeys || "",
        ageBand: planSnapshot.propertyContext?.ageBand || "",
        floorArea: planSnapshot.propertyContext?.floorArea || "",
        occupants: planSnapshot.propertyContext?.occupants || "",
        sharedWalls: planSnapshot.propertyContext?.sharedWalls || "",
        roofType: planSnapshot.propertyContext?.roofType || "",
        roofColour: planSnapshot.propertyContext?.roofColour || "",
        roofForm: planSnapshot.propertyContext?.roofForm || "",
        roofCondition: planSnapshot.propertyContext?.roofCondition || "",
        switchboard: planSnapshot.propertyContext?.switchboard || "",
        wallConstruction: planSnapshot.propertyContext?.wallConstruction || "",
        floorConstruction: planSnapshot.propertyContext?.floorConstruction || "",
      },
    },
    consent: {
      accepted: true,
      purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
      noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
    },
  });
}

export function PublicPlanEnquiryForm({
  initialPostcode = "",
  suggestedInterests,
  planSnapshot,
  className = "",
}: PublicPlanEnquiryFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [postcode, setPostcode] = useState(initialPostcode.slice(0, 4));
  const [interest, setInterest] = useState<PublicPlanUpgradeInterest>(() =>
    firstAllowedInterest(suggestedInterests));
  const [message, setMessage] = useState("");
  const [shareName, setShareName] = useState(false);
  const [sharePhone, setSharePhone] = useState(false);
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "idle", message: "" });
  const startedAt = useRef(0);
  const submissionId = useRef("");
  const consentGrantedAt = useRef("");
  const lastAttemptCore = useRef("");

  useEffect(() => {
    startedAt.current = Date.now();
    submissionId.current = createSubmissionId();
    consentGrantedAt.current = "";
    lastAttemptCore.current = "";
  }, []);

  function reset() {
    setStatus({ kind: "idle", message: "" });
    setConsent(false);
    setMessage("");
    setShareName(false);
    setSharePhone(false);
    startedAt.current = Date.now();
    submissionId.current = createSubmissionId();
    consentGrantedAt.current = "";
    lastAttemptCore.current = "";
  }

  function changeConsent(accepted: boolean) {
    setConsent(accepted);
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
    if (!email.trim()) {
      setStatus({ kind: "error", message: "Enter your email address so we can send your private plan and matching trades can reply." });
      return;
    }
    if (!phone.trim()) {
      setStatus({ kind: "error", message: "Enter your phone number for Australian Energy Assessments records. It stays private unless you choose to share it." });
      return;
    }
    if (!/^\d{4}$/.test(postcode) || !residentialStateFromPostcode(postcode)) {
      setStatus({ kind: "error", message: "Enter a valid Australian postcode." });
      return;
    }
    if (!consent || !consentGrantedAt.current) {
      setStatus({ kind: "error", message: "Confirm that we may use these details to respond to this enquiry." });
      return;
    }

    setStatus({ kind: "sending", message: "Sending your enquiry..." });
    try {
      if (!submissionId.current) {
        submissionId.current = createSubmissionId();
      }
      const currentCore = submissionCoreKey({
        name,
        email,
        phone,
        postcode,
        interest,
        message,
        tradeSharing: {
          name: shareName,
          phone: sharePhone,
        },
        planSnapshot,
      });
      if (lastAttemptCore.current && lastAttemptCore.current !== currentCore) {
        submissionId.current = createSubmissionId();
      }
      lastAttemptCore.current = currentCore;
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionType: "upgrade",
          enquiry: PUBLIC_PLAN_ENQUIRY_KIND,
          submissionId: submissionId.current,
          clientStartedAt: startedAt.current,
          website,
          name,
          email,
          phone,
          postcode,
          projectCategories: [interest],
          projectNotes: message,
          tradeSharing: {
            email: true,
            postcode: true,
            name: shareName,
            phone: sharePhone,
          },
          planSnapshot,
          consent: {
            accepted: true,
            purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
            noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
            grantedAt: consentGrantedAt.current,
          },
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        filtered?: boolean;
        error?: string;
        reference?: string;
        planEmailSent?: boolean;
        received?: boolean;
      };
      if (result.filtered) {
        throw new Error("We could not verify this enquiry. Refresh the page and try again, or call 1300 241 149.");
      }
      if (!response.ok || !result.ok) {
        if (result.received) {
          setStatus({
            kind: "received",
            message: result.planEmailSent
              ? "Your enquiry and private plan PDF email were safely received, but trade matching is not prepared yet. Retry trade matching with this same request."
              : "Your enquiry was safely received, but trade matching is not prepared yet. Retry trade matching with this same request.",
            reference: result.reference || "",
          });
          return;
        }
        throw new Error(result.error || "Your enquiry could not be delivered. Please try again.");
      }
      setStatus({
        kind: "success",
        message: result.planEmailSent
          ? "Your enquiry is ready for matching trades and your personalised home plan PDF has been emailed to you. This did not create an account."
          : "Your enquiry is ready for matching trades. Your private plan PDF could not be emailed, so you can still download it here. This did not create an account.",
        reference: result.reference || "",
      });
    } catch (caught) {
      setStatus({
        kind: "error",
        message: caught instanceof Error
          ? caught.message
          : "Your enquiry could not be delivered. Please try again.",
      });
    }
  }

  const rootClassName = [styles.root, className].filter(Boolean).join(" ");

  if (status.kind === "success") {
    return (
      <section className={rootClassName} aria-labelledby="public-plan-enquiry-success-title">
        <div className={styles.success} role="status">
          <span className={styles.eyebrow}>Enquiry received</span>
          <h3 className={styles.title} id="public-plan-enquiry-success-title">We have your request</h3>
          <p>{status.message}</p>
          {status.reference && <p className={styles.reference}>Reference {status.reference}</p>}
          <button className={styles.reset} type="button" onClick={reset}>Send another enquiry</button>
        </div>
      </section>
    );
  }

  return (
    <section className={rootClassName} aria-labelledby="public-plan-enquiry-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Your next step</span>
          <h3 className={styles.title} id="public-plan-enquiry-title">Ask about an upgrade</h3>
          <p className={styles.intro}>No account needed. Tell us what you want help with and how to contact you.</p>
        </div>
        <span className={styles.badge}>About 1 minute</span>
      </header>

      <form className={styles.form} onSubmit={submit}>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.labelRow}>Name <span className={styles.optional}>private unless you share it below</span></span>
            <input className={styles.control} required autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Postcode</span>
            <input className={styles.control} required autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={postcode} onChange={(event) => setPostcode(event.target.value.replace(/\D/g, "").slice(0, 4))} />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Email <span className={styles.optional}>shared so trades can reply</span></span>
            <input className={styles.control} required type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby="public-plan-contact-hint" />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Phone <span className={styles.optional}>private unless you share it below</span></span>
            <input className={styles.control} required type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} aria-describedby="public-plan-contact-hint" />
          </label>
          <p className={`${styles.hint} ${styles.full}`} id="public-plan-contact-hint">Australian Energy Assessments keeps these details for your enquiry. Matching trades always receive your email and postcode. Your name and phone stay private unless you choose to share them.</p>
          <label className={`${styles.field} ${styles.full}`}>
            <span className={styles.labelRow}>What would you like help with first?</span>
            <select className={styles.control} value={interest} onChange={(event) => setInterest(event.target.value as PublicPlanUpgradeInterest)}>
              {(Object.entries(INTEREST_LABELS) as Array<[PublicPlanUpgradeInterest, string]>).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            <span className={styles.labelRow}>Anything we should know? <span className={styles.optional}>optional</span></span>
            <textarea className={styles.control} maxLength={500} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="For example, the system has stopped working or you want to plan the upgrade in stages." />
          </label>
        </div>

        <fieldset className={styles.shareChoices}>
          <legend>Choose what matching trades can see</legend>
          <p>Your email, postcode, selected service and any message you write are included so trades can reply and understand what you need.</p>
          <label>
            <input type="checkbox" checked={shareName} onChange={(event) => setShareName(event.target.checked)} />
            <span>Also share my name</span>
          </label>
          <label>
            <input type="checkbox" checked={sharePhone} onChange={(event) => setSharePhone(event.target.checked)} />
            <span>Also share my phone number</span>
          </label>
        </fieldset>

        <div className={styles.honeypot} aria-hidden="true">
          <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
        </div>

        <label className={styles.consent}>
          <input className={styles.consentBox} type="checkbox" checked={consent} onChange={(event) => changeConsent(event.target.checked)} />
          <span>I agree that Australian Energy Assessments may send this enquiry to all approved TLink trades that service my area. Trades receive my email, postcode, selected service and any message I wrote, plus my name or phone only if I selected them above. My full plan and PDF stay private and are emailed only to me.</span>
        </label>

        <details className={styles.privacy}>
          <summary>What is sent with this enquiry?</summary>
          <p>Australian Energy Assessments keeps the full enquiry for its records. Matching trades receive your email, postcode, selected service and any message you wrote. Your name and phone are included only when you choose to share them. Your full plan, PDF, street address, bills, energy usage, meter identifiers, account data and uploaded files are not shared with trades.</p>
        </details>

        <div className={styles.actions}>
          <button className={styles.submit} type="submit" disabled={status.kind === "sending"}>
            {status.kind === "sending"
              ? "Sending..."
              : status.kind === "received"
                ? "Retry trade matching"
                : "Enquire about this upgrade"}
          </button>
          {status.message && (
            <p className={status.kind === "error" ? styles.error : styles.status} role={status.kind === "error" ? "alert" : "status"}>
              {status.message}
              {status.kind === "received" && status.reference ? ` Reference ${status.reference}.` : ""}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
