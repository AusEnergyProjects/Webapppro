"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type Member = { id: string; email: string; displayName: string; role: string; status: string; invitedAt: string; acceptedAt: string; lastActiveAt: string };
type Job = { id: string; workNumber: string; title: string; stage: string; priority: string; scheduledStart: string; scheduledEnd: string; assigneeMemberId: string; assigneeLabel: string; protectedJob: boolean; serviceAddress: string };
type TeamResult = { ok?: boolean; members?: Member[]; jobs?: Job[]; invite?: { inviteUrl: string; email: string; expiresInDays: number }; error?: string };
type Device = { id: string; deviceName: string; platform: string; appVersion: string; pushConnected: boolean; status: string; memberName: string; memberEmail: string; registeredAt: string; lastSeenAt: string; revokedAt: string };
type DeviceResult = { ok?: boolean; devices?: Device[]; pendingPushEvents?: number; error?: string };

const roleLabels: Record<string, string> = { manager: "Manager", coordinator: "Coordinator", technician: "Technician" };
const stageLabels: Record<string, string> = { backlog: "Planning", ready: "Ready", scheduled: "Scheduled", in_progress: "On site", blocked: "Waiting", completed: "Complete", cancelled: "Cancelled" };

export function TradeTeamCentre({ user }: { user: User }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pendingPushEvents, setPendingPushEvents] = useState(0);
  const [view, setView] = useState<"dispatch" | "people" | "devices">("dispatch");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");

  const apply = useCallback((result: TeamResult) => { setMembers(result.members || []); setJobs(result.jobs || []); }, []);
  const load = useCallback(async () => {
    const token = await user.getIdToken(); const headers = { Authorization: `Bearer ${token}` };
    const [teamResponse, deviceResponse] = await Promise.all([
      fetch("/api/trade-team", { headers, cache: "no-store" }),
      fetch("/api/trade-team/devices", { headers, cache: "no-store" }),
    ]);
    const result = await teamResponse.json().catch(() => ({})) as TeamResult;
    if (!teamResponse.ok) throw new Error(result.error || "The team workspace could not be loaded."); apply(result);
    const deviceResult = await deviceResponse.json().catch(() => ({})) as DeviceResult;
    if (deviceResponse.ok) { setDevices(deviceResult.devices || []); setPendingPushEvents(deviceResult.pendingPushEvents || 0); }
  }, [apply, user]);

  useEffect(() => {
    let active = true; const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "The team workspace could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  async function request(method: "POST" | "PATCH", body: Record<string, unknown>, key: string, success: string) {
    setBusy(key); setStatus("Saving the team update...");
    try {
      const token = await user.getIdToken(); const response = await fetch("/api/trade-team", { method, headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as TeamResult;
      if (!response.ok) throw new Error(result.error || "The team update could not be saved.");
      apply(result); if (result.invite?.inviteUrl) setInviteUrl(result.invite.inviteUrl); setStatus(success); return true;
    } catch (error) { setStatus(error instanceof Error ? error.message : "The team update could not be saved."); return false; }
    finally { setBusy(""); }
  }

  async function updateDevice(id: string, action: "revoke_device" | "authorise_device") {
    setBusy(`device:${id}`); setStatus(action === "revoke_device" ? "Removing field access from this device..." : "Authorising this device...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-team/devices", { method: "PATCH", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ id, action }) });
      const result = await response.json().catch(() => ({})) as DeviceResult;
      if (!response.ok) throw new Error(result.error || "The device update could not be saved.");
      setDevices(result.devices || []); setPendingPushEvents(result.pendingPushEvents || 0);
      setStatus(action === "revoke_device" ? "Device access revoked. Its next request will require local work data to be removed." : "Device authorised. The team member can register it again securely.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The device update could not be saved."); }
    finally { setBusy(""); }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (await request("POST", { action: "invite_member", displayName: data.get("displayName"), email: data.get("email"), role: data.get("role") }, "invite", "Invitation link created.")) form.reset();
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl); setStatus("Invitation link copied.");
  }

  const activeMembers = members.filter((member) => member.status === "active");
  const scheduled = useMemo(() => jobs.filter((job) => !["completed", "cancelled"].includes(job.stage))
    .sort((a, b) => (a.scheduledStart || "9999").localeCompare(b.scheduledStart || "9999")), [jobs]);

  if (loading) return <section className="crm-loading"><span /><div><strong>Opening team operations</strong><p>Loading people and assignments...</p></div></section>;

  return <div className="crm-team-centre">
    <div className="crm-page-heading"><div><span>Team operations</span><h3>People and dispatch</h3><p>Invite staff with their own login, assign work and keep each technician focused on the jobs they are meant to see.</p></div><a className="crm-team-portal-link" href="/direct-trade/team">Open staff portal</a></div>
    <nav className="crm-team-tabs" aria-label="Team workspace"><button type="button" className={view === "dispatch" ? "active" : ""} onClick={() => setView("dispatch")}>Dispatch board</button><button type="button" className={view === "people" ? "active" : ""} onClick={() => setView("people")}>People ({members.length})</button><button type="button" className={view === "devices" ? "active" : ""} onClick={() => setView("devices")}>Field devices ({devices.length})</button></nav>
    {view === "dispatch" && <section className="crm-dispatch-board">
      <header><div><strong>Active work</strong><span>{scheduled.length} jobs to coordinate</span></div><div className="crm-dispatch-legend"><span>Unassigned {scheduled.filter((job) => !job.assigneeMemberId).length}</span><span>On site {scheduled.filter((job) => job.stage === "in_progress").length}</span></div></header>
      {scheduled.length ? <div className="crm-dispatch-list">{scheduled.map((job) => <article key={job.id} className={!job.assigneeMemberId ? "unassigned" : ""}><div className="crm-dispatch-date"><strong>{job.scheduledStart ? new Date(`${job.scheduledStart}T00:00:00`).toLocaleDateString("en-AU", { day: "2-digit" }) : "?"}</strong><span>{job.scheduledStart ? new Date(`${job.scheduledStart}T00:00:00`).toLocaleDateString("en-AU", { month: "short" }) : "Unscheduled"}</span></div><div className="crm-dispatch-job"><span>{job.workNumber} | {stageLabels[job.stage] || job.stage}</span><strong>{job.title}</strong><small>{job.protectedJob ? "AEA protected, region only" : job.serviceAddress || "Direct customer address not added"}</small></div><label><span>Assigned to</span><select value={job.assigneeMemberId} disabled={busy === `assign:${job.id}`} onChange={(event) => void request("PATCH", { action: "assign_job", workOrderId: job.id, memberId: event.target.value }, `assign:${job.id}`, "Job assignment saved.")}><option value="">Unassigned</option>{activeMembers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label></article>)}</div> : <div className="crm-empty"><strong>No active jobs</strong><span>New jobs will appear here for assignment.</span></div>}
    </section>}
    {view === "people" && <div className="crm-team-layout"><section className="crm-team-invite"><span>Add a team member</span><h4>Create a secure invitation</h4><p>The invitation expires after seven days and only works for the exact email entered.</p><form onSubmit={invite}><label><span>Name</span><input name="displayName" required maxLength={100} /></label><label><span>Email</span><input name="email" type="email" required maxLength={180} /></label><label><span>Role</span><select name="role"><option value="technician">Technician</option><option value="coordinator">Coordinator</option><option value="manager">Manager</option></select></label><button disabled={busy === "invite"}>{busy === "invite" ? "Creating..." : "Create invitation"}</button></form>{inviteUrl && <div className="crm-invite-link"><strong>Share this link privately</strong><input value={inviteUrl} readOnly aria-readonly="true" /><button type="button" onClick={() => void copyInvite()}>Copy link</button></div>}</section><section className="crm-team-list"><header><strong>Team directory</strong><span>{activeMembers.length} active</span></header>{members.length ? members.map((member) => <article key={member.id}><div><strong>{member.displayName}</strong><span>{member.email}</span><small>{member.status === "active" ? `Last active ${member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleDateString("en-AU") : "not yet recorded"}` : "Invitation pending"}</small></div><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void request("PATCH", { action: "update_member", memberId: member.id, role: data.get("role"), status: data.get("status") }, `member:${member.id}`, "Team member updated."); }}><select name="role" defaultValue={member.role}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select name="status" defaultValue={member.status === "active" ? "active" : "suspended"}><option value="active">Active</option><option value="suspended">Suspended</option></select><button disabled={busy === `member:${member.id}`}>Save</button></form>{member.status === "invited" && <button className="crm-reissue-button" type="button" disabled={busy === `reissue:${member.id}`} onClick={() => void request("POST", { action: "reissue_invite", memberId: member.id }, `reissue:${member.id}`, "A fresh invitation link was created.")}>Create fresh link</button>}</article>) : <div className="crm-empty"><strong>No team members yet</strong><span>Create the first invitation.</span></div>}</section></div>}
    {view === "devices" && <section className="crm-device-centre"><header><div><span>Mobile field security</span><h4>Registered phones and tablets</h4><p>Devices appear here after a team member signs into the future field app. Revoke access immediately if a device is lost, replaced or no longer used.</p></div><aside><strong>{pendingPushEvents}</strong><span>private sync alerts queued</span></aside></header>{devices.length ? <div className="crm-device-list">{devices.map((device) => <article key={device.id} className={device.status === "active" ? "" : "revoked"}><div className="crm-device-icon" aria-hidden="true">{device.platform === "ios" ? "iOS" : "A"}</div><div><strong>{device.deviceName}</strong><span>{device.memberName}{device.memberEmail ? ` | ${device.memberEmail}` : ""}</span><small>{device.platform === "ios" ? "iPhone or iPad" : "Android"} | App {device.appVersion} | Push {device.pushConnected ? "ready" : "not connected"}</small></div><div className="crm-device-activity"><span>{device.status === "active" ? "Active" : "Revoked"}</span><small>{device.lastSeenAt ? `Last used ${new Date(device.lastSeenAt).toLocaleString("en-AU")}` : "Not used yet"}</small></div><button type="button" disabled={busy === `device:${device.id}`} onClick={() => void updateDevice(device.id, device.status === "active" ? "revoke_device" : "authorise_device")}>{busy === `device:${device.id}` ? "Saving..." : device.status === "active" ? "Revoke access" : "Authorise again"}</button></article>)}</div> : <div className="crm-empty"><strong>No field devices registered</strong><span>This is expected until the iOS and Android field app is released and a staff member signs in.</span></div>}<footer><strong>What revocation does</strong><p>Sync, queued actions and file uploads are blocked immediately. The app is instructed to purge its encrypted local job cache. AEA protected contact and address data is never stored on a field device.</p></footer></section>}
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </div>;
}
