"use client";

import { useEffect, useState } from "react";
import { ENERGY_SERVICE_LABELS } from "@/lib/energy-service-catalogue.mjs";
import { isAdminSubmittedEnquiryResult, type AdminSubmittedEnquiryResult } from "@/lib/admin-submitted-enquiry";
import { dateTime, readable, workspaceError } from "@/components/admin-workspace";
import styles from "./AdminSubmittedEnquiryDetails.module.css";

export type AdminSubmittedEnquiryDetailsProps = {
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  opportunityId: string;
};

const sharingLabels: Record<string, string> = {
  customer_name: "Name", customer_email: "Email", customer_phone: "Phone",
  customer_address: "Property address", customer_message: "Customer message",
  postcode: "Postcode", service_categories: "Selected services", state: "State", quote_brief: "Quote brief",
};

export function AdminSubmittedEnquiryDetails({ api, opportunityId }: AdminSubmittedEnquiryDetailsProps) {
  const [state, setState] = useState<{ id: string; attempt: number; result?: AdminSubmittedEnquiryResult; error?: string }>({ id: "", attempt: 0 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void api(`/api/admin/opportunities?contact=${encodeURIComponent(opportunityId)}`, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        if (!isAdminSubmittedEnquiryResult(result, opportunityId)) throw new Error("The submitted enquiry details could not be opened.");
        setState({ id: opportunityId, attempt, result });
      }).catch((error: unknown) => {
        if (active) setState({ id: opportunityId, attempt, error: workspaceError(error) });
      });
    return () => { active = false; controller.abort(); };
  }, [api, opportunityId, attempt]);

  const current = state.id === opportunityId && state.attempt === attempt ? state : null;
  const result = current?.result;
  if (!result) return <section className={styles.panel} aria-label="Submitted enquiry details" aria-busy={!current?.error}>
    <h3>Submitted enquiry details</h3>
    {current?.error ? <><p role="alert">{current.error}</p><p>Details may be unavailable if the contact record is missing or sharing consent has been withdrawn.</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></> : <p role="status">Opening customer details...</p>}
  </section>;

  const { retainedContact: contact, submittedEnquiry: enquiry } = result;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const address = [contact.unitNumber ? `Unit ${contact.unitNumber}` : "", contact.streetAddress, contact.suburb, contact.state, contact.postcode].filter(Boolean).join(", ");
  return <section className={styles.panel} aria-label="Submitted enquiry details">
    <header><h3>{name || "Customer name not provided"}</h3><p>Submitted enquiry · {enquiry.title}</p></header>
    <dl className={styles.fields}>
      <div><dt>Email</dt><dd>{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : "Not provided"}</dd></div>
      <div><dt>Phone</dt><dd>{contact.phone ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : "Not provided"}</dd></div>
      <div className={styles.wide}><dt>Property address</dt><dd>{address || "Not provided"}</dd></div>
      <div className={styles.wide}><dt>Requested services</dt><dd>{enquiry.serviceCategories.map((service) => ENERGY_SERVICE_LABELS[service] || readable(service)).join(", ") || "Not provided"}</dd></div>
      <div className={styles.wide}><dt>Customer message</dt><dd className={styles.message}>{enquiry.customerMessage || "No message provided"}</dd></div>
      <div><dt>Received</dt><dd>{dateTime(enquiry.createdAt)}</dd></div>
      <div><dt>Current enquiry status</dt><dd>{readable(enquiry.status)}</dd></div>
      <div className={styles.wide}><dt>Submission reference</dt><dd>{enquiry.sourceReference || "Not available"}</dd></div>
      <div className={styles.wide}><dt>Enquiry ID</dt><dd>{enquiry.id}</dd></div>
    </dl>
    <details className={styles.consent}><summary>Customer sharing consent</summary><dl className={styles.fields}>
      <div><dt>Accepted</dt><dd>{dateTime(enquiry.consent.grantedAt)}</dd></div>
      <div><dt>Notice version</dt><dd>{enquiry.consent.noticeVersion}</dd></div>
      <div className={styles.wide}><dt>Agreed purpose</dt><dd>{enquiry.consent.purpose}</dd></div>
      <div className={styles.wide}><dt>Fields permitted for trade sharing</dt><dd>{enquiry.consent.disclosedFields.map((field) => sharingLabels[field] || readable(field)).join(", ")}</dd></div>
    </dl></details>
    <p className={styles.notice}>Opened for Australian Energy Assessments support. This access is audited. Trades only receive the details the customer agreed to share.</p>
  </section>;
}
