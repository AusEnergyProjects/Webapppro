"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { browserLocalDateTime, moveAppointmentToDate } from "@/lib/trade-schedule";

type Member = { id: string; displayName: string; role: string; status: string; isOwner: boolean };
type WorkingHours = { id?: string; teamMemberId: string; weekday: number; startMinute: number; endMinute: number; isAvailable: boolean };
type Unavailability = { id: string; teamMemberId: string; startsAt: string; endsAt: string; reason: string };
type Appointment = { id: string; workOrderId: string; workNumber: string; title: string; appointmentType: string; startsAt: string; endsAt: string; assigneeMemberId: string; assigneeLabel: string; status: string; revision: number; serviceCategory: string; siteLabel: string; siteSummary: string; protectedJob: boolean; conflicts: boolean; outsideWorkingHours: boolean };
type RescheduleRequest = { id: string; appointmentId: string; workOrderId: string; workNumber: string; title: string; status: string;
  preferredWindows: Array<{ startsAt: string; endsAt: string }>; reason: string; accessNotes: string;
  originalStartsAt: string; originalEndsAt: string; proposedStartsAt: string; proposedEndsAt: string;
  proposedAssigneeMemberId: string; proposedAssigneeLabel: string; decisionNote: string; revision: number;
  requestedAt: string; decidedAt: string; currentStartsAt: string; currentEndsAt: string;
  currentAssigneeMemberId: string; currentAssigneeLabel: string; appointmentRevision: number };
