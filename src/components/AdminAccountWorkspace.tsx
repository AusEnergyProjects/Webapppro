"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import type { FeatureKey } from "@/lib/direct-trade-entitlements";
import { WorkspaceListControls, type WorkspaceListPreferences } from "@/components/WorkspaceListControls";
import { downloadWorkspaceCsv } from "@/components/WorkspaceTableTools";
import { dateTime, readable, resetWorkspaceListView, saveWorkspaceListView, workspaceError } from "@/components/admin-workspace";
import styles from "./AdminAccountWorkspace.module.css";

type AdminRole = "owner" | "admin" | "reviewer" | "support";
type ListPagination = { page: number; pageSize: number; total: number; pageCount: number; hasNext?: boolean; nextCursor?: string };
type Account = {
  firebaseUid: string; email: string; businessName: string; abn?: string; contactName: string; phone?: string; partnerType: string;
  businessWebsite?: string; addressLine1?: string; suburb?: string; addressState: string; postcode: string;
  serviceStates: string[]; capabilities: string[]; summary?: string; accountStatus: string; verificationStatus: string;
  verifiedAbn: string; verificationReviewedAt: string; verificationReviewedByUid: string; accessApproved: boolean;
  officialAbnLookupUrl: string; availabilityStatus: string; createdAt: string; updatedAt: string;
  serviceBasePostcode: string; serviceRadiusKm: number;
};
type VerificationReview = {
  id: string; abn: string; legal_entity_name: string; decision: string; review_method: string;
  source_reference: string; note: string; reviewed_by_uid: string; reviewed_at: string;
};
type VerificationDocument = {
  id: string; category: string; file_name: string; size_bytes: number; expiry_date: string; status: string;
};
type AccountDetail = {
  account: Account; documents: VerificationDocument[]; notes: Record<string, unknown>[]; matches: Record<string, unknown>[];
  reviews: VerificationReview[];
  entitlements: { verified: boolean; accessLabel: string; features: Record<FeatureKey, boolean> };
};
type AccountCounts = { total: number; approvedAccess: number; reviewRequired: number; suspended: number };
type AdminApiResult = {
  accounts?: Account[]; counts?: Partial<AccountCounts>; pagination?: Partial<ListPagination>; preferences?: WorkspaceListPreferences;
  saved?: boolean; reviewId?: string; account?: Account; documents?: VerificationDocument[]; notes?: Record<string, unknown>[];
  matches?: Record<string, unknown>[]; reviews?: VerificationReview[]; entitlements?: AccountDetail["entitlements"];
};

const emptyPagination: ListPagination = { page: 1, pageSize: 25, total: 0, pageCount: 1 };
const emptyCounts: AccountCounts = { total: 0, approvedAccess: 0, reviewRequired: 0, suspended: 0 };
const capabilityLabels: Record<string, string> = {
  assessment: "Energy assessment", solar: "Rooftop solar", battery: "Home batteries", "heating-cooling": "Heating and cooling",
  "hot-water": "Hot water", "draught-proofing": "Draught-proofing", insulation: "Insulation", glazing: "Glazing",
  "window-coverings": "Blinds, shutters and external shading", "ev-charging": "EV charging", other: "Other energy upgrades",
};

export type AdminAccountWorkspaceProps = {
  api: (path: string, init?: RequestInit) => Promise<AdminApiResult>;
  role: AdminRole;
  setStatus: (status: string) => void;
  onCounts: (counts: AccountCounts) => void;
  target?: { uid: string; nonce: number } | null;
  verificationTarget?: string;
};

