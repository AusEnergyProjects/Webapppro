"use client";

import { useState } from "react";
import { firebaseAuth } from "@/lib/firebase-client";

type ArrivalWindow = { id?: string; startsAt: string; endsAt: string };
type ArrivalProposal = {
  id: string;
  status: "proposed" | "selected" | "direct_contact" | "withdrawn";
  windows: ArrivalWindow[];
  installerNote: string;
  selectedWindow: ArrivalWindow | null;
  revision: number;
  proposedAt: string;
  selectedAt: string;
  crmWorkOrderId?: string;
  crmAppointmentId?: string;
  preparationAcknowledgedAt?: string;
};

type WindowDraft = { startDate: string; startTime: string; endDate: string; endTime: string };
const emptyWindow = (): WindowDraft => ({ startDate: "", startTime: "09:00", endDate: "", endTime: "12:00" });
const draftFromWindow = (window: ArrivalWindow): WindowDraft => ({
  startDate: window.startsAt.slice(0, 10), startTime: window.startsAt.slice(11, 16),
  endDate: window.endsAt.slice(0, 10), endTime: window.endsAt.slice(11, 16),
});

export function InstallerArrivalWindows({ matchId, initialProposal, onStatus }: {
  matchId: string;
  initialProposal: ArrivalProposal | null;
  onStatus: (message: string) => void;
}) {
  const [proposal, setProposal] = useState(initialProposal);
  const [windows, setWindows] = useState<WindowDraft[]>(initialProposal?.windows.length
    ? initialProposal.windows.map(draftFromWindow) : [emptyWindow()]);
  const [installerNote, setInstallerNote] = useState(initialProposal?.installerNote || "");
  const [busy, setBusy] = useState(false);
  const update = (index: number, key: keyof WindowDraft, value: string) => setWindows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));

  async function submit() {
    const user = firebaseAuth.currentUser;
    if (!user) { onStatus("Sign in again before proposing arrival windows."); return; }
    setBusy(true); onStatus("Saving customer arrival window options...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-opportunities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          matchId,
          action: "propose_arrival_windows",
          expectedRevision: proposal?.revision || 0,
          windows: windows.map((window) => ({ startsAt: `${window.startDate}T${window.startTime}`, endsAt: `${window.endDate}T${window.endTime}` })),
          installerNote,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "The arrival windows could not be saved.");
      setProposal(result.proposal);
      setWindows(result.proposal.windows.map(draftFromWindow));
      onStatus("Arrival windows sent for customer review. No appointment has been created or changed.");
    } catch (error) { onStatus(error instanceof Error ? error.message : "The arrival windows could not be saved."); }
    finally { setBusy(false); }
  }

  if (proposal?.status === "selected" && proposal.selectedWindow) return <section className="installer-arrival-windows selected">
    <header><div><span>Customer reviewed</span><h4>Arrival window selected</h4></div><strong>{proposal.selectedWindow.startsAt.slice(0, 10)}</strong></header>
    <p>{proposal.selectedWindow.startsAt.slice(11, 16)} to {proposal.selectedWindow.endsAt.slice(11, 16)}. {proposal.crmAppointmentId ? "The CRM appointment is ready for staff assignment and conflict review." : "Create the CRM job to materialise this reviewed window as an unassigned appointment."}</p>
    {proposal.preparationAcknowledgedAt && <small>Customer site-preparation checklist acknowledged.</small>}
  </section>;

  if (proposal?.status === "direct_contact") return <section className="installer-arrival-windows selected"><header><div><span>Customer reviewed</span><h4>Direct contact selected</h4></div></header><p>The customer chose to contact the business directly instead of selecting an arrival window. AEA administrators received an audit notification.</p></section>;

  return <section className="installer-arrival-windows" aria-label="Customer arrival window proposal">
    <header><div><span>Accepted installer action</span><h4>Provide arrival windows for the customer</h4><p>Offer one to three windows. The customer reviews and selects an option before scheduling progresses.</p></div>{proposal && <strong>Revision {proposal.revision}</strong>}</header>
    <div className="installer-arrival-window-list">{windows.map((window, index) => <fieldset key={`arrival-window-${index}`}><legend>Option {index + 1}</legend><label><span>Start date</span><input type="date" required value={window.startDate} data-date-range-group={`installer-arrival-${matchId}-${index}`} data-date-range-role="start" onChange={(event) => update(index, "startDate", event.target.value)} /></label><label><span>From</span><input type="time" required value={window.startTime} onChange={(event) => update(index, "startTime", event.target.value)} /></label><label><span>End date</span><input type="date" required value={window.endDate} data-date-range-group={`installer-arrival-${matchId}-${index}`} data-date-range-role="end" onChange={(event) => update(index, "endDate", event.target.value)} /></label><label><span>Until</span><input type="time" required value={window.endTime} onChange={(event) => update(index, "endTime", event.target.value)} /></label>{windows.length > 1 && <button type="button" onClick={() => setWindows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>}</fieldset>)}</div>
    {windows.length < 3 && <button type="button" onClick={() => setWindows((current) => [...current, emptyWindow()])}>Add another option</button>}
    <label><span>Customer-facing note, optional</span><textarea rows={3} maxLength={300} value={installerNote} onChange={(event) => setInstallerNote(event.target.value)} placeholder="Example: Allow two hours for an assessment and switchboard review" /></label>
    <button type="button" className="primary" disabled={busy || windows.some((window) => !window.startDate || !window.endDate || !window.startTime || !window.endTime)} onClick={() => void submit()}>{busy ? "Saving..." : proposal ? "Update proposed windows" : "Send windows for customer review"}</button>
    <small>Each window must be on one day, between 30 minutes and four hours, and within the next 180 days.</small>
  </section>;
}