type Job = { id: string; workNumber: string; title: string; serviceCategory: string; siteLabel: string; siteSummary: string; priority: string; stage: string; revision: number; assigneeMemberId: string; assigneeLabel: string };
type ScheduleResult = { ok?: boolean; error?: string; weekStart?: string; weekEnd?: string; members?: Member[]; workingHours?: WorkingHours[]; unavailability?: Unavailability[]; appointments?: Appointment[]; rescheduleRequests?: RescheduleRequest[]; unassignedJobs?: Job[] };
type Edit = { memberId: string; startsAt: string; endsAt: string };

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monday(value = new Date()) {
  const date = new Date(value); const day = date.getDay(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - ((day + 6) % 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(date: string, amount: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + amount); return value.toISOString().slice(0, 10); }
function minuteLabel(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function minuteValue(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function defaultHours(weekday: number): WorkingHours { return { teamMemberId: "", weekday, startMinute: 540, endMinute: 1020, isAvailable: weekday >= 1 && weekday <= 5 }; }
function durationMinutes(start: string, end: string) { return Math.max(0, (Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 60000); }
function readable(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function memberLabel(member: Member) { return member.isOwner ? "Me" : member.displayName; }
function initialAppointmentRange(weekStart: string, localNow: string) {
  let targetDate = weekStart < localNow.slice(0, 10) ? localNow.slice(0, 10) : weekStart;
  try { return moveAppointmentToDate(`${targetDate}T09:00`, `${targetDate}T10:00`, targetDate, localNow); }
  catch { targetDate = addDays(targetDate, 1); return { startsAt: `${targetDate}T09:00`, endsAt: `${targetDate}T10:00` }; }
}

export function TradeScheduleWorkspace({ user }: { user: User }) {
  const [weekStart, setWeekStart] = useState(() => monday()); const [data, setData] = useState<ScheduleResult>({});
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [status, setStatus] = useState("");
  const [memberFilter, setMemberFilter] = useState(""); const [jobFilter, setJobFilter] = useState(""); const [serviceFilter, setServiceFilter] = useState(""); const [siteFilter, setSiteFilter] = useState(""); const [statusFilter, setStatusFilter] = useState(""); const [conflictOnly, setConflictOnly] = useState(false);
  const [hoursMember, setHoursMember] = useState(""); const [hourEdits, setHourEdits] = useState<Record<number, WorkingHours>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [draggingId, setDraggingId] = useState(""); const [dropTarget, setDropTarget] = useState("");
  const minimumStart = useMemo(() => browserLocalDateTime(), []);

  const load = useCallback(async () => {
    setLoading(true); setStatus("");
    try { const token = await user.getIdToken(); const response = await fetch(`/api/trade-schedule?weekStart=${weekStart}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json().catch(() => ({})) as ScheduleResult; if (!response.ok || !result.ok) throw new Error(result.error || "The schedule could not be loaded.");
      setData(result); setHoursMember((current) => current || result.members?.[0]?.id || ""); setEdits({}); setDecisionNotes({});
    } catch (error) { setStatus(error instanceof Error ? error.message : "The schedule could not be loaded."); } finally { setLoading(false); }
  }, [user, weekStart]);
  useEffect(() => { const frame = window.requestAnimationFrame(() => void load()); return () => window.cancelAnimationFrame(frame); }, [load]);
  useEffect(() => {
    if (!hoursMember) return; const next: Record<number, WorkingHours> = {};
    for (let weekday = 0; weekday < 7; weekday += 1) next[weekday] = data.workingHours?.find((row) => row.teamMemberId === hoursMember && row.weekday === weekday) || { ...defaultHours(weekday), teamMemberId: hoursMember };
    const frame = window.requestAnimationFrame(() => setHourEdits(next)); return () => window.cancelAnimationFrame(frame);
  }, [hoursMember, data.workingHours]);

  async function update(body: Record<string, unknown>, key: string, success: string) {
    setBusy(key); setStatus("");
    try { const token = await user.getIdToken(); const response = await fetch("/api/trade-schedule", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...body, weekStart }) });
      const result = await response.json().catch(() => ({})) as ScheduleResult; if (!response.ok || !result.ok) throw new Error(result.error || "The schedule change could not be saved.");
      setData(result); setEdits({}); setDecisionNotes({}); setStatus(success);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The schedule change could not be saved."); } finally { setBusy(""); }
  }

  async function moveAppointment(appointment: Appointment, targetDate: string) {
    if (targetDate < minimumStart.slice(0, 10)) { setStatus("Appointments cannot be moved into the past."); return; }
    const edit = edits[appointment.id] || { memberId: appointment.assigneeMemberId, startsAt: appointment.startsAt, endsAt: appointment.endsAt };
    try {
      const moved = moveAppointmentToDate(edit.startsAt, edit.endsAt, targetDate);
      await update({ action: "schedule_appointment", appointmentId: appointment.id, expectedRevision: appointment.revision,
        memberId: edit.memberId, ...moved }, `appointment:${appointment.id}`, `${appointment.workNumber} moved to ${targetDate}. Working hours remain a visible guide.`);
    } catch (error) { setStatus(error instanceof Error && error.message === "PAST_APPOINTMENT" ? "There is no future time left in that day. Choose another day." : "That appointment could not be moved."); }
    finally { setDraggingId(""); setDropTarget(""); }
  }

  const members = useMemo(() => data.members || [], [data.members]); const appointments = useMemo(() => data.appointments || [], [data.appointments]);
  const services = useMemo(() => [...new Set([...appointments.map((item) => item.serviceCategory), ...(data.unassignedJobs || []).map((item) => item.serviceCategory)])].filter(Boolean).sort(), [appointments, data.unassignedJobs]);
  const sites = useMemo(() => [...new Set([...appointments.map((item) => item.siteLabel), ...(data.unassignedJobs || []).map((item) => item.siteLabel)])].filter(Boolean).sort(), [appointments, data.unassignedJobs]);
  const jobQuery = jobFilter.trim().toLowerCase();
  const visibleAppointments = appointments.filter((item) => (!memberFilter || item.assigneeMemberId === memberFilter) && (!jobQuery || `${item.workNumber} ${item.title}`.toLowerCase().includes(jobQuery)) && (!serviceFilter || item.serviceCategory === serviceFilter) && (!siteFilter || item.siteLabel === siteFilter) && (!conflictOnly || item.conflicts) && !["awaiting", "unassigned"].includes(statusFilter) && (statusFilter !== "conflict" || item.conflicts));
  const visibleJobs = (data.unassignedJobs || []).filter((item) => (!memberFilter || item.assigneeMemberId === memberFilter) && (!jobQuery || `${item.workNumber} ${item.title}`.toLowerCase().includes(jobQuery)) && (!serviceFilter || item.serviceCategory === serviceFilter) && (!siteFilter || item.siteLabel === siteFilter) && !["scheduled", "conflict"].includes(statusFilter) && (statusFilter !== "unassigned" || !item.assigneeMemberId));
  const unassignedCount = visibleJobs.filter((item) => !item.assigneeMemberId).length;
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const ownerMemberId = members.find((member) => member.isOwner)?.id || members[0]?.id || "";

  function hoursFor(memberId: string, weekday: number) { return data.workingHours?.find((row) => row.teamMemberId === memberId && row.weekday === weekday) || { ...defaultHours(weekday), teamMemberId: memberId }; }
  const capacity = members.map((member) => {
    const available = days.reduce((total, date) => { const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); const row = hoursFor(member.id, weekday); return total + (row.isAvailable ? row.endMinute - row.startMinute : 0); }, 0);
    const booked = appointments.filter((item) => item.assigneeMemberId === member.id).reduce((total, item) => total + durationMinutes(item.startsAt, item.endsAt), 0);
    return { member, available, booked, percent: available ? Math.min(100, Math.round(booked / available * 100)) : booked ? 100 : 0 };
  });

  if (loading) return <section className="dashboard-panel schedule-workspace"><div className="crm-empty"><strong>Building the team week</strong><span>Loading appointments, availability and capacity.</span></div></section>;
  return <section className="dashboard-panel schedule-workspace">
    <header className="schedule-heading"><div><span>Schedule</span><h2>Plan the week</h2><p>Assign a job in one row. Sole traders are ready as Me, and added people can be scheduled before they have a login.</p></div><div className="schedule-week-nav"><button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous</button><button type="button" onClick={() => setWeekStart(monday())}>This week</button><strong>{weekStart} to {addDays(weekStart, 6)}</strong><button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next</button></div></header>
    <div className="schedule-filters"><label><span>Person</span><select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}><option value="">Everyone</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label><span>Job</span><input value={jobFilter} placeholder="Number or title" onChange={(event) => setJobFilter(event.target.value)} /></label><label><span>Service</span><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="">All services</option>{services.map((service) => <option key={service}>{readable(service)}</option>)}</select></label><label><span>Site</span><select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="">All sites</option>{sites.map((site) => <option key={site}>{site}</option>)}</select></label><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All schedule states</option><option value="scheduled">Scheduled</option><option value="conflict">Conflicts</option><option value="awaiting">Awaiting appointment</option><option value="unassigned">Unassigned</option></select></label><label className="schedule-check"><input type="checkbox" checked={conflictOnly} onChange={(event) => setConflictOnly(event.target.checked)} /><span>Conflicts only</span></label></div>
    <section className="schedule-capacity"><header><strong>This week</strong><span>{unassignedCount} jobs waiting | {appointments.filter((item) => item.conflicts).length} conflicts</span></header><div>{capacity.map(({ member, available, booked, percent }) => <article key={member.id}><span>{memberLabel(member)}<small>{member.isOwner ? "Owner" : readable(member.role)}</small></span><strong>{Math.round(booked / 60)}h booked of {Math.round(available / 60)}h</strong><div><i style={{ width: `${percent}%` }} /></div></article>)}</div></section>
    {(data.rescheduleRequests || []).length > 0 && <section className="schedule-reschedule-queue"><header><div><span>Customer requests</span><h3>Review before changing the schedule</h3><p>Overlaps, recorded time off and past times are blocked. Working hours stay visible as a guide.</p></div><strong>{data.rescheduleRequests?.length}</strong></header>{data.rescheduleRequests?.map((request) => { const preferred = request.preferredWindows[0]; const edit = edits[request.id] || { memberId: request.proposedAssigneeMemberId || request.currentAssigneeMemberId, startsAt: request.proposedStartsAt || preferred?.startsAt || request.currentStartsAt, endsAt: request.proposedEndsAt || preferred?.endsAt || request.currentEndsAt }; const invalidTime = edit.startsAt <= minimumStart || edit.endsAt <= edit.startsAt; return <article key={request.id}><header><div><span>{request.workNumber} | {readable(request.status)}</span><strong>{request.title}</strong><small>Current: {request.currentStartsAt} to {request.currentEndsAt} | {request.currentAssigneeLabel || "Unassigned"}</small></div><time>{new Date(request.requestedAt).toLocaleString("en-AU")}</time></header><div className="schedule-request-notes"><p><strong>Reason</strong>{request.reason}</p>{request.accessNotes && <p><strong>Access notes</strong>{request.accessNotes}</p>}</div><ol>{request.preferredWindows.map((window, index) => <li key={`${request.id}:${index}`}><span>Option {index + 1}</span><strong>{window.startsAt} to {window.endsAt}</strong><button type="button" onClick={() => setEdits((current) => ({ ...current, [request.id]: { ...edit, startsAt: window.startsAt, endsAt: window.endsAt } }))}>Use option</button></li>)}</ol><div className="schedule-request-decision"><select aria-label={`Assigned staff for request ${request.workNumber}`} value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [request.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose staff</option>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select><input type="datetime-local" min={minimumStart} aria-label={`Reviewed start for ${request.workNumber}`} value={edit.startsAt} onChange={(event) => setEdits((current) => ({ ...current, [request.id]: { ...edit, startsAt: event.target.value } }))} /><input type="datetime-local" min={edit.startsAt > minimumStart ? edit.startsAt : minimumStart} aria-label={`Reviewed finish for ${request.workNumber}`} value={edit.endsAt} onChange={(event) => setEdits((current) => ({ ...current, [request.id]: { ...edit, endsAt: event.target.value } }))} /><input maxLength={500} value={decisionNotes[request.id] || ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Optional customer-facing response" /></div><div className="schedule-request-actions"><button type="button" disabled={busy === `reject:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "rejected", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "" }, `reject:${request.id}`, `${request.workNumber} request rejected without changing the schedule.`)}>Reject</button><button type="button" disabled={!edit.memberId || invalidTime || busy === `alternative:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "alternative_proposed", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "", ...edit }, `alternative:${request.id}`, `${request.workNumber} alternative proposed without changing the schedule.`)}>Propose alternative</button><button className="primary" type="button" disabled={!edit.memberId || invalidTime || busy === `accept:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "accepted", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "", ...edit }, `accept:${request.id}`, `${request.workNumber} appointment change accepted.`)}>Accept and reschedule</button></div></article>; })}</section>}
    <p className="schedule-drag-note">Drag an appointment to another day. Its time and duration stay the same, and you can still edit exact times below.</p>
    <div className={`schedule-board${visibleAppointments.length ? "" : " empty"}`}>{days.map((date) => {
      const dayIsPast = date < minimumStart.slice(0, 10);
      return <section key={date} className={`${dropTarget === date ? "drop-target " : ""}${dayIsPast ? "past" : ""}`.trim()}
        onDragOver={(event) => { if (!dayIsPast && draggingId) { event.preventDefault(); setDropTarget(date); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(""); }}
        onDrop={(event) => { event.preventDefault(); const appointment = appointments.find((item) => item.id === (draggingId || event.dataTransfer.getData("text/plain"))); if (appointment) void moveAppointment(appointment, date); }}>
        <header><strong>{shortDays[new Date(`${date}T00:00:00Z`).getUTCDay()]}</strong><span>{date.slice(5)}</span></header>
        {visibleAppointments.filter((item) => item.startsAt.slice(0, 10) === date).map((item) => {
          const edit = edits[item.id] || { memberId: item.assigneeMemberId, startsAt: item.startsAt, endsAt: item.endsAt };
          const invalidTime = edit.startsAt <= minimumStart || edit.endsAt <= edit.startsAt;
          return <article key={item.id} draggable={!busy} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); setDraggingId(item.id); }} onDragEnd={() => { setDraggingId(""); setDropTarget(""); }} className={`${item.conflicts ? "conflict " : ""}${draggingId === item.id ? "dragging" : ""}`.trim()}>
            <span>{item.workNumber}<i>Drag</i>{item.conflicts && <b>Conflict</b>}{item.outsideWorkingHours && <b className="hours-warning">Outside hours</b>}</span><strong>{item.title}</strong><small>{item.siteLabel} | {readable(item.serviceCategory)}</small>
            <select aria-label={`Assigned person for ${item.workNumber}`} value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [item.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select>
            <input type="datetime-local" min={minimumStart} aria-label={`Start for ${item.workNumber}`} value={edit.startsAt} onChange={(event) => setEdits((current) => ({ ...current, [item.id]: { ...edit, startsAt: event.target.value } }))} />
            <input type="datetime-local" min={edit.startsAt > minimumStart ? edit.startsAt : minimumStart} aria-label={`Finish for ${item.workNumber}`} value={edit.endsAt} onChange={(event) => setEdits((current) => ({ ...current, [item.id]: { ...edit, endsAt: event.target.value } }))} />
            <button type="button" disabled={!edit.memberId || invalidTime || busy === `appointment:${item.id}`} onClick={() => void update({ action: "schedule_appointment", appointmentId: item.id, expectedRevision: item.revision, ...edit }, `appointment:${item.id}`, `${item.workNumber} schedule updated and moved to its saved day.`)}>Save</button>
          </article>;
        })}
        {visibleAppointments.length > 0 && <div className="schedule-day-empty">{visibleAppointments.some((item) => item.startsAt.slice(0, 10) === date) ? "" : dayIsPast ? "Past" : "Drop here"}</div>}
      </section>;
    })}</div>
    <div className="schedule-lower-grid"><section className="schedule-unassigned"><header><div><span>Ready to schedule</span><h3>Choose a time and add the job</h3></div><strong>{visibleJobs.length}</strong></header>{visibleJobs.map((job) => { const initial = initialAppointmentRange(weekStart, minimumStart); const edit = edits[job.id] || { memberId: job.assigneeMemberId || ownerMemberId, ...initial }; const invalidTime = edit.startsAt <= minimumStart || edit.endsAt <= edit.startsAt; return <article key={job.id}><div><span>{job.workNumber} | {readable(job.priority)}</span><strong>{job.title}</strong><small>{job.siteLabel} | {readable(job.serviceCategory)}</small></div><label><span>Who</span><select aria-label={`Person for ${job.workNumber}`} value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label><span>Starts</span><input aria-label={`Start for ${job.workNumber}`} type="datetime-local" min={minimumStart} value={edit.startsAt} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, startsAt: event.target.value } }))} /></label><label><span>Finishes</span><input aria-label={`Finish for ${job.workNumber}`} type="datetime-local" min={edit.startsAt > minimumStart ? edit.startsAt : minimumStart} value={edit.endsAt} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, endsAt: event.target.value } }))} /></label><button type="button" disabled={!edit.memberId || invalidTime || busy === `job:${job.id}`} onClick={() => void update({ action: "schedule_job", workOrderId: job.id, expectedRevision: job.revision, ...edit }, `job:${job.id}`, `${job.workNumber} added to the schedule.`)}>Add to schedule</button></article>; })}{!visibleJobs.length && <div className="crm-empty"><strong>No work waiting</strong><span>Every visible active job already has a scheduled appointment.</span></div>}</section>
      <details className="schedule-availability"><summary><span>Availability</span><strong>Set working hours and time off</strong></summary><div className="schedule-availability-content"><label><span>Person</span><select value={hoursMember} onChange={(event) => setHoursMember(event.target.value)}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>{hoursMember && <div className="schedule-hours-grid">{dayNames.map((day, weekday) => { const row = hourEdits[weekday] || { ...defaultHours(weekday), teamMemberId: hoursMember }; return <article key={day}><label><input type="checkbox" checked={row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, isAvailable: event.target.checked } }))} />{day}</label><input type="time" value={minuteLabel(row.startMinute)} disabled={!row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, startMinute: minuteValue(event.target.value) } }))} /><input type="time" value={minuteLabel(row.endMinute)} disabled={!row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, endMinute: minuteValue(event.target.value) } }))} /><button type="button" disabled={busy === `hours:${weekday}`} onClick={() => void update({ action: "save_working_hours", memberId: hoursMember, weekday, startMinute: row.startMinute, endMinute: row.endMinute, isAvailable: row.isAvailable }, `hours:${weekday}`, `${day} hours saved.`)}>Save</button></article>; })}</div>}
        {hoursMember && <form className="schedule-unavailable-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ action: "add_unavailability", memberId: hoursMember, startsAt: form.get("startsAt"), endsAt: form.get("endsAt"), reason: form.get("reason") }, "unavailable", "Unavailable time recorded."); event.currentTarget.reset(); }}><strong>Add unavailable time</strong><input name="startsAt" type="datetime-local" required /><input name="endsAt" type="datetime-local" required /><input name="reason" maxLength={200} placeholder="Leave, training or other reason" /><button disabled={busy === "unavailable"}>Add</button></form>}
        <div className="schedule-unavailable-list">{(data.unavailability || []).filter((item) => !hoursMember || item.teamMemberId === hoursMember).map((item) => <article key={item.id}><div><strong>{item.reason}</strong><span>{item.startsAt} to {item.endsAt}</span></div><button type="button" onClick={() => void update({ action: "remove_unavailability", id: item.id }, `remove:${item.id}`, "Unavailable time removed.")}>Remove</button></article>)}</div></div></details></div>
    {status && <p className="crm-status" role="status">{status}</p>}
  </section>;
}
