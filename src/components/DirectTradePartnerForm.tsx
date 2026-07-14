"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Field, SiteFooter, SiteHeader } from "./ComparatorChrome";

const NOTICE_VERSION = "2026-07-14";
const states = ["ACT", "NSW", "NT", "Qld", "SA", "Tas", "Vic", "WA"];
const categories = [
  ["assessment", "Energy assessment"],
  ["solar", "Rooftop solar"],
  ["battery", "Home batteries"],
  ["heating-cooling", "Heating and cooling"],
  ["hot-water", "Hot water"],
  ["insulation-draughts", "Insulation and draught control"],
  ["ev-charging", "EV charging"],
  ["other", "Other energy upgrades"],
] as const;

export function DirectTradePartnerForm() {
  const startedAt = useRef(0);
  const [partnerType, setPartnerType] = useState<"installer" | "supplier">("installer");
  const [businessName, setBusinessName] = useState("");
  const [businessWebsite, setBusinessWebsite] = useState("");
  const [serviceStates, setServiceStates] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [partnerNotes, setPartnerNotes] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"" | "ok" | "err">("");

  useEffect(() => { startedAt.current = Date.now(); }, []);

  function toggle(value: string, current: string[], setCurrent: (values: string[]) => void) {
    setCurrent(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusType("err");
    if (!businessName.trim()) { setStatus("Enter the business name."); return; }
    if (!serviceStates.length) { setStatus("Choose at least one state or territory served."); return; }
    if (!selectedCategories.length) { setStatus("Choose at least one capability or product category."); return; }
    if (!name.trim()) { setStatus("Enter the contact name."); return; }
    if (!email.trim() && !phone.trim()) { setStatus("Enter an email address or phone number."); return; }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setStatus("Check the email address, or leave it blank and provide a phone number."); return; }
    if (!consent) { setStatus("Confirm that we may use these details to review the expression of interest."); return; }

    setSending(true);
    setStatusType("");
    setStatus("Sending your expression of interest...");
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionType: "upgrade",
          enquiry: "direct-trade-partner",
          type: partnerType === "installer" ? "Direct Trade installer expression of interest" : "Direct Trade supplier expression of interest",
          partnerType,
          businessName: businessName.trim(),
          businessWebsite: businessWebsite.trim(),
          serviceStates,
          projectCategories: selectedCategories,
          partnerNotes,
          clientStartedAt: startedAt.current,
          website,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          consent: {
            accepted: true,
            purpose: "Review and respond to this Direct Trade participation expression of interest",
            noticeVersion: NOTICE_VERSION,
            grantedAt: new Date().toISOString(),
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Your expression of interest could not be delivered.");
      setStatusType("ok");
      setStatus(`Thanks ${name.trim()}.${result.reference ? ` Reference ${result.reference}.` : ""} Australian Energy Assessments will review the business and contact you about the participation process.`);
    } catch (error) {
      setStatusType("err");
      setStatus(error instanceof Error ? error.message : "Your expression of interest could not be delivered. Please call 1300 241 149.");
    } finally {
      setSending(false);
    }
  }

  return <main className="wrap direct-trade-request-page">
    <SiteHeader active="direct-trade-partners" />
    <header className="direct-trade-request-hero"><div><span>Direct Trade participation</span><h1>Put proven capability closer to the customer</h1><p>Licensed installers can apply to become Direct Trade Specialists. Reputable suppliers can introduce supported products to qualified trades and suitable household projects.</p><a className="direct-trade-hero-link" href="/direct-trade/standards">Review the participation and customer standards</a></div><aside><strong>An expression of interest, not automatic approval</strong><p>Australian Energy Assessments reviews credentials, service coverage, insurance, product evidence and customer support before participation is confirmed.</p></aside></header>
    <form className="direct-trade-brief" onSubmit={submit} noValidate>
      <section className="direct-trade-form-section" aria-labelledby="partner-type-title"><div className="direct-trade-form-heading"><span>Step 1</span><h2 id="partner-type-title">How do you want to participate?</h2><p>Choose the role that best describes the business.</p></div><div className="partner-type-grid"><label className={partnerType === "installer" ? "selected" : ""}><input type="radio" name="partner-type" checked={partnerType === "installer"} onChange={() => setPartnerType("installer")} /><span><strong>Licensed installer</strong><small>Install, commission and support household energy upgrades within verified service areas.</small></span></label><label className={partnerType === "supplier" ? "selected" : ""}><input type="radio" name="partner-type" checked={partnerType === "supplier"} onChange={() => setPartnerType("supplier")} /><span><strong>Product supplier or wholesaler</strong><small>Place proven, supported products with qualified trades and suitable household projects.</small></span></label></div></section>
      <section className="direct-trade-form-section" aria-labelledby="partner-business-title"><div className="direct-trade-form-heading"><span>Step 2</span><h2 id="partner-business-title">Tell us about the business</h2><p>Initial review needs coverage and capability, not sensitive documents.</p></div><div className="direct-trade-field-grid"><Field label="Business name"><input type="text" value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" /></Field><Field label="Business website" optional="optional"><input type="url" value={businessWebsite} onChange={(event) => setBusinessWebsite(event.target.value)} inputMode="url" placeholder="https://example.com.au" /></Field></div><fieldset className="partner-check-group"><legend>States and territories served</legend><div className="partner-chip-grid">{states.map((value) => <label className={serviceStates.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={serviceStates.includes(value)} onChange={() => toggle(value, serviceStates, setServiceStates)} />{value}</label>)}</div></fieldset><fieldset className="partner-check-group"><legend>{partnerType === "installer" ? "Installation capabilities" : "Product categories"}</legend><div className="partner-category-grid">{categories.map(([value, label]) => <label className={selectedCategories.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={selectedCategories.includes(value)} onChange={() => toggle(value, selectedCategories, setSelectedCategories)} />{label}</label>)}</div></fieldset><Field label={partnerType === "installer" ? "Capabilities and credential summary" : "Products, warranties and support summary"} optional="optional" hint="Maximum 800 characters. Do not upload or paste licence documents, identity records, customer lists, wholesale price files or confidential contracts."><textarea maxLength={800} rows={5} value={partnerNotes} onChange={(event) => setPartnerNotes(event.target.value)} /></Field></section>
      <section className="direct-trade-form-section" aria-labelledby="partner-contact-title"><div className="direct-trade-form-heading"><span>Step 3</span><h2 id="partner-contact-title">Who should we contact?</h2><p>These details are used only to assess and respond to this participation enquiry.</p></div><div className="direct-trade-field-grid"><Field label="Contact name"><input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></Field><Field label="Business email" optional="email or phone required"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></Field><Field label="Phone" optional="email or phone required"><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" /></Field></div><label className="native-honeypot" aria-hidden="true">Website<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label><label className="direct-trade-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree that Australian Energy Assessments may use these details to review the business and contact me about Direct Trade participation. This request does not create membership, accreditation, exclusivity or guaranteed opportunity volume.</span></label><button className="btn direct-trade-submit" disabled={sending}>{sending ? "Sending..." : "Send expression of interest"}</button>{status && <p className={`direct-trade-form-status ${statusType}`} role="status">{status}</p>}</section>
    </form>
    <SiteFooter>Direct Trade membership does not replace trade licensing, government accreditation, scheme approval, insurance, product compliance or each applicant&apos;s own customer obligations.</SiteFooter>
  </main>;
}
