"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useState } from "react";
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
import { AdminUsabilityPilot } from "@/components/AdminUsabilityPilot";
import { AdminPerformancePanel } from "@/components/AdminPerformancePanel";
import { AdminServiceFollowUpReporting } from "@/components/AdminServiceFollowUpReporting";
import { AdminOpportunityWorkspace } from "@/components/AdminOpportunityWorkspace";
import { AdminCatalogueWorkspace } from "@/components/AdminCatalogueWorkspace";
import { AdminAccountWorkspace } from "@/components/AdminAccountWorkspace";
import { AdminProductEnquiryWorkspace, summariseProductEnquiries, type ProductEnquirySummary } from "@/components/AdminProductEnquiryWorkspace";
import { AdminServiceReminderDelivery } from "@/components/AdminServiceReminderDelivery";
import { AdminJobDirectory } from "@/components/AdminJobDirectory";

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
type ReferralRecord = {
  id: string;
  code: string;
  status: string;
  riskReason: string;
  referrerBusiness: string;
  referrerEmail: string;
  referredBusiness: string;
  referredEmail: string;
  registeredAt: string;
  firstPaidAt: string;
  rewardedAt: string;
  appliedCredits: number;
  failedCredits: number;
  updatedAt: string;
};
type EcosystemHealth = {
  status: "healthy" | "attention";
  checkedAt: string;
  counts: Record<string, number>;
  checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    detail: string;
  }>;
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
  const [tab, setTab] = useState<
    "inbox" | "overview" | "directory" | "jobs" | "customers" | "partners" | "opportunities" | "catalogue" | "enquiries" | "handovers" | "asset-safety" | "asset-governance" | "form-governance" | "referrals" | "field-pilot" | "access"
  >("inbox");
  const [metrics, setMetrics] = useState<Metrics>({});
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [accountListCounts, setAccountListCounts] = useState({ total: 0, paid: 0, free: 0, hiddenSuppliers: 0, leadLockedInstallers: 0 });
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [productEnquirySummary, setProductEnquirySummary] = useState<ProductEnquirySummary>({ total: 0, open: 0, responded: 0, valueCents: 0 });
  const [ecosystemHealth, setEcosystemHealth] = useState<EcosystemHealth | null>(null);
  const [ecosystemBusy, setEcosystemBusy] = useState(false);
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
  const [opportunityDemoRequest, setOpportunityDemoRequest] = useState(0);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const activeUser = firebaseAuth.currentUser;
    if (!activeUser) throw new Error("Sign in to continue.");
    const token = await activeUser.getIdToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(
        result.error || "The operations request could not be completed.",
      );
      Object.assign(error, { response, result });
      throw error;
    }
    return result;
  }, []);

  const loadWorkspace = useCallback(
    async (nextSession: AdminSession) => {
      const datasets = await Promise.allSettled([
        api("/api/admin/accounts?pageSize=25"),
        api("/api/admin/referrals"),
        api("/api/admin/product-enquiries"),
      ]);
      const failures: string[] = [];
      const [accountResult, referralResult, enquiryResult] = datasets;
      if (accountResult.status === "fulfilled") setAccountListCounts(accountResult.value.counts || { total: 0, paid: 0, free: 0, hiddenSuppliers: 0, leadLockedInstallers: 0 });
      else failures.push("partners");
      if (referralResult.status === "fulfilled") setReferrals(referralResult.value.referrals || []);
      else failures.push("referrals");
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
      setStatus(authMessage(error));
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
      setStatus(authMessage(error));
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
    setTab("inbox");
    window.history.replaceState(null, "", "#operations-inbox");
    window.requestAnimationFrame(() => {
      document.getElementById("operations-inbox")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  async function runEcosystemCheck() {
    setEcosystemBusy(true);
    setStatus("Checking the protected demo journey...");
    try {
      const result = await api("/api/admin/ecosystem-health");
      setEcosystemHealth(result as unknown as EcosystemHealth);
      setStatus(
        result.status === "healthy"
          ? "The full demo ecosystem passed every readiness check."
          : "The demo ecosystem check found steps that need attention.",
      );
    } catch (error) {
      setStatus(authMessage(error));
    } finally {
      setEcosystemBusy(false);
    }
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
    if (notification.actorType === "customer" || ["customer_account", "customer_project"].includes(notification.entityType)) {
      if (!notification.actorUid) {
        setStatus("The customer record could not be identified from this notification.");
        return;
      }
      setDirectoryTarget({ type: "customer", uid: notification.actorUid, nonce: Date.now() });
      setTab("customers");
      return;
    }
    if (notification.entityType === "supplier_product") {
      setTab("catalogue");
      return;
    }
    if (notification.entityType === "trade_referral") {
      setTab("referrals");
      return;
    }
    if (["supplier_product_enquiry", "installer_product_list"].includes(notification.entityType)) {
      setTab("enquiries");
      return;
    }
    if (notification.entityType === "trade_handover_pack") {
      setTab("handovers");
      return;
    }
    if (notification.entityType === "asset_safety_notice") {
      setTab("asset-safety");
      return;
    }
    if (["customer_asset_transfer", "trade_handover_correction"].includes(notification.entityType)) {
      setTab("asset-governance");
      return;
    }
    if (["trade_opportunity_match", "customer_project_quote"].includes(notification.entityType)) {
      setTab("opportunities");
      return;
    }
    if (["trade_account", "verification_document"].includes(notification.entityType) || ["installer", "supplier"].includes(notification.actorType)) {
      if (notification.actorUid) {
        setPartnerTarget({ uid: notification.actorUid, nonce: Date.now() });
        setTab("partners");
        return;
      }
    }
    setTab("opportunities");
  }

  async function moderateReferral(
    referral: ReferralRecord,
    action: "approve" | "reject" | "retry",
  ) {
    const note = action === "reject"
      ? window.prompt("Record the reason this referral is not eligible:", referral.riskReason || "") || ""
      : "";
    if (action === "reject" && !note.trim()) return;
    setStatus(`${readable(action)} referral reward...`);
    try {
      await api("/api/admin/referrals", {
        method: "PATCH",
        body: JSON.stringify({ id: referral.id, action, note }),
      });
      const result = await api("/api/admin/referrals");
      setReferrals(result.referrals || []);
      setStatus("Referral decision saved and added to the audit history.");
    } catch (error) {
      setStatus(authMessage(error));
    }
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
  const paidAccounts = accountListCounts.paid;
  const freeAccounts = accountListCounts.free;
  const hiddenSuppliers = accountListCounts.hiddenSuppliers;
  const leadLockedInstallers = accountListCounts.leadLockedInstallers;
  const openProductEnquiries = productEnquirySummary.open;
  const activeOwners = admins.filter(
    (item) => item.role === "owner" && item.status === "active",
  ).length;
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
      <header className="admin-topbar">
        <AdminTLinkBrand context="Operations control centre" />
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
            <strong>{notificationCounts.unread || 0}</strong>
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
        <nav className="admin-sidebar" aria-label="Operations sections">
          <button
            className={tab === "inbox" ? "active" : ""}
            onClick={() => setTab("inbox")}
          >
            <span>01</span>Inbox
            {notificationCounts.action_required > 0 && <strong className="admin-nav-count">{notificationCounts.action_required}</strong>}
          </button>
          <button
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            <span>02</span>Overview
          </button>
          <button
            className={tab === "directory" ? "active" : ""}
            onClick={() => setTab("directory")}
          >
            <span>03</span>All accounts
          </button>
          <button
            className={tab === "jobs" ? "active" : ""}
            onClick={() => setTab("jobs")}
          >
            <span>04</span>Jobs
          </button>
          <button
            className={tab === "customers" ? "active" : ""}
            onClick={() => setTab("customers")}
          >
            <span>05</span>Customers ({customerCounts.total || 0})
          </button>
          <button
            className={tab === "partners" ? "active" : ""}
            onClick={() => setTab("partners")}
          >
            <span>06</span>Partners ({accountCounts.total || 0})
          </button>
          <button
            className={tab === "opportunities" ? "active" : ""}
            onClick={() => setTab("opportunities")}
          >
            <span>07</span>Leads ({opportunityCounts.total || 0})
          </button>
          <button
            className={tab === "catalogue" ? "active" : ""}
            onClick={() => setTab("catalogue")}
          >
            <span>08</span>Products ({productCounts.total || 0})
          </button>
          <button
            className={tab === "enquiries" ? "active" : ""}
            onClick={() => setTab("enquiries")}
          >
            <span>09</span>Product enquiries
          </button>
          <button
            className={tab === "handovers" ? "active" : ""}
            onClick={() => setTab("handovers")}
          >
            <span>10</span>Handovers
          </button>
          <button
            className={tab === "asset-safety" ? "active" : ""}
            onClick={() => setTab("asset-safety")}
          >
            <span>11</span>Asset safety
          </button>
          <button
            className={tab === "asset-governance" ? "active" : ""}
            onClick={() => setTab("asset-governance")}
          >
            <span>12</span>Asset governance
          </button>
          <button
            className={tab === "form-governance" ? "active" : ""}
            onClick={() => setTab("form-governance")}
          >
            <span>13</span>Field forms
          </button>
          <button
            className={tab === "referrals" ? "active" : ""}
            onClick={() => setTab("referrals")}
          >
            <span>14</span>Referrals
          </button>
          <button
            className={tab === "field-pilot" ? "active" : ""}
            onClick={() => setTab("field-pilot")}
          >
            <span>15</span>Field pilot
          </button>
          {session.role === "owner" && (
            <button
              className={tab === "access" ? "active" : ""}
              onClick={() => setTab("access")}
            >
              <span>16</span>Access & audit
            </button>
          )}
          <aside>
            <strong>Privacy boundary</strong>
            <p>
              Wholesalers never see household opportunities. Installer
              allocations exclude names, street addresses and contact details.
              The platform does not release them to trade accounts.
            </p>
          </aside>
        </nav>
        <section className="admin-content">
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
                setTab("partners");
              }}
              onManageAdmin={() => {
                if (session.role === "owner") setTab("access");
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
                setTab("partners");
              }}
              onManageAdmin={() => {
                if (session.role === "owner") setTab("access");
                else setStatus("Only an owner can change operations access.");
              }}
            />
          )}
          {tab === "handovers" && user && <AdminHandoverReview user={user} role={session.role} />}
          {tab === "asset-safety" && user && <AdminAssetSafety user={user} role={session.role} />}
          {tab === "asset-governance" && user && <AdminAssetGovernance user={user} role={session.role} />}
          {tab === "form-governance" && <AdminFormTemplates api={api} role={session.role} />}
          {tab === "field-pilot" && <AdminUsabilityPilot api={api} role={session.role} />}
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
              <section className="admin-access-metrics" aria-label="Membership access health">
                <article><span>Paid memberships</span><strong>{paidAccounts}</strong><small>Commercial role tools active</small></article>
                <article><span>Free profiles</span><strong>{freeAccounts}</strong><small>Setup and verification access only</small></article>
                <article><span>Hidden wholesalers</span><strong>{hiddenSuppliers}</strong><small>Products excluded from installer selection</small></article>
                <article><span>Lead-locked installers</span><strong>{leadLockedInstallers}</strong><small>Excluded from opportunity allocation</small></article>
              </section>
              <section className="admin-panel admin-ecosystem-check" aria-labelledby="ecosystem-check-title">
                <div className="admin-panel-heading">
                  <span>End-to-end assurance</span>
                  <h2 id="ecosystem-check-title">Ecosystem walkthrough</h2>
                  <p>
                    Run a read-only check across demo customers, six-installer matching,
                    wholesaler catalogue visibility, installer responses and structured quotes.
                    This check never sends a new lead or exposes household information.
                  </p>
                </div>
                <div className="admin-ecosystem-actions">
                  <button type="button" onClick={() => void runEcosystemCheck()} disabled={ecosystemBusy}>
                    {ecosystemBusy ? "Checking journey..." : ecosystemHealth ? "Run check again" : "Run ecosystem check"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setOpportunityDemoRequest((current) => current + 1);
                      setTab("opportunities");
                    }}
                  >
                    Open demo enquiries
                  </button>
                  {ecosystemHealth && (
                    <span className={`admin-ecosystem-state ${ecosystemHealth.status}`}>
                      {ecosystemHealth.status === "healthy" ? "All checks passed" : "Attention required"}
                    </span>
                  )}
                </div>
                {ecosystemHealth && (
                  <div className="admin-ecosystem-results">
                    {ecosystemHealth.checks.map((check) => (
                      <article key={check.key} className={check.passed ? "passed" : "attention"}>
                        <span aria-hidden="true">{check.passed ? "OK" : "!"}</span>
                        <div>
                          <strong>{check.label}</strong>
                          <small>{check.detail}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              {["owner", "admin"].includes(session.role) && <AdminPerformancePanel api={api} />}
              {["owner", "admin"].includes(session.role) && <AdminServiceFollowUpReporting api={api} />}
              <div className="admin-overview-grid">
                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <span>Priority queues</span>
                    <h2>What needs attention</h2>
                  </div>
                  <div className="admin-queue-list">
                    <button onClick={() => setTab("inbox")}>
                      <strong>{notificationCounts.overdue || 0}</strong>
                      <span>Operations cases past their response target</span>
                    </button>
                    <button onClick={() => setTab("inbox")}>
                      <strong>{notificationCounts.unassigned || 0}</strong>
                      <span>Actionable cases without a responsible administrator</span>
                    </button>
                    <button onClick={() => setTab("inbox")}>
                      <strong>{notificationCounts.action_required || 0}</strong>
                      <span>Inbox items requiring action or approval</span>
                    </button>
                    <button
                      onClick={() => {
                        setTab("partners");
                        setPartnerVerificationTarget("under_review");
                      }}
                    >
                      <strong>{verificationCounts.awaiting || 0}</strong>
                      <span>Verification submissions awaiting review</span>
                    </button>
                    <button onClick={() => setTab("opportunities")}>
                      <strong>{opportunityCounts.draft || 0}</strong>
                      <span>Draft opportunities requiring scope review</span>
                    </button>
                    <button onClick={() => setTab("catalogue")}>
                      <strong>{productCounts.pending || 0}</strong>
                      <span>Wholesaler products awaiting catalogue review</span>
                    </button>
                    <button onClick={() => setTab("enquiries")}>
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
                            {item.administrator} Ãƒâ€šÃ‚Â· {dateTime(item.created_at)}
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
              <AdminAccountWorkspace api={api} role={session.role} setStatus={setStatus} onCounts={setAccountListCounts} target={partnerTarget} verificationTarget={partnerVerificationTarget} />
            </>
          )}

          {tab === "opportunities" && (
            <AdminOpportunityWorkspace api={api} demoOnlyRequest={opportunityDemoRequest} role={session.role} setStatus={setStatus} />
          )}

          {tab === "catalogue" && (
            <AdminCatalogueWorkspace api={api} role={session.role} setStatus={setStatus} />
          )}


          {tab === "enquiries" && <AdminProductEnquiryWorkspace api={api} setStatus={setStatus} onSummary={setProductEnquirySummary} />}

          {tab === "referrals" && (
            <>
              <header className="admin-page-heading">
                <span>Member growth controls</span>
                <h1>Referral rewards and eligibility</h1>
                <p>
                  Follow each new-business referral from signup to first paid
                  membership and confirm that both one-month extensions were
                  applied. Exact duplicate signals pause a reward for review.
                </p>
              </header>
              <section className="admin-metric-grid">
                <article><span>Total referrals</span><strong>{referrals.length}</strong><small>One reward maximum per new business</small></article>
                <article><span>Awaiting payment</span><strong>{referrals.filter((item) => item.status === "registered").length}</strong><small>Profile created, first payment not yet cleared</small></article>
                <article><span>Needs review</span><strong>{referrals.filter((item) => ["review_required", "reward_failed"].includes(item.status)).length}</strong><small>Eligibility or Stripe retry attention</small></article>
                <article><span>Completed</span><strong>{referrals.filter((item) => item.status === "rewarded").length}</strong><small>Two membership months applied</small></article>
              </section>
              <section className="admin-panel admin-referral-workspace">
                <div className="admin-panel-heading">
                  <span>Two-sided ledger</span>
                  <h2>Referral history</h2>
                  <p>Monthly members receive their second month free; annual members receive month 13 free.</p>
                </div>
                <div className="admin-referral-list tlink-data-table">
                  {referrals.length ? referrals.map((item) => (
                    <article key={item.id}>
                      <div className="admin-referral-parties">
                        <div><span>Referrer</span><strong>{item.referrerBusiness}</strong><small>{item.referrerEmail}</small></div>
                        <b aria-hidden="true">to</b>
                        <div><span>New member</span><strong>{item.referredBusiness}</strong><small>{item.referredEmail}</small></div>
                      </div>
                      <div className="admin-referral-status">
                        <span className={`admin-pill admin-pill-${item.status}`}>{readable(item.status)}</span>
                        <small>{item.code} Ãƒâ€šÃ‚Â· joined {dateTime(item.registeredAt)}</small>
                        <small>{item.appliedCredits}/2 free months applied</small>
                        {item.riskReason && <p>{item.riskReason}</p>}
                      </div>
                      {["owner", "admin"].includes(session.role) && (
                        <div className="admin-referral-actions">
                          {item.status === "review_required" && <button onClick={() => void moderateReferral(item, "approve")}>Approve eligibility</button>}
                          {item.status === "reward_failed" && <button onClick={() => void moderateReferral(item, "retry")}>Retry reward</button>}
                          {!['rewarded', 'rejected'].includes(item.status) && <button className="danger" onClick={() => void moderateReferral(item, "reject")}>Reject</button>}
                        </div>
                      )}
                    </article>
                  )) : <p className="admin-empty">No referral links have produced a new member yet.</p>}
                </div>
              </section>
            </>
          )}

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
                      <option value="support">Support Ãƒâ€šÃ‚Â· read accounts</option>
                      <option value="reviewer">
                        Reviewer Ãƒâ€šÃ‚Â· verification decisions
                      </option>
                      <option value="admin">
                        Administrator Ãƒâ€šÃ‚Â· partners and projects
                      </option>
                      <option value="owner">Owner Ãƒâ€šÃ‚Â· access management</option>
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
                        {item.administrator} Ãƒâ€šÃ‚Â· {readable(item.action)}
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
