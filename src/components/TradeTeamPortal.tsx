"use client";

import TradeTeamPresence from "./TradeTeamPresence";

import { TradeBusinessGate, useTradeBusinessFetch } from "./TradeBusinessProvider";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserPopupRedirectResolver, createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, reload, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { requestTLinkPasswordReset, tlinkPasswordResetErrorMessage } from "@/lib/tlink-password-reset-client";
import { disableTradeDeviceNotifications } from "@/lib/trade-notification-client";
import { FirebaseAccountSecurity, FirebaseMfaChallenge, useFirebaseMfaChallenge } from "./FirebaseMfa";
import { SiteFooter } from "./ComparatorChrome";
import { TLinkHeader } from "./TLinkChrome";
import { InstallerCrmWorkspace } from "./InstallerCrmWorkspace";
import { TradeFieldWorkPanel } from "./TradeFieldWorkPanel";
import { TradeJobFormsPanel } from "./TradeJobFormsPanel";
import { TradeTeamSettings, type TradeTeamPermissions } from "./TradeTeamSettings";
import dynamic from "next/dynamic";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";
import { teamAuthErrorCode, teamAuthErrorMessage } from "./trade-team-auth-errors";
import { saveTradeBusinessSelection } from "@/lib/trade-business-client";

const TradeTrainingWorkspace = dynamic(() => import("./TradeTrainingWorkspace").then((module) => module.TradeTrainingWorkspace), { loading: () => <p role="status">Loading activity training...</p> });
const TradeMessagesWorkspace = dynamic(() => import("./TradeMessagesWorkspace").then(module => module.TradeMessagesWorkspace));
import { TradeTeamCallProvider } from "./TradeTeamCallProvider";
import { TradeMessageAlerts, TradeMessageUnreadBadge } from "./TradeMessageAlerts";

type Member = { id: string; displayName: string; status: string };
type Assignee = Member & { capabilities?: string[] };
type Task = { id: string; title: string; dueAt: string; status: string };
type Job = { id: string; workNumber: string; title: string; serviceCategory: string; siteArea: string; stage: string; priority: string; scheduledStart: string; scheduledEnd: string; assigneeMemberId: string; assigneeLabel: string; protectedJob: boolean; serviceAddress: string; tasks: Task[] };
type AssigneeRoster = { page: number; pageSize: number; total: number; totalPages: number; search: string; capability: string };
type WorkRoster = { included: boolean; page: number; pageSize: number; total: number; totalPages: number };
type Result = { ownerUid?: string; businessName?: string; code?: string; ok?: boolean; accepted?: boolean; access?: { businessName: string; displayName: string; memberId: string; isOwner: boolean; permissions: TradeTeamPermissions }; members?: Member[]; assignees?: Assignee[]; assigneeRoster?: AssigneeRoster; work?: WorkRoster; jobs?: Job[]; error?: string };
type Invitation = { email: string; displayName: string; businessName: string; expiresAt: string };

const stages = [["backlog", "Planning"], ["ready", "Ready"], ["scheduled", "Scheduled"], ["in_progress", "On site"], ["blocked", "Waiting"], ["completed", "Complete"], ["cancelled", "Cancelled"]];

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />{visible && <path d="m3 3 18 18" />}</svg>;
}

export function TradeTeamPortal() {
  const [invitationEntry, setInvitationEntry] = useState<boolean | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setInvitationEntry(new URLSearchParams(window.location.search).has("invite")));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  if (invitationEntry === null) return <p role="status">Opening TLink...</p>;
  if (invitationEntry) return <TradeTeamPortalContent onInvitationAccepted={() => setInvitationEntry(false)} />;
  return <TradeBusinessGate destination="member"><TradeTeamPortalContent /></TradeBusinessGate>;
}

