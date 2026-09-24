"use client";

import dynamic from "next/dynamic";

/* eslint-disable @next/next/no-img-element */

import "./AdminOperationsPortal.css";
import { AdminWorkspaceNavigation, adminWorkspaceHash, adminWorkspaceTabFromHash, type AdminWorkspaceTab } from "./AdminWorkspaceNavigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { FirebaseAccountSecurity, FirebaseMfaChallenge, useFirebaseMfaChallenge } from "./FirebaseMfa";
import {
  AdminNotificationInbox,
  type AdminNotification,
  type AdminNotificationCounts,
} from "@/components/AdminNotificationInbox";
import { AdminAccountDirectory } from "@/components/AdminAccountDirectory";
import { AdminHandoverReview } from "@/components/AdminHandoverReview";
import { AdminAssetSafety } from "@/components/AdminAssetSafety";
import { AdminAssetGovernance } from "@/components/AdminAssetGovernance";
import { AdminFormTemplates } from "@/components/AdminFormTemplates";
const CreditexActivityWorkPackGovernance = dynamic(() => import("./CreditexActivityWorkPackGovernance").then((module) => module.CreditexActivityWorkPackGovernance), { loading: () => <p role="status">Loading master forms...</p> });
const TrainingQuestionnaireEditor = dynamic(() => import("./TrainingQuestionnaireEditor").then((module) => module.TrainingQuestionnaireEditor), { loading: () => <p role="status">Loading compliance questions...</p> });
import { CreditexOutputActions } from "@/components/CreditexOutputActions";
import { CreditexRegistryWorkspace } from "@/components/CreditexRegistryWorkspace";
import { AdminUsabilityPilot } from "@/components/AdminUsabilityPilot";
import { AdminPerformancePanel } from "@/components/AdminPerformancePanel";
import { AdminOpportunityWorkspace } from "@/components/AdminOpportunityWorkspace";
import { AdminCatalogueWorkspace } from "@/components/AdminCatalogueWorkspace";
import { AdminAccountWorkspace } from "@/components/AdminAccountWorkspace";
import { AdminProductEnquiryWorkspace, summariseProductEnquiries, type ProductEnquirySummary } from "@/components/AdminProductEnquiryWorkspace";
import { AdminServiceReminderDelivery } from "@/components/AdminServiceReminderDelivery";
import { AdminJobDirectory } from "@/components/AdminJobDirectory";
import AdminDemoCleanupPanel from "@/components/AdminDemoCleanupPanel";
import { AdminDatabaseWorkspace } from "@/components/AdminDatabaseWorkspace";
import { AdminEnergyAssistantLeads } from "@/components/AdminEnergyAssistantLeads";
import { AdminSurgeAnswerReviews } from "@/components/AdminSurgeAnswerReviews";

type AdminRole = "owner" | "admin" | "reviewer" | "support";
type AdminSession = { email: string; displayName: string; role: AdminRole };
type Metrics = {
  customers?: { total?: number; active?: number; projects?: number; submitted?: number };
  accounts?: {
    total?: number;
    active?: number;
    suspended?: number;
    installers?: number;
    suppliers?: number;
  };
  opportunities?: { total?: number; open?: number; draft?: number };
  matches?: { total?: number; offered?: number; interested?: number };
  verification?: { awaiting?: number; approved?: number };
  products?: {
    total?: number;
    pending?: number;
    live?: number;
  };
  notifications?: { total?: number; unread?: number; action_required?: number; urgent?: number };
};
type AuditItem = {
  id: string;
  action: string;
  entity_type: string;
  summary: string;
  created_at: string;
  administrator: string;
};
type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: AdminRole;
  status: string;
  pending: number;
  last_login_at: string;
  created_at: string;
};
function authMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (code.includes("invalid-credential") || code.includes("wrong-password"))
    return "The email or password was not recognised.";
  if (code.includes("popup-closed"))
    return "Google sign-in was closed before it finished.";
  if (code.includes("popup-blocked"))
    return "Allow the Google sign-in pop-up and try again.";
  return error instanceof Error
    ? error.message
    : "The secure account action could not be completed.";
}

