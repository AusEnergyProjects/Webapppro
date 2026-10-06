"use client";

import TradeTeamPresence from "./TradeTeamPresence";
import { WattzunToolsWorkspace } from "./WattzunToolsWorkspace";
import { TradeTeamTimeWorkspace } from "./TradeTeamTimeWorkspace";
import { TradeCrewWorkspace } from "./TradeCrewWorkspace";
import { TradePersonalNameSettings } from "./TradePersonalNameSettings";

import { TradeBusinessGate, useTradeBusiness, useTradeBusinessFetch } from "./TradeBusinessProvider";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { browserPopupRedirectResolver, createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, reload, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { requestTLinkPasswordReset, tlinkPasswordResetErrorMessage } from "@/lib/tlink-password-reset-client";
import { disableTradeDeviceNotifications } from "@/lib/trade-device-client";
import { FirebaseAccountSecurity, FirebaseMfaChallenge, useFirebaseMfaChallenge } from "./FirebaseMfa";
import { SiteFooter } from "./ComparatorChrome";
import { TLinkHeader, TLinkMark } from "./TLinkChrome";
import { TLinkNavigationIcon } from "./TLinkNavigationIcon";
import { readTLinkColourMode, writeTLinkColourMode, TLINK_COLOUR_MODE_STORAGE_KEY, type TLinkColourMode } from "@/lib/trade-device-client";
import { createMapNavigationGuard } from "@/lib/trade-map-navigation";
import { InstallerCrmWorkspace } from "./InstallerCrmWorkspace";
import { TradeTeamSettings, type TradeTeamPermissions } from "./TradeTeamSettings";
import dynamic from "next/dynamic";
import type { TLinkCommandTarget } from "./TLinkCommandCentre";
import { teamAuthErrorCode, teamAuthErrorMessage } from "./trade-team-auth-errors";
import { saveTradeBusinessSelection } from "@/lib/trade-business-client";

const TradeFormsWorkspace = dynamic(() => import('./TradeFormsWorkspace').then(module => module.TradeFormsWorkspace), { loading: () => <p role="status">Opening forms...</p> });
const TradeTasksAndTraining = dynamic(() => import("./TradeTasksAndTraining").then(module => module.TradeTasksAndTraining), { loading: () => <p role="status">Loading tasks and training...</p> });
const TradeSalesWorkspace = dynamic(() => import("./TradeSalesWorkspace").then(module => module.TradeSalesWorkspace), { loading: () => <p role="status">Opening sales...</p> });
const TradeMessagesWorkspace = dynamic(() => import("./TradeMessagesWorkspace").then(module => module.TradeMessagesWorkspace));
import { TradeTeamCallProvider } from "./TradeTeamCallProvider";
import { TradeMessageAlerts, TradeMessageUnreadBadge } from "./TradeMessageAlerts";

type Result = { ownerUid?: string; code?: string; ok?: boolean; accepted?: boolean; access?: { businessName: string; displayName: string; memberId: string; isOwner: boolean; crewId?: string; crewLead?: boolean; permissions: TradeTeamPermissions }; error?: string };
type Invitation = { email: string; displayName: string; businessName: string; expiresAt: string };

type PortalView = "business" | "sales" | "wattzun" | "map" | "team" | "forms" | "tasks" | "training" | "messages" | "time" | "crew";
type CrmShortcut = "today" | "jobs" | "customers" | "schedule" | "pricebook" | "reports";

function teamWorkspaceLocation(search: string): { view: PortalView; target: TLinkCommandTarget | null } {
  const parameters = new URLSearchParams(search);
  const workspace = parameters.get("workspace");
  if (workspace === "wattzun" || workspace === "sales" || workspace === "forms" || workspace === "tasks" || workspace === "training" || workspace === "messages" || workspace === "time") return { view: workspace, target: null };
  const jobId = parameters.get("jobId") || "";
  if (workspace === "work" && /^[A-Za-z0-9:_-]{1,180}$/.test(jobId)) {
    const requestedTab = parameters.get("jobTab");
    const jobTab = requestedTab === "quote" || requestedTab === "invoice" || requestedTab === "field" || requestedTab === "summary" ? requestedTab : requestedTab === "files" ? "field" : "schedule";
    return { view: "business", target: { workspace: "work", kind: "job", id: jobId, jobTab, query: "", nonce: Date.now() } };
  }
  const customerId = parameters.get("customerId") || "";
  if (workspace === "work" && /^[A-Za-z0-9:_-]{1,180}$/.test(customerId)) {
    return { view: "business", target: { workspace: "work", kind: "customer", id: customerId, query: "", nonce: Date.now() } };
  }
  const view: CrmShortcut = workspace === "work" || workspace === "jobs" ? "jobs" : workspace === "schedule" || workspace === "customers" || workspace === "pricebook" || workspace === "reports" ? workspace : "today";
  return { view: "business", target: { workspace: "work", kind: "crm-view", id: view, query: "", nonce: Date.now() } };
}

function teamCrmShortcuts(permissions: TradeTeamPermissions) {
  const shortcuts: { id: CrmShortcut; label: string; icon: "jobs" | "customers" | "schedule" | "products" | "finance" }[] = [{ id: "jobs", label: "Jobs", icon: "jobs" }];
  if (permissions.scheduleScope) shortcuts.push({ id: "schedule", label: "Schedule", icon: "schedule" });
  if (permissions.canViewCustomers && permissions.canSearchCustomers) shortcuts.push({ id: "customers", label: "Customers", icon: "customers" });
  if (permissions.canViewPriceBook) shortcuts.push({ id: "pricebook", label: "Products", icon: "products" });
  if (permissions.canRunReports) shortcuts.push({ id: "reports", label: "Reports", icon: "finance" });
  return shortcuts;
}

function canUseTeamSales(permissions: TradeTeamPermissions | undefined, crewId?: string) {
  return Boolean(permissions && !crewId && permissions.canViewCustomers && permissions.canViewQuotes
    && (permissions.jobScope === "own" || permissions.jobScope === "team"));
}

function TeamWorkspaceNavigation({ permissions, view, crmView, onView, onCrm, crewId }: {
  permissions: TradeTeamPermissions; view: PortalView; crmView: string; crewId?: string;
  onView: (view: PortalView) => void; onCrm: (view: CrmShortcut) => void;
}) {
  return <nav className="tlink-team-navigation" aria-label="Staff workspace">
    <button type="button" aria-current={view === "business" && crmView === "today" ? "page" : undefined} onClick={() => onCrm("today")}><TLinkNavigationIcon name="home" /><span>Home dashboard</span></button>
    {teamCrmShortcuts(permissions).map(item => <button type="button" key={item.id} aria-current={view === "business" && crmView === item.id ? "page" : undefined} onClick={() => onCrm(item.id)}><TLinkNavigationIcon name={item.icon} /><span>{item.label}</span></button>)}
    {canUseTeamSales(permissions, crewId) && <button type="button" aria-current={view === "sales" ? "page" : undefined} onClick={() => onView("sales")}><TLinkNavigationIcon name="leads" /><span>Sales</span></button>}
    <button type="button" aria-current={view === "time" ? "page" : undefined} onClick={() => onView("time")}><TLinkNavigationIcon name="schedule" /><span>My time</span></button>
    {crewId && <button type="button" aria-current={view === "crew" ? "page" : undefined} onClick={() => onView("crew")}><TLinkNavigationIcon name="team" /><span>My crew</span></button>}
    <button type="button" aria-current={view === "messages" ? "page" : undefined} onClick={() => onView("messages")}><TLinkNavigationIcon name="connect" /><span>Connect <TradeMessageUnreadBadge /></span></button>
    {permissions.canViewQuotes && permissions.canManageQuotes && <button type="button" aria-current={view === "map" ? "page" : undefined} onClick={() => onView("map")}><TLinkNavigationIcon name="map" /><span>Map &amp; quote</span></button>}
    <button type="button" aria-current={view === 'forms' ? 'page' : undefined} onClick={() => onView('forms')}><TLinkNavigationIcon name="forms" /><span>Forms</span></button>
    <button type="button" aria-current={view === "wattzun" ? "page" : undefined} onClick={() => onView("wattzun")}><TLinkNavigationIcon name="wattzun" /><span>Wattzun</span></button>
    <button type="button" aria-current={view === "tasks" || view === "training" ? "page" : undefined} onClick={() => onView("tasks")}><TLinkNavigationIcon name="training" /><span>Tasks &amp; training</span></button>
    {permissions.canManageTeam && <button type="button" aria-current={view === "team" ? "page" : undefined} onClick={() => onView("team")}><TLinkNavigationIcon name="team" /><span>Team</span></button>}
  </nav>;
}

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
  const business = useTradeBusiness();
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
  const clearPasswordFields = useCallback(() => {
    setPassword(""); setConfirmPassword(""); setShowPassword(false); setShowConfirmPassword(false); setPasswordMismatch(false);
  }, []);
  async function leaveAccount() {
    try {
      if (!await mapNavigation.run(() => {})) return;
      await disableTradeDeviceNotifications(async ():Promise<Record<string,string>> => user ? {Authorization: `Bearer ${await user.getIdToken()}`} : {}, fetch);
      await signOut(firebaseAuth);
      setData({}); setStatus(""); clearPasswordFields();
    } catch (failure) { setStatus(failure instanceof Error ? failure.message : "Sign out could not be completed. Try again."); }
  }
  const [portalView, setPortalViewState] = useState<PortalView>("business");
  const [mapNavigation] = useState(createMapNavigationGuard);
  const registerMapSave = useCallback((save: (() => Promise<unknown>) | null) => mapNavigation.register(save), [mapNavigation]);
  const setPortalView = useCallback((view: PortalView) => { void mapNavigation.run(() => setPortalViewState(view)); }, [mapNavigation, setPortalViewState]);
  const [crmTarget, setCrmTarget] = useState<TLinkCommandTarget | null>(null);
  const [crmView, setCrmView] = useState("today");
  const workspaceLocation = useRef(typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}${window.location.hash}`);
  const [colourMode, setColourMode] = useState<TLinkColourMode>("day");
  const teamReady = Boolean(user && emailVerified && data.access && invitationReady && !invitationError && !resolver && !mfaRequired);

  useEffect(() => {
    if (!teamReady) return;
    const apply = () => {
      let next: TLinkColourMode = "day";
      try { next = readTLinkColourMode(window.localStorage); } catch { /* Storage can be unavailable in private browsing. */ }
      setColourMode(next); document.documentElement.dataset.tlinkColourMode = next;
    };
    const stored = (event: StorageEvent) => { if (event.key === TLINK_COLOUR_MODE_STORAGE_KEY || event.key === null) apply(); };
    apply(); window.addEventListener("storage", stored);
    return () => { window.removeEventListener("storage", stored); delete document.documentElement.dataset.tlinkColourMode; };
  }, [teamReady]);

  const toggleColourMode = () => {
    const next = colourMode === "night" ? "day" : "night";
    setColourMode(next); document.documentElement.dataset.tlinkColourMode = next;
    try { writeTLinkColourMode(window.localStorage, next); } catch { /* This tab still keeps the selected appearance. */ }
  };

  const openCrm = (view: CrmShortcut) => {
    void mapNavigation.run(() => {
      setCrmView(view);
      setCrmTarget({ workspace: "work", kind: "crm-view", id: view, query: "", nonce: Date.now() });
      setPortalViewState("business");
    });
  };

  function openSalesJob(workOrderId: string, tab: "summary" | "quote" = "summary") {
    void mapNavigation.run(() => {
      setCrmView("jobs");
      setCrmTarget({ workspace: "work", kind: "job", id: workOrderId, jobTab: tab, query: "", nonce: Date.now() });
      setPortalViewState("business");
    });
  }

  function openSalesQuote() {
    void mapNavigation.run(() => {
      setCrmView("jobs");
      setCrmTarget({ workspace: "work", kind: "new-job", id: "", jobTab: "quote", query: "", nonce: Date.now() });
      setPortalViewState("business");
    });
  }

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
    const applyWorkspaceLink = () => {
      const location = teamWorkspaceLocation(window.location.search);
      const nextLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      void mapNavigation.run(() => {
        setPortalViewState(location.view);
        if (location.target) { setCrmTarget(location.target); setCrmView(location.target.kind === "job" ? "jobs" : location.target.kind === "customer" ? "customers" : location.target.id); }
        workspaceLocation.current = nextLocation;
      }).then(changed => {
        if (!changed && workspaceLocation.current) window.history.replaceState(window.history.state, "", workspaceLocation.current);
      });
    };
    applyWorkspaceLink();
    window.addEventListener("popstate", applyWorkspaceLink);
    return () => window.removeEventListener("popstate", applyWorkspaceLink);
  }, [mapNavigation]);

  useEffect(() => {
    const nextUrl = new URL(window.location.href);
    if (!nextUrl.searchParams.has("customerId") && crmTarget?.kind !== "customer") return;
    if (!crmTarget && portalView === "business" && teamWorkspaceLocation(nextUrl.search).target?.kind === "customer") return;
    if (portalView === "business" && crmTarget?.kind === "customer") {
      nextUrl.searchParams.set("customerId", crmTarget.id);
      nextUrl.searchParams.delete("jobId"); nextUrl.searchParams.delete("jobTab");
    } else {
      nextUrl.searchParams.delete("customerId");
      if (portalView === "business" && crmTarget?.kind === "job") {
        nextUrl.searchParams.set("jobId", crmTarget.id); nextUrl.searchParams.set("jobTab", crmTarget.jobTab || "summary");
      } else { nextUrl.searchParams.delete("jobId"); nextUrl.searchParams.delete("jobTab"); }
    }
    nextUrl.searchParams.set("workspace", portalView === "business" ? crmTarget?.kind === "crm-view" ? crmTarget.id : "work" : portalView);
    if (nextUrl.href === window.location.href) return;
    workspaceLocation.current = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    window.history.replaceState(window.history.state, "", workspaceLocation.current);
  }, [crmTarget, portalView]);

  const loadAccess = useCallback(async () => {
    if (!user) return {} as Result;
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-team", {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as Result;
    if (result.code === "MFA_REQUIRED") setMfaRequired(true);
    if (!response.ok) throw new Error(result.error || "The staff portal could not be opened.");
    return result;
  }, [fetch, user]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setAuthDelayed(true), 10_000);
    const unsubscribe = onAuthStateChanged(firebaseAuth, (next) => {
      window.clearTimeout(timeout); setAuthDelayed(false);
      mapNavigation.reset();
      setUser(next); setData({}); setEmailVerified(Boolean(next?.emailVerified)); setAuthReady(true); if (!next) setMfaRequired(false);
    }, () => { window.clearTimeout(timeout); setAuthDelayed(true); });
    return () => { window.clearTimeout(timeout); unsubscribe(); mapNavigation.reset(); };
  }, [mapNavigation]);
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
        const result = await loadAccess();
        if (active) { setData(result); setStatus(""); if (invite) window.history.replaceState({}, "", "/direct-trade/team"); }
      })().catch((error) => active && setStatus(error instanceof Error ? error.message : "The staff portal could not be opened."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [fetch, authRevision, emailVerified, invitation, invitationError, invitationReady, inviteToken, loadAccess, onInvitationAccepted, user]);

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

  const permissions = data.access?.permissions;
  const salesAllowed = canUseTeamSales(permissions, data.access?.crewId);
  const salesScopeKey = JSON.stringify([user?.uid, business?.ownerUid || data.ownerUid, data.access?.memberId, data.access?.crewId, permissions]);
  const canCreateSalesQuote = salesAllowed && permissions?.canCreateJobs && permissions.jobScope === "team" && permissions.canManageQuotes;

  if (resolver) return <main className="wrap trade-team-page"><TLinkHeader active="team" /><FirebaseMfaChallenge resolver={resolver} onCancel={clearMfaChallenge} onComplete={clearMfaChallenge} /></main>;
  if (user && mfaRequired) return <main className="wrap trade-team-page"><TLinkHeader active="team" /><FirebaseAccountSecurity key={user.uid} user={user} onComplete={async () => { setMfaRequired(false); setAuthRevision(current => current + 1); }} /><button type="button" onClick={() => void leaveAccount()}>Sign out</button></main>;

  return <TradeMessageAlerts user={user} enabled={Boolean(data.access)} onOpen={threadId => { setMessageTarget(current => ({ id: threadId, revision: current.revision + 1 })); setPortalView("messages"); }}><TradeTeamCallProvider user={user} enabled={Boolean(data.access)}><main className={teamReady ? `trade-team-page trade-portal-shell tlink-team-shell` : "wrap trade-team-page"} data-trade-colour-mode={teamReady ? colourMode : undefined}>{!teamReady && <TLinkHeader active="team" />}
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
      : loading ? <section className="dashboard-state-card"><p>Opening your workspace...</p></section>
      : !data.access ? <section className="dashboard-state-card"><span>Team access</span><h1>Opening your team</h1><p>{status || "Checking your saved access..."}</p><button className="btn" type="button" onClick={() => void leaveAccount()}>Use another account</button></section> : <>
      <header className="tlink-team-header">
        <div className="tlink-team-topbar">
          <a className="tlink-team-brand" href="/direct-trade/team" aria-label="TLink team workspace"><TLinkMark size={34} /><strong>TLink</strong></a>
          <div className="tlink-team-headerActions">
            <a className="tlink-team-getApp" href="/direct-trade/field-app">Get the app <span aria-hidden="true">↗</span></a>
            <button type="button" className="tlink-team-themeToggle" aria-label="Night mode" aria-pressed={colourMode === "night"} title={colourMode === "night" ? "Switch to day mode" : "Switch to night mode"} onClick={toggleColourMode}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{colourMode === "night" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></> : <path d="M20.4 15.1A8.7 8.7 0 0 1 8.9 3.6 8.8 8.8 0 1 0 20.4 15.1Z" />}</svg>
            </button>
          </div>
        </div>
        <div className="tlink-team-businessBar">
          <div className="tlink-team-business"><span>Working with</span><strong>{data.access.businessName}</strong></div>
          <TradeTeamPresence key={user.uid} getAuthHeaders={async () => ({ Authorization: "Bearer " + await user.getIdToken() })} />
        </div>
      </header>
      <TeamWorkspaceNavigation permissions={data.access.permissions} crewId={data.access.crewId} view={portalView} crmView={crmView} onView={setPortalView} onCrm={openCrm} />
      <div className="tlink-team-content">
      {portalView === "sales" && salesAllowed && <TradeSalesWorkspace key={salesScopeKey} user={user} onOpenJob={openSalesJob} onNewQuote={canCreateSalesQuote ? openSalesQuote : undefined} onRegisterLeave={registerMapSave} />}
      {portalView === "sales" && !salesAllowed && <section className="dashboard-state-card"><p role="alert">Customer and quote access is required to open Sales.</p><button type="button" onClick={() => openCrm("jobs")}>Open jobs</button></section>}
      {portalView === "time" && <TradeTeamTimeWorkspace user={user} />}
      {portalView === "crew" && data.access.crewId && <TradeCrewWorkspace user={user} />}
      {portalView === "messages" && <TradeMessagesWorkspace user={user} initialThreadId={messageTarget.id} initialThreadRevision={messageTarget.revision} onOpenQuote={workOrderId => { setCrmTarget({ workspace: "work", kind: "job", id: workOrderId, jobTab: "quote", query: "", nonce: Date.now() }); setPortalView("business"); }} />}
      {(portalView === "business" || (portalView === "map" && permissions?.canViewQuotes && permissions.canManageQuotes)) && <InstallerCrmWorkspace key={portalView} user={user} teamAccess={Boolean(permissions?.canManageTeam)} staffPermissions={permissions} hideNavigation={portalView !== "map"} navigationTarget={portalView === "map" ? null : crmTarget} mapWorkspace={portalView === "map"} onRegisterMapSave={registerMapSave} onViewChange={setCrmView} />}
      {portalView === 'forms' && <TradeFormsWorkspace user={user} onRegisterLeave={registerMapSave} />}
      {portalView === "wattzun" && <WattzunToolsWorkspace user={user} portal="trade" scopeId={business?.ownerUid} />}
      {(portalView === "tasks" || portalView === "training") && <TradeTasksAndTraining key={user.uid} user={user} tab={portalView} onTab={setPortalView} />}
      {portalView === "team" && permissions?.canManageTeam && <section className="team-field-tools" aria-label="Team management"><TradeTeamSettings user={user} onOpenOwnTraining={() => setPortalView("training")} onOpenSchedule={() => openCrm("schedule")} /></section>}
      {status && <p className="crm-status" role="status">{status}</p>}
      </div><TradePersonalNameSettings key={`${user.uid}:${data.access.memberId}`} user={user} name={data.access.displayName} onSaved={displayName => setData(current => current.access ? { ...current, access: { ...current.access, displayName } } : current)} /><footer className="tlink-team-footer"><span>Signed in as {data.access.displayName}</span><button type="button" onClick={() => void leaveAccount()}>Sign out</button></footer>
    </>}{!teamReady && <SiteFooter>Team access is controlled by the installer business. Australian Energy Assessments protected customer identity and contact details remain unavailable.</SiteFooter>}</main></TradeTeamCallProvider></TradeMessageAlerts>;
}
