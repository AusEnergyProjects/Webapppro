"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { SiteFooter } from "./ComparatorChrome";
import { TLinkHeader } from "./TLinkChrome";
import { InstallerCrmWorkspace } from "./InstallerCrmWorkspace";
import { TradeFieldWorkPanel } from "./TradeFieldWorkPanel";
import { TradeJobFormsPanel } from "./TradeJobFormsPanel";
import { TradeTeamSettings, type TradeTeamPermissions } from "./TradeTeamSettings";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";

type Member = { id: string; displayName: string; status: string };
type Assignee = Member & { capabilities?: string[] };
type Task = { id: string; title: string; dueAt: string; status: string };
type Job = { id: string; workNumber: string; title: string; serviceCategory: string; siteArea: string; stage: string; priority: string; scheduledStart: string; scheduledEnd: string; assigneeMemberId: string; assigneeLabel: string; protectedJob: boolean; serviceAddress: string; tasks: Task[] };
type AssigneeRoster = { page: number; pageSize: number; total: number; totalPages: number; search: string; capability: string };
type WorkRoster = { included: boolean; page: number; pageSize: number; total: number; totalPages: number };
type Result = { ok?: boolean; accepted?: boolean; access?: { businessName: string; displayName: string; memberId: string; isOwner: boolean; permissions: TradeTeamPermissions }; members?: Member[]; assignees?: Assignee[]; assigneeRoster?: AssigneeRoster; work?: WorkRoster; jobs?: Job[]; error?: string };

const stages = [["backlog", "Planning"], ["ready", "Ready"], ["scheduled", "Scheduled"], ["in_progress", "On site"], ["blocked", "Waiting"], ["completed", "Complete"], ["cancelled", "Cancelled"]];

