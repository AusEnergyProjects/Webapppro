"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Field, SiteFooter, SiteHeader } from "./ComparatorChrome";
import { australianStateLabel, canonicalAustralianState, postcodeMatchesState, residentialStateFromPostcode } from "@/lib/australian-postcodes.mjs";

const NOTICE_VERSION = "2026-07-14";
const services = [
  ["assessment", "Independent energy assessment", "Understand the home and priorities before selecting equipment."],
  ["solar", "Rooftop solar", "Design, replacement or expansion of a solar system."],
  ["battery", "Home battery", "Storage, backup and solar integration."],
  ["heating-cooling", "Heating and cooling", "Efficient heating, cooling or replacement of gas equipment."],
  ["hot-water", "Hot water", "Heat pump, solar hot water or replacement advice."],
  ["insulation-draughts", "Insulation and draught control", "Building fabric, air leakage and comfort improvements."],
  ["ev-charging", "EV charging", "Home charging equipment and electrical capacity checks."],
  ["other", "Another energy upgrade", "Describe the project briefly below."],
] as const;

export function DirectTradeProjectBrief() {
  const startedAt = useRef(0);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [postcode, setPostcode] = useState("");
  const [state, setState] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [projectStage, setProjectStage] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [projectNotes, setProjectNotes] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredContact, setPreferredContact] = useState("either");
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"" | "ok" | "err">("");
  const inferredState = postcode.length === 4 ? residentialStateFromPostcode(postcode) : null;
  const locationMismatch = Boolean(inferredState && state && !postcodeMatchesState(postcode, state));

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  function toggleService(value: string) {
    setSelectedServices((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusType("err");
    if (!selectedServices.length) { setStatus("Choose at least one service for your project."); return; }
    if (!/^\d{4}$/.test(postcode) || !state) { setStatus("Enter a four digit postcode and choose your state or territory."); return; }
    if (locationMismatch) { setStatus(`Postcode ${postcode} is usually in ${australianStateLabel(inferredState)}. Check the postcode or state.`); return; }
    if (!propertyType || !projectStage || !timeframe) { setStatus("Complete the property, project stage and timing fields."); return; }
    if (!name.trim()) { setStatus("Enter your name."); return; }
    if (!email.trim() && !phone.trim()) { setStatus("Enter an email address or phone number so we can respond."); return; }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setStatus("Check the email address, or leave it blank and provide a phone number."); return; }
    if (!consent) { setStatus("Confirm that Australian Energy Assessments may use these details to respond to this project brief."); return; }

    setSending(true);
    setStatusType("");
    setStatus("Sending your project brief...");
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionType: "upgrade",
          enquiry: "direct-trade-project",
          type: "Direct Trade household project brief",
          upgrades: true,
          clientStartedAt: startedAt.current,
          website,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          postcode,
          state,
          projectCategories: selectedServices,
          propertyType,
          projectStage,
          timeframe,
          preferredContact,
          projectNotes,
          consent: {
            accepted: true,
            purpose: "Respond to this Direct Trade household project brief",
            noticeVersion: NOTICE_VERSION,
            grantedAt: new Date().toISOString(),
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Your project brief could not be delivered.");
      setStatusType("ok");
      setStatus(`Thanks ${name.trim()}. Your project brief has been received. Australian Energy Assessments will review the project before connecting it with a suitable trade.`);
    } catch (error) {
      setStatusType("err");
      setStatus(error instanceof Error ? error.message : "Your project brief could not be delivered. Please call 1300 241 149.");
    } finally {
      setSending(false);
    }
  }

  return <main className="wrap direct-trade-request-page">
    <SiteHeader active="direct-trade-request" />
    <header className="direct-trade-request-hero"><div><span>Direct Trade Services</span><h1>Tell us what your home needs</h1><p>Create a short project brief for Australian Energy Assessments to review before connecting you with a suitable licensed trade. This is not a quote and does not guarantee that a trade is available in every location.</p><a className="direct-trade-hero-link" href="/direct-trade/standards">See how matching, verification and quotes work</a></div><aside><strong>Keep the first brief simple</strong><p>Do not include your street address, NMI, meter file, energy bill, payment details or identity documents. We only need enough information to understand the type and location of the work.</p></aside></header>

    <form className="direct-trade-brief" onSubmit={submit} noValidate>
      <section className="direct-trade-form-section" aria-labelledby="trade-service-title"><div className="direct-trade-form-heading"><span>Step 1</span><h2 id="trade-service-title">What help are you looking for?</h2><p>Select every service that may be relevant. The assessment can refine the scope before a quote is requested.</p></div><div className="direct-trade-service-grid">{services.map(([value, title, description]) => <label className={selectedServices.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={selectedServices.includes(value)} onChange={() => toggleService(value)} /><span><strong>{title}</strong><small>{description}</small></span></label>)}</div></section>

      <section className="direct-trade-form-section" aria-labelledby="trade-project-title"><div className="direct-trade-form-heading"><span>Step 2</span><h2 id="trade-project-title">Describe the project</h2><p>Location and timing help us identify the right licence, service area and scheme requirements.</p></div><div className="direct-trade-field-grid"><Field label="Postcode"><input type="text" inputMode="numeric" maxLength={4} value={postcode} onChange={(event) => { const nextPostcode = event.target.value.replace(/\D/g, "").slice(0, 4); setPostcode(nextPostcode); const nextState = residentialStateFromPostcode(nextPostcode); if (nextState && !state) setState(nextState); }} placeholder="3000" /></Field><Field label="State or territory"><select value={canonicalAustralianState(state) || ""} onChange={(event) => setState(event.target.value)}><option value="">Choose one</option><option value="ACT">ACT</option><option value="NSW">NSW</option><option value="NT">NT</option><option value="QLD">Qld</option><option value="SA">SA</option><option value="TAS">Tas</option><option value="VIC">Vic</option><option value="WA">WA</option></select></Field><Field label="Property type"><select value={propertyType} onChange={(event) => setPropertyType(event.target.value)}><option value="">Choose one</option><option value="house">House</option><option value="townhouse-unit">Townhouse or unit</option><option value="apartment">Apartment</option><option value="small-business">Small business</option><option value="other">Other</option></select></Field><Field label="Project stage"><select value={projectStage} onChange={(event) => setProjectStage(event.target.value)}><option value="">Choose one</option><option value="researching">Researching options</option><option value="assessment-ready">Ready for an assessment</option><option value="seeking-quotes">Ready to seek quotes</option><option value="replacement-urgent">Failed equipment needs replacement</option></select></Field><Field label="Preferred timing"><select value={timeframe} onChange={(event) => setTimeframe(event.target.value)}><option value="">Choose one</option><option value="urgent">As soon as practical</option><option value="one-three-months">Within 1 to 3 months</option><option value="three-six-months">Within 3 to 6 months</option><option value="later">More than 6 months away</option></select></Field></div>{postcode.length === 4 && <p className={`direct-trade-location-check ${locationMismatch ? "mismatch" : "matched"}`} role="status">{locationMismatch ? `Postcode ${postcode} is usually in ${australianStateLabel(inferredState)}. Check the postcode or state.` : inferredState ? `Location check: ${postcode} matches ${australianStateLabel(inferredState)}.` : "Check that this is the postcode for the property."}</p>}<Field label="Project notes" optional="optional" hint="Maximum 800 characters. Do not include account numbers, meter identifiers, detailed bills or identity documents."><textarea maxLength={800} rows={5} value={projectNotes} onChange={(event) => setProjectNotes(event.target.value)} placeholder="For example: replacing ducted gas heating, interested in room-by-room electric options, double-storey home." /></Field></section>

      <section className="direct-trade-form-section" aria-labelledby="trade-contact-title"><div className="direct-trade-form-heading"><span>Step 3</span><h2 id="trade-contact-title">How should we contact you?</h2><p>Your details are used only to review and respond to this project brief.</p></div><div className="direct-trade-field-grid"><Field label="Name"><input type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Email" optional="email or phone required"><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field><Field label="Phone" optional="email or phone required"><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></Field><Field label="Preferred contact"><select value={preferredContact} onChange={(event) => setPreferredContact(event.target.value)}><option value="either">Email or phone</option><option value="email">Email</option><option value="phone">Phone</option></select></Field></div><label className="native-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label><label className="direct-trade-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree that Australian Energy Assessments may use these details to review my project, contact me about it and, where suitable, connect the enquiry with a participating trade. My details are not added to comparison reminder emails by this request.</span></label><button className="btn direct-trade-submit" disabled={sending}>{sending ? "Sending..." : "Send my project brief"}</button>{status && <p className={`direct-trade-form-status ${statusType}`} role="status">{status}</p>}</section>
    </form>
    <SiteFooter>This project brief does not create a quote, installation contract or guarantee of trade availability. Confirm licences, scheme approvals, product eligibility, scope, price and warranties before committing.</SiteFooter>
  </main>;
}
