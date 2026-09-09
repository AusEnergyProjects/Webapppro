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
      <span className="private-project-modal-label">Plan your upgrade</span>
      <h3 id="gas-enquiry-title">Save {title.toLowerCase()} in your home energy plan</h3>
      <p>Open the planner with this upgrade preselected. You can download your plan or choose to send an enquiry without creating an account.</p>
      <ul><li>No account needed to make a plan</li><li>Your upgrade and postcode carry across</li><li>Review your choices before sending an enquiry</li><li>Choose whether to share your details with suitable trades</li></ul>
      <div className="enqbtns"><a ref={actionRef} className="mclose" href={`/plan?${params.toString()}`}>Open my plan</a><button className="mcancel" type="button" onClick={onClose}>Keep comparing</button></div>
      <p className="enqfine">Opening the planner does not send an enquiry or share your contact details.</p>
    </div>
  </div>;
}
