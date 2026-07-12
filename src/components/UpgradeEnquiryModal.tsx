"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const EMAIL_WEBHOOK = "https://script.google.com/macros/s/AKfycbwstZJE6asc39Mtbw1uEN_IE0osNOqcHvRV-Ope-AKfOgooEXMVHr5Hff2gHPXSv308/exec";

type UpgradeEnquiryModalProps = {
  title: string;
  annualMj: string;
  estimatedSaving: number;
  onClose: () => void;
};

export function UpgradeEnquiryModal({ title, annualMj, estimatedSaving, onClose }: UpgradeEnquiryModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"" | "ok" | "err">("");
  const [sending, setSending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (website.trim()) {
      setStatusType("ok");
      setStatus("Thanks, your enquiry has been received.");
      return;
    }
    if (!name.trim()) {
      setStatusType("err");
      setStatus("Please enter your name.");
      nameRef.current?.focus();
      return;
    }
    if (!email.trim() && !phone.trim()) {
      setStatusType("err");
      setStatus("Please enter an email or a phone number so we can reach you.");
      return;
    }
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setStatusType("err");
      setStatus("That email does not look right. Check it, or leave it blank and give a phone number.");
      return;
    }

    setSending(true);
    setStatusType("");
    setStatus("Sending...");
    const payload = {
      ts: new Date().toISOString(),
      enquiry: title,
      type: `Upgrade enquiry: ${title}`,
      upgrades: true,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      annualMj: Number(annualMj) || "",
      annualSaving: Math.round(estimatedSaving),
    };

    fetch(EMAIL_WEBHOOK, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(payload) })
      .then(() => {
        setStatusType("ok");
        setStatus(`Thanks ${name.trim()}, your enquiry is in. Our team will be in touch about an independent assessment and direct-to-trade options.`);
        setName("");
        setEmail("");
        setPhone("");
      })
      .catch(() => {
        setStatusType("err");
        setStatus("Could not send right now. Please try again shortly, or call 1300 241 149.");
      })
      .finally(() => setSending(false));
  }

  return <div className="modal-ov show" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="gas-enquiry-title">
      <h3 id="gas-enquiry-title">{title}</h3>
      <p>Leave your details and our team will be in touch about your direct-to-trade options.</p>
      <form onSubmit={submit}>
        <div className="enqrow">
          <input ref={nameRef} type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Name" />
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" aria-label="Email address" />
          <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone number" aria-label="Phone number" />
        </div>
        <input className="hp-field" type="text" value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" placeholder="Leave this blank" />
        {status && <div className={`estat ${statusType}`}>{status}</div>}
        <div className="enqbtns">
          <button className="mclose" type="submit" disabled={sending}>{sending ? "Sending..." : "Send my enquiry"}</button>
          <button className="mcancel" type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
      <p className="enqfine">Please give your name and at least an email or a phone number. We use your details only for this enquiry. Call 1300 241 149 if you prefer.</p>
    </div>
  </div>;
}
