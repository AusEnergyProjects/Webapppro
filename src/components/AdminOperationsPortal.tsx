"use client";

/* eslint-disable @next/next/no-img-element */

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
import {
  FEATURE_DEFINITIONS,
  type FeatureKey,
} from "@/lib/direct-trade-entitlements";
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
import { downloadWorkspaceCsv } from "@/components/WorkspaceTableTools";
import { WorkspaceListControls, type WorkspaceListPreferences } from "@/components/WorkspaceListControls";
import { AdminPerformancePanel } from "@/components/AdminPerformancePanel";
import { AdminOpportunityWorkspace } from "@/components/AdminOpportunityWorkspace";
import { AdminCatalogueWorkspace } from "@/components/AdminCatalogueWorkspace";

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
type Account = {
  firebaseUid: string;
  email: string;
  businessName: string;
  contactName: string;
  phone?: string;
  partnerType: string;
  businessWebsite?: string;
  addressLine1?: string;
  suburb?: string;
  addressState: string;
  postcode: string;
  serviceStates: string[];
  capabilities: string[];
  summary?: string;
  accountStatus: string;
  verificationStatus: string;
  planKey: string;
  billingStatus: string;
  availabilityStatus: string;
  createdAt: string;
  updatedAt: string;
  serviceBasePostcode: string;
  serviceRadiusKm: number;
  membershipActive: boolean;
  isSynthetic: boolean;
};
type AdminFeatureGrant = {
  featureKey: FeatureKey;
  status: "active" | "revoked";
  expiresAt: string;
  note: string;
  updatedAt?: string;
};
type AccountDetail = {
  account: Account;
  documents: Record<string, unknown>[];
  notes: Record<string, unknown>[];
  matches: Record<string, unknown>[];
  featureGrants: AdminFeatureGrant[];
  entitlements: {
    paidMembership: boolean;
    accessLabel: string;
    features: Record<FeatureKey, boolean>;
    activeGrants: FeatureKey[];
  };
};
type ListPagination = { page: number; pageSize: number; total: number; pageCount: number; hasNext?: boolean; nextCursor?: string };
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
type AdminProductEnquiry = {
  id: string;
  status: string;
  message: string;
  supplierNote: string;
  createdAt: string;
  updatedAt: string;
  listId: string;
  listName: string;
  projectPostcode: string;
  installerBusiness: string;
  installerEmail: string;
  supplierBusiness: string;
  supplierEmail: string;
  itemCount: number;
  subtotalCentsExGst: number;
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

const capabilityLabels: Record<string, string> = {
  assessment: "Energy assessment", solar: "Rooftop solar", battery: "Home batteries",
  "heating-cooling": "Heating and cooling", "hot-water": "Hot water",
  "insulation-draughts": "Insulation and draught control", "ev-charging": "EV charging",
  other: "Other energy upgrades",
};
const emptyPagination: ListPagination = { page: 1, pageSize: 25, total: 0, pageCount: 1 };

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
    "inbox" | "overview" | "directory" | "customers" | "partners" | "opportunities" | "catalogue" | "enquiries" | "handovers" | "asset-safety" | "asset-governance" | "form-governance" | "referrals" | "field-pilot" | "access"
  >("inbox");
  const [metrics, setMetrics] = useState<Metrics>({});
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountType, setAccountType] = useState("");
  const [accountVerification, setAccountVerification] = useState("");
  const [accountSynthetic, setAccountSynthetic] = useState("");
  const [accountSort, setAccountSort] = useState("updated-desc");
  const [accountPage, setAccountPage] = useState(1);
  const [accountPageSize, setAccountPageSize] = useState(25);
  const [accountPagination, setAccountPagination] = useState<ListPagination>(emptyPagination);
  const accountCursors = useRef<string[]>([""]);
  const accountTotalReady = useRef(false);
  const [accountListCounts, setAccountListCounts] = useState({ total: 0, paid: 0, free: 0, hiddenSuppliers: 0, leadLockedInstallers: 0 });
  const [accountViewReady, setAccountViewReady] = useState(false);
  const [accountViewSaved, setAccountViewSaved] = useState(false);
  const [accountViewBusy, setAccountViewBusy] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AccountDetail | null>(
    null,
  );
  const [accountNote, setAccountNote] = useState("");
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [productEnquiries, setProductEnquiries] = useState<AdminProductEnquiry[]>([]);
  const [enquirySearch, setEnquirySearch] = useState("");
  const [enquiryStatus, setEnquiryStatus] = useState("");
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

  const loadAccounts = useCallback(async (announce = false) => {
    const params = new URLSearchParams({ page: String(accountPage), pageSize: String(accountPageSize), sort: accountSort });
    const cursor = accountCursors.current[accountPage - 1] || "";
    if (cursor) params.set("cursor", cursor);
    if (accountTotalReady.current) params.set("total", "0");
    if (accountSearch.trim()) params.set("search", accountSearch.trim());
    if (accountType) params.set("partnerType", accountType);
    if (accountVerification) params.set("verification", accountVerification);
    if (accountSynthetic) params.set("synthetic", accountSynthetic);
    try {
      const result = await api(`/api/admin/accounts?${params}`);
      setAccounts(result.accounts || []);
      setAccountPagination((current) => {
        const next = { ...current, ...(result.pagination || {}), page: accountPage, pageSize: accountPageSize };
        if (typeof result.pagination?.total === "number") accountTotalReady.current = true;
        if (next.hasNext && next.nextCursor) accountCursors.current[accountPage] = next.nextCursor;
        accountCursors.current.length = Math.max(accountPage, next.hasNext ? accountPage + 1 : accountPage);
        return next;
      });
      setAccountListCounts(result.counts || { total: 0, paid: 0, free: 0, hiddenSuppliers: 0, leadLockedInstallers: 0 });
      if (announce) setStatus(`${result.pagination?.total || 0} business accounts match this view.`);
    } catch (error) { setStatus(authMessage(error)); }
  }, [accountPage, accountPageSize, accountSearch, accountSort, accountSynthetic, accountType, accountVerification, api]);

  const loadWorkspace = useCallback(
    async (nextSession: AdminSession) => {
      const datasets = await Promise.allSettled([
        api("/api/admin/accounts"),
        api("/api/admin/referrals"),
        api("/api/admin/product-enquiries"),
      ]);
      const failures: string[] = [];
      const [accountResult, referralResult, enquiryResult] = datasets;
      if (accountResult.status === "fulfilled") {
        setAccounts(accountResult.value.accounts || []);
        setAccountPagination(accountResult.value.pagination || emptyPagination);
        accountTotalReady.current = typeof accountResult.value.pagination?.total === "number";
        accountCursors.current = ["", accountResult.value.pagination?.nextCursor || ""].filter((value, index) => index === 0 || Boolean(value));
        setAccountListCounts(accountResult.value.counts || { total: 0, paid: 0, free: 0, hiddenSuppliers: 0, leadLockedInstallers: 0 });
      }
      else failures.push("partners");
      if (referralResult.status === "fulfilled") setReferrals(referralResult.value.referrals || []);
      else failures.push("referrals");
      if (enquiryResult.status === "fulfilled") setProductEnquiries(enquiryResult.value.enquiries || []);
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

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void api("/api/admin/list-views?view=admin-partners").then((partnerView) => {
      if (cancelled) return;
      const preferences = partnerView.preferences as WorkspaceListPreferences;
      setAccountSearch(preferences.search || "");
      setAccountType(preferences.type || "");
      setAccountVerification(preferences.filter === "all" ? "" : preferences.filter || "");
      setAccountSynthetic(preferences.synthetic || "");
      setAccountSort(preferences.sort || "updated-desc");
      setAccountPageSize(preferences.pageSize || 25);
      setAccountViewSaved(Boolean(partnerView.saved));
    }).catch((error) => setStatus(authMessage(error))).finally(() => {
      if (!cancelled) setAccountViewReady(true);
    });
    return () => { cancelled = true; };
  }, [api, session]);

  useEffect(() => {
    accountCursors.current = [""]; accountTotalReady.current = false;
  }, [accountPageSize, accountSearch, accountSort, accountSynthetic, accountType, accountVerification]);
  useEffect(() => {
    if (!session || !accountViewReady) return;
    const timer = window.setTimeout(() => { void loadAccounts(); }, 180);
    return () => window.clearTimeout(timer);
  }, [accountViewReady, loadAccounts, session]);

  async function saveAdminListView(view: string, preferences: WorkspaceListPreferences, setSaved: (saved: boolean) => void, setBusy: (busy: boolean) => void) {
    setBusy(true);
    try {
      await api(`/api/admin/list-views?view=${view}`, { method: "PATCH", body: JSON.stringify(preferences) });
      setSaved(true);
      setStatus("Your default table view has been saved.");
    } catch (error) { setStatus(authMessage(error)); }
    finally { setBusy(false); }
  }

  async function resetAdminListView(view: string, apply: (preferences: WorkspaceListPreferences) => void, setSaved: (saved: boolean) => void, setBusy: (busy: boolean) => void) {
    setBusy(true);
    try {
      const result = await api(`/api/admin/list-views?view=${view}`, { method: "DELETE" });
      apply(result.preferences as WorkspaceListPreferences);
      setSaved(false);
      setStatus("The table view has been reset to the TLink default.");
    } catch (error) { setStatus(authMessage(error)); }
    finally { setBusy(false); }
  }

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

  async function searchAccounts(event?: FormEvent) {
    event?.preventDefault();
    if (accountPage !== 1) setAccountPage(1);
    else await loadAccounts(true);
  }

  function applyPartnerView(preferences: WorkspaceListPreferences) {
    setAccountSearch(preferences.search || ""); setAccountType(preferences.type || "");
    setAccountVerification(preferences.filter === "all" ? "" : preferences.filter || "");
    setAccountSynthetic(preferences.synthetic || ""); setAccountSort(preferences.sort || "updated-desc");
    setAccountPageSize(preferences.pageSize || 25); setAccountPage(1);
  }

  function savePartnerView() {
    void saveAdminListView("admin-partners", { search: accountSearch, filter: accountVerification || "all", sort: accountSort, pageSize: accountPageSize, type: accountType, synthetic: accountSynthetic }, setAccountViewSaved, setAccountViewBusy);
  }

  function resetPartnerView() {
    void resetAdminListView("admin-partners", applyPartnerView, setAccountViewSaved, setAccountViewBusy);
  }

  async function searchProductEnquiries(event?: FormEvent) {
    event?.preventDefault();
    setStatus("Refreshing product enquiries...");
    try {
      const params = new URLSearchParams();
      if (enquirySearch.trim()) params.set("search", enquirySearch.trim());
      if (enquiryStatus) params.set("status", enquiryStatus);
      const result = await api(`/api/admin/product-enquiries?${params}`);
      setProductEnquiries(result.enquiries || []);
      setStatus(`${result.enquiries?.length || 0} product enquiries shown.`);
    } catch (error) {
      setStatus(authMessage(error));
    }
  }

  async function openAccount(uid: string) {
    setStatus("Loading account details...");
    try {
      const result = await api(
        `/api/admin/accounts?uid=${encodeURIComponent(uid)}`,
      );
      setSelectedAccount({
        ...result,
        featureGrants: result.featureGrants || [],
      });
      setAccountNote("");
      setStatus("");
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
        setTab("partners");
        void openAccount(notification.actorUid);
        return;
      }
    }
    setTab("opportunities");
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    if (!selectedAccount) return;
    setStatus("Saving moderation decision...");
    try {
      await api("/api/admin/accounts", {
        method: "PATCH",
        body: JSON.stringify({
          firebaseUid: selectedAccount.account.firebaseUid,
          accountStatus: selectedAccount.account.accountStatus,
          verificationStatus: selectedAccount.account.verificationStatus,
          availabilityStatus: selectedAccount.account.availabilityStatus,
          planKey: selectedAccount.account.planKey,
          billingStatus: selectedAccount.account.billingStatus,
          ...(["owner", "admin"].includes(session?.role || "")
            ? {
                featureGrants: FEATURE_DEFINITIONS.map((feature) => {
                  const grant = selectedAccount.featureGrants.find(
                    (item) => item.featureKey === feature.key,
                  );
                  return {
                    featureKey: feature.key,
                    enabled: grant?.status === "active",
                    expiresAt: grant?.expiresAt || "",
                    note: grant?.note || "",
                  };
                }),
              }
            : {}),
          note: accountNote,
        }),
      });
      await openAccount(selectedAccount.account.firebaseUid);
      await searchAccounts();
      setStatus("Account decision saved and recorded in the audit history.");
    } catch (error) {
      setStatus(authMessage(error));
    }
  }

  function updateSelectedAccount(key: keyof Account, value: string) {
    setSelectedAccount((current) =>
      current
        ? { ...current, account: { ...current.account, [key]: value } }
        : current,
    );
  }

  function updateFeatureGrant(
    featureKey: FeatureKey,
    update: Partial<AdminFeatureGrant>,
  ) {
    setSelectedAccount((current) => {
      if (!current) return current;
      const existing = current.featureGrants.find(
        (item) => item.featureKey === featureKey,
      ) || {
        featureKey,
        status: "revoked" as const,
        expiresAt: "",
        note: "",
      };
      return {
        ...current,
        featureGrants: [
          ...current.featureGrants.filter(
            (item) => item.featureKey !== featureKey,
          ),
          { ...existing, ...update },
        ],
      };
    });
  }

  async function downloadEvidence(id: unknown, fileName: unknown) {
    setStatus("Preparing protected document download...");
    try {
      const activeUser = firebaseAuth.currentUser;
      if (!activeUser) throw new Error("Sign in to continue.");
      const token = await activeUser.getIdToken();
      const response = await fetch(
        `/api/admin/evidence?id=${encodeURIComponent(String(id))}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Document download failed.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = String(fileName || "verification-document");
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(
        "Protected document download started and was added to the audit history.",
      );
    } catch (error) {
      setStatus(authMessage(error));
    }
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
  const openProductEnquiries = productEnquiries.filter((item) => ["new", "viewed"].includes(item.status)).length;
  const respondedProductEnquiries = productEnquiries.filter((item) => item.status === "responded").length;
  const enquiryValueCents = productEnquiries.reduce((total, item) => total + item.subtotalCentsExGst, 0);
  const activeOwners = admins.filter(
    (item) => item.role === "owner" && item.status === "active",
  ).length;
  function exportPartners() {
    downloadWorkspaceCsv("tlink-admin-partners.csv", [
      { key: "business", label: "Business" }, { key: "type", label: "Type" }, { key: "email", label: "Email" },
      { key: "state", label: "State" }, { key: "postcode", label: "Postcode" }, { key: "verification", label: "Verification" },
      { key: "account", label: "Account" }, { key: "membership", label: "Membership" }, { key: "updated", label: "Updated" },
    ], accounts.map((account) => ({ business: account.businessName, type: account.partnerType === "supplier" ? "Wholesaler" : "Installer", email: account.email,
      state: account.addressState, postcode: account.postcode, verification: readable(account.verificationStatus), account: readable(account.accountStatus),
      membership: account.membershipActive ? "Paid" : "Free", updated: dateTime(account.updatedAt) })));
  }

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
            className={tab === "customers" ? "active" : ""}
            onClick={() => setTab("customers")}
          >
            <span>04</span>Customers ({customerCounts.total || 0})
          </button>
          <button
            className={tab === "partners" ? "active" : ""}
            onClick={() => setTab("partners")}
          >
            <span>05</span>Partners ({accountCounts.total || 0})
          </button>
          <button
            className={tab === "opportunities" ? "active" : ""}
            onClick={() => setTab("opportunities")}
          >
            <span>06</span>Leads ({opportunityCounts.total || 0})
          </button>
          <button
            className={tab === "catalogue" ? "active" : ""}
            onClick={() => setTab("catalogue")}
          >
            <span>07</span>Products ({productCounts.total || 0})
          </button>
          <button
            className={tab === "enquiries" ? "active" : ""}
            onClick={() => setTab("enquiries")}
          >
            <span>08</span>Product enquiries
          </button>
          <button
            className={tab === "handovers" ? "active" : ""}
            onClick={() => setTab("handovers")}
          >
            <span>09</span>Handovers
          </button>
          <button
            className={tab === "asset-safety" ? "active" : ""}
            onClick={() => setTab("asset-safety")}
          >
            <span>10</span>Asset safety
          </button>
          <button
            className={tab === "asset-governance" ? "active" : ""}
            onClick={() => setTab("asset-governance")}
          >
            <span>11</span>Asset governance
          </button>
          <button
            className={tab === "form-governance" ? "active" : ""}
            onClick={() => setTab("form-governance")}
          >
            <span>12</span>Field forms
          </button>
          <button
            className={tab === "referrals" ? "active" : ""}
            onClick={() => setTab("referrals")}
          >
            <span>13</span>Referrals
          </button>
          <button
            className={tab === "field-pilot" ? "active" : ""}
            onClick={() => setTab("field-pilot")}
          >
            <span>14</span>Field pilot
          </button>
          {session.role === "owner" && (
            <button
              className={tab === "access" ? "active" : ""}
              onClick={() => setTab("access")}
            >
              <span>15</span>Access & audit
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
                setTab("partners");
                void openAccount(uid);
              }}
              onManageAdmin={() => {
                if (session.role === "owner") setTab("access");
                else setStatus("Only an owner can change operations access.");
              }}
            />
          )}
          {tab === "customers" && (
            <AdminAccountDirectory
              api={api}
              role={session.role}
              fixedType="customer"
              target={directoryTarget?.type === "customer" ? directoryTarget : null}
              onManageTrade={(uid) => {
                setTab("partners");
                void openAccount(uid);
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
                        setAccountVerification("under_review");
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
                            {item.administrator} Ã‚Â· {dateTime(item.created_at)}
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
              <header className="admin-page-heading">
                <span>Business network</span>
                <h1>Partner and wholesaler accounts</h1>
                <p>
                  Search profiles, review evidence and control account,
                  verification and membership state.
                </p>
              </header>
              <form className="admin-filterbar" onSubmit={searchAccounts}>
                <input
                  aria-label="Search accounts"
                  placeholder="Business, contact, email or postcode"
                  value={accountSearch}
                  onChange={(event) => { setAccountSearch(event.target.value); setAccountPage(1); }}
                />
                <select
                  aria-label="Partner type"
                  value={accountType}
                  onChange={(event) => { setAccountType(event.target.value); setAccountPage(1); }}
                >
                  <option value="">All partner types</option>
                  <option value="installer">Installers</option>
                  <option value="supplier">Wholesalers</option>
                </select>
                <select aria-label="Test account marker" value={accountSynthetic} onChange={(event) => { setAccountSynthetic(event.target.value); setAccountPage(1); }}>
                  <option value="">Live and demo accounts</option>
                  <option value="exclude">Live accounts only</option>
                  <option value="only">Demo accounts only</option>
                </select>
                <select
                  aria-label="Verification status"
                  value={accountVerification}
                  onChange={(event) => { setAccountVerification(event.target.value); setAccountPage(1); }}
                >
                  <option value="">All verification states</option>
                  {[
                    "not_started",
                    "submitted",
                    "under_review",
                    "needs_information",
                    "approved",
                    "rejected",
                    "expired",
                  ].map((value) => (
                    <option value={value} key={value}>
                      {readable(value)}
                    </option>
                  ))}
                </select>
                <select aria-label="Sort partners" value={accountSort} onChange={(event) => { setAccountSort(event.target.value); setAccountPage(1); }}>
                  <option value="updated-desc">Recently updated</option>
                  <option value="updated-asc">Oldest updated</option>
                  <option value="name-asc">Business A to Z</option>
                  <option value="name-desc">Business Z to A</option>
                  <option value="type-asc">Partner type</option>
                  <option value="verification-asc">Verification status</option>
                  <option value="status-asc">Account status</option>
                </select>
                <button type="submit">Apply filters</button>
              </form>
              <WorkspaceListControls page={accountPagination.page} pageCount={accountPagination.pageCount} pageSize={accountPagination.pageSize} total={accountPagination.total} hasNext={accountPagination.hasNext}
                saved={accountViewSaved} busy={accountViewBusy} onPage={setAccountPage} onPageSize={(size) => { setAccountPageSize(size); setAccountPage(1); }}
                onSave={savePartnerView} onReset={resetPartnerView} />
              <div className="workspace-table-actionbar"><button className="workspace-csv-export" type="button" disabled={!accounts.length} onClick={exportPartners}>Export visible partners CSV</button></div>
              <div className="admin-partner-layout">
                <section className="admin-panel admin-account-list tlink-data-table">
                  <div className="admin-table-header">
                    <span>Business</span>
                    <span>Type</span>
                    <span>Verification</span>
                    <span>Account</span>
                  </div>
                  {accounts.length ? (
                    accounts.map((account) => (
                      <button
                        key={account.firebaseUid}
                        className={
                          selectedAccount?.account.firebaseUid ===
                          account.firebaseUid
                            ? "selected"
                            : ""
                        }
                        onClick={() => void openAccount(account.firebaseUid)}
                      >
                        <span>
                          <strong>{account.businessName}{account.isSynthetic && <b className="admin-synthetic-marker">Demo</b>}</strong>
                          <small>
                            {account.email}
                            <br />
                            {account.addressState} {account.postcode}
                            {" Ã‚Â· "}{account.membershipActive ? "Paid" : "Free"}
                          </small>
                        </span>
                        <span>
                          {account.partnerType === "supplier"
                            ? "Wholesaler"
                            : "Installer"}
                        </span>
                        <span
                          className={`admin-pill admin-pill-${account.verificationStatus}`}
                        >
                          {readable(account.verificationStatus)}
                        </span>
                        <span
                          className={`admin-pill admin-pill-${account.accountStatus}`}
                        >
                          {readable(account.accountStatus)}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="admin-empty">
                      No accounts match these filters.
                    </p>
                  )}
                </section>
                <aside className="admin-panel admin-account-detail">
                  {selectedAccount ? (
                    <>
                      <div className="admin-panel-heading">
                        <span>{selectedAccount.account.partnerType}</span>
                        <h2>{selectedAccount.account.businessName}</h2>
                        <p>
                          {selectedAccount.account.contactName} Ã‚Â·{" "}
                          {selectedAccount.account.email} Ã‚Â·{" "}
                          {selectedAccount.account.phone || "No phone"}
                        </p>
                      </div>
                      <div className="admin-business-facts">
                        <div>
                          <span>Business address</span>
                          <strong>
                            {selectedAccount.account.addressLine1}
                            <br />
                            {selectedAccount.account.suburb}{" "}
                            {selectedAccount.account.addressState}{" "}
                            {selectedAccount.account.postcode}
                          </strong>
                        </div>
                        <div>
                          <span>Serviceability</span>
                          <strong>
                            {selectedAccount.account.partnerType === "installer"
                              ? `${selectedAccount.account.serviceBasePostcode || selectedAccount.account.postcode} base, ${selectedAccount.account.serviceRadiusKm || 50} km radius; ${selectedAccount.account.serviceStates.join(", ")}`
                              : selectedAccount.account.serviceStates.join(
                                  ", ",
                                )}
                          </strong>
                        </div>
                        <div>
                          <span>Capabilities</span>
                          <strong>
                            {selectedAccount.account.capabilities
                              .map(
                                (value) =>
                                  capabilityLabels[value] || readable(value),
                              )
                              .join(", ")}
                          </strong>
                        </div>
                        <div>
                          <span>Joined</span>
                          <strong>
                            {dateTime(selectedAccount.account.createdAt)}
                          </strong>
                        </div>
                      </div>
                      <form
                        className="admin-moderation-form"
                        onSubmit={saveAccount}
                      >
                        <label>
                          Account status
                          <select
                            value={selectedAccount.account.accountStatus}
                            onChange={(event) =>
                              updateSelectedAccount(
                                "accountStatus",
                                event.target.value,
                              )
                            }
                            disabled={session.role === "reviewer"}
                          >
                            <option>active</option>
                            <option>suspended</option>
                            <option>closed</option>
                          </select>
                        </label>
                        <label>
                          Verification
                          <select
                            value={selectedAccount.account.verificationStatus}
                            onChange={(event) =>
                              updateSelectedAccount(
                                "verificationStatus",
                                event.target.value,
                              )
                            }
                          >
                            {[
                              "not_started",
                              "submitted",
                              "under_review",
                              "needs_information",
                              "approved",
                              "rejected",
                              "expired",
                            ].map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Availability
                          <select
                            value={selectedAccount.account.availabilityStatus}
                            onChange={(event) =>
                              updateSelectedAccount(
                                "availabilityStatus",
                                event.target.value,
                              )
                            }
                            disabled={session.role === "reviewer"}
                          >
                            <option>open</option>
                            <option>limited</option>
                            <option>paused</option>
                          </select>
                        </label>
                        <label>
                          Membership plan
                          <select
                            value={selectedAccount.account.planKey}
                            onChange={(event) =>
                              updateSelectedAccount(
                                "planKey",
                                event.target.value,
                              )
                            }
                            disabled={session.role === "reviewer"}
                          >
                            {[
                              "unselected",
                              "installer_annual",
                              "installer_monthly",
                              "supplier_annual",
                              "supplier_monthly",
                            ].map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Billing state
                          <select
                            value={selectedAccount.account.billingStatus}
                            onChange={(event) =>
                              updateSelectedAccount(
                                "billingStatus",
                                event.target.value,
                              )
                            }
                            disabled={session.role === "reviewer"}
                          >
                            {[
                              "not_connected",
                              "processing",
                              "trial",
                              "active",
                              "active_cancels_at_period_end",
                              "past_due",
                              "paused",
                              "cancelled",
                            ].map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </label>
                        <section className="admin-feature-controls full">
                          <div>
                            <span>Access and entitlements</span>
                            <h3>Premium feature grants</h3>
                            <p>
                              Paid membership includes the role-specific commercial
                              tools. Use grants for trials, service recovery or
                              individually approved premium add-ons. Every change is audited.
                            </p>
                          </div>
                          <div className="admin-feature-summary">
                            <strong>{selectedAccount.entitlements.accessLabel}</strong>
                            <span>
                              {selectedAccount.account.partnerType === "supplier"
                                ? "Unpaid wholesalers stay invisible to installers unless visibility is granted."
                                : "Free installers receive no leads unless lead access is granted."}
                            </span>
                          </div>
                          <div className="admin-feature-grid">
                            {FEATURE_DEFINITIONS.filter((feature) =>
                              feature.roles.includes(
                                selectedAccount.account.partnerType as "installer" | "supplier",
                              ),
                            ).map((feature) => {
                              const grant = selectedAccount.featureGrants.find(
                                (item) => item.featureKey === feature.key,
                              );
                              const enabled = grant?.status === "active";
                              const included =
                                feature.tier === "membership" &&
                                selectedAccount.entitlements.paidMembership;
                              return (
                                <article key={feature.key} className={enabled ? "enabled" : ""}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={enabled}
                                      disabled={!['owner', 'admin'].includes(session.role)}
                                      onChange={(event) =>
                                        updateFeatureGrant(feature.key, {
                                          status: event.target.checked ? "active" : "revoked",
                                        })
                                      }
                                    />
                                    <span>
                                      <strong>{feature.label}</strong>
                                      <small>{feature.description}</small>
                                    </span>
                                  </label>
                                  <div>
                                    <span className="admin-feature-tier">
                                      {included ? "Included in paid plan" : feature.tier === "premium" ? "Premium add-on" : "Membership override"}
                                    </span>
                                    <label>
                                      Grant expiry
                                      <input
                                        type="date"
                                        value={grant?.expiresAt?.slice(0, 10) || ""}
                                        disabled={!enabled || !['owner', 'admin'].includes(session.role)}
                                        onChange={(event) =>
                                          updateFeatureGrant(feature.key, {
                                            expiresAt: event.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                    <label>
                                      Grant note
                                      <input
                                        value={grant?.note || ""}
                                        disabled={!enabled || !['owner', 'admin'].includes(session.role)}
                                        placeholder="Reason, approval or service case"
                                        onChange={(event) =>
                                          updateFeatureGrant(feature.key, {
                                            note: event.target.value,
                                          })
                                        }
                                      />
                                    </label>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                        <label className="full">
                          Internal moderation note
                          <textarea
                            value={accountNote}
                            onChange={(event) =>
                              setAccountNote(event.target.value)
                            }
                            placeholder="Record evidence reviewed, follow-up needed or reason for a decision."
                          />
                        </label>
                        <button type="submit">Save and audit decision</button>
                      </form>
                      <section className="admin-evidence-section">
                        <h3>Verification evidence</h3>
                        {selectedAccount.documents.length ? (
                          selectedAccount.documents.map((document) => (
                            <article key={String(document.id)}>
                              <div>
                                <strong>{String(document.file_name)}</strong>
                                <small>
                                  {readable(String(document.category))} Ã‚Â·{" "}
                                  {Math.ceil(
                                    Number(document.size_bytes) / 1024,
                                  )}{" "}
                                  KB Ã‚Â· {readable(String(document.status))}
                                </small>
                              </div>
                              <button
                                onClick={() =>
                                  void downloadEvidence(
                                    document.id,
                                    document.file_name,
                                  )
                                }
                              >
                                Protected download
                              </button>
                            </article>
                          ))
                        ) : (
                          <p>No verification documents uploaded.</p>
                        )}
                      </section>
                      <section className="admin-notes-section">
                        <h3>Internal notes</h3>
                        {selectedAccount.notes.length ? (
                          selectedAccount.notes.map((note) => (
                            <article key={String(note.id)}>
                              <p>{String(note.note)}</p>
                              <small>
                                {String(note.author)} Ã‚Â·{" "}
                                {dateTime(note.created_at)}
                              </small>
                            </article>
                          ))
                        ) : (
                          <p>No internal notes recorded.</p>
                        )}
                      </section>
                    </>
                  ) : (
                    <div className="admin-empty admin-empty-detail">
                      <strong>Select a business account</strong>
                      <p>
                        The detailed moderation view, evidence list and internal
                        notes will appear here.
                      </p>
                    </div>
                  )}
                </aside>
              </div>
            </>
          )}

          {tab === "opportunities" && (
            <AdminOpportunityWorkspace api={api} demoOnlyRequest={opportunityDemoRequest} role={session.role} setStatus={setStatus} />
          )}

          {tab === "catalogue" && (
            <AdminCatalogueWorkspace api={api} role={session.role} setStatus={setStatus} />
          )}


          {tab === "enquiries" && (
            <>
              <header className="admin-page-heading">
                <span>Trade supply workflow</span>
                <h1>Installer product enquiries</h1>
                <p>
                  Monitor which paid installers are selecting approved products,
                  whether wholesalers are responding and the indicative ex-GST
                  value moving through the trade supply network.
                </p>
              </header>
              <section className="admin-metric-grid">
                <article><span>Total enquiries</span><strong>{productEnquiries.length}</strong><small>One enquiry per project list and wholesaler</small></article>
                <article><span>Awaiting response</span><strong>{openProductEnquiries}</strong><small>New or reviewed by the wholesaler</small></article>
                <article><span>Responded</span><strong>{respondedProductEnquiries}</strong><small>Wholesaler follow-up recorded</small></article>
                <article><span>Indicative value</span><strong>{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(enquiryValueCents / 100)}</strong><small>Selected product snapshots before GST</small></article>
              </section>
              <form className="admin-filterbar admin-enquiry-filterbar" onSubmit={searchProductEnquiries}>
                <input aria-label="Search product enquiries" placeholder="Installer, wholesaler, project list or postcode" value={enquirySearch} onChange={(event) => setEnquirySearch(event.target.value)} />
                <select aria-label="Product enquiry status" value={enquiryStatus} onChange={(event) => setEnquiryStatus(event.target.value)}>
                  <option value="">All enquiry states</option>
                  <option value="new">New</option>
                  <option value="viewed">Viewed</option>
                  <option value="responded">Responded</option>
                  <option value="closed">Closed</option>
                </select>
                <button type="submit">Apply filters</button>
              </form>
              <section className="admin-panel admin-product-enquiry-workspace">
                <div className="admin-panel-heading">
                  <span>Commercial handoff</span>
                  <h2>Selection and response history</h2>
                  <p>
                    Product enquiries contain installer business details and
                    commercial project context only. Household contact details
                    and street addresses are outside this workflow.
                  </p>
                </div>
                <div className="admin-product-enquiry-list tlink-data-table">
                  {productEnquiries.length ? productEnquiries.map((item) => (
                    <article key={item.id}>
                      <header>
                        <div>
                          <span>{item.projectPostcode || "No postcode"} Ã‚Â· {dateTime(item.createdAt)}</span>
                          <h3>{item.listName}</h3>
                        </div>
                        <span className={`admin-pill admin-pill-${item.status}`}>{readable(item.status)}</span>
                      </header>
                      <div className="admin-enquiry-parties">
                        <div><span>Installer</span><strong>{item.installerBusiness}</strong><small>{item.installerEmail}</small></div>
                        <b aria-hidden="true">to</b>
                        <div><span>Wholesaler</span><strong>{item.supplierBusiness}</strong><small>{item.supplierEmail}</small></div>
                      </div>
                      <div className="admin-enquiry-facts">
                        <span>{item.itemCount} selected item{item.itemCount === 1 ? "" : "s"}</span>
                        <span>{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(item.subtotalCentsExGst / 100)} ex GST indicative</span>
                        <span>Updated {dateTime(item.updatedAt)}</span>
                      </div>
                      {item.message && <p>{item.message}</p>}
                      {item.supplierNote && <small className="admin-enquiry-note">Wholesaler note: {item.supplierNote}</small>}
                    </article>
                  )) : <p className="admin-empty">No product enquiries match this view.</p>}
                </div>
              </section>
            </>
          )}

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
                        <small>{item.code} Ã‚Â· joined {dateTime(item.registeredAt)}</small>
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
                      <option value="support">Support Ã‚Â· read accounts</option>
                      <option value="reviewer">
                        Reviewer Ã‚Â· verification decisions
                      </option>
                      <option value="admin">
                        Administrator Ã‚Â· partners and projects
                      </option>
                      <option value="owner">Owner Ã‚Â· access management</option>
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
                        {item.administrator} Ã‚Â· {readable(item.action)}
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
