"use client";

import { useEffect, useRef } from "react";

type UpgradeEnquiryModalProps = {
  enquiryCode: "gas-heating" | "gas-hot-water";
  title: string;
  postcode: string;
  annualMj: string;
  estimatedSaving: number;
  installedCost: number;
  onClose: () => void;
};

export function UpgradeEnquiryModal({ enquiryCode, title, postcode, onClose }: UpgradeEnquiryModalProps) {
  const actionRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => { actionRef.current?.focus(); }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const category = enquiryCode === "gas-heating" ? "heating-cooling" : "hot-water";
  const feature = enquiryCode === "gas-heating" ? "gas-heating" : "gas-hot-water";
  const params = new URLSearchParams({ goal: "move-from-gas", pace: "staged", category, feature });
  if (/^\d{4}$/.test(postcode)) params.set("postcode", postcode);
  return <div className="modal-ov show" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal private-project-modal" role="dialog" aria-modal="true" aria-labelledby="gas-enquiry-title">
      <span className="private-project-modal-label">Private account project</span>
      <h3 id="gas-enquiry-title">Save {title.toLowerCase()} without sharing contact details</h3>
      <p>Create a free project with this upgrade preselected. Your comparison stays private, and installers can respond only to a later anonymised scope inside the platform.</p>
      <ul><li>No phone number or street address required</li><li>No customer details released to trades</li><li>Save the roadmap and return from any device</li><li>Structured quote options, not sales messages</li></ul>
      <div className="enqbtns"><a ref={actionRef} className="mclose" href={`/account/projects/new?${params.toString()}`}>Save as a free project</a><button className="mcancel" type="button" onClick={onClose}>Keep comparing</button></div>
      <p className="enqfine">Creating a project does not submit an enquiry. You review the installer view and choose when to request responses.</p>
    </div>
  </div>;
}
