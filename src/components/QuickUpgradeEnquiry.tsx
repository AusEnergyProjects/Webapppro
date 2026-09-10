"use client";

import dynamic from "next/dynamic";
import { useState, type FormEvent } from "react";
import { ENERGY_SERVICE_CATALOGUE } from "@/lib/energy-service-catalogue.mjs";
import styles from "./GettingStarted.module.css";

const QuickUpgradeEnquiryDialog = dynamic(
  () => import("./QuickUpgradeEnquiryDialog").then((module) => module.QuickUpgradeEnquiryDialog),
  { ssr: false, loading: () => <p className={styles.dialogLoading} role="status">Opening your request...</p> },
);

export function QuickUpgradeEnquiry() {
  const [open, setOpen] = useState(false);
  const [service, setService] = useState("");
  const [postcode, setPostcode] = useState("");
  function continueRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpen(true);
  }
  return <>
    <section className={styles.enquiry} id="home-enquiry" aria-labelledby="home-enquiry-title">
      <div className={styles.enquiryTop}><span>Start here</span><span>01 / 02</span></div>
      <h2 id="home-enquiry-title">I want help with...</h2>
      <p>Tell us what you need. We&apos;ll help connect you with suitable trades in your area.</p>
      <form onSubmit={continueRequest}>
        <label className={styles.field}><span>What do you need?</span><select name="service" value={service} onChange={(event) => setService(event.target.value)} required>
          <option value="" disabled>Choose a service</option>
          {ENERGY_SERVICE_CATALOGUE.map((item) => <option key={item.id} value={item.id}>{item.id === "assessment" ? "NatHERS & home energy assessments" : item.id === "other" ? "Something else or not sure" : item.label}</option>)}
        </select></label>
        <label className={styles.field}><span>Your postcode</span><input name="postcode" value={postcode} onChange={(event) => setPostcode(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="postal-code" placeholder="e.g. 3000" pattern="\d{4}" maxLength={4} required /></label>
        <button className={styles.enquiryButton} id="quick-upgrade-options" type="submit">Find the right help <span aria-hidden="true">↗</span></button>
      </form>
      <p className={styles.enquiryNote}>Choose any other services next, then add your property and contact details.</p>
      <div className={styles.enquiryTrust}><span>No account needed</span><span>No obligation</span></div>
      <p className={styles.sharingNote}>Your request and full property address are shared with matching approved businesses to help them quote. You choose which contact details they receive.</p>
    </section>
    {open ? <QuickUpgradeEnquiryDialog initialPostcode={postcode} initialServices={[service]} onClose={() => setOpen(false)} /> : null}
  </>;
}
