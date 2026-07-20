"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  APPOINTMENT_MAX_DURATION_MINUTES,
  APPOINTMENT_MIN_DURATION_MINUTES,
  appointmentDurationMinutes,
  appointmentEndsAt,
  browserLocalDateTime,
  durationLabel,
  moveAppointmentToDate,
  nextAppointmentSlot,
} from "@/lib/trade-schedule";
import {
  clearIntegrationReturnFromAddress,
  integrationProviderLabel,
  isCalendarIntegration,
  readIntegrationReturn,
} from "@/lib/trade-integration-return";

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
type Edit = { memberId: string; date: string; time: string; durationMinutes: number };
type CalendarConnection = { provider: "google_calendar" | "microsoft_calendar"; label: string; configured: boolean; status: "connected" | "not_connected"; lastSyncAt: string; lastError: string };
type CalendarResult = { ok?: boolean; error?: string; providers?: CalendarConnection[]; synced?: number; failed?: number };

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const shortDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GRID_START_MINUTE = 6 * 60;
const GRID_END_MINUTE = 22 * 60;
const GRID_QUARTER_HEIGHT = 16;
const memberColours = ["green", "teal", "blue", "amber", "purple", "coral"];
const timeChoices = Array.from({ length: (GRID_END_MINUTE - GRID_START_MINUTE) / 15 }, (_, index) => {
  const minutes = GRID_START_MINUTE + index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const timeLabels = Array.from({ length: (GRID_END_MINUTE - GRID_START_MINUTE) / 60 + 1 }, (_, index) => GRID_START_MINUTE + index * 60);

function monday(value = new Date()) {
  const date = new Date(value); const day = date.getDay(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - ((day + 6) % 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(date: string, amount: number) { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + amount); return value.toISOString().slice(0, 10); }
function minuteLabel(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function minuteValue(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function defaultHours(weekday: number): WorkingHours { return { teamMemberId: "", weekday, startMinute: 540, endMinute: 1020, isAvailable: weekday >= 1 && weekday <= 5 }; }
function readable(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function memberLabel(member: Member) { return member.isOwner ? "Me" : member.displayName; }
function editFromRange(memberId: string, startsAt: string, endsAt: string): Edit {
  return { memberId, date: startsAt.slice(0, 10), time: startsAt.slice(11, 16), durationMinutes: appointmentDurationMinutes(startsAt, endsAt) };
}
function editStart(edit: Edit) { return `${edit.date}T${edit.time}`; }
function formatTime(value: string) { return new Date(`${value}:00`).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }); }
function initialEdit(weekStart: string, localNow: string, memberId: string): Edit {
  let date = weekStart < localNow.slice(0, 10) ? localNow.slice(0, 10) : weekStart;
  let time = "09:00";
  if (`${date}T${time}` <= localNow) {
    const rounded = new Date(`${localNow}:00`); rounded.setMinutes(Math.floor(rounded.getMinutes() / 15) * 15 + 15, 0, 0);
    const roundedLocal = browserLocalDateTime(rounded);
    date = roundedLocal.slice(0, 10); time = roundedLocal.slice(11, 16);
    const roundedMinute = minuteValue(time);
    if (roundedMinute < GRID_START_MINUTE) time = "09:00";
    if (roundedMinute >= GRID_END_MINUTE) { date = addDays(date, 1); time = "09:00"; }
  }
  return { memberId, date, time, durationMinutes: 60 };
}

function DurationControl({ id, value, onChange }: { id: string; value: number; onChange: (minutes: number) => void }) {
  return <label className="schedule-duration" htmlFor={id}><span>Duration <strong>{durationLabel(value)}</strong></span><input id={id} type="range" min={APPOINTMENT_MIN_DURATION_MINUTES} max={APPOINTMENT_MAX_DURATION_MINUTES} step="15" value={value} onChange={(event) => onChange(Number(event.target.value))} /><small>15 min</small><small>8 hours</small></label>;
}

export function TradeScheduleWorkspace({ user, onOpenJob = () => undefined }: { user: User; onOpenJob?: (workOrderId: string) => void }) {
  const [weekStart, setWeekStart] = useState(() => monday());
  const [data, setData] = useState<ScheduleResult>({});
  const [calendars, setCalendars] = useState<CalendarConnection[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [status, setStatus] = useState("");
  const [memberFilter, setMemberFilter] = useState(""); const [jobFilter, setJobFilter] = useState(""); const [serviceFilter, setServiceFilter] = useState(""); const [siteFilter, setSiteFilter] = useState(""); const [statusFilter, setStatusFilter] = useState(""); const [conflictOnly, setConflictOnly] = useState(false);
  const [hoursMember, setHoursMember] = useState(""); const [hourEdits, setHourEdits] = useState<Record<number, WorkingHours>>({});
  const [edits, setEdits] = useState<Record<string, Edit>>({}); const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [draggingId, setDraggingId] = useState(""); const [dropTarget, setDropTarget] = useState(""); const [dropMinute, setDropMinute] = useState(GRID_START_MINUTE);
  const minimumStart = useMemo(() => nextAppointmentSlot(new Date(), 0), []);

  const load = useCallback(async () => {
    setLoading(true); setStatus("");
    try {
      const token = await user.getIdToken();
      const [scheduleResponse, calendarResponse] = await Promise.all([
        fetch(`/api/trade-schedule?weekStart=${weekStart}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
        fetch(`/api/trade-calendar-sync?weekStart=${weekStart}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }),
      ]);
      const result = await scheduleResponse.json().catch(() => ({})) as ScheduleResult;
      const calendarResult = await calendarResponse.json().catch(() => ({})) as CalendarResult;
      if (!scheduleResponse.ok || !result.ok) throw new Error(result.error || "The schedule could not be loaded.");
      setData(result); setHoursMember((current) => current || result.members?.[0]?.id || ""); setEdits({}); setDecisionNotes({});
      const returned = readIntegrationReturn(window.location.search);
      const calendarReturn = returned && isCalendarIntegration(returned.provider) ? returned : null;
      if (calendarResponse.ok && calendarResult.ok) {
        const nextCalendars = calendarResult.providers || [];
        setCalendars(nextCalendars);
        if (calendarReturn) {
          const label = integrationProviderLabel(calendarReturn.provider);
          if (calendarReturn.status === "cancelled") setStatus(`${label} connection cancelled. Nothing was changed.`);
          else if (calendarReturn.status === "failed") setStatus(`${label} could not be connected. Try again or contact TLink support.`);
          else if (!nextCalendars.some((provider) => provider.provider === calendarReturn.provider && provider.status === "connected")) {
            setStatus(`${label} returned to TLink, but the connection could not be verified. Try connecting again.`);
          } else {
            const firstSyncResponse = await fetch("/api/trade-calendar-sync", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ weekStart }),
            });
            const firstSyncResult = await firstSyncResponse.json().catch(() => ({})) as CalendarResult;
            if (firstSyncResponse.ok && firstSyncResult.ok) {
              setCalendars(firstSyncResult.providers || nextCalendars);
              setStatus(firstSyncResult.failed
                ? `${label} connected. ${firstSyncResult.synced || 0} calendar items synced and ${firstSyncResult.failed} need another try.`
                : `${label} connected. ${firstSyncResult.synced || 0} calendar items are up to date.`);
            } else setStatus(`${label} connected. TLink is saved, but the first calendar sync needs another try.`);
          }
          clearIntegrationReturnFromAddress();
        }
      } else if (calendarReturn) {
        const label = integrationProviderLabel(calendarReturn.provider);
        setStatus(`${label} returned to TLink, but the connection could not be checked. Refresh and try again.`);
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : "The schedule could not be loaded."); }
    finally { setLoading(false); }
  }, [user, weekStart]);

  useEffect(() => { const frame = window.requestAnimationFrame(() => void load()); return () => window.cancelAnimationFrame(frame); }, [load]);
  useEffect(() => {
    if (!hoursMember) return; const next: Record<number, WorkingHours> = {};
    for (let weekday = 0; weekday < 7; weekday += 1) next[weekday] = data.workingHours?.find((row) => row.teamMemberId === hoursMember && row.weekday === weekday) || { ...defaultHours(weekday), teamMemberId: hoursMember };
    const frame = window.requestAnimationFrame(() => setHourEdits(next)); return () => window.cancelAnimationFrame(frame);
  }, [hoursMember, data.workingHours]);

  async function update(body: Record<string, unknown>, key: string, success: string) {
    setBusy(key); setStatus("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-schedule", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...body, weekStart }) });
      const result = await response.json().catch(() => ({})) as ScheduleResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The schedule change could not be saved.");
      setData(result); setEdits({}); setDecisionNotes({});
      const changesAppointment = ["schedule_appointment", "schedule_job"].includes(String(body.action))
        || (body.action === "review_reschedule_request" && body.decision === "accepted");
      if (changesAppointment && calendars.some((item) => item.status === "connected")) {
        try {
          const calendarResponse = await fetch("/api/trade-calendar-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ weekStart }) });
          const calendarResult = await calendarResponse.json().catch(() => ({})) as CalendarResult;
          if (!calendarResponse.ok || !calendarResult.ok) throw new Error(calendarResult.error || "Calendar sync needs another try.");
          setCalendars(calendarResult.providers || calendars);
          setStatus(calendarResult.failed ? `${success} TLink is saved. A calendar item needs another sync.` : `${success} Connected calendars are up to date.`);
        } catch { setStatus(`${success} TLink is saved. Calendar sync needs another try.`); }
      } else setStatus(success);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The schedule change could not be saved."); }
    finally { setBusy(""); }
  }

  async function connectCalendar(provider: CalendarConnection) {
    setBusy(`connect:${provider.provider}`); setStatus(`Opening ${provider.label} secure authorisation...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-integrations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ provider: provider.provider }) });
      const result = await response.json().catch(() => ({})) as { authorizationUrl?: string; error?: string };
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || "The calendar connection could not be started.");
      window.location.assign(result.authorizationUrl);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The calendar connection could not be started."); setBusy(""); }
  }

  async function syncCalendars() {
    setBusy("calendar-sync"); setStatus("Sending this TLink week to connected calendars...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-calendar-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ weekStart }) });
      const result = await response.json().catch(() => ({})) as CalendarResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The calendar sync could not be completed.");
      setCalendars(result.providers || calendars);
      setStatus(result.failed ? `${result.synced || 0} calendar items synced. ${result.failed} need another try.` : `${result.synced || 0} calendar items are up to date.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The calendar sync could not be completed."); }
    finally { setBusy(""); }
  }

  const members = useMemo(() => data.members || [], [data.members]);
  const appointments = useMemo(() => data.appointments || [], [data.appointments]);
  const services = useMemo(() => [...new Set([...appointments.map((item) => item.serviceCategory), ...(data.unassignedJobs || []).map((item) => item.serviceCategory)])].filter(Boolean).sort(), [appointments, data.unassignedJobs]);
  const sites = useMemo(() => [...new Set([...appointments.map((item) => item.siteLabel), ...(data.unassignedJobs || []).map((item) => item.siteLabel)])].filter(Boolean).sort(), [appointments, data.unassignedJobs]);
  const jobQuery = jobFilter.trim().toLowerCase();
  const visibleAppointments = appointments.filter((item) => (!memberFilter || item.assigneeMemberId === memberFilter) && (!jobQuery || `${item.workNumber} ${item.title}`.toLowerCase().includes(jobQuery)) && (!serviceFilter || item.serviceCategory === serviceFilter) && (!siteFilter || item.siteLabel === siteFilter) && (!conflictOnly || item.conflicts) && !["awaiting", "unassigned"].includes(statusFilter) && (statusFilter !== "conflict" || item.conflicts));
  const visibleJobs = (data.unassignedJobs || []).filter((item) => (!memberFilter || item.assigneeMemberId === memberFilter) && (!jobQuery || `${item.workNumber} ${item.title}`.toLowerCase().includes(jobQuery)) && (!serviceFilter || item.serviceCategory === serviceFilter) && (!siteFilter || item.siteLabel === siteFilter) && !["scheduled", "conflict"].includes(statusFilter) && (statusFilter !== "unassigned" || !item.assigneeMemberId));
  const unassignedCount = visibleJobs.filter((item) => !item.assigneeMemberId).length;
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const ownerMemberId = members.find((member) => member.isOwner)?.id || members[0]?.id || "";
  const selectedAppointment = appointments.find((item) => item.id === selectedAppointmentId);

  function hoursFor(memberId: string, weekday: number) { return data.workingHours?.find((row) => row.teamMemberId === memberId && row.weekday === weekday) || { ...defaultHours(weekday), teamMemberId: memberId }; }
  const capacity = members.map((member) => {
    const available = days.reduce((total, date) => { const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); const row = hoursFor(member.id, weekday); return total + (row.isAvailable ? row.endMinute - row.startMinute : 0); }, 0);
    const booked = appointments.filter((item) => item.assigneeMemberId === member.id).reduce((total, item) => total + appointmentDurationMinutes(item.startsAt, item.endsAt), 0);
    return { member, available, booked, percent: available ? Math.min(100, Math.round(booked / available * 100)) : booked ? 100 : 0 };
  });
  function colourFor(memberId: string) { const index = Math.max(0, members.findIndex((member) => member.id === memberId)); return memberColours[index % memberColours.length]; }

  function minuteFromPointer(element: HTMLElement, clientY: number, durationMinutes: number) {
    const quarter = Math.round((clientY - element.getBoundingClientRect().top) / GRID_QUARTER_HEIGHT);
    const requested = GRID_START_MINUTE + quarter * 15;
    return Math.max(GRID_START_MINUTE, Math.min(GRID_END_MINUTE - durationMinutes, requested));
  }

  async function moveAppointment(appointment: Appointment, targetDate: string, targetMinute: number) {
    if (targetDate < minimumStart.slice(0, 10)) { setStatus("Appointments cannot be moved into the past."); return; }
    const edit = edits[appointment.id] || editFromRange(appointment.assigneeMemberId, appointment.startsAt, appointment.endsAt);
    try {
      const targetStart = `${appointment.startsAt.slice(0, 10)}T${minuteLabel(targetMinute)}`;
      const moved = moveAppointmentToDate(targetStart, appointmentEndsAt(targetStart, edit.durationMinutes), targetDate, minimumStart);
      await update({ action: "schedule_appointment", appointmentId: appointment.id, expectedRevision: appointment.revision,
        memberId: edit.memberId, startsAt: moved.startsAt, durationMinutes: edit.durationMinutes }, `appointment:${appointment.id}`, `${appointment.workNumber} moved to ${formatTime(moved.startsAt)} on ${targetDate}.`);
    } catch (error) { setStatus(error instanceof Error && error.message === "PAST_APPOINTMENT" ? "There is no future time left in that day. Choose another day." : "That appointment could not be moved."); }
    finally { setDraggingId(""); setDropTarget(""); setDropMinute(GRID_START_MINUTE); }
  }

  if (loading) return <section className="dashboard-panel schedule-workspace"><div className="crm-empty"><strong>Building the team week</strong><span>Loading appointments, availability and capacity.</span></div></section>;
  return <section className="dashboard-panel schedule-workspace">
    <header className="schedule-heading"><div><span>Plan the week</span><h2>See the week at a glance</h2><p>Choose any week, then drag an appointment across days or up and down to change its start time.</p></div><div className="schedule-week-nav"><button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous</button><button type="button" onClick={() => setWeekStart(monday())}>This week</button><label><span>View week containing</span><input type="date" value={weekStart} onChange={(event) => { if (event.target.value) setWeekStart(monday(new Date(`${event.target.value}T12:00:00`))); }} /></label><strong>{weekStart} to {addDays(weekStart, 6)}</strong><button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next</button></div></header>
    <details className="schedule-calendar-links"><summary><span>Calendar apps</span><strong>Google Calendar and Outlook</strong></summary><div><p>TLink stays authoritative. Connected calendars receive this week&apos;s job blocks and never control the TLink schedule.</p>{calendars.map((provider) => <article key={provider.provider}><div><strong>{provider.label}</strong><span>{provider.status === "connected" ? provider.lastError ? "Connected, last sync needs attention" : "Connected" : provider.configured ? "Available to connect" : "TLink setup in progress"}</span></div><button type="button" disabled={!provider.configured || provider.status === "connected" || Boolean(busy)} onClick={() => void connectCalendar(provider)}>{provider.status === "connected" ? "Connected" : provider.configured ? `Connect ${provider.label}` : "TLink setup in progress"}</button></article>)}<button className="primary" type="button" disabled={!calendars.some((item) => item.status === "connected") || Boolean(busy)} onClick={() => void syncCalendars()}>{busy === "calendar-sync" ? "Syncing..." : "Sync this week"}</button></div></details>
    <div className="schedule-filters"><label><span>Person</span><select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}><option value="">Everyone</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label><span>Job</span><input value={jobFilter} placeholder="Number or title" onChange={(event) => setJobFilter(event.target.value)} /></label><label><span>Service</span><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="">All services</option>{services.map((service) => <option key={service}>{readable(service)}</option>)}</select></label><label><span>Site</span><select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="">All sites</option>{sites.map((site) => <option key={site}>{site}</option>)}</select></label><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All schedule states</option><option value="scheduled">Scheduled</option><option value="conflict">Conflicts</option><option value="awaiting">Awaiting appointment</option><option value="unassigned">Unassigned</option></select></label><label className="schedule-check"><input type="checkbox" checked={conflictOnly} onChange={(event) => setConflictOnly(event.target.checked)} /><span>Conflicts only</span></label></div>
    <section className="schedule-capacity"><header><strong>This week</strong><span>{unassignedCount} jobs waiting | {appointments.filter((item) => item.conflicts).length} conflicts</span></header><div>{capacity.map(({ member, available, booked, percent }) => <article key={member.id}><span><i className={`schedule-person-dot ${colourFor(member.id)}`} />{memberLabel(member)}<small>{member.isOwner ? "Owner" : readable(member.role)}</small></span><strong>{Math.round(booked / 60)}h booked of {Math.round(available / 60)}h</strong><div><i style={{ width: `${percent}%` }} /></div></article>)}</div></section>
    {(data.rescheduleRequests || []).length > 0 && <details className="schedule-reschedule-queue"><summary><span>Customer requests</span><strong>Review before changing the schedule | {data.rescheduleRequests?.length}</strong></summary><div>{data.rescheduleRequests?.map((request) => {
      const preferred = request.preferredWindows[0]; const baseStart = request.proposedStartsAt || preferred?.startsAt || request.currentStartsAt; const baseEnd = request.proposedEndsAt || preferred?.endsAt || request.currentEndsAt;
      const edit = edits[request.id] || editFromRange(request.proposedAssigneeMemberId || request.currentAssigneeMemberId, baseStart, baseEnd); const startsAt = editStart(edit); const invalidTime = startsAt <= minimumStart;
      return <article key={request.id}><header><div><span>{request.workNumber} | {readable(request.status)}</span><strong>{request.title}</strong><small>Current: {request.currentStartsAt} | {durationLabel(appointmentDurationMinutes(request.currentStartsAt, request.currentEndsAt))}</small></div></header><p><strong>Reason</strong>{request.reason}</p>{request.accessNotes && <p><strong>Access notes</strong>{request.accessNotes}</p>}<div className="schedule-request-decision"><select aria-label={`Assigned staff for request ${request.workNumber}`} value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [request.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select><input type="datetime-local" min={minimumStart} step="900" aria-label={`Reviewed start for ${request.workNumber}`} value={startsAt} onChange={(event) => setEdits((current) => ({ ...current, [request.id]: { ...edit, date: event.target.value.slice(0, 10), time: event.target.value.slice(11, 16) } }))} /><DurationControl id={`request-duration-${request.id}`} value={edit.durationMinutes} onChange={(durationMinutes) => setEdits((current) => ({ ...current, [request.id]: { ...edit, durationMinutes } }))} /><input maxLength={500} value={decisionNotes[request.id] || ""} onChange={(event) => setDecisionNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Optional customer-facing response" /></div><div className="schedule-request-actions"><button type="button" disabled={busy === `reject:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "rejected", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "" }, `reject:${request.id}`, `${request.workNumber} request rejected without changing the schedule.`)}>Reject</button><button type="button" disabled={!edit.memberId || invalidTime || busy === `alternative:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "alternative_proposed", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "", memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `alternative:${request.id}`, `${request.workNumber} alternative proposed without changing the schedule.`)}>Propose alternative</button><button className="primary" type="button" disabled={!edit.memberId || invalidTime || busy === `accept:${request.id}`} onClick={() => void update({ action: "review_reschedule_request", requestId: request.id, decision: "accepted", expectedRequestRevision: request.revision, expectedAppointmentRevision: request.appointmentRevision, decisionNote: decisionNotes[request.id] || "", memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `accept:${request.id}`, `${request.workNumber} appointment change accepted.`)}>Accept and reschedule</button></div></article>;
    })}</div></details>}
    <p className="schedule-drag-note">Drag a block left or right to change the day, and up or down to choose a new 15-minute start. Double-click it to open the job.</p>
    <div className="schedule-timetable-scroll"><div className="schedule-timetable">
      <div className="schedule-time-rail"><div className="schedule-time-heading">Time</div><div className="schedule-time-track">{timeLabels.map((minute) => <span key={minute} style={{ top: `${((minute - GRID_START_MINUTE) / 15) * GRID_QUARTER_HEIGHT}px` }}>{formatTime(`2000-01-01T${minuteLabel(minute)}`)}</span>)}</div></div>
      {days.map((date) => { const dayIsPast = date < minimumStart.slice(0, 10); const dayAppointments = visibleAppointments.filter((item) => item.startsAt.slice(0, 10) === date); return <section key={date} className={`schedule-day-track${dropTarget === date ? " drop-target" : ""}${dayIsPast ? " past" : ""}`}>
        <header><strong>{shortDays[new Date(`${date}T00:00:00Z`).getUTCDay()]}</strong><span>{date.slice(5)}</span></header><div className="schedule-day-grid" style={{ height: `${((GRID_END_MINUTE - GRID_START_MINUTE) / 15) * GRID_QUARTER_HEIGHT}px` }}
          onDragOver={(event) => { const appointment = appointments.find((item) => item.id === draggingId); if (!dayIsPast && appointment) { event.preventDefault(); setDropTarget(date); setDropMinute(minuteFromPointer(event.currentTarget, event.clientY, appointmentDurationMinutes(appointment.startsAt, appointment.endsAt))); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(""); }}
          onDrop={(event) => { event.preventDefault(); const appointment = appointments.find((item) => item.id === (draggingId || event.dataTransfer.getData("text/plain"))); if (appointment) void moveAppointment(appointment, date, minuteFromPointer(event.currentTarget, event.clientY, appointmentDurationMinutes(appointment.startsAt, appointment.endsAt))); }}>
          {dropTarget === date && <span className="schedule-drop-guide" style={{ top: `${((dropMinute - GRID_START_MINUTE) / 15) * GRID_QUARTER_HEIGHT}px` }}>{formatTime(`${date}T${minuteLabel(dropMinute)}`)}</span>}{dayAppointments.map((item) => {
          const startMinute = minuteValue(item.startsAt.slice(11, 16)); const duration = appointmentDurationMinutes(item.startsAt, item.endsAt); const top = Math.max(0, ((startMinute - GRID_START_MINUTE) / 15) * GRID_QUARTER_HEIGHT); const height = Math.max(42, (duration / 15) * GRID_QUARTER_HEIGHT);
          return <article key={item.id} draggable={!busy} tabIndex={0} className={`schedule-block ${colourFor(item.assigneeMemberId)}${item.conflicts ? " conflict" : ""}${selectedAppointmentId === item.id ? " selected" : ""}${draggingId === item.id ? " dragging" : ""}`} style={{ top: `${top}px`, height: `${height}px` }} onClick={() => setSelectedAppointmentId(item.id)} onDoubleClick={() => onOpenJob(item.workOrderId)} onKeyDown={(event) => { if (event.key === "Enter") onOpenJob(item.workOrderId); }} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); setDraggingId(item.id); setDropMinute(startMinute); }} onDragEnd={() => { setDraggingId(""); setDropTarget(""); setDropMinute(GRID_START_MINUTE); }}>
            <span>{formatTime(item.startsAt)} | {durationLabel(duration)}</span><strong>{item.workNumber}</strong><small>{item.title}</small><em>{item.assigneeLabel || "Unassigned"}</em>{item.outsideWorkingHours && <b>Outside hours</b>}{item.conflicts && <b>Conflict</b>}
          </article>;
        })}{!dayAppointments.length && <span className="schedule-free-day">{dayIsPast ? "Past" : "Free"}</span>}</div>
      </section>; })}
    </div></div>
    {selectedAppointment && (() => { const edit = edits[selectedAppointment.id] || editFromRange(selectedAppointment.assigneeMemberId, selectedAppointment.startsAt, selectedAppointment.endsAt); const startsAt = editStart(edit); return <section className="schedule-selection"><header><div><span>Selected appointment</span><h3>{selectedAppointment.workNumber} | {selectedAppointment.title}</h3></div><button type="button" onClick={() => onOpenJob(selectedAppointment.workOrderId)}>Open job</button></header><div className="schedule-selection-fields"><label><span>Person</span><select value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label><span>Day</span><input type="date" min={minimumStart.slice(0, 10)} value={edit.date} onChange={(event) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, date: event.target.value } }))} /></label><label><span>Start</span><select value={edit.time} onChange={(event) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, time: event.target.value } }))}>{timeChoices.map((time) => <option key={time}>{time}</option>)}</select></label><DurationControl id={`appointment-duration-${selectedAppointment.id}`} value={edit.durationMinutes} onChange={(durationMinutes) => setEdits((current) => ({ ...current, [selectedAppointment.id]: { ...edit, durationMinutes } }))} /><button className="primary" type="button" disabled={!edit.memberId || startsAt <= minimumStart || busy === `appointment:${selectedAppointment.id}`} onClick={() => void update({ action: "schedule_appointment", appointmentId: selectedAppointment.id, expectedRevision: selectedAppointment.revision, memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `appointment:${selectedAppointment.id}`, `${selectedAppointment.workNumber} schedule updated.`)}>Save appointment</button></div></section>; })()}
    <div className="schedule-lower-grid"><section className="schedule-unassigned"><header><div><span>Ready to schedule</span><h3>Choose a start and job length</h3></div><strong>{visibleJobs.length}</strong></header>{visibleJobs.map((job) => { const edit = edits[job.id] || initialEdit(weekStart, minimumStart, job.assigneeMemberId || ownerMemberId); const startsAt = editStart(edit); return <article key={job.id}><div><span>{job.workNumber} | {readable(job.priority)}</span><strong>{job.title}</strong><small>{job.siteLabel} | {readable(job.serviceCategory)}</small></div><label><span>Person</span><select value={edit.memberId} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, memberId: event.target.value } }))}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label><span>Day</span><input type="date" min={minimumStart.slice(0, 10)} value={edit.date} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, date: event.target.value } }))} /></label><label><span>Start</span><select value={edit.time} onChange={(event) => setEdits((current) => ({ ...current, [job.id]: { ...edit, time: event.target.value } }))}>{timeChoices.map((time) => <option key={time}>{time}</option>)}</select></label><DurationControl id={`job-duration-${job.id}`} value={edit.durationMinutes} onChange={(durationMinutes) => setEdits((current) => ({ ...current, [job.id]: { ...edit, durationMinutes } }))} /><button type="button" disabled={!edit.memberId || startsAt <= minimumStart || busy === `job:${job.id}`} onClick={() => void update({ action: "schedule_job", workOrderId: job.id, expectedRevision: job.revision, memberId: edit.memberId, startsAt, durationMinutes: edit.durationMinutes }, `job:${job.id}`, `${job.workNumber} added to the schedule.`)}>Add to schedule</button></article>; })}{!visibleJobs.length && <div className="crm-empty"><strong>No work waiting</strong><span>Every visible active job already has a scheduled appointment.</span></div>}</section>
      <details className="schedule-availability"><summary><span>Availability</span><strong>Set working hours and time off</strong></summary><div className="schedule-availability-content"><label><span>Person</span><select value={hoursMember} onChange={(event) => setHoursMember(event.target.value)}><option value="">Choose person</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label>{hoursMember && <div className="schedule-hours-grid">{dayNames.map((day, weekday) => { const row = hourEdits[weekday] || { ...defaultHours(weekday), teamMemberId: hoursMember }; return <article key={day}><label><input type="checkbox" checked={row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, isAvailable: event.target.checked } }))} />{day}</label><input type="time" value={minuteLabel(row.startMinute)} disabled={!row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, startMinute: minuteValue(event.target.value) } }))} /><input type="time" value={minuteLabel(row.endMinute)} disabled={!row.isAvailable} onChange={(event) => setHourEdits((current) => ({ ...current, [weekday]: { ...row, endMinute: minuteValue(event.target.value) } }))} /><button type="button" disabled={busy === `hours:${weekday}`} onClick={() => void update({ action: "save_working_hours", memberId: hoursMember, weekday, startMinute: row.startMinute, endMinute: row.endMinute, isAvailable: row.isAvailable }, `hours:${weekday}`, `${day} hours saved.`)}>Save</button></article>; })}</div>}
        {hoursMember && <form className="schedule-unavailable-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void update({ action: "add_unavailability", memberId: hoursMember, startsAt: form.get("startsAt"), endsAt: form.get("endsAt"), reason: form.get("reason") }, "unavailable", "Unavailable time recorded."); event.currentTarget.reset(); }}><strong>Add unavailable time</strong><input name="startsAt" type="datetime-local" required /><input name="endsAt" type="datetime-local" required /><input name="reason" maxLength={200} placeholder="Leave, training or other reason" /><button disabled={busy === "unavailable"}>Add</button></form>}
        <div className="schedule-unavailable-list">{(data.unavailability || []).filter((item) => !hoursMember || item.teamMemberId === hoursMember).map((item) => <article key={item.id}><div><strong>{item.reason}</strong><span>{item.startsAt} to {item.endsAt}</span></div><button type="button" onClick={() => void update({ action: "remove_unavailability", id: item.id }, `remove:${item.id}`, "Unavailable time removed.")}>Remove</button></article>)}</div></div></details></div>
    {status && <p className="crm-status" role="status">{status}</p>}
  </section>;
}
