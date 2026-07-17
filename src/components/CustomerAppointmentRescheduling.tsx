"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type Appointment = { id: string; title: string; appointmentType: string; startsAt: string; endsAt: string; revision: number; workNumber: string; siteLabel: string; siteSummary: string };
type WindowValue = { startDate: string; startTime: string; endDate: string; endTime: string };
type RequestRecord = { id: string; appointmentId: string; title: string; workNumber: string; status: string;
  preferredWindows: Array<{ startsAt: string; endsAt: string }>; reason: string; accessNotes: string;
  originalStartsAt: string; originalEndsAt: string; currentStartsAt: string; currentEndsAt: string;
  proposedStartsAt: string; proposedEndsAt: string; decisionNote: string; revision: number; requestedAt: string; decidedAt: string };
type Result = { ok?: boolean; error?: string; appointments?: Appointment[]; requests?: RequestRecord[] };

const emptyWindow = (): WindowValue => ({ startDate: "", startTime: "09:00", endDate: "", endTime: "10:00" });
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value: string) => value ? new Date(`${value.length === 16 ? value : value.slice(0, 16)}:00`).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";

export function CustomerAppointmentRescheduling({ user }: { user: User }) {
  const [data, setData] = useState<Result>({}); const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [appointmentId, setAppointmentId] = useState(""); const [reason, setReason] = useState("");
  const [accessNotes, setAccessNotes] = useState(""); const [windows, setWindows] = useState<WindowValue[]>([emptyWindow()]);

  const request = useCallback(async (init: RequestInit = {}) => {
    const token = await user.getIdToken(); const response = await fetch("/api/customer-appointment-rescheduling", {
      ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok || !result.ok) throw new Error(result.error || "Your appointment changes could not be loaded.");
    return result;
  }, [user]);

  const load = useCallback(async () => { setLoading(true); setMessage(""); try { const result = await request(); setData(result); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Your appointment changes could not be loaded."); }
    finally { setLoading(false); } }, [request]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => void load()); return () => window.cancelAnimationFrame(frame); }, [load]);

  const activeAppointmentIds = useMemo(() => new Set((data.requests || []).filter((item) => ["pending", "alternative_proposed"].includes(item.status)).map((item) => item.appointmentId)), [data.requests]);
  const eligible = (data.appointments || []).filter((item) => !activeAppointmentIds.has(item.id));
  const selected = (data.appointments || []).find((item) => item.id === appointmentId);

  function updateWindow(index: number, key: keyof WindowValue, value: string) {
    setWindows((current) => current.map((window, windowIndex) => windowIndex === index ? { ...window, [key]: value } : window));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setBusy(true); setMessage("");
    try {
      const preferredWindows = windows.map((window) => ({ startsAt: `${window.startDate}T${window.startTime}`, endsAt: `${window.endDate}T${window.endTime}` }));
      const result = await request({ method: "POST", body: JSON.stringify({ appointmentId: selected.id, expectedAppointmentRevision: selected.revision, preferredWindows, reason, accessNotes }) });
      setData(result); setAppointmentId(""); setReason(""); setAccessNotes(""); setWindows([emptyWindow()]);
      setMessage("Your request is recorded for installer review. The existing appointment has not changed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The appointment change request could not be submitted."); }
    finally { setBusy(false); }
  }

  if (loading) return <section className="customer-appointment-changes"><div className="customer-empty-state"><span>Appointments</span><h3>Loading your future visits</h3><p>Checking the appointments linked to your verified customer record.</p></div></section>;
  return <section className="customer-appointment-changes">
    <header><div><span>Appointment changes</span><h2>Request another suitable time</h2><p>Your request goes to the installer for review. Nothing moves on the schedule until authorised dispatch staff accept a time.</p></div><strong>{(data.requests || []).filter((item) => ["pending", "alternative_proposed"].includes(item.status)).length} open</strong></header>
    {eligible.length ? <form onSubmit={submit} className="customer-reschedule-form">
      <label className="wide"><span>Future appointment</span><select required value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)}><option value="">Choose an appointment</option>{eligible.map((item) => <option key={item.id} value={item.id}>{item.workNumber} | {item.title} | {dateTime(item.startsAt)}</option>)}</select></label>
      {selected && <div className="customer-current-appointment"><span>Current appointment</span><strong>{dateTime(selected.startsAt)} to {dateTime(selected.endsAt)}</strong><small>{selected.siteLabel}{selected.siteSummary ? ` | ${selected.siteSummary}` : ""}</small></div>}
      <div className="customer-preferred-windows wide"><header><div><strong>Preferred windows</strong><span>Add up to three options. Each option must start and finish on the same day.</span></div>{windows.length < 3 && <button type="button" onClick={() => setWindows((current) => [...current, emptyWindow()])}>Add another option</button>}</header>{windows.map((window, index) => <fieldset key={`preferred-window-${index}`}><legend>Option {index + 1}</legend><label><span>Start date</span><input type="date" required value={window.startDate} data-date-range-group={`appointment-window-${index}`} data-date-range-role="start" onChange={(event) => updateWindow(index, "startDate", event.target.value)} /></label><label><span>Start time</span><input type="time" required value={window.startTime} onChange={(event) => updateWindow(index, "startTime", event.target.value)} /></label><label><span>End date</span><input type="date" required value={window.endDate} data-date-range-group={`appointment-window-${index}`} data-date-range-role="end" onChange={(event) => updateWindow(index, "endDate", event.target.value)} /></label><label><span>End time</span><input type="time" required value={window.endTime} onChange={(event) => updateWindow(index, "endTime", event.target.value)} /></label>{windows.length > 1 && <button type="button" onClick={() => setWindows((current) => current.filter((_, windowIndex) => windowIndex !== index))}>Remove</button>}</fieldset>)}</div>
      <label className="wide"><span>Reason for changing</span><textarea required maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Briefly explain why the current time no longer works" /></label>
      <label className="wide"><span>Access notes for the visit</span><textarea maxLength={500} rows={3} value={accessNotes} onChange={(event) => setAccessNotes(event.target.value)} placeholder="Gate, parking or arrival instructions that the installer should review" /></label>
      <button className="primary" disabled={busy || !selected}>{busy ? "Submitting..." : "Send for installer review"}</button>
    </form> : <div className="customer-empty-state"><span>Future appointments</span><h3>No appointment is available for a new request</h3><p>Only future scheduled visits linked to your verified CRM customer email appear here. An appointment with an open request stays locked until the installer reviews it.</p></div>}
    {(data.requests || []).length > 0 && <section className="customer-reschedule-history"><header><span>Request history</span><h3>Recorded decisions and unchanged originals</h3></header>{(data.requests || []).map((item) => <article key={item.id} className={`status-${item.status}`}><header><div><span>{item.workNumber} | Requested {new Date(item.requestedAt).toLocaleString("en-AU")}</span><strong>{item.title}</strong></div><b>{readable(item.status)}</b></header><dl><div><dt>Original appointment</dt><dd>{dateTime(item.originalStartsAt)} to {dateTime(item.originalEndsAt)}</dd></div><div><dt>Current appointment</dt><dd>{dateTime(item.currentStartsAt)} to {dateTime(item.currentEndsAt)}</dd></div>{item.proposedStartsAt && <div><dt>{item.status === "accepted" ? "Accepted time" : "Installer alternative"}</dt><dd>{dateTime(item.proposedStartsAt)} to {dateTime(item.proposedEndsAt)}</dd></div>}</dl><details><summary>Preferred windows and notes</summary><ol>{item.preferredWindows.map((window, index) => <li key={`${item.id}:${index}`}>{dateTime(window.startsAt)} to {dateTime(window.endsAt)}</li>)}</ol><p><strong>Reason:</strong> {item.reason}</p>{item.accessNotes && <p><strong>Access notes:</strong> {item.accessNotes}</p>}{item.decisionNote && <p><strong>Installer response:</strong> {item.decisionNote}</p>}</details></article>)}</section>}
    {message && <p className="customer-dashboard-status" role="status">{message}</p>}
  </section>;
}
