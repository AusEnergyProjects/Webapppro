"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type AdminRole = "owner" | "admin" | "reviewer" | "support";

type DirectoryAccount = {
  accountKey: string;
  firebaseUid: string;
  accountType: "customer" | "installer" | "supplier" | "admin";
  name: string;
  email: string;
  secondary: string;
  addressState: string;
  postcode: string;
  accountStatus: string;
  verificationStatus: string;
  planKey: string;
  createdAt: string;
  updatedAt: string;
};

type CustomerProject = {
  id: string;
  title: string;
  homeNickname: string;
  postcode: string;
  addressState: string;
  goal: string;
  pace: string;
  serviceCategories: string[];
  priorities: string[];
  projectStage: string;
  timing: string;
  budgetRange: string;
  privateNotes: string;
  completedPlanItems: string[];
  status: string;
  submittedAt: string;
  updatedAt: string;
  quotes: Array<{
    id: string;
    installerBusiness: string;
    totalCentsExGst: number;
    quoteType: string;
    startWindow: string;
    durationWeeks: number;
    workmanshipWarrantyYears: number;
    status: string;
    customerDecision: string;
    submittedAt: string;
  }>;
};

type AccountDetail = {
  accountType: "customer" | "installer" | "supplier" | "admin";
  canEdit: boolean;
  impersonationAllowed: false;
  account: Record<string, unknown>;
  projects?: CustomerProject[];
  notes?: Array<{ id: string; note: string; author: string; created_at: string }>;
};

type Counts = { total: number; customers: number; installers: number; suppliers: number; admins: number };

