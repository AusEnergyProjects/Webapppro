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
  className?: string;
};

type SubmissionStatus =
  | { kind: "idle"; message: "" }
  | { kind: "sending"; message: string }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string; reference: string };

function firstAllowedInterest(
  suggestedInterests: readonly string[] | undefined,
): PublicPlanUpgradeInterest {
  const suggested = suggestedInterests?.find((value) =>
    isPublicPlanUpgradeInterest(value));
  return (suggested as PublicPlanUpgradeInterest | undefined) ?? "assessment";
}

export function PublicPlanEnquiryForm({
  initialPostcode = "",
  suggestedInterests,
  className = "",
}: PublicPlanEnquiryFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [postcode, setPostcode] = useState(initialPostcode.slice(0, 4));
  const [interest, setInterest] = useState<PublicPlanUpgradeInterest>(() =>
    firstAllowedInterest(suggestedInterests));
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<SubmissionStatus>({ kind: "idle", message: "" });
  const startedAt = useRef(0);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  function reset() {
    setStatus({ kind: "idle", message: "" });
    setConsent(false);
    setMessage("");
    startedAt.current = Date.now();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() && !phone.trim()) {
      setStatus({ kind: "error", message: "Enter an email address or phone number so we can respond." });
      return;
    }
    if (!/^\d{4}$/.test(postcode) || !residentialStateFromPostcode(postcode)) {
      setStatus({ kind: "error", message: "Enter a valid Australian postcode." });
      return;
    }
    if (!consent) {
      setStatus({ kind: "error", message: "Confirm that we may use these details to respond to this enquiry." });
      return;
    }

    setStatus({ kind: "sending", message: "Sending your enquiry..." });
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionType: "upgrade",
          enquiry: PUBLIC_PLAN_ENQUIRY_KIND,
          clientStartedAt: startedAt.current,
          website,
          name,
          email,
          phone,
          postcode,
          projectCategories: [interest],
          projectNotes: message,
          consent: {
            accepted: true,
            purpose: PUBLIC_PLAN_CONSENT_PURPOSE,
            noticeVersion: PUBLIC_PLAN_CONSENT_NOTICE_VERSION,
            grantedAt: new Date().toISOString(),
          },
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        ok?: boolean;
        filtered?: boolean;
        error?: string;
        reference?: string;
      };
      if (result.filtered) {
        throw new Error("We could not verify this enquiry. Refresh the page and try again, or call 1300 241 149.");
      }
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Your enquiry could not be delivered. Please try again.");
      }
      setStatus({
        kind: "success",
        message: "Your enquiry is in. We will use the details you supplied to respond. This did not create an account.",
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
            <span className={styles.labelRow}>Name</span>
            <input className={styles.control} required autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Postcode</span>
            <input className={styles.control} required autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={postcode} onChange={(event) => setPostcode(event.target.value.replace(/\D/g, "").slice(0, 4))} />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Email <span className={styles.optional}>email or phone required</span></span>
            <input className={styles.control} type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby="public-plan-contact-hint" />
          </label>
          <label className={styles.field}>
            <span className={styles.labelRow}>Phone <span className={styles.optional}>email or phone required</span></span>
            <input className={styles.control} type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} aria-describedby="public-plan-contact-hint" />
          </label>
          <p className={`${styles.hint} ${styles.full}`} id="public-plan-contact-hint">You can provide either contact method or both.</p>
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

        <div className={styles.honeypot} aria-hidden="true">
          <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
        </div>

        <label className={styles.consent}>
          <input className={styles.consentBox} type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>I agree that Australian Energy Assessments may use these details to contact me about this upgrade enquiry.</span>
        </label>

        <details className={styles.privacy}>
          <summary>What is sent with this enquiry?</summary>
          <p>Only the fields shown above are sent. Your plan answers, account data, energy usage, meter identifiers and uploaded files are not included. We review the request before sharing anything with a trade.</p>
        </details>

        <div className={styles.actions}>
          <button className={styles.submit} type="submit" disabled={status.kind === "sending"}>
            {status.kind === "sending" ? "Sending..." : "Enquire about this upgrade"}
          </button>
          {status.message && (
            <p className={status.kind === "error" ? styles.error : styles.status} role={status.kind === "error" ? "alert" : "status"}>
              {status.message}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