export function AdminAccountWorkspace({ api, role, setStatus, onCounts, target, verificationTarget }: AdminAccountWorkspaceProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountType, setAccountType] = useState("");
  const [accountVerification, setAccountVerification] = useState("");
  const [accountSort, setAccountSort] = useState("updated-desc");
  const [accountPage, setAccountPage] = useState(1);
  const [accountPageSize, setAccountPageSize] = useState(25);
  const [accountPagination, setAccountPagination] = useState<ListPagination>(emptyPagination);
  const cursors = useRef<string[]>([""]);
  const totalReady = useRef(false);
  const [viewReady, setViewReady] = useState(false);
  const [viewSaved, setViewSaved] = useState(false);
  const [viewBusy, setViewBusy] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AccountDetail | null>(null);
  const [accountNote, setAccountNote] = useState("");
  const [legalEntityName, setLegalEntityName] = useState("");
  const [reviewMethod, setReviewMethod] = useState("official_abr_lookup");

  const loadAccounts = useCallback(async (announce = false) => {
    const params = new URLSearchParams({ page: String(accountPage), pageSize: String(accountPageSize), sort: accountSort });
    const cursor = cursors.current[accountPage - 1] || "";
    if (cursor) params.set("cursor", cursor);
    if (totalReady.current) params.set("total", "0");
    if (accountSearch.trim()) params.set("search", accountSearch.trim());
    if (accountType) params.set("partnerType", accountType);
    if (accountVerification) params.set("verification", accountVerification);
    try {
      const result = await api(`/api/admin/accounts?${params}`);
      setAccounts(result.accounts || []);
      setAccountPagination((current) => {
        const next = { ...current, ...(result.pagination || {}), page: accountPage, pageSize: accountPageSize };
        if (typeof result.pagination?.total === "number") totalReady.current = true;
        if (next.hasNext && next.nextCursor) cursors.current[accountPage] = next.nextCursor;
        cursors.current.length = Math.max(accountPage, next.hasNext ? accountPage + 1 : accountPage);
        return next;
      });
      onCounts({ ...emptyCounts, ...(result.counts || {}) });
      if (announce) setStatus(`${result.pagination?.total || 0} business accounts match this view.`);
    } catch (error) { setStatus(workspaceError(error, "The secure account action could not be completed.")); }
  }, [accountPage, accountPageSize, accountSearch, accountSort, accountType, accountVerification, api, onCounts, setStatus]);

  const openAccount = useCallback(async (uid: string) => {
    setStatus("Loading account details...");
    try {
      const result = await api(`/api/admin/accounts?uid=${encodeURIComponent(uid)}`);
      if (!result.account || !result.entitlements) throw new Error("Business account details were unavailable.");
      const reviews = result.reviews || [];
      setSelectedAccount({
        account: result.account,
        documents: result.documents || [],
        notes: result.notes || [],
        matches: result.matches || [],
        reviews,
        entitlements: result.entitlements,
      });
      setLegalEntityName(reviews[0]?.legal_entity_name || result.account.businessName);
      setReviewMethod(reviews[0]?.review_method || "official_abr_lookup");
      setAccountNote(""); setStatus("");
    } catch (error) { setStatus(workspaceError(error, "The secure account action could not be completed.")); }
  }, [api, setStatus]);

  useEffect(() => {
    let cancelled = false;
    void api("/api/admin/list-views?view=admin-partners").then((result) => {
      if (cancelled) return;
      const preferences = (result.preferences || {}) as Partial<WorkspaceListPreferences>;
      setAccountSearch(preferences.search || ""); setAccountType(preferences.type || "");
      setAccountVerification(preferences.filter === "all" ? "" : preferences.filter || "");
      setAccountSort(preferences.sort || "updated-desc");
      setAccountPageSize(preferences.pageSize || 25); setViewSaved(Boolean(result.saved));
    }).catch((error) => setStatus(workspaceError(error, "The secure account action could not be completed."))).finally(() => { if (!cancelled) setViewReady(true); });
    return () => { cancelled = true; };
  }, [api, setStatus]);
  useEffect(() => { cursors.current = [""]; totalReady.current = false; }, [accountPageSize, accountSearch, accountSort, accountType, accountVerification]);
  useEffect(() => {
    if (!viewReady) return;
    const timer = window.setTimeout(() => { void loadAccounts(); }, 180);
    return () => window.clearTimeout(timer);
  }, [loadAccounts, viewReady]);
  useEffect(() => {
    if (!target?.uid) return;
    const timer = window.setTimeout(() => { void openAccount(target.uid); }, 0);
    return () => window.clearTimeout(timer);
  }, [openAccount, target]);
  useEffect(() => {
    if (!verificationTarget) return;
    const timer = window.setTimeout(() => { setAccountVerification(verificationTarget); setAccountPage(1); }, 0);
    return () => window.clearTimeout(timer);
  }, [verificationTarget]);

  function applyView(preferences: WorkspaceListPreferences) {
    setAccountSearch(preferences.search || ""); setAccountType(preferences.type || "");
    setAccountVerification(preferences.filter === "all" ? "" : preferences.filter || "");
    setAccountSort(preferences.sort || "updated-desc"); setAccountPageSize(preferences.pageSize || 25); setAccountPage(1);
  }
  async function saveView() {
    setViewBusy(true);
    try {
      await saveWorkspaceListView(api, "admin-partners", { search: accountSearch, filter: accountVerification || "all", sort: accountSort, pageSize: accountPageSize, type: accountType });
      setViewSaved(true); setStatus("Your default table view has been saved.");
    } catch (error) { setStatus(workspaceError(error, "The secure account action could not be completed.")); } finally { setViewBusy(false); }
  }
  async function resetView() {
    setViewBusy(true);
    try { applyView(await resetWorkspaceListView(api, "admin-partners")); setViewSaved(false); setStatus("The table view has been reset to the TLink default."); }
    catch (error) { setStatus(workspaceError(error, "The secure account action could not be completed.")); } finally { setViewBusy(false); }
  }
  async function searchAccounts(event?: FormEvent) { event?.preventDefault(); if (accountPage !== 1) setAccountPage(1); else await loadAccounts(true); }
  function updateSelectedAccount(key: keyof Account, value: string) { setSelectedAccount((current) => current ? { ...current, account: { ...current.account, [key]: value } } : current); }
  async function saveAccount(event: FormEvent) {
    event.preventDefault(); if (!selectedAccount) return;
    setStatus("Saving moderation decision...");
    try {
      await api("/api/admin/accounts", { method: "PATCH", body: JSON.stringify({
        firebaseUid: selectedAccount.account.firebaseUid, accountStatus: selectedAccount.account.accountStatus, verificationStatus: selectedAccount.account.verificationStatus,
        availabilityStatus: selectedAccount.account.availabilityStatus,
        legalEntityName,
        reviewMethod,
        sourceReference: reviewMethod === "official_abr_lookup" ? selectedAccount.account.officialAbnLookupUrl : "",
        note: accountNote,
      }) });
      await openAccount(selectedAccount.account.firebaseUid); await searchAccounts(); setStatus("Account decision saved and recorded in the audit history.");
    } catch (error) { setStatus(workspaceError(error, "The secure account action could not be completed.")); }
  }
  async function downloadEvidence(id: unknown, fileName: unknown) {
    setStatus("Preparing protected document download...");
    try {
      const activeUser = firebaseAuth.currentUser;
      if (!activeUser) throw new Error("Sign in to continue.");
      const response = await fetch(`/api/admin/evidence?id=${encodeURIComponent(String(id))}`, { headers: { Authorization: `Bearer ${await activeUser.getIdToken()}` }, cache: "no-store" });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || "Document download failed."); }
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = String(fileName || "verification-document"); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Protected document download started and was added to the audit history.");
    } catch (error) { setStatus(workspaceError(error, "The secure account action could not be completed.")); }
  }
  function exportPartners() {
    downloadWorkspaceCsv("tlink-admin-partners.csv", [{ key: "business", label: "Business" }, { key: "type", label: "Type" }, { key: "email", label: "Email" }, { key: "abn", label: "ABN" }, { key: "state", label: "State" }, { key: "postcode", label: "Postcode" }, { key: "verification", label: "Verification" }, { key: "access", label: "Access" }, { key: "account", label: "Account" }, { key: "updated", label: "Updated" }], accounts.map((account) => ({ business: account.businessName, type: account.partnerType === "supplier" ? "Wholesaler" : "Installer", email: account.email, abn: account.abn || "", state: account.addressState, postcode: account.postcode, verification: readable(account.verificationStatus), access: account.accessApproved ? "Approved" : "Blocked pending ABN review", account: readable(account.accountStatus), updated: dateTime(account.updatedAt) })));
  }

  return <>
    <header className="admin-page-heading"><span>Business network</span><h1>Partner and wholesaler accounts</h1><p>Review the registered business identity and ABN before granting free TLink access.</p></header>
    <form className="admin-filterbar" onSubmit={searchAccounts}>
      <input aria-label="Search accounts" placeholder="Business, contact, email or postcode" value={accountSearch} onChange={(event) => { setAccountSearch(event.target.value); setAccountPage(1); }} />
      <select aria-label="Partner type" value={accountType} onChange={(event) => { setAccountType(event.target.value); setAccountPage(1); }}><option value="">All partner types</option><option value="installer">Installers</option><option value="supplier">Wholesalers</option></select>
      <select aria-label="Verification status" value={accountVerification} onChange={(event) => { setAccountVerification(event.target.value); setAccountPage(1); }}><option value="">All verification states</option>{["submitted", "under_review", "needs_information", "approved", "rejected", "expired"].map((value) => <option value={value} key={value}>{readable(value)}</option>)}</select>
      <select aria-label="Sort partners" value={accountSort} onChange={(event) => { setAccountSort(event.target.value); setAccountPage(1); }}><option value="updated-desc">Recently updated</option><option value="updated-asc">Oldest updated</option><option value="name-asc">Business A to Z</option><option value="name-desc">Business Z to A</option><option value="type-asc">Partner type</option><option value="verification-asc">Verification status</option><option value="status-asc">Account status</option></select><button type="submit">Apply filters</button>
    </form>
    <WorkspaceListControls page={accountPagination.page} pageCount={accountPagination.pageCount} pageSize={accountPagination.pageSize} total={accountPagination.total} hasNext={accountPagination.hasNext} saved={viewSaved} busy={viewBusy} onPage={setAccountPage} onPageSize={(size) => { setAccountPageSize(size); setAccountPage(1); }} onSave={saveView} onReset={resetView} />
    <div className="workspace-table-actionbar"><button className="workspace-csv-export" type="button" disabled={!accounts.length} onClick={exportPartners}>Export visible partners CSV</button></div>
    <div className={styles.layout}>
      <section className={`admin-panel tlink-data-table ${styles.list}`}><div className="admin-table-header"><span>Business</span><span>Type</span><span>Verification</span><span>Account</span></div>
        {accounts.length ? accounts.map((account) => <button key={account.firebaseUid} className={selectedAccount?.account.firebaseUid === account.firebaseUid ? styles.selected : ""} onClick={() => void openAccount(account.firebaseUid)}><span><strong>{account.businessName}</strong><small>{account.email}<br />{account.addressState} {account.postcode} · {account.accessApproved ? "Access approved" : "ABN review required"}</small></span><span>{account.partnerType === "supplier" ? "Wholesaler" : "Installer"}</span><span className={`admin-pill admin-pill-${account.verificationStatus}`}>{readable(account.verificationStatus)}</span><span className={`admin-pill admin-pill-${account.accountStatus}`}>{readable(account.accountStatus)}</span></button>) : <p className="admin-empty">No accounts match these filters.</p>}
      </section>
      <aside className={`admin-panel ${styles.detail}`}>
        {selectedAccount ? <>
          <div className="admin-panel-heading"><span>{selectedAccount.account.partnerType}</span><h2>{selectedAccount.account.businessName}</h2><p>{selectedAccount.account.contactName} · {selectedAccount.account.email} · {selectedAccount.account.phone || "No phone"}</p></div>
          <div className={styles.facts}><div><span>Business address</span><strong>{selectedAccount.account.addressLine1}<br />{selectedAccount.account.suburb} {selectedAccount.account.addressState} {selectedAccount.account.postcode}</strong></div><div><span>ABN</span><strong>{selectedAccount.account.abn || "Not provided"}</strong>{selectedAccount.account.officialAbnLookupUrl && <a href={selectedAccount.account.officialAbnLookupUrl} target="_blank" rel="noreferrer">Open official ABN Register record</a>}</div><div><span>Access boundary</span><strong>{selectedAccount.account.accessApproved ? "Approved ABN access" : "Blocked pending ABN review"}</strong><small>{selectedAccount.account.verificationReviewedAt ? `Last approved ${dateTime(selectedAccount.account.verificationReviewedAt)}` : "No approved review is recorded."}</small></div><div><span>Serviceability</span><strong>{selectedAccount.account.partnerType === "installer" ? `${selectedAccount.account.serviceBasePostcode || selectedAccount.account.postcode} base, ${selectedAccount.account.serviceRadiusKm || 50} km radius; ${selectedAccount.account.serviceStates.join(", ")}` : selectedAccount.account.serviceStates.join(", ")}</strong></div><div><span>Capabilities</span><strong>{selectedAccount.account.capabilities.map((value) => capabilityLabels[value] || readable(value)).join(", ")}</strong></div><div><span>Joined</span><strong>{dateTime(selectedAccount.account.createdAt)}</strong></div></div>
          <form className={styles.moderationForm} onSubmit={saveAccount}>
            <label>Account status<select value={selectedAccount.account.accountStatus} onChange={(event) => updateSelectedAccount("accountStatus", event.target.value)} disabled={role === "reviewer"}><option>active</option><option>suspended</option><option>closed</option></select></label>
            <label>Verification<select value={selectedAccount.account.verificationStatus} onChange={(event) => { updateSelectedAccount("verificationStatus", event.target.value); if (event.target.value === "approved") setReviewMethod("official_abr_lookup"); }}>{["submitted", "under_review", "needs_information", "approved", "rejected", "expired"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Availability<select value={selectedAccount.account.availabilityStatus} onChange={(event) => updateSelectedAccount("availabilityStatus", event.target.value)} disabled={role === "reviewer"}><option>open</option><option>limited</option><option>paused</option></select></label>
            <label>Review method<select value={reviewMethod} onChange={(event) => setReviewMethod(event.target.value)}><option value="official_abr_lookup">Official ABN Register lookup</option><option value="document_review">Business evidence review</option></select></label>
            <label className={styles.full}>Registered legal entity name<input value={legalEntityName} onChange={(event) => setLegalEntityName(event.target.value)} placeholder="Exactly as shown in the ABN Register" /></label>
            <section className={`${styles.featureControls} ${styles.full}`}><div><span>Access and permissions</span><h3>{selectedAccount.entitlements.accessLabel}</h3><p>An active account receives every role-appropriate core tool only after an administrator confirms the business against its official ABN Register record. Changing the ABN, business name or account type removes access until a fresh review is completed.</p></div></section>
            <label className={styles.full}>Internal moderation note<textarea value={accountNote} onChange={(event) => setAccountNote(event.target.value)} placeholder="Record evidence reviewed, follow-up needed or reason for a decision." /></label><button type="submit">Save and audit decision</button>
          </form>
          <section className={styles.evidence}><h3>Verification evidence</h3>{selectedAccount.documents.length ? selectedAccount.documents.map((document) => <article key={String(document.id)}><div><strong>{String(document.file_name)}</strong><small>{readable(String(document.category))} · {Math.ceil(Number(document.size_bytes) / 1024)} KB · {readable(String(document.status))}</small></div><button onClick={() => void downloadEvidence(document.id, document.file_name)}>Protected download</button></article>) : <p>No verification documents uploaded.</p>}</section>
          <section className={styles.notes}><h3>ABN review history</h3>{selectedAccount.reviews.length ? selectedAccount.reviews.map((review) => <article key={review.id}><p><strong>{readable(review.decision)}</strong> · ABN {review.abn} · {review.legal_entity_name}</p><p>{review.note}</p><small>{readable(review.review_method)} · {dateTime(review.reviewed_at)}</small></article>) : <p>No ABN review has been recorded.</p>}</section>
          <section className={styles.notes}><h3>Internal notes</h3>{selectedAccount.notes.length ? selectedAccount.notes.map((note) => <article key={String(note.id)}><p>{String(note.note)}</p><small>{String(note.author)} · {dateTime(note.created_at)}</small></article>) : <p>No internal notes recorded.</p>}</section>
        </> : <div className="admin-empty admin-empty-detail"><strong>Select a business account</strong><p>The detailed moderation view, evidence list and internal notes will appear here.</p></div>}
      </aside>
    </div>
  </>;
}