type Props = {
  api: (path: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  role: AdminRole;
  target?: { type: string; uid: string; nonce: number } | null;
  onManageTrade: (uid: string) => void;
  onManageAdmin: () => void;
};

const emptyCounts: Counts = { total: 0, customers: 0, installers: 0, suppliers: 0, admins: 0 };

function readable(value: unknown) {
  return String(value || "Not set").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: unknown) {
  if (!value) return "Not yet";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function money(cents: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
}

function accountLabel(type: string) {
  if (type === "supplier") return "Wholesaler";
  if (type === "admin") return "Operations";
  return readable(type);
}

export function AdminAccountDirectory({ api, role, target, onManageTrade, onManageAdmin }: Props) {
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([]);
  const [counts, setCounts] = useState<Counts>(emptyCounts);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [selected, setSelected] = useState<AccountDetail | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");

  const loadList = useCallback(async (announce = false) => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (type) params.set("type", type);
    if (accountStatus) params.set("status", accountStatus);
    try {
      const result = await api(`/api/admin/directory?${params}`);
      const next = (result.accounts || []) as DirectoryAccount[];
      setAccounts(next);
      setCounts({ ...emptyCounts, ...((result.counts || {}) as Partial<Counts>) });
      if (announce) setStatus(`${next.length} accounts shown.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The account directory could not be loaded.");
    }
  }, [accountStatus, api, search, type]);

  const openAccount = useCallback(async (accountType: string, uid: string) => {
    setStatus("Opening the audited account record...");
    try {
      const result = await api(`/api/admin/directory?type=${encodeURIComponent(accountType)}&uid=${encodeURIComponent(uid)}`);
      setSelected(result as unknown as AccountDetail);
      setNote("");
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The account record could not be opened.");
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(), 0);
    return () => window.clearTimeout(timer);
  }, [loadList]);
  useEffect(() => {
    if (!target?.uid || !target.type) return;
    const timer = window.setTimeout(() => void openAccount(target.type, target.uid), 0);
    return () => window.clearTimeout(timer);
  }, [openAccount, target]);

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    void loadList(true);
  }

  function updateCustomer(key: string, value: string) {
    setSelected((current) => current ? { ...current, account: { ...current.account, [key]: value } } : current);
  }

  async function saveCustomer(event: FormEvent) {
    event.preventDefault();
    if (!selected || selected.accountType !== "customer") return;
    setStatus("Saving the customer support adjustment...");
    try {
      await api("/api/admin/directory", {
        method: "PATCH",
        body: JSON.stringify({
          accountType: "customer",
          firebaseUid: selected.account.firebaseUid,
          displayName: selected.account.displayName,
          postcode: selected.account.postcode,
          addressState: selected.account.addressState,
          propertyType: selected.account.propertyType,
          householdSituation: selected.account.householdSituation,
          accountStatus: selected.account.accountStatus,
          note,
        }),
      });
      await openAccount("customer", String(selected.account.firebaseUid));
      await loadList();
      setStatus("Customer account adjustment saved and added to the audit history.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The customer account could not be updated.");
    }
  }

  return (
    <>
      <header className="admin-page-heading">
        <span>Whole platform directory</span>
        <h1>All accounts</h1>
        <p>Find customer, installer, wholesaler and operations accounts in one place, then open the appropriate audited support or moderation record.</p>
      </header>
      <div className="admin-account-security-note">
        <strong>Safe account access</strong>
        <p>Opening a record never signs in as that person and never exposes their password or session. Private customer record access is role restricted and audited.</p>
      </div>
      {status && <div className="admin-inline-status" role="status">{status}</div>}
      <section className="admin-metric-grid admin-directory-metrics">
        <article><span>All accounts</span><strong>{counts.total}</strong><small>Across every platform role</small></article>
        <article><span>Customers</span><strong>{counts.customers}</strong><small>Always-free household accounts</small></article>
        <article><span>Installers</span><strong>{counts.installers}</strong><small>Trade and opportunity accounts</small></article>
        <article><span>Wholesalers</span><strong>{counts.suppliers}</strong><small>Catalogue and supply accounts</small></article>
      </section>
      <form className="admin-filterbar" onSubmit={submitFilters}>
        <input aria-label="Search all accounts" placeholder="Name, email, contact or postcode" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="Account type" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">All account types</option>
          <option value="customer">Customers</option>
          <option value="installer">Installers</option>
          <option value="supplier">Wholesalers</option>
          <option value="admin">Operations users</option>
        </select>
        <select aria-label="Account status" value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)}>
          <option value="">All account states</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="closed">Closed</option>
        </select>
        <button type="submit">Apply filters</button>
      </form>
      <div className="admin-directory-layout">
        <section className="admin-panel admin-directory-list">
          <div className="admin-table-header"><span>Account</span><span>Type</span><span>Status</span><span>Updated</span></div>
          {accounts.length ? accounts.map((account) => {
            const restricted = account.accountType === "customer" && role === "reviewer";
            return (
              <button key={account.accountKey} type="button" disabled={restricted} className={selected?.account.firebaseUid === account.firebaseUid ? "selected" : ""}
                onClick={() => void openAccount(account.accountType, account.firebaseUid)}>
                <span><strong>{account.name}</strong><small>{account.email || (restricted ? "Private record restricted" : account.secondary)}{account.postcode ? <><br />{account.addressState} {account.postcode}</> : null}</small></span>
                <span>{accountLabel(account.accountType)}</span>
                <span className={`admin-pill admin-pill-${account.accountStatus}`}>{readable(account.accountStatus)}</span>
                <span>{dateTime(account.updatedAt)}</span>
              </button>
            );
          }) : <div className="admin-empty"><strong>No matching accounts</strong><p>Change the filters to broaden the directory.</p></div>}
        </section>
        <aside className="admin-panel admin-directory-detail">
          {!selected && <div className="admin-empty admin-empty-detail"><strong>Open an account record</strong><p>Profile, status and relevant platform activity will appear here.</p></div>}
          {selected?.accountType === "customer" && (
            <>
              <div className="admin-panel-heading">
                <span>Private customer support record</span>
                <h2>{String(selected.account.displayName)}</h2>
                <p>{String(selected.account.email)} · joined {dateTime(selected.account.createdAt)}</p>
              </div>
              <form className="admin-customer-account-form" onSubmit={saveCustomer}>
                <label>Display name<input value={String(selected.account.displayName || "")} disabled={!selected.canEdit} onChange={(event) => updateCustomer("displayName", event.target.value)} /></label>
                <label>Postcode<input value={String(selected.account.postcode || "")} inputMode="numeric" maxLength={4} disabled={!selected.canEdit} onChange={(event) => updateCustomer("postcode", event.target.value)} /></label>
                <label>State or territory<select value={String(selected.account.addressState || "")} disabled={!selected.canEdit} onChange={(event) => updateCustomer("addressState", event.target.value)}>{['ACT','NSW','NT','Qld','SA','Tas','Vic','WA'].map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>Property type<select value={String(selected.account.propertyType || "house")} disabled={!selected.canEdit} onChange={(event) => updateCustomer("propertyType", event.target.value)}>{['house','townhouse','apartment','new-build','other'].map((value) => <option value={value} key={value}>{readable(value)}</option>)}</select></label>
                <label>Household situation<select value={String(selected.account.householdSituation || "owner")} disabled={!selected.canEdit} onChange={(event) => updateCustomer("householdSituation", event.target.value)}>{['owner','renter','strata','planning-building'].map((value) => <option value={value} key={value}>{readable(value)}</option>)}</select></label>
                <label>Account status<select value={String(selected.account.accountStatus || "active")} disabled={!selected.canEdit} onChange={(event) => updateCustomer("accountStatus", event.target.value)}>{['active','suspended','closed'].map((value) => <option value={value} key={value}>{readable(value)}</option>)}</select></label>
                <label className="full">Internal support note<textarea value={note} disabled={!selected.canEdit} onChange={(event) => setNote(event.target.value)} placeholder="Record the reason for any adjustment or follow-up." /></label>
                {selected.canEdit && <button type="submit">Save and audit adjustment</button>}
              </form>
              <section className="admin-customer-projects">
                <div className="admin-panel-heading"><span>Private project history</span><h3>{selected.projects?.length || 0} saved projects</h3></div>
                {selected.projects?.length ? selected.projects.map((project) => (
                  <article key={project.id}>
                    <div className="admin-customer-project-heading"><div><strong>{project.title}</strong><small>{project.homeNickname} · {project.addressState} {project.postcode}</small></div><span className={`admin-pill admin-pill-${project.status}`}>{readable(project.status)}</span></div>
                    <dl><div><dt>Goal</dt><dd>{readable(project.goal)}</dd></div><div><dt>Timing</dt><dd>{readable(project.timing)}</dd></div><div><dt>Budget</dt><dd>{readable(project.budgetRange)}</dd></div><div><dt>Services</dt><dd>{project.serviceCategories.map(readable).join(", ") || "Not set"}</dd></div></dl>
                    {project.privateNotes && <div className="admin-private-note"><strong>Customer private notes</strong><p>{project.privateNotes}</p></div>}
                    {project.quotes.length > 0 && <div className="admin-customer-quotes"><strong>Quote options</strong>{project.quotes.map((quote) => <div key={quote.id}><span>{quote.installerBusiness}</span><b>{money(quote.totalCentsExGst)}</b><small>{readable(quote.customerDecision)} · {readable(quote.quoteType)} · submitted {dateTime(quote.submittedAt)}</small></div>)}</div>}
                  </article>
                )) : <p>No customer projects have been created.</p>}
              </section>
              <section className="admin-notes-section"><h3>Internal support notes</h3>{selected.notes?.length ? selected.notes.map((item) => <article key={item.id}><p>{item.note}</p><small>{item.author} · {dateTime(item.created_at)}</small></article>) : <p>No internal notes recorded.</p>}</section>
            </>
          )}
          {(selected?.accountType === "installer" || selected?.accountType === "supplier") && (
            <>
              <div className="admin-panel-heading"><span>{accountLabel(selected.accountType)} account</span><h2>{String(selected.account.name)}</h2><p>{String(selected.account.email)} · {String(selected.account.contactName)}</p></div>
              <div className="admin-business-facts"><div><span>Account</span><strong>{readable(selected.account.accountStatus)}</strong></div><div><span>Verification</span><strong>{readable(selected.account.verificationStatus)}</strong></div><div><span>Membership</span><strong>{readable(selected.account.billingStatus)}</strong></div><div><span>Location</span><strong>{String(selected.account.addressState)} {String(selected.account.postcode)}</strong></div></div>
              <p>{String(selected.account.summary || "No business summary supplied.")}</p>
              <button type="button" onClick={() => onManageTrade(String(selected.account.firebaseUid))}>Open full partner controls</button>
            </>
          )}
          {selected?.accountType === "admin" && (
            <>
              <div className="admin-panel-heading"><span>Operations account</span><h2>{String(selected.account.display_name || selected.account.email)}</h2><p>{String(selected.account.email)}</p></div>
              <div className="admin-business-facts"><div><span>Role</span><strong>{readable(selected.account.role)}</strong></div><div><span>Status</span><strong>{readable(selected.account.status)}</strong></div><div><span>Last login</span><strong>{dateTime(selected.account.last_login_at)}</strong></div></div>
              <button type="button" onClick={onManageAdmin}>Open owner access controls</button>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