function readable(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: unknown) {
  if (!value) return "Not yet";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

const WORKSPACE_HISTORY_INDEX = "tlinkAdminWorkspaceIndex";
function workspaceHistoryIndex(): number | null {
  const value = window.history.state?.[WORKSPACE_HISTORY_INDEX];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}
function workspaceHistoryState(index: number) {
  const current = window.history.state;
  return { ...(current && typeof current === "object" ? current : {}), [WORKSPACE_HISTORY_INDEX]: index };
}

function AdminTLinkBrand({ context }: { context: string }) {
  return (
    <div className="admin-brand admin-tlink-brand">
      <img src="/tlink-icon-192.png" width="42" height="42" alt="" aria-hidden="true" />
      <div>
        <strong>TLink</strong>
        <small>{context}</small>
      </div>
    </div>
  );
}

export function AdminOperationsPortal() {
  const { resolver, captureMfaError, clearMfaChallenge } = useFirebaseMfaChallenge();
  const [mfaRequired, setMfaRequired] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [canBootstrap, setCanBootstrap] = useState(false);
  const [canRecoverOwner, setCanRecoverOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapCode, setBootstrapCode] = useState("");
  const [tab, setTab] = useState<AdminWorkspaceTab>("inbox");
  const questionnaireDirty = useRef(false);
  const historyIndex = useRef<number | null>(null);
  const restoringHistory = useRef(false);
  const reportQuestionnaireDirty = useCallback((dirty: boolean) => { questionnaireDirty.current = dirty; }, []);
  const selectTab = useCallback((next: AdminWorkspaceTab, updateHistory = true) => {
    if (next === tab) return true;
    if (questionnaireDirty.current && !window.confirm("Discard the unsaved changes to this questionnaire?")) return false;
    questionnaireDirty.current = false;
    setTab(next);
    if (updateHistory && window.location.hash !== adminWorkspaceHash(next)) {
      const index = (historyIndex.current ?? 0) + 1;
      window.history.pushState(workspaceHistoryState(index), "", adminWorkspaceHash(next));
      historyIndex.current = index;
    }
    return true;
  }, [tab]);
  useEffect(() => {
    if (!session) return;
    const role = session.role;
    if (historyIndex.current === null) {
      historyIndex.current = workspaceHistoryIndex() ?? 0;
      window.history.replaceState(workspaceHistoryState(historyIndex.current), "");
    }
    function readWorkspaceHash() {
      const currentIndex = historyIndex.current ?? 0;
      let nextIndex = workspaceHistoryIndex();
      if (restoringHistory.current) {
        if (nextIndex === currentIndex) restoringHistory.current = false;
        return;
      }
      const next = adminWorkspaceTabFromHash(window.location.hash, role);
      if (!next) return;
      // Native fragment links create an entry without our navigation index.
      if (nextIndex === null) {
        nextIndex = currentIndex + 1;
        window.history.replaceState(workspaceHistoryState(nextIndex), "");
      }
      if (!selectTab(next, false)) {
        const distance = currentIndex - nextIndex;
        if (distance) {
          restoringHistory.current = true;
          window.history.go(distance);
        }
        return;
      }
      historyIndex.current = nextIndex;
    }
    readWorkspaceHash();
    window.addEventListener("hashchange", readWorkspaceHash);
    window.addEventListener("popstate", readWorkspaceHash);
    return () => {
      window.removeEventListener("hashchange", readWorkspaceHash);
      window.removeEventListener("popstate", readWorkspaceHash);
    };
  }, [session, selectTab, tab]);
  const [metrics, setMetrics] = useState<Metrics>({});
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [productEnquirySummary, setProductEnquirySummary] = useState<ProductEnquirySummary>({ total: 0, open: 0, responded: 0, valueCents: 0 });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<AdminRole>("support");
  const [notificationCounts, setNotificationCounts] = useState<AdminNotificationCounts>({
    total: 0,
    unread: 0,
    action_required: 0,
    urgent: 0,
    unassigned: 0,
    overdue: 0,
    due_soon: 0,
    mine: 0,
    resolved: 0,
  });
  const [directoryTarget, setDirectoryTarget] = useState<{ type: string; uid: string; nonce: number } | null>(null);
  const [partnerTarget, setPartnerTarget] = useState<{ uid: string; nonce: number } | null>(null);
  const [partnerVerificationTarget, setPartnerVerificationTarget] = useState("");
  const [assistantLeadTarget, setAssistantLeadTarget] = useState<{ id: string; nonce: number } | null>(null);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const activeUser = firebaseAuth.currentUser;
    if (!activeUser) throw new Error("Sign in to continue.");
    const token = await activeUser.getIdToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (
      init.body
      && !(init.body instanceof FormData)
      && !headers.has("Content-Type")
    )
      headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (result.code === "MFA_REQUIRED") setMfaRequired(true);
    if (!response.ok || result.ok === false) {
      const error = new Error(
        result.error || "The operations request could not be completed.",
      );
      Object.assign(error, { response, result });
      throw error;
    }
    return result;
  }, []);

  const downloadOfficialSource = useCallback(async (
    artifactId: string,
    originalFileName: string,
  ) => {
    const activeUser = firebaseAuth.currentUser;
    if (!activeUser) throw new Error("Sign in to continue.");
    const token = await activeUser.getIdToken();
    const response = await fetch(
      `/api/admin/compliance-official-sources/${encodeURIComponent(artifactId)}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(
        String(result.error || "The retained official source could not be opened."),
      );
    }
    const receipt = response.headers.get(
      "X-Creditex-Official-Source-Receipt",
    )?.trim();
    if (!receipt) {
      throw new Error(
        "The retained source was verified but no access receipt was returned.",
      );
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = originalFileName
      .replace(/[^A-Za-z0-9._ ()-]/g, "_")
      .slice(0, 180) || "official-source";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    return receipt;
  }, []);

  const loadWorkspace = useCallback(
    async (nextSession: AdminSession) => {
      const datasets = await Promise.allSettled([
        api("/api/admin/product-enquiries"),
      ]);
      const failures: string[] = [];
      const [enquiryResult] = datasets;
      if (enquiryResult.status === "fulfilled") setProductEnquirySummary(summariseProductEnquiries(enquiryResult.value.enquiries || []));
      else failures.push("product enquiries");
      if (nextSession.role === "owner") {
        try {
          const adminResult = await api("/api/admin/admins");
          setAdmins(adminResult.admins || []);
        } catch {
          failures.push("operations users");
        }
      }
      if (failures.length) throw new Error(`${failures.join(", ")} could not be loaded.`);
    },
    [api],
  );

  const loadSession = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const result = await api("/api/admin/session");
      setSession(result.admin);
      setMetrics(result.metrics || {});
      setNotificationCounts((current) => ({
        ...current,
        ...(result.metrics?.notifications || {}),
      }));
      setAudit(result.audit || []);
      setCanBootstrap(false);
      setCanRecoverOwner(false);
      try {
        await loadWorkspace(result.admin);
      } catch (workspaceError) {
        setStatus(
          `Owner access is active. Some workspace data could not be loaded: ${authMessage(workspaceError)}`,
        );
      }
    } catch (error) {
      const result =
        typeof error === "object" && error && "result" in error
          ? (error as { result?: { canBootstrap?: boolean; canRecoverOwner?: boolean } }).result
          : undefined;
      setSession(null);
      setCanBootstrap(result?.canBootstrap === true);
      setCanRecoverOwner(result?.canRecoverOwner === true);
      setStatus(authMessage(error));
    } finally {
      setLoading(false);
    }
  }, [api, loadWorkspace]);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (nextUser) => {
        setUser(nextUser);
        if (!nextUser) setMfaRequired(false);
        setAuthReady(true);
        if (nextUser) void loadSession();
        else {
          setSession(null);
          setLoading(false);
          setCanBootstrap(false);
          setCanRecoverOwner(false);
        }
      }),
    [loadSession],
  );

  async function signInGoogle() {
    setStatus("Opening secure Google sign-in...");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(firebaseAuth, provider);
    } catch (error) {
      if (!captureMfaError(error)) setStatus(authMessage(error));
    }
  }

  async function signInEmail(event: FormEvent) {
    event.preventDefault();
    setStatus("Signing in...");
    try {
      await signInWithEmailAndPassword(
        firebaseAuth,
        email.trim().toLowerCase(),
        password,
      );
    } catch (error) {
      if (!captureMfaError(error)) setStatus(authMessage(error));
    }
  }

  async function resetAdminPassword() {
    const accountEmail = email.trim().toLowerCase();
    if (!accountEmail) {
      setStatus("Enter your operations email address first.");
      return;
    }
    setStatus("Sending secure password reset instructions...");
    try {
      await sendPasswordResetEmail(firebaseAuth, accountEmail);
      setStatus(
        "Password reset instructions have been sent. Use the same email so your existing operations identity is preserved.",
      );
    } catch (error) {
      setStatus(authMessage(error));
    }
  }

  function openNotificationInbox() {
    if (!selectTab("inbox")) return;
    window.requestAnimationFrame(() => {
      document.getElementById("operations-inbox")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  async function bootstrap(event: FormEvent) {
    event.preventDefault();
    setStatus("Creating the protected owner account...");
    try {
      await api("/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ code: bootstrapCode }),
      });
      setBootstrapCode("");
      await loadSession();
    } catch (error) {
      setStatus(authMessage(error));
    }
  }

  async function recoverOwnerAccess() {
    setStatus("Reconnecting the verified owner identity...");
    try {
      await api("/api/admin/recovery", { method: "POST" });
      setCanRecoverOwner(false);
      await loadSession();
    } catch (error) {
      setStatus(authMessage(error));
    }
  }

  function openNotificationRecord(notification: AdminNotification) {
    if (notification.entityType === "energy_assistant_lead") {
      setAssistantLeadTarget({ id: notification.entityId, nonce: Date.now() });
      selectTab("assistant-leads");
      return;
    }
    if (notification.actorType === "customer" || ["customer_account", "customer_project"].includes(notification.entityType)) {
      if (!notification.actorUid) {
        setStatus("The customer record could not be identified from this notification.");
        return;
      }
      setDirectoryTarget({ type: "customer", uid: notification.actorUid, nonce: Date.now() });
      selectTab("customers");
      return;
    }
    if (notification.entityType === "supplier_product") {
      selectTab("catalogue");
      return;
    }
    if (["supplier_product_enquiry", "installer_product_list"].includes(notification.entityType)) {
      selectTab("enquiries");
      return;
    }
    if (notification.entityType === "trade_handover_pack") {
      selectTab("handovers");
      return;
    }
    if (notification.entityType === "asset_safety_notice") {
      selectTab("asset-safety");
      return;
    }
    if (["customer_asset_transfer", "trade_handover_correction"].includes(notification.entityType)) {
      selectTab("asset-governance");
      return;
    }
    if (["trade_opportunity_match", "customer_project_quote"].includes(notification.entityType)) {
      selectTab("opportunities");
      return;
    }
    if (["trade_account", "verification_document"].includes(notification.entityType) || ["installer", "supplier"].includes(notification.actorType)) {
      if (notification.actorUid) {
        setPartnerTarget({ uid: notification.actorUid, nonce: Date.now() });
        selectTab("partners");
        return;
      }
    }
    selectTab("opportunities");
  }

  async function inviteAdmin(event: FormEvent) {
    event.preventDefault();
    setStatus("Creating operations invitation...");
    try {
      await api("/api/admin/admins", {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail,
          displayName: inviteName,
          role: inviteRole,
        }),
      });
      setInviteEmail("");
      setInviteName("");
      setInviteRole("support");
      const result = await api("/api/admin/admins");
      setAdmins(result.admins || []);
      setStatus(
        "Operations invitation is ready. The person can sign in with that exact verified email.",
      );
    } catch (error) {
      setStatus(authMessage(error));
    }
  }

  async function updateAdmin(id: string, role: AdminRole, nextStatus: string) {
    setStatus("Updating operations access...");
    try {
      await api("/api/admin/admins", {
        method: "PATCH",
        body: JSON.stringify({ id, role, status: nextStatus }),
      });
      const result = await api("/api/admin/admins");
      setAdmins(result.admins || []);
      setStatus("Operations access updated and audited.");
    } catch (error) {
      setStatus(authMessage(error));
    }
  }

  const accountCounts = metrics.accounts || {};
  const customerCounts = metrics.customers || {};
  const verificationCounts = metrics.verification || {};
  const opportunityCounts = metrics.opportunities || {};
  const matchCounts = metrics.matches || {};
  const productCounts = metrics.products || {};
  const openProductEnquiries = productEnquirySummary.open;
  const activeOwners = admins.filter(
    (item) => item.role === "owner" && item.status === "active",
  ).length;
  if (resolver) return <main className="admin-shell"><FirebaseMfaChallenge resolver={resolver} onCancel={clearMfaChallenge} onComplete={clearMfaChallenge} /></main>;
  if (user && mfaRequired) return <main className="admin-shell"><FirebaseAccountSecurity key={user.uid} user={user} onComplete={async () => { setMfaRequired(false); await loadSession(); }} /><p style={{ textAlign: "center" }}><button type="button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></p></main>;

  if (!authReady || loading)
    return (
      <main className="admin-shell">
        <section className="admin-auth-card">
          <AdminTLinkBrand context="Operations control centre" />
          <h1>Preparing the control centre</h1>
          <p>
            Validating the signed-in account and loading the protected
            workspace.
          </p>
          <div className="admin-loading" />
        </section>
      </main>
    );

  if (!user)
    return (
      <main className="admin-shell">
        <section className="admin-auth-card">
          <AdminTLinkBrand context="Restricted operations portal" />
          <span>Authorised team access</span>
          <h1>Sign in to the operations control centre</h1>
          <p>
            This portal is for authorised account moderation, verification
            review and opportunity coordination. Access attempts are checked
            against the server-side operations register.
          </p>
          <button
            className="admin-google-button"
            type="button"
            onClick={() => void signInGoogle()}
          >
            <img
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
              alt=""
            />
            Continue with Google
          </button>
          <div className="admin-auth-divider">
            <span>or use an invited email</span>
          </div>
          <form onSubmit={signInEmail} className="admin-auth-form">
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button type="submit">Sign in securely</button>
            <button
              type="button"
              className="admin-password-reset"
              onClick={() => void resetAdminPassword()}
            >
              Forgot password?
            </button>
          </form>
          {status && (
            <p className="admin-inline-status" role="status">
              {status}
            </p>
          )}
          <small className="admin-security-note">
            No public administrator registration is available. Ask an owner to
            invite your verified account.
          </small>
        </section>
      </main>
    );

  if (!session)
    return (
      <main className="admin-shell">
        <section className="admin-auth-card">
          <AdminTLinkBrand context={`Operations access | ${user.email || "verified account"}`} />
          {canRecoverOwner || (!canBootstrap && user.email) ? (
            <>
              <span>Verified owner recovery</span>
              <h1>Reconnect this owner account</h1>
              <p>
                If this is the verified owner email, reconnect its secure
                identity after signing in with the password you just recovered.
                Other accounts are rejected automatically.
              </p>
              <button
                className="admin-recovery-button"
                type="button"
                onClick={() => void recoverOwnerAccess()}
              >
                Reconnect owner access
              </button>
              <small className="admin-security-note">
                This one-time recovery requires recent password authentication
                and creates a permanent security audit entry.
              </small>
            </>
          ) : canBootstrap ? (
            <>
              <span>One-time owner setup</span>
              <h1>Create the first protected owner</h1>
              <p>
                Enter the deployment setup code once. After the first owner is
                created, this route permanently switches to invitation-only
                access.
              </p>
              <form className="admin-auth-form" onSubmit={bootstrap}>
                <label>
                  One-time owner setup code
                  <input
                    type="password"
                    autoComplete="off"
                    value={bootstrapCode}
                    onChange={(event) => setBootstrapCode(event.target.value)}
                    required
                  />
                </label>
                <button type="submit">Create owner account</button>
              </form>
            </>
          ) : (
            <>
              <span>Access not assigned</span>
              <h1>This account is not authorised</h1>
              <p>
                {status ||
                  "Ask an existing owner to invite this exact verified email address."}
              </p>
            </>
          )}
          {status && (canRecoverOwner || (!canBootstrap && user.email)) && (
            <p className="admin-inline-status" role="status">
              {status}
            </p>
          )}
          <button
            className="admin-text-button"
            type="button"
            onClick={() => void signOut(firebaseAuth)}
          >
            Sign out and use another account
          </button>
        </section>
      </main>
    );

  return (
    <main className="admin-shell admin-workspace">
      <a className="admin-skip-link" href="#admin-workspace-content" onClick={(event) => {
        event.preventDefault();
        const content = document.getElementById("admin-workspace-content");
        content?.focus({ preventScroll: true });
        content?.scrollIntoView({ block: "start" });
      }}>Skip to workspace</a>
      <header className="admin-topbar">
        <AdminTLinkBrand context="Administration" />
        <div className="admin-topbar-account">
          <a
            href="#operations-inbox"
            className="admin-notification-button"
            aria-label={`Open operations inbox, ${notificationCounts.unread || 0} unread alerts`}
            onClick={(event) => {
              event.preventDefault();
              openNotificationInbox();
            }}
          >
            Alerts
            {notificationCounts.unread > 0 && <strong>{notificationCounts.unread}</strong>}
          </a>
          <span className={`admin-role admin-role-${session.role}`}>
            {session.role}
          </span>
          <div>
            <strong>{session.displayName || session.email}</strong>
            <small>{session.email}</small>
          </div>
          <button type="button" onClick={() => void signOut(firebaseAuth)}>
            Sign out
          </button>
        </div>
      </header>
      <div className="admin-layout">
        <AdminWorkspaceNavigation selected={tab} role={session.role} unread={notificationCounts.unread} onSelect={selectTab} />
        <section className="admin-content" id="admin-workspace-content" aria-label="Selected operations workspace" tabIndex={-1}>
          {status && (
            <div className="admin-banner" role="status">
              {status}
              <button onClick={() => setStatus("")} aria-label="Dismiss status">
                &times;
              </button>
            </div>
          )}
          <div id="operations-inbox" hidden={tab !== "inbox"}>
            <AdminNotificationInbox
              api={api}
              role={session.role}
              onOpen={openNotificationRecord}
              onCounts={setNotificationCounts}
            />
          </div>
          {tab === "directory" && (
            <AdminAccountDirectory
              api={api}
              role={session.role}
              target={directoryTarget}
              onManageTrade={(uid) => {
                setPartnerTarget({ uid, nonce: Date.now() });
                selectTab("partners");
              }}
              onManageAdmin={() => {
                if (session.role === "owner") selectTab("access");
                else setStatus("Only an owner can change operations access.");
              }}
            />
          )}
          {tab === "jobs" && <AdminJobDirectory api={api} />}
          {tab === "customers" && (
            <AdminAccountDirectory
              api={api}
              role={session.role}
              fixedType="customer"
              target={directoryTarget?.type === "customer" ? directoryTarget : null}
              onManageTrade={(uid) => {
                setPartnerTarget({ uid, nonce: Date.now() });
                selectTab("partners");
              }}
              onManageAdmin={() => {
                if (session.role === "owner") selectTab("access");
                else setStatus("Only an owner can change operations access.");
              }}
            />
          )}
          {tab === "handovers" && user && <AdminHandoverReview user={user} role={session.role} />}
          {tab === "asset-safety" && user && <AdminAssetSafety user={user} role={session.role} />}
          {tab === "asset-governance" && user && <AdminAssetGovernance user={user} role={session.role} />}
          {tab === "form-governance" && (
            <>
              <CreditexActivityWorkPackGovernance
                api={api}
                endpoint="/api/admin/compliance-work-packs"
                sourceEndpoint="/api/admin/compliance-official-sources"
                sourceBatchEndpoint="/api/admin/compliance-official-sources/batch-import"
                canCaptureSource={["owner", "admin"].includes(session.role)}
                onDownloadSource={downloadOfficialSource}
                contextLabel="Australian Energy Assessments operations"
              />
              <details className="admin-card admin-supporting-form-templates">
                <summary>Supporting non-program field templates</summary>
                <AdminFormTemplates api={api} role={session.role} />
              </details>
            </>
          )}
          {tab === "compliance-submissions" && session.role !== "support" && (
            <CreditexRegistryWorkspace
              api={api}
              endpoint="/api/admin/compliance-registry"
              outputEndpoint="/api/admin/compliance-output-actions"
            >
              <CreditexOutputActions
                api={api}
                endpoint="/api/admin/compliance-output-actions"
                contextLabel="Australian Energy Assessments administration"
              />
            </CreditexRegistryWorkspace>
          )}
          {tab === "field-pilot" && <AdminUsabilityPilot api={api} role={session.role} />}
          {tab === "compliance-questions" && session.role !== "support" && <TrainingQuestionnaireEditor api={api} canEdit={true} onDirtyChange={reportQuestionnaireDirty} />}
          {tab === "overview" && (
            <>
              <header className="admin-page-heading">
                <span>Operational view</span>
                <h1>Network overview</h1>
                <p>
                  Account health, verification work, fair opportunity flow,
                  catalogue review and recent administrator activity.
                </p>
              </header>
              <section className="admin-metric-grid">
                <article>
                  <span>Action notifications</span>
                  <strong>{notificationCounts.action_required || 0}</strong>
                  <small>{notificationCounts.overdue || 0} overdue | {notificationCounts.unassigned || 0} unassigned</small>
                </article>
                <article>
                  <span>Customers</span>
                  <strong>{customerCounts.total || 0}</strong>
                  <small>
                    {customerCounts.projects || 0} projects | {customerCounts.submitted || 0} active enquiries
                  </small>
                </article>
                <article>
                  <span>Partners</span>
                  <strong>{accountCounts.total || 0}</strong>
                  <small>
                    {accountCounts.installers || 0} installers | {accountCounts.suppliers || 0} wholesalers
                  </small>
                </article>
                <article>
                  <span>Leads and opportunities</span>
                  <strong>{opportunityCounts.open || 0}</strong>
                  <small>
                    {matchCounts.interested || 0} installers interested
                  </small>
                </article>
                <article>
                  <span>Products</span>
                  <strong>{productCounts.total || 0}</strong>
                  <small>
                    {productCounts.live || 0} live | {productCounts.pending || 0} awaiting review
                  </small>
                </article>
                <article>
                  <span>Verification queue</span>
                  <strong>{verificationCounts.awaiting || 0}</strong>
                  <small>
                    {verificationCounts.approved || 0} accounts approved
                  </small>
                </article>
              </section>
              <section className="admin-access-metrics" aria-label="Trade access readiness">
                <article><span>Business profiles</span><strong>{accountCounts.total || 0}</strong><small>{accountCounts.installers || 0} installers and {accountCounts.suppliers || 0} wholesalers</small></article>
                <article><span>Approved</span><strong>{verificationCounts.approved || 0}</strong><small>Role-appropriate access available</small></article>
                <article><span>Awaiting review</span><strong>{verificationCounts.awaiting || 0}</strong><small>ABN and evidence review required</small></article>
              </section>
              {["owner", "admin"].includes(session.role) && <AdminPerformancePanel api={api} />}
              <div className="admin-overview-grid">
                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <span>Priority queues</span>
                    <h2>What needs attention</h2>
                  </div>
                  <div className="admin-queue-list">
                    <button onClick={() => selectTab("inbox")}>
                      <strong>{notificationCounts.overdue || 0}</strong>
                      <span>Operations cases past their response target</span>
                    </button>
                    <button onClick={() => selectTab("inbox")}>
                      <strong>{notificationCounts.unassigned || 0}</strong>
                      <span>Actionable cases without a responsible administrator</span>
                    </button>
                    <button onClick={() => selectTab("inbox")}>
                      <strong>{notificationCounts.action_required || 0}</strong>
                      <span>Inbox items requiring action or approval</span>
                    </button>
                    <button
                      onClick={() => {
                        selectTab("partners");
                        setPartnerVerificationTarget("under_review");
                      }}
                    >
                      <strong>{verificationCounts.awaiting || 0}</strong>
                      <span>Verification submissions awaiting review</span>
                    </button>
                    <button onClick={() => selectTab("opportunities")}>
                      <strong>{opportunityCounts.draft || 0}</strong>
                      <span>Draft opportunities requiring scope review</span>
                    </button>
                    <button onClick={() => selectTab("catalogue")}>
                      <strong>{productCounts.pending || 0}</strong>
                      <span>Wholesaler products awaiting catalogue review</span>
                    </button>
                    <button onClick={() => selectTab("enquiries")}>
                      <strong>{openProductEnquiries}</strong>
                      <span>Product enquiries awaiting wholesaler response</span>
                    </button>
                  </div>
                </section>
                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <span>Immutable record</span>
                    <h2>Recent audit history</h2>
                  </div>
                  <div className="admin-audit-list">
                    {audit.length ? (
                      audit.slice(0, 12).map((item) => (
                        <article key={item.id}>
                          <strong>{item.summary}</strong>
                          <span>
                            {item.administrator} · {dateTime(item.created_at)}
                          </span>
                        </article>
                      ))
                    ) : (
                      <p>No administrator actions have been recorded yet.</p>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}

          {tab === "partners" && (
            <>
              <AdminAccountWorkspace api={api} role={session.role} setStatus={setStatus} onCounts={() => undefined} target={partnerTarget} verificationTarget={partnerVerificationTarget} />
            </>
          )}

          {tab === "opportunities" && (
            <AdminOpportunityWorkspace api={api} role={session.role} setStatus={setStatus} />
          )}

          {tab === "assistant-leads" && (
            <AdminEnergyAssistantLeads api={api} target={assistantLeadTarget} setStatus={setStatus} />
          )}

          {tab === "assistant-reviews" && session.role !== "support" && (
            <AdminSurgeAnswerReviews api={api} setStatus={setStatus} />
          )}

          {tab === "catalogue" && (
            <AdminCatalogueWorkspace api={api} role={session.role} setStatus={setStatus} />
          )}


          {tab === "enquiries" && <AdminProductEnquiryWorkspace api={api} setStatus={setStatus} onSummary={setProductEnquirySummary} />}

          {tab === "database" && session.role === "owner" && <><AdminDatabaseWorkspace api={api} setStatus={setStatus} />{user && <AdminDemoCleanupPanel user={user} />}</>}

          {tab === "access" && session.role === "owner" && (
            <>
              <header className="admin-page-heading">
                <span>Owner controls</span>
                <h1>Operations access and audit</h1>
                <p>
                  Invite named team members, apply least-privilege roles and
                  suspend access without deleting the accountability record.
                </p>
              </header>
              <section className={`admin-panel admin-recovery-readiness ${activeOwners > 1 ? "ready" : "attention"}`}>
                <div>
                  <span>Owner recovery readiness</span>
                  <h2>{activeOwners > 1 ? "Backup owner coverage is active" : "Add a backup owner"}</h2>
                  <p>
                    Password recovery on the sign-in page preserves the existing Firebase identity.
                    A second named owner provides audited recovery if the primary owner loses access entirely.
                  </p>
                </div>
                <strong>{activeOwners} active owner{activeOwners === 1 ? "" : "s"}</strong>
              </section>
              <AdminServiceReminderDelivery api={api} setStatus={setStatus} />
              <div className="admin-access-layout">
                <form
                  className="admin-panel admin-invite-form"
                  onSubmit={inviteAdmin}
                >
                  <div className="admin-panel-heading">
                    <span>Invitation-only</span>
                    <h2>Add an operations user</h2>
                  </div>
                  <label>
                    Display name
                    <input
                      value={inviteName}
                      onChange={(event) => setInviteName(event.target.value)}
                    />
                  </label>
                  <label>
                    Verified account email
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Role
                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(event.target.value as AdminRole)
                      }
                    >
                      <option value="support">Support · read accounts</option>
                      <option value="reviewer">
                        Reviewer · verification decisions
                      </option>
                      <option value="admin">
                        Administrator · partners and projects
                      </option>
                      <option value="owner">Owner · access management</option>
                    </select>
                  </label>
                  <button type="submit">Create invitation</button>
                  <p>
                    The invitation binds to this exact email the first time the
                    user signs in with a verified Firebase account.
                  </p>
                </form>
                <section className="admin-panel admin-admin-list tlink-data-table">
                  <div className="admin-panel-heading">
                    <span>Least privilege</span>
                    <h2>Operations team</h2>
                  </div>
                  {admins.map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>{item.display_name || item.email}</strong>
                        <small>
                          {item.email}
                          <br />
                          {item.pending
                            ? "Invitation pending"
                            : `Last login ${dateTime(item.last_login_at)}`}
                        </small>
                      </div>
                      <select
                        aria-label={`Role for ${item.email}`}
                        value={item.role}
                        onChange={(event) =>
                          void updateAdmin(
                            item.id,
                            event.target.value as AdminRole,
                            item.status,
                          )
                        }
                      >
                        <option value="support">Support</option>
                        <option value="reviewer">Reviewer</option>
                        <option value="admin">Administrator</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button
                        className={item.status === "active" ? "danger" : ""}
                        onClick={() =>
                          void updateAdmin(
                            item.id,
                            item.role,
                            item.status === "active" ? "suspended" : "active",
                          )
                        }
                      >
                        {item.status === "active" ? "Suspend" : "Restore"}
                      </button>
                    </article>
                  ))}
                </section>
              </div>
              <section className="admin-panel admin-full-audit">
                <div className="admin-panel-heading">
                  <span>Accountability</span>
                  <h2>Recent administrator activity</h2>
                </div>
                <div className="admin-audit-table">
                  {audit.map((item) => (
                    <article key={item.id}>
                      <span>{dateTime(item.created_at)}</span>
                      <strong>{item.summary}</strong>
                      <small>
                        {item.administrator} · {readable(item.action)}
                      </small>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
