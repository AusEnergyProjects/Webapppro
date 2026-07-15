"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AdminRole } from "@/lib/admin-server";

type Pilot = { id: string; name: string; goal: string; targetParticipants: number; status: string; startsAt: string; endsAt: string; successCriteria: string[]; createdAt: string; updatedAt: string };
type Session = { id: string; sessionType: string; status: string; scheduledAt: string; completedAt: string; durationMinutes: number; tasksAttempted: number; tasksCompleted: number; easeScore: number; confidenceScore: number; feedback: string; observedFrictions: string[]; nextAction: string; facilitatorName: string; createdAt: string };
type Participant = { id: string; pilotId: string; firebaseUid: string; slotNumber: number; businessName: string; baselineSystem: string; teamSize: number; primaryTrade: string; status: string; ownerUid: string; ownerName: string; nextAction: string; invitedAt: string; completedAt: string; sessions: Session[] };
type Candidate = { firebaseUid: string; businessName: string; addressState: string; postcode: string; capabilities: string[] };
type Admin = { firebaseUid: string; name: string; role: string };
type Metrics = { participantCount: number; completedParticipants: number; completedSessions: number; taskCompletionRate: number; averageEase: number; averageConfidence: number; openFrictions: number };
type Result = { pilots?: Pilot[]; participants?: Participant[]; candidates?: Candidate[]; admins?: Admin[]; metrics?: Metrics };