export function TradeTeamPortal() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [data, setData] = useState<Result>({}); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(""); const [status, setStatus] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [portalView, setPortalView] = useState<"work" | "business" | "team">("work");
  const [crmTarget] = useState<TLinkCommandTarget | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [workLoading, setWorkLoading] = useState(false);
  const assigneeRequestRef = useRef(0);

  const loadWork = useCallback(async (requestedCapability = "", throughPage = 1) => {
    if (!user) return {} as Result;
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-team?includeWork=1&workPage=1&workPageSize=50", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok) throw new Error(result.error || "The staff portal could not be opened.");
    const requestedLastPage = Math.min(Math.max(1, throughPage), result.work?.totalPages || 1);
    for (let workPage = 2; workPage <= requestedLastPage; workPage += 1) {
      const pageResponse = await fetch(`/api/trade-team?includeWork=1&workPage=${workPage}&workPageSize=50`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const pageResult = await pageResponse.json().catch(() => ({})) as Result;
      if (!pageResponse.ok) throw new Error(pageResult.error || "Assigned work could not be refreshed.");
      const combined = [...(result.jobs || []), ...(pageResult.jobs || [])];
      result.jobs = combined.filter((job, index) => combined.findIndex((candidate) => candidate.id === job.id) === index);
      result.work = pageResult.work || result.work;
    }
    const capability = requestedCapability || result.jobs?.[0]?.serviceCategory || "";
    if (result.access?.permissions.canAssignJobs && capability) {
      const assigneeParams = new URLSearchParams({ assigneePage: "1", assigneePageSize: "25", assigneeCapability: capability });
      const assigneeResponse = await fetch(`/api/trade-team?${assigneeParams.toString()}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const assigneeResult = await assigneeResponse.json().catch(() => ({})) as Result;
      if (!assigneeResponse.ok) throw new Error(assigneeResult.error || "Available team members could not be loaded.");
      result.assignees = assigneeResult.assignees || [];
      result.assigneeRoster = assigneeResult.assigneeRoster;
    }
    return result;
  }, [user]);

  const loadAssignees = useCallback(async (capability: string, search: string, page = 1, append = false) => {
    if (!user || !capability) return;
    const requestId = assigneeRequestRef.current + 1;
    assigneeRequestRef.current = requestId;
    setAssigneesLoading(true);
    if (!append) setData((current) => ({ ...current, assignees: [], assigneeRoster: undefined }));
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ assigneePage: String(page), assigneePageSize: "25", assigneeCapability: capability });
      if (search.trim()) params.set("assigneeSearch", search.trim());
      const response = await fetch(`/api/trade-team?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(result.error || "Available team members could not be loaded.");
      if (assigneeRequestRef.current !== requestId) return;
      setData((current) => {
        const next = result.assignees || [];
        if (!append) return { ...current, assignees: next, assigneeRoster: result.assigneeRoster };
        const combined = [...(current.assignees || []), ...next];
        return { ...current, assignees: combined.filter((member, index) => combined.findIndex((candidate) => candidate.id === member.id) === index), assigneeRoster: result.assigneeRoster };
      });
    } catch (error) {
      if (assigneeRequestRef.current === requestId) setStatus(error instanceof Error ? error.message : "Available team members could not be loaded.");
    } finally {
      if (assigneeRequestRef.current === requestId) setAssigneesLoading(false);
    }
  }, [user]);

  const loadMoreWork = useCallback(async () => {
    if (!user || workLoading || !data.work || data.work.page >= data.work.totalPages) return;
    setWorkLoading(true);
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ includeWork: "1", workPage: String(data.work.page + 1), workPageSize: String(data.work.pageSize) });
      const response = await fetch(`/api/trade-team?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(result.error || "More assigned work could not be loaded.");
      setData((current) => {
        const combined = [...(current.jobs || []), ...(result.jobs || [])];
        return { ...current, jobs: combined.filter((job, index) => combined.findIndex((candidate) => candidate.id === job.id) === index), work: result.work || current.work };
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "More assigned work could not be loaded.");
    } finally {
      setWorkLoading(false);
    }
  }, [data.work, user, workLoading]);

  useEffect(() => onAuthStateChanged(firebaseAuth, (next) => { setUser(next); setAuthReady(true); }), []);
  useEffect(() => {
    if (!user) return; let active = true;
    const frame = window.requestAnimationFrame(() => {
      setLoading(true); const invite = new URLSearchParams(window.location.search).get("invite") || "";
      void (async () => {
        if (invite) {
          const token = await user.getIdToken();
          const response = await fetch("/api/trade-team", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "accept_invite", token: invite }) });
          const accepted = await response.json().catch(() => ({})) as Result;
          if (!response.ok && !accepted.access) throw new Error(accepted.error || "The team invitation could not be accepted.");
        }
        const result = await loadWork();
        if (active) { setData(result); setSelectedJobId((current) => current || result.jobs?.[0]?.id || ""); if (invite) window.history.replaceState({}, "", "/direct-trade/team"); }
      })().catch((error) => active && setStatus(error instanceof Error ? error.message : "The staff portal could not be opened."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [loadWork, user]);

  async function google() { setBusy("auth"); setStatus("Opening Google sign-in..."); try { const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" }); await signInWithPopup(firebaseAuth, provider); } catch { setStatus("Google sign-in could not be completed."); } finally { setBusy(""); } }
  async function emailAuth(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy("auth"); setStatus(mode === "create" ? "Creating your team login..." : "Signing in..."); try { if (mode === "create") { const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password); await updateProfile(credential.user, { displayName: name.trim() }); } else await signInWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password); setPassword(""); } catch { setStatus("Check the email and password, then try again."); } finally { setBusy(""); } }
  async function reset() { if (!email.trim()) { setStatus("Enter your email first."); return; } await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase()).then(() => setStatus("Password reset instructions sent.")).catch(() => setStatus("Password reset could not be sent.")); }
  async function update(body: Record<string, unknown>, key: string, success: string) { if (!user) return; setBusy(key); try { const token = await user.getIdToken(); const response = await fetch("/api/trade-team", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); const result = await response.json().catch(() => ({})) as Result; if (!response.ok) throw new Error(result.error || "The update could not be saved."); const selectedCapability = data.jobs?.find((job) => job.id === selectedJobId)?.serviceCategory || ""; const refreshed = await loadWork(selectedCapability, data.work?.page || 1); setData(refreshed); setSelectedJobId((current) => refreshed.jobs?.some((job) => job.id === current) ? current : refreshed.jobs?.[0]?.id || ""); setStatus(success); } catch (error) { setStatus(error instanceof Error ? error.message : "The update could not be saved."); } finally { setBusy(""); } }

  const permissions = data.access?.permissions;
  const jobs = useMemo(() => data.jobs || [], [data.jobs]); const selectedJob = jobs.find((job) => job.id === selectedJobId) || null;
  const todayJobs = useMemo(() => jobs.filter((job) => job.scheduledStart.slice(0, 10) === new Date().toISOString().slice(0, 10)), [jobs]);
  const businessToolsAvailable = Boolean(permissions && (
    permissions.canCreateJobs || permissions.canManageJobs || permissions.canSearchCustomers
    || permissions.canViewCustomers || permissions.canViewQuotes || permissions.canViewPriceBook
    || permissions.canRunReports || permissions.scheduleScope
  ));

  return <main className="wrap trade-team-page"><TLinkHeader active="team" />
    {!authReady ? <section className="dashboard-state-card"><p>Opening the secure staff portal...</p></section> : !user ? <section className="team-auth-shell"><div className="team-auth-intro"><span>TLink installer team access</span><h1>Your workday, without the office clutter</h1><p>Use the email address your employer invited. Your workspace shows only the jobs, customers and business tools your saved access permits.</p></div><div className="team-auth-card"><button className="customer-google-button" type="button" onClick={() => void google()} disabled={busy === "auth"}>Continue with Google</button><div className="customer-auth-tabs"><button type="button" className={mode === "signin" ? "selected" : ""} onClick={() => setMode("signin")}>Sign in</button><button type="button" className={mode === "create" ? "selected" : ""} onClick={() => setMode("create")}>Create login</button></div><form onSubmit={emailAuth}>{mode === "create" && <label><span>Your name</span><input value={name} required onChange={(event) => setName(event.target.value)} /></label>}<label><span>Invited email</span><input type="email" value={email} required onChange={(event) => setEmail(event.target.value)} /></label><label><span>Password</span><input type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="btn" disabled={busy === "auth"}>{busy === "auth" ? "Please wait..." : mode === "create" ? "Create team login" : "Sign in"}</button>{mode === "signin" && <button className="customer-reset-link" type="button" onClick={() => void reset()}>Reset password</button>}</form>{status && <p role="status">{status}</p>}</div></section> : loading ? <section className="dashboard-state-card"><p>Loading assigned work...</p></section> : !data.access ? <section className="dashboard-state-card"><span>Team access required</span><h1>This login is not connected to an active installer team</h1><p>{status || "Open the invitation link from your employer, or ask them to create a fresh link."}</p><button className="btn" type="button" onClick={() => void signOut(firebaseAuth)}>Use another account</button></section> : <>
      <header className="team-portal-hero"><div><span>Team portal</span><h1>{data.access.businessName}</h1><p>Welcome, {data.access.displayName}. {permissions?.jobScope === "own" ? "Only work assigned to you is visible. Customer details are limited to assigned jobs." : "Coordinate the active work queue from one place."}</p></div><div><strong>{todayJobs.length}</strong><span>jobs today</span><button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></div></header>
      <nav className="crm-nav" aria-label="Staff workspace">
        <button type="button" className={portalView === "work" ? "active" : ""} aria-current={portalView === "work" ? "page" : undefined} onClick={() => setPortalView("work")}>Assigned work</button>
        {businessToolsAvailable && <button type="button" className={portalView === "business" ? "active" : ""} aria-current={portalView === "business" ? "page" : undefined} onClick={() => setPortalView("business")}>Business tools</button>}
        {permissions?.canManageTeam && <button type="button" className={portalView === "team" ? "active" : ""} aria-current={portalView === "team" ? "page" : undefined} onClick={() => setPortalView("team")}>Team</button>}
      </nav>
      {portalView === "work" && <><section className="team-queue-summary"><article><span>Assigned work</span><strong>{jobs.filter((job) => !["completed", "cancelled"].includes(job.stage)).length}</strong></article><article><span>Today</span><strong>{todayJobs.length}</strong></article><article><span>Waiting</span><strong>{jobs.filter((job) => job.stage === "blocked").length}</strong></article><article><span>Open tasks</span><strong>{jobs.flatMap((job) => job.tasks).filter((task) => task.status !== "done").length}</strong></article></section>
      <div className="team-queue-layout"><aside className="team-job-queue"><header><strong>Work queue</strong><span>{jobs.length}{data.work?.total ? ` of ${data.work.total}` : ""} visible</span></header>{jobs.length ? jobs.map((job) => <button type="button" key={job.id} className={selectedJobId === job.id ? "active" : ""} onClick={() => { setSelectedJobId(job.id); setAssigneeSearch(""); if (permissions?.canAssignJobs) void loadAssignees(job.serviceCategory, ""); }}><span>{job.workNumber}<b>{job.priority}</b></span><strong>{job.title}</strong><small>{job.scheduledStart || "Not scheduled"} | {job.assigneeLabel || "Unassigned"}</small></button>) : <div className="crm-empty"><strong>No work assigned</strong><span>Your dispatcher can assign the next job.</span></div>}{data.work && data.work.page < data.work.totalPages && <button type="button" disabled={workLoading} onClick={() => void loadMoreWork()}>{workLoading ? "Loading more work..." : "Load more work"}</button>}</aside><section className="team-job-focus">{selectedJob ? <article><header><div><span>{selectedJob.workNumber}</span><h2>{selectedJob.title}</h2><p>{selectedJob.protectedJob ? `${selectedJob.siteArea || "Service region"}. Australian Energy Assessments protected job, no customer identity or street address.` : selectedJob.serviceAddress || "Direct customer address has not been added."}</p></div><label><span>Job stage</span><select value={selectedJob.stage} disabled={!permissions?.canManageJobs || busy === `job:${selectedJob.id}`} onChange={(event) => void update({ action: "update_job", workOrderId: selectedJob.id, stage: event.target.value }, `job:${selectedJob.id}`, "Job stage updated.")}>{stages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></header>{permissions?.canAssignJobs && <section className="team-portal-assignment" aria-label="Assign this job"><label><span>Assigned technician</span><select value={selectedJob.assigneeMemberId} disabled={busy === `assign:${selectedJob.id}` || assigneesLoading} onChange={(event) => void update({ action: "assign_job", workOrderId: selectedJob.id, memberId: event.target.value }, `assign:${selectedJob.id}`, "Assignment updated.")}><option value="">Unassigned</option>{selectedJob.assigneeMemberId && !(data.assignees || []).some((member) => member.id === selectedJob.assigneeMemberId) && <option value={selectedJob.assigneeMemberId}>{selectedJob.assigneeLabel || "Current assignee"}</option>}{(data.assignees || []).map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><form onSubmit={(event) => { event.preventDefault(); void loadAssignees(selectedJob.serviceCategory, assigneeSearch); }}><label><span>Find an active teammate</span><input type="search" value={assigneeSearch} onChange={(event) => setAssigneeSearch(event.target.value)} placeholder="Search by name" /></label><button type="submit" disabled={assigneesLoading}>{assigneesLoading ? "Searching..." : "Search"}</button></form>{data.assigneeRoster && data.assigneeRoster.page < data.assigneeRoster.totalPages && <button type="button" disabled={assigneesLoading} onClick={() => void loadAssignees(selectedJob.serviceCategory, data.assigneeRoster?.search || "", data.assigneeRoster!.page + 1, true)}>{assigneesLoading ? "Loading..." : "Load more team members"}</button>}<small>{permissions.jobScope === "own" ? "You can hand your assigned job to an active teammate. You cannot open or reassign someone else's work." : "Choose an active teammate who provides this service."}</small></section>}<section className="team-mobile-checklist"><h3>Job checklist</h3>{selectedJob.tasks.length ? selectedJob.tasks.map((task) => <label key={task.id}><input type="checkbox" checked={task.status === "done"} disabled={!permissions?.canManageJobs || busy === `task:${task.id}`} onChange={(event) => void update({ action: "update_task", taskId: task.id, status: event.target.checked ? "done" : "pending" }, `task:${task.id}`, event.target.checked ? "Task completed." : "Task reopened.")} /><span>{task.title}<small>{task.dueAt ? `Due ${task.dueAt}` : "No due date"}</small></span></label>) : <div className="crm-empty"><strong>No checklist yet</strong><span>The office can add task steps from the CRM.</span></div>}</section>{permissions?.canViewFieldEvidence && <section className="team-field-tools"><h3>Field record</h3><TradeFieldWorkPanel user={user} workOrderId={selectedJob.id} isProtected={selectedJob.protectedJob} readOnly={!permissions.canManageFieldEvidence} /></section>}{permissions?.canViewFieldEvidence && <section className="team-field-tools"><h3>Field forms</h3><TradeJobFormsPanel user={user} workOrderId={selectedJob.id} readOnly={!permissions.canManageFieldEvidence} /></section>}</article> : <div className="crm-empty"><strong>Select a job</strong><span>Its work details will open here.</span></div>}</section></div></>}
      {portalView === "business" && businessToolsAvailable && <InstallerCrmWorkspace user={user} teamAccess={Boolean(permissions?.canManageTeam)} staffPermissions={permissions} navigationTarget={crmTarget} />}
      {portalView === "team" && permissions?.canManageTeam && <section className="team-field-tools" aria-label="Team management"><TradeTeamSettings user={user} /></section>}
      {status && <p className="crm-status" role="status">{status}</p>}
    </>}<SiteFooter>Team access is controlled by the installer business. Australian Energy Assessments protected customer identity and contact details remain unavailable.</SiteFooter></main>;
}