function TradeTeamPortalContent({ onInvitationAccepted }: { onInvitationAccepted?: () => void }) {
  const fetch = useTradeBusinessFetch();
  const { resolver, captureMfaError, clearMfaChallenge } = useFirebaseMfaChallenge();
  const [mfaRequired, setMfaRequired] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [messageTarget, setMessageTarget] = useState({ id: "", revision: 0 });
  const [authReady, setAuthReady] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [invitationReady, setInvitationReady] = useState(false);
  const [invitationError, setInvitationError] = useState("");
  const [invitationInvalid, setInvitationInvalid] = useState(false);
  const [invitationAttempt, setInvitationAttempt] = useState(0);
  const [authDelayed, setAuthDelayed] = useState(false);
  const [authRevision, setAuthRevision] = useState(0);
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [existingAccount, setExistingAccount] = useState(false);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<Result>({}); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(""); const [status, setStatus] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const clearPasswordFields = useCallback(() => {
    setPassword(""); setConfirmPassword(""); setShowPassword(false); setShowConfirmPassword(false); setPasswordMismatch(false);
  }, []);
  async function leaveAccount() {
    try {
      await disableTradeDeviceNotifications(async ():Promise<Record<string,string>> => user ? {Authorization: `Bearer ${await user.getIdToken()}`} : {}, fetch);
      await signOut(firebaseAuth);
      setData({}); setStatus(""); clearPasswordFields();
    } catch (failure) { setStatus(failure instanceof Error ? failure.message : "Sign out could not be completed. Try again."); }
  }
  const [portalView, setPortalView] = useState<"work" | "business" | "team" | "training" | "messages">("work");
  const [crmTarget, setCrmTarget] = useState<TLinkCommandTarget | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [workLoading, setWorkLoading] = useState(false);
  const assigneeRequestRef = useRef(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      const invite = new URLSearchParams(window.location.search).get("invite") || "";
      setInviteToken(invite);
      setInvitationReady(false);
      setInvitationError("");
      setInvitationInvalid(false);
      if (!invite) { setInvitation(null); setInvitationReady(true); return; }
      const loadInvitation = async () => {
        const url = `/api/trade-team/invitation?invite=${encodeURIComponent(invite)}`;
        // Public invitations must open without waiting for Firebase's mobile sign-in restoration.
        let response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (response.status === 410 && user) {
          // A previously accepted link can still be reopened by its bound account.
          const token = await user.getIdToken();
          if (controller.signal.aborted) throw new Error("INVITATION_CONNECTION");
          response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
        }
        if (response.status === 410) throw new Error("INVITATION_INVALID");
        if (!response.ok) throw new Error("INVITATION_CONNECTION");
        const result = await response.json() as { invitation?: Invitation };
        if (!result.invitation) throw new Error("INVITATION_CONNECTION");
        return result;
      };
      const deadline = new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => { controller.abort(); reject(new Error("INVITATION_CONNECTION")); }, 10_000);
      });
      void Promise.race([loadInvitation(), deadline]).then(result => {
        if (active && result.invitation) {
          setInvitation(result.invitation); setEmail(result.invitation.email); setName(result.invitation.displayName);
          setMode(new URLSearchParams(window.location.search).get("auth") === "signin" ? "signin" : "create"); clearPasswordFields();
        }
      }).catch(error => {
        if (active) {
          const invalid = error instanceof Error && error.message === "INVITATION_INVALID";
          setInvitation(null); setInvitationInvalid(invalid);
          setInvitationError(invalid
            ? "This link has expired or been replaced. Open the newest TLink invitation email and press Join team."
            : "We could not load your invitation. Check your connection and try again.");
        }
      }).finally(() => { window.clearTimeout(timeout); if (active) setInvitationReady(true); });
    });
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); window.cancelAnimationFrame(frame); };
  }, [fetch, clearPasswordFields, user, invitationAttempt]);

  const refreshVerification = useCallback(async (showStatus = false) => {
    if (!user) return;
    try {
      await reload(user);
      if (user.emailVerified) {
        await user.getIdToken(true);
        setEmailVerified(true); setStatus("Email confirmed. Opening your team...");
      } else if (showStatus) setStatus("Open the verification email and confirm your email address, then return here.");
    } catch (error) { if (showStatus) setStatus(teamAuthErrorMessage(error)); }
  }, [user]);

  useEffect(() => {
    if (!user || emailVerified) return;
    const check = () => { if (document.visibilityState === "visible") void refreshVerification(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [emailVerified, refreshVerification, user]);

  useEffect(() => {
    const applyTrainingLink = () => {
      const workspace = new URLSearchParams(window.location.search).get("workspace");
      if (workspace === "training" || workspace === "messages") setPortalView(workspace);
    };
    applyTrainingLink();
    window.addEventListener("popstate", applyTrainingLink);
    return () => window.removeEventListener("popstate", applyTrainingLink);
  }, []);

  const loadWork = useCallback(async (requestedCapability = "", throughPage = 1) => {
    if (!user) return {} as Result;
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-team?includeWork=1&workPage=1&workPageSize=50", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as Result;
    if (result.code === "MFA_REQUIRED") setMfaRequired(true);
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
  }, [fetch, user]);

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
  }, [fetch, user]);

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
  }, [fetch, data.work, user, workLoading]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setAuthDelayed(true), 10_000);
    const unsubscribe = onAuthStateChanged(firebaseAuth, (next) => {
      window.clearTimeout(timeout); setAuthDelayed(false);
      setUser(next); setData({}); setEmailVerified(Boolean(next?.emailVerified)); setAuthReady(true); if (!next) setMfaRequired(false);
    }, () => { window.clearTimeout(timeout); setAuthDelayed(true); });
    return () => { window.clearTimeout(timeout); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!user || !emailVerified || !invitationReady || invitationError) return;
    if (invitation && user.email?.toLowerCase() !== invitation.email.toLowerCase()) return;
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      setLoading(true); const invite = inviteToken;
      void (async () => {
        if (invite) {
          const token = await user.getIdToken(true);
          const response = await fetch("/api/trade-team", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "accept_invite", token: invite }) });
          const accepted = await response.json().catch(() => ({})) as Result;
          if (accepted.code === "MFA_REQUIRED") setMfaRequired(true);
          if (!response.ok && !accepted.access) throw new Error(accepted.error || "The team invitation could not be accepted.");
          if (accepted.ownerUid && onInvitationAccepted) {
            saveTradeBusinessSelection(user.uid, accepted.ownerUid);
            window.history.replaceState({}, "", "/direct-trade/team");
            if (active) onInvitationAccepted();
            return;
          }
        }
        const result = await loadWork();
        if (active) { setData(result); setStatus(""); setSelectedJobId((current) => current || result.jobs?.[0]?.id || ""); if (invite) window.history.replaceState({}, "", "/direct-trade/team"); }
      })().catch((error) => active && setStatus(error instanceof Error ? error.message : "The staff portal could not be opened."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [fetch, authRevision, emailVerified, invitation, invitationError, invitationReady, inviteToken, loadWork, onInvitationAccepted, user]);

  function emailActionSettings() {
    const url = new URL("/direct-trade/team", window.location.origin);
    if (inviteToken) url.searchParams.set("invite", inviteToken);
    url.searchParams.set("auth", "signin");
    return { url: url.toString() };
  }
  async function sendVerification(account: User) {
    try {
      await sendEmailVerification(account, emailActionSettings());
      setStatus(`We sent a verification email to ${account.email}. Open it and confirm your email to join your team.`);
    } catch (error) {
      setStatus(`Your login is saved, but the verification email could not be sent. ${teamAuthErrorMessage(error)} Use Resend verification email below.`);
    }
  }
  async function google() { setBusy("auth"); setStatus("Opening Google sign-in..."); try { const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account", ...(invitation ? { login_hint: invitation.email } : {}) }); await signInWithPopup(firebaseAuth, provider, browserPopupRedirectResolver); clearPasswordFields(); } catch (error) { if (!captureMfaError(error)) setStatus(teamAuthErrorMessage(error)); } finally { setBusy(""); } }
  async function emailAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "create" && password !== confirmPassword) {
      setPasswordMismatch(true); setStatus("Your passwords do not match. Enter the same password in both fields."); confirmPasswordRef.current?.focus(); return;
    }
    setPasswordMismatch(false); setBusy("auth"); setStatus(mode === "create" ? "Creating your team login..." : "Signing in...");
    try {
      if (mode === "create") {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
        await sendVerification(credential.user);
      } else await signInWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password);
      clearPasswordFields();
    } catch (error) {
      if (teamAuthErrorCode(error) === "auth/email-already-in-use") {
        setExistingAccount(true); clearPasswordFields(); setStatus(""); return;
      }
      if (!captureMfaError(error)) setStatus(teamAuthErrorMessage(error));
    } finally { setBusy(""); }
  }
  async function reset() {
    const recipient = email.trim().toLowerCase();
    if (!recipient) { setStatus("Enter your email first."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) { setStatus("Enter a valid email address before resetting your password."); return; }
    setBusy("reset"); setStatus(`Requesting a password reset for ${recipient}...`);
    try {
      await requestTLinkPasswordReset(recipient, emailActionSettings().url);
      setStatus(`Password reset request accepted for ${recipient}. If this email has a login, look for “Reset your TLink password” from TLink and press Reset password in the email. Check Inbox and Spam. You can also use Continue with Google if that is how you joined.`);
    }
    catch (error) { setStatus(`We could not confirm the password reset request. ${tlinkPasswordResetErrorMessage(error)}`); }
    finally { setBusy(""); }
  }
  async function update(body: Record<string, unknown>, key: string, success: string) { if (!user) return; setBusy(key); try { const token = await user.getIdToken(); const response = await fetch("/api/trade-team", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); const result = await response.json().catch(() => ({})) as Result; if (!response.ok) throw new Error(result.error || "The update could not be saved."); const selectedCapability = data.jobs?.find((job) => job.id === selectedJobId)?.serviceCategory || ""; const refreshed = await loadWork(selectedCapability, data.work?.page || 1); setData(refreshed); setSelectedJobId((current) => refreshed.jobs?.some((job) => job.id === current) ? current : refreshed.jobs?.[0]?.id || ""); setStatus(success); } catch (error) { setStatus(error instanceof Error ? error.message : "The update could not be saved."); } finally { setBusy(""); } }

  const permissions = data.access?.permissions;
  const jobs = useMemo(() => data.jobs || [], [data.jobs]); const selectedJob = jobs.find((job) => job.id === selectedJobId) || null;
  const todayJobs = useMemo(() => jobs.filter((job) => job.scheduledStart.slice(0, 10) === new Date().toISOString().slice(0, 10)), [jobs]);
  const businessToolsAvailable = Boolean(permissions && (
    permissions.canCreateJobs || permissions.canManageJobs || permissions.canSearchCustomers
    || permissions.canViewCustomers || permissions.canViewQuotes || permissions.canViewPriceBook
    || permissions.canRunReports || permissions.scheduleScope
  ));

  if (resolver) return <main className="wrap trade-team-page"><TLinkHeader active="team" /><FirebaseMfaChallenge resolver={resolver} onCancel={clearMfaChallenge} onComplete={clearMfaChallenge} /></main>;
  if (user && mfaRequired) return <main className="wrap trade-team-page"><TLinkHeader active="team" /><FirebaseAccountSecurity key={user.uid} user={user} onComplete={async () => { setMfaRequired(false); setAuthRevision(current => current + 1); }} /><button type="button" onClick={() => void leaveAccount()}>Sign out</button></main>;

  return <TradeMessageAlerts user={user} enabled={Boolean(data.access)} onOpen={threadId => { setMessageTarget(current => ({ id: threadId, revision: current.revision + 1 })); setPortalView("messages"); }}><TradeTeamCallProvider user={user} enabled={Boolean(data.access)}><main className="wrap trade-team-page"><TLinkHeader active="team" />
    {!invitationReady ? <section className="dashboard-state-card"><p role="status">Opening your invitation...</p></section>
      : invitationError ? <section className="dashboard-state-card"><h1>{invitationInvalid ? "Use your newest invitation" : "Let's try that again"}</h1><p role="alert">{invitationError}</p>{invitationInvalid ? <><p>Look for the most recent email titled &ldquo;You&apos;re invited to ... on TLink&rdquo;. Earlier invitation and password-reset links may refer to the old invitation.</p><p>Your business can also send you the current link from Team &gt; Copy invitation link.</p><a className="btn" href="/direct-trade/team">Already joined? Sign in</a></> : <button className="btn" type="button" onClick={() => setInvitationAttempt(current => current + 1)}>Try again</button>}</section>
      : !authReady ? <section className="dashboard-state-card"><h1>{invitation ? "Your invitation is ready" : "Opening TLink"}</h1><p role="status">{authDelayed ? "Sign-in is taking longer than expected. Check your connection and try again." : "Checking your sign-in..."}</p>{authDelayed && <button className="btn" type="button" onClick={() => window.location.reload()}>Try again</button>}</section>
      : user && invitation && user.email?.toLowerCase() !== invitation.email.toLowerCase() ? <section className="dashboard-state-card"><h1>This invitation is for {invitation.displayName}</h1><p>Use {invitation.email} to join {invitation.businessName}. You are currently signed in as {user.email}.</p><button className="btn" type="button" onClick={() => void leaveAccount()}>Use invited email</button></section>
      : !user ? <section className="team-auth-shell">
        <div className="team-auth-intro"><span>TLink team invitation</span><h1>{invitation ? `Join ${invitation.businessName}` : "Welcome to your team"}</h1><p>{invitation ? `${invitation.displayName}, your access is ready. Continue with Google using ${invitation.email}, or use your TLink email login below.` : "Sign in with the email your business invited. Your saved permissions control the jobs and tools you can use."}</p></div>
        <div className="team-auth-card">
          <button className="customer-google-button" type="button" onClick={() => void google()} disabled={Boolean(busy)}>Continue with Google</button>
          {existingAccount ? <section aria-labelledby="team-existing-login">
            <h2 id="team-existing-login">You already have a TLink login</h2>
            <p><strong>The new password you entered was not saved.</strong></p>
            <p>Continue with Google above using <strong>{email}</strong>. To use a password instead, request a reset link and set it from the email.</p>
            <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void reset()}>{busy === "reset" ? "Requesting reset..." : "Email me a password reset link"}</button>
            <button className="customer-reset-link" type="button" disabled={Boolean(busy)} onClick={() => { setExistingAccount(false); setMode("signin"); setStatus(""); clearPasswordFields(); }}>I know my existing password</button>
          </section> : <form onSubmit={emailAuth}>
            <h2>{mode === "create" ? "Set your new password" : "Sign in to your team"}</h2>
            {mode === "create" && !invitation && <label><span>Your name</span><input value={name} autoComplete="name" required onChange={(event) => setName(event.target.value)} /></label>}
            <label><span>Invited email</span><input type="email" autoComplete="email" value={email} readOnly={Boolean(invitation)} required onChange={(event) => setEmail(event.target.value)} /></label>
            <label htmlFor="team-auth-password"><span>{mode === "create" ? "New password" : "Password"}</span><span className="team-auth-password-control"><input id="team-auth-password" type={showPassword ? "text" : "password"} autoComplete={mode === "create" ? "new-password" : "current-password"} minLength={mode === "create" ? 8 : undefined} required value={password} onChange={(event) => { setPassword(event.target.value); setPasswordMismatch(false); }} /><button className="team-auth-password-visibility" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} aria-controls="team-auth-password" onClick={() => setShowPassword(current => !current)}><PasswordVisibilityIcon visible={showPassword} /></button></span>{mode === "create" && <small>Use at least 8 characters. This is the password you will use to sign in.</small>}</label>
            {mode === "create" && <label htmlFor="team-auth-confirm-password"><span>Confirm new password</span><span className="team-auth-password-control"><input id="team-auth-confirm-password" ref={confirmPasswordRef} type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={confirmPassword} aria-invalid={passwordMismatch} aria-describedby={passwordMismatch ? "team-auth-password-error" : undefined} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordMismatch(false); }} /><button className="team-auth-password-visibility" type="button" aria-label={showConfirmPassword ? "Hide confirmed password" : "Show confirmed password"} aria-pressed={showConfirmPassword} aria-controls="team-auth-confirm-password" onClick={() => setShowConfirmPassword(current => !current)}><PasswordVisibilityIcon visible={showConfirmPassword} /></button></span>{passwordMismatch && <small id="team-auth-password-error" role="alert">Your passwords do not match. Enter the same password in both fields.</small>}</label>}
            <button className="btn" disabled={Boolean(busy)}>{busy === "auth" ? "Please wait..." : mode === "create" ? "Join team" : "Sign in"}</button>
            <button className="customer-reset-link" type="button" disabled={Boolean(busy)} onClick={() => void reset()}>{busy === "reset" ? "Requesting reset..." : "Reset password"}</button>
          </form>}
          {status && <p role="status">{status}</p>}
          {!existingAccount && <button className="customer-reset-link" type="button" disabled={Boolean(busy)} onClick={() => { setMode(mode === "create" ? "signin" : "create"); setStatus(""); clearPasswordFields(); }}>{mode === "create" ? "Already have a login? Sign in" : "First time here? Set up your login"}</button>}
        </div>
      </section>
      : !emailVerified ? <section className="team-auth-shell"><div className="team-auth-intro"><span>One final step</span><h1>Confirm your email</h1><p>Your login is ready. Confirm that {user.email} is yours to open your team&apos;s workspace.</p></div><div className="team-auth-card"><h2>Check your inbox</h2><p>Open the verification email, tap the link and return here. Your team&apos;s saved access will then open automatically.</p>{status && <p role="status">{status}</p>}<button className="btn" type="button" disabled={Boolean(busy)} onClick={async () => { setBusy("verify"); await refreshVerification(true); setBusy(""); }}>{busy === "verify" ? "Checking..." : "I've verified my email"}</button><button className="customer-reset-link" type="button" disabled={Boolean(busy)} onClick={async () => { setBusy("verification-email"); await sendVerification(user); setBusy(""); }}>{busy === "verification-email" ? "Sending..." : "Resend verification email"}</button><button className="customer-reset-link" type="button" onClick={() => void leaveAccount()}>Use another account</button></div></section>
      : loading ? <section className="dashboard-state-card"><p>Loading assigned work...</p></section>
      : !data.access ? <section className="dashboard-state-card"><span>Team access</span><h1>Opening your team</h1><p>{status || "Checking your saved access..."}</p><button className="btn" type="button" onClick={() => void leaveAccount()}>Use another account</button></section> : <>
      <header className="team-portal-hero"><div><span>Team portal</span><h1>{data.access.businessName}</h1><p>Welcome, {data.access.displayName}. {permissions?.jobScope === "own" ? "Only work assigned to you is visible. Customer details are limited to assigned jobs." : "Coordinate the active work queue from one place."}</p></div><div><strong>{todayJobs.length}</strong><span>jobs today</span><button type="button" onClick={() => void leaveAccount()}>Sign out</button></div></header>
      <TradeTeamPresence key={user.uid} getAuthHeaders={async () => ({ Authorization: `Bearer ${await user.getIdToken()}` })} />
      <nav className="crm-nav" aria-label="Staff workspace">
        <button type="button" className={portalView === "work" ? "active" : ""} aria-current={portalView === "work" ? "page" : undefined} onClick={() => setPortalView("work")}>Assigned work</button>
        <button type="button" className={portalView === "training" ? "active" : ""} aria-current={portalView === "training" ? "page" : undefined} onClick={() => setPortalView("training")}>My to do &amp; training</button>
        {businessToolsAvailable && <button type="button" className={portalView === "business" ? "active" : ""} aria-current={portalView === "business" ? "page" : undefined} onClick={() => setPortalView("business")}>Business tools</button>}
        <button type="button" className={portalView === "messages" ? "active" : ""} aria-current={portalView === "messages" ? "page" : undefined} onClick={() => setPortalView("messages")}>Messages <TradeMessageUnreadBadge /></button>
        {permissions?.canManageTeam && <button type="button" className={portalView === "team" ? "active" : ""} aria-current={portalView === "team" ? "page" : undefined} onClick={() => setPortalView("team")}>Team</button>}
      </nav>
      {portalView === "work" && <><section className="team-queue-summary"><article><span>Assigned work</span><strong>{jobs.filter((job) => !["completed", "cancelled"].includes(job.stage)).length}</strong></article><article><span>Today</span><strong>{todayJobs.length}</strong></article><article><span>Waiting</span><strong>{jobs.filter((job) => job.stage === "blocked").length}</strong></article><article><span>Open tasks</span><strong>{jobs.flatMap((job) => job.tasks).filter((task) => task.status !== "done").length}</strong></article></section>
      <div className="team-queue-layout"><aside className="team-job-queue"><header><strong>Work queue</strong><span>{jobs.length}{data.work?.total ? ` of ${data.work.total}` : ""} visible</span></header>{jobs.length ? jobs.map((job) => <button type="button" key={job.id} className={selectedJobId === job.id ? "active" : ""} onClick={() => { setSelectedJobId(job.id); setAssigneeSearch(""); if (permissions?.canAssignJobs) void loadAssignees(job.serviceCategory, ""); }}><span>{job.workNumber}<b>{job.priority}</b></span><strong>{job.title}</strong><small>{job.scheduledStart || "Not scheduled"} | {job.assigneeLabel || "Unassigned"}</small></button>) : <div className="crm-empty"><strong>No work assigned</strong><span>Your dispatcher can assign the next job.</span></div>}{data.work && data.work.page < data.work.totalPages && <button type="button" disabled={workLoading} onClick={() => void loadMoreWork()}>{workLoading ? "Loading more work..." : "Load more work"}</button>}</aside><section className="team-job-focus">{selectedJob ? <article><header><div><span>{selectedJob.workNumber}</span><h2>{selectedJob.title}</h2><p>{selectedJob.protectedJob ? `${selectedJob.siteArea || "Service region"}. Australian Energy Assessments protected job, no customer identity or street address.` : selectedJob.serviceAddress || "Direct customer address has not been added."}</p></div><label><span>Job stage</span><select value={selectedJob.stage} disabled={!permissions?.canManageJobs || busy === `job:${selectedJob.id}`} onChange={(event) => void update({ action: "update_job", workOrderId: selectedJob.id, stage: event.target.value }, `job:${selectedJob.id}`, "Job stage updated.")}>{stages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></header>{permissions?.canAssignJobs && <section className="team-portal-assignment" aria-label="Assign this job"><label><span>Assigned technician</span><select value={selectedJob.assigneeMemberId} disabled={busy === `assign:${selectedJob.id}` || assigneesLoading} onChange={(event) => void update({ action: "assign_job", workOrderId: selectedJob.id, memberId: event.target.value }, `assign:${selectedJob.id}`, "Assignment updated.")}><option value="">Unassigned</option>{selectedJob.assigneeMemberId && !(data.assignees || []).some((member) => member.id === selectedJob.assigneeMemberId) && <option value={selectedJob.assigneeMemberId}>{selectedJob.assigneeLabel || "Current assignee"}</option>}{(data.assignees || []).map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><form onSubmit={(event) => { event.preventDefault(); void loadAssignees(selectedJob.serviceCategory, assigneeSearch); }}><label><span>Find an active teammate</span><input type="search" value={assigneeSearch} onChange={(event) => setAssigneeSearch(event.target.value)} placeholder="Search by name" /></label><button type="submit" disabled={assigneesLoading}>{assigneesLoading ? "Searching..." : "Search"}</button></form>{data.assigneeRoster && data.assigneeRoster.page < data.assigneeRoster.totalPages && <button type="button" disabled={assigneesLoading} onClick={() => void loadAssignees(selectedJob.serviceCategory, data.assigneeRoster?.search || "", data.assigneeRoster!.page + 1, true)}>{assigneesLoading ? "Loading..." : "Load more team members"}</button>}<small>{permissions.jobScope === "own" ? "You can hand your assigned job to an active teammate. You cannot open or reassign someone else's work." : "Choose an active teammate who provides this service."}</small></section>}<section className="team-mobile-checklist"><h3>Job checklist</h3>{selectedJob.tasks.length ? selectedJob.tasks.map((task) => <label key={task.id}><input type="checkbox" checked={task.status === "done"} disabled={!permissions?.canManageJobs || busy === `task:${task.id}`} onChange={(event) => void update({ action: "update_task", taskId: task.id, status: event.target.checked ? "done" : "pending" }, `task:${task.id}`, event.target.checked ? "Task completed." : "Task reopened.")} /><span>{task.title}<small>{task.dueAt ? `Due ${task.dueAt}` : "No due date"}</small></span></label>) : <div className="crm-empty"><strong>No checklist yet</strong><span>The office can add task steps from the CRM.</span></div>}</section>{permissions?.canViewFieldEvidence && <section className="team-field-tools"><h3>Field record</h3><TradeFieldWorkPanel user={user} workOrderId={selectedJob.id} isProtected={selectedJob.protectedJob} readOnly={!permissions.canManageFieldEvidence} /></section>}{permissions?.canViewFieldEvidence && <section className="team-field-tools"><h3>Field forms</h3><TradeJobFormsPanel user={user} workOrderId={selectedJob.id} readOnly={!permissions.canManageFieldEvidence} /></section>}</article> : <div className="crm-empty"><strong>Select a job</strong><span>Its work details will open here.</span></div>}</section></div></>}
      {portalView === "messages" && <TradeMessagesWorkspace user={user} initialThreadId={messageTarget.id} initialThreadRevision={messageTarget.revision} onOpenQuote={workOrderId => { setCrmTarget({ workspace: "work", kind: "job", id: workOrderId, jobTab: "quote", query: "", nonce: Date.now() }); setPortalView("business"); }} />}
      {portalView === "business" && businessToolsAvailable && <InstallerCrmWorkspace user={user} teamAccess={Boolean(permissions?.canManageTeam)} staffPermissions={permissions} navigationTarget={crmTarget} />}
      {portalView === "training" && <TradeTrainingWorkspace key={user.uid} user={user} />}
      {portalView === "team" && permissions?.canManageTeam && <section className="team-field-tools" aria-label="Team management"><TradeTeamSettings user={user} onOpenOwnTraining={() => setPortalView("training")} /></section>}
      {status && <p className="crm-status" role="status">{status}</p>}
    </>}<SiteFooter>Team access is controlled by the installer business. Australian Energy Assessments protected customer identity and contact details remain unavailable.</SiteFooter></main></TradeTeamCallProvider></TradeMessageAlerts>;
}