const sessionLabels: Record<string, string> = {
  onboarding: "Guided onboarding", first_customer: "Create first customer", first_job: "Create first job",
  field_work: "Complete field workflow", office_workflow: "Office workflow", weekly_review: "Weekly review", final_review: "Final review",
};

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export function AdminUsabilityPilot({ api, role }: { api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>; role: AdminRole }) {
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({ participantCount: 0, completedParticipants: 0, completedSessions: 0, taskCompletionRate: 0, averageEase: 0, averageConfidence: 0, openFrictions: 0 });
  const [selectedParticipantId, setSelectedParticipantId] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");

  const apply = useCallback((result: Result) => {
    setPilots(result.pilots || []); setParticipants(result.participants || []); setCandidates(result.candidates || []); setAdmins(result.admins || []);
    if (result.metrics) setMetrics(result.metrics);
    setSelectedParticipantId((current) => current && (result.participants || []).some((item) => item.id === current) ? current : result.participants?.[0]?.id || "");
  }, []);

  const load = useCallback(async () => {
    const result = await api("/api/admin/usability-pilot") as Result;
    apply(result);
  }, [api, apply]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => setStatus(error instanceof Error ? error.message : "The field pilot could not be loaded."));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const activePilot = pilots[0] || null;
  const pilotParticipants = participants.filter((item) => item.pilotId === activePilot?.id);
  const selected = pilotParticipants.find((item) => item.id === selectedParticipantId) || null;
  const usedAccounts = new Set(pilotParticipants.map((item) => item.firebaseUid));
  const availableCandidates = candidates.filter((item) => !usedAccounts.has(item.firebaseUid));
  const openSlots = useMemo(() => activePilot ? Array.from({ length: activePilot.targetParticipants }, (_, index) => index + 1).filter((slot) => !pilotParticipants.some((item) => item.slotNumber === slot)) : [], [activePilot, pilotParticipants]);
  const canManageCohort = ["owner", "admin"].includes(role);

  async function submit(path: string, init: RequestInit, busyKey: string, success: string) {
    setBusy(busyKey); setStatus("Saving the field pilot update...");
    try { const result = await api(path, init) as Result; apply(result); setStatus(success); return true; }
    catch (error) { setStatus(error instanceof Error ? error.message : "The field pilot update could not be saved."); return false; }
    finally { setBusy(""); }
  }

  async function addParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activePilot) return;
    const form = event.currentTarget; const data = new FormData(form);
    const saved = await submit("/api/admin/usability-pilot", { method: "POST", body: JSON.stringify({ action: "add_participant", pilotId: activePilot.id, slotNumber: data.get("slotNumber"), firebaseUid: data.get("firebaseUid"), baselineSystem: data.get("baselineSystem"), teamSize: data.get("teamSize"), primaryTrade: data.get("primaryTrade"), ownerUid: data.get("ownerUid"), nextAction: data.get("nextAction") }) }, "add", "Business added to the pilot. Arrange the onboarding session next.");
    if (saved) form.reset();
  }

  async function updatePilot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activePilot) return; const data = new FormData(event.currentTarget);
    await submit("/api/admin/usability-pilot", { method: "PATCH", body: JSON.stringify({ action: "update_pilot", pilotId: activePilot.id, status: data.get("status"), startsAt: data.get("startsAt"), endsAt: data.get("endsAt") }) }, "pilot", "Pilot schedule updated.");
  }

  async function updateParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const data = new FormData(event.currentTarget);
    await submit("/api/admin/usability-pilot", { method: "PATCH", body: JSON.stringify({ action: "update_participant", participantId: selected.id, status: data.get("status"), baselineSystem: data.get("baselineSystem"), teamSize: data.get("teamSize"), primaryTrade: data.get("primaryTrade"), ownerUid: data.get("ownerUid"), nextAction: data.get("nextAction") }) }, "participant", "Participant plan updated.");
  }

  async function logSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = event.currentTarget; const data = new FormData(form);
    const saved = await submit("/api/admin/usability-pilot", { method: "POST", body: JSON.stringify({ action: "log_session", participantId: selected.id, sessionType: data.get("sessionType"), status: data.get("status"), scheduledAt: data.get("scheduledAt"), durationMinutes: data.get("durationMinutes"), tasksAttempted: data.get("tasksAttempted"), tasksCompleted: data.get("tasksCompleted"), easeScore: data.get("easeScore"), confidenceScore: data.get("confidenceScore"), feedback: data.get("feedback"), observedFrictions: data.get("observedFrictions"), nextAction: data.get("nextAction") }) }, "session", "Pilot session recorded and included in the cohort measures.");
    if (saved) form.reset();
  }

  if (!activePilot) return <section className="admin-panel"><div className="admin-panel-heading"><span>Field pilot</span><h1>No pilot configured</h1><p>Add the pilot schema seed before recruiting businesses.</p></div></section>;

  return <section className="admin-pilot-workspace">
    <header className="admin-page-heading"><span>Five-business usability pilot</span><h1>{activePilot.name}</h1><p>{activePilot.goal}</p></header>
    <section className="admin-pilot-scoreboard" aria-label="Pilot measures">
      <article><span>Businesses</span><strong>{pilotParticipants.length}/{activePilot.targetParticipants}</strong><small>{openSlots.length} open slots</small></article>
      <article><span>Sessions</span><strong>{metrics.completedSessions}</strong><small>Completed observations</small></article>
      <article><span>Task success</span><strong>{metrics.taskCompletionRate}%</strong><small>Observed tasks completed</small></article>
      <article><span>Ease</span><strong>{metrics.averageEase || "-"}/5</strong><small>Average participant score</small></article>
      <article><span>Confidence</span><strong>{metrics.averageConfidence || "-"}/5</strong><small>Can use without help</small></article>
      <article className={metrics.openFrictions ? "attention" : ""}><span>Frictions</span><strong>{metrics.openFrictions}</strong><small>Recorded product issues</small></article>
    </section>

    <section className="admin-pilot-plan">
      <div><span>Success means</span><ul>{activePilot.successCriteria.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <form onSubmit={updatePilot}><label><span>Status</span><select name="status" defaultValue={activePilot.status} disabled={!canManageCohort}>{["recruiting", "active", "reviewing", "completed", "paused"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label><label><span>Starts</span><input type="date" name="startsAt" defaultValue={activePilot.startsAt} disabled={!canManageCohort} /></label><label><span>Ends</span><input type="date" name="endsAt" defaultValue={activePilot.endsAt} disabled={!canManageCohort} /></label>{canManageCohort && <button disabled={busy === "pilot"}>Save pilot</button>}</form>
    </section>

    <div className="admin-pilot-layout">
      <section className="admin-pilot-cohort"><header><div><span>Cohort</span><h2>Five business slots</h2></div></header><div className="admin-pilot-slots">{Array.from({ length: activePilot.targetParticipants }, (_, index) => index + 1).map((slot) => { const item = pilotParticipants.find((entry) => entry.slotNumber === slot); return item ? <button type="button" key={slot} className={selected?.id === item.id ? "active" : ""} onClick={() => setSelectedParticipantId(item.id)}><span>Slot {slot} | {readable(item.status)}</span><strong>{item.businessName}</strong><small>{item.teamSize} staff | {readable(item.primaryTrade || "trade not set")}</small><em>{item.sessions.length} session{item.sessions.length === 1 ? "" : "s"}</em></button> : <article key={slot}><span>Slot {slot}</span><strong>Open business place</strong><small>Select an active live installer below.</small></article>; })}</div>
      {canManageCohort && openSlots.length > 0 && <form className="admin-pilot-recruit" onSubmit={addParticipant}><div><span>Add a live installer</span><h3>Fill the next pilot slot</h3><p>Synthetic demo accounts are excluded. Contact and consent still need to be arranged with the business.</p></div><label><span>Slot</span><select name="slotNumber">{openSlots.map((slot) => <option key={slot} value={slot}>Slot {slot}</option>)}</select></label><label className="wide"><span>Business</span><select name="firebaseUid" required defaultValue=""><option value="" disabled>Choose an installer</option>{availableCandidates.map((item) => <option key={item.firebaseUid} value={item.firebaseUid}>{item.businessName} | {item.addressState} {item.postcode}</option>)}</select></label><label><span>Current system</span><input name="baselineSystem" placeholder="ServiceM8, Tradify, paper" /></label><label><span>Team size</span><input type="number" min="1" max="10000" name="teamSize" defaultValue="1" /></label><label><span>Primary trade</span><input name="primaryTrade" placeholder="Electrical" /></label><label><span>AEA owner</span><select name="ownerUid" defaultValue=""><option value="">Current administrator</option>{admins.map((admin) => <option key={admin.firebaseUid} value={admin.firebaseUid}>{admin.name}</option>)}</select></label><label className="wide"><span>Next action</span><input name="nextAction" defaultValue="Arrange a 30-minute guided onboarding session." /></label><button disabled={busy === "add" || availableCandidates.length === 0}>{busy === "add" ? "Adding..." : "Add to pilot"}</button></form>}
      </section>

      <aside className="admin-pilot-detail">{selected ? <><header><span>Slot {selected.slotNumber}</span><h2>{selected.businessName}</h2><p>{selected.ownerName ? `Owned by ${selected.ownerName}` : "No AEA owner assigned"}</p></header><form onSubmit={updateParticipant}><label><span>Status</span><select name="status" defaultValue={selected.status}>{["invited", "onboarding", "active", "feedback_due", "completed", "paused", "withdrawn"].map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label><label><span>Current system</span><input name="baselineSystem" defaultValue={selected.baselineSystem} /></label><label><span>Team size</span><input type="number" min="1" max="10000" name="teamSize" defaultValue={selected.teamSize} /></label><label><span>Primary trade</span><input name="primaryTrade" defaultValue={selected.primaryTrade} /></label><label><span>AEA owner</span><select name="ownerUid" defaultValue={selected.ownerUid}><option value="">Unassigned</option>{admins.map((admin) => <option key={admin.firebaseUid} value={admin.firebaseUid}>{admin.name}</option>)}</select></label><label><span>Next action</span><textarea name="nextAction" rows={3} defaultValue={selected.nextAction} /></label><button disabled={busy === "participant"}>Save participant</button></form>
      <details className="admin-pilot-session-form"><summary>Record a pilot session</summary><form onSubmit={logSession}><label><span>Session</span><select name="sessionType">{Object.entries(sessionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Result</span><select name="status"><option value="completed">Completed</option><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option></select></label><label><span>Scheduled time</span><input type="datetime-local" name="scheduledAt" /></label><label><span>Minutes</span><input type="number" min="0" max="480" name="durationMinutes" defaultValue="30" /></label><label><span>Tasks attempted</span><input type="number" min="0" max="50" name="tasksAttempted" defaultValue="3" /></label><label><span>Tasks completed</span><input type="number" min="0" max="50" name="tasksCompleted" defaultValue="3" /></label><label><span>Ease score</span><select name="easeScore" defaultValue="4">{[1,2,3,4,5].map((score) => <option key={score}>{score}</option>)}</select></label><label><span>Confidence score</span><select name="confidenceScore" defaultValue="4">{[1,2,3,4,5].map((score) => <option key={score}>{score}</option>)}</select></label><label className="wide"><span>Participant feedback</span><textarea name="feedback" rows={3} placeholder="Use their own words where useful" /></label><label className="wide"><span>Observed frictions, one per line</span><textarea name="observedFrictions" rows={4} placeholder={"Could not find customer import\nNeeded help changing job stage"} /></label><label className="wide"><span>Next action</span><input name="nextAction" placeholder="Product or follow-up action" /></label><button disabled={busy === "session"}>Save session</button></form></details>
      <section className="admin-pilot-sessions"><h3>Session history</h3>{selected.sessions.length ? selected.sessions.map((item) => <article key={item.id}><span>{sessionLabels[item.sessionType] || readable(item.sessionType)} | {readable(item.status)}</span><strong>{dateLabel(item.completedAt || item.scheduledAt || item.createdAt)}</strong><small>{item.tasksCompleted}/{item.tasksAttempted} tasks | Ease {item.easeScore || "-"}/5 | Confidence {item.confidenceScore || "-"}/5</small>{item.feedback && <p>{item.feedback}</p>}{item.observedFrictions.length > 0 && <ul>{item.observedFrictions.map((friction) => <li key={friction}>{friction}</li>)}</ul>}</article>) : <p>No sessions recorded yet.</p>}</section></> : <div className="admin-pilot-empty"><strong>Select a business slot</strong><span>The participant plan and session history will open here.</span></div>}</aside>
    </div>
    {status && <p className="admin-pilot-status" role="status">{status}</p>}
  </section>;
}
