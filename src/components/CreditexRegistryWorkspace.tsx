"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import {
  REGISTRY_SCHEMES,
  registryFormatSupportsActivity,
  type RegistryAccount,
  type RegistryClaim,
  type RegistrySchemeKey,
  type RegistryStatus,
  type RegistryWorkspaceResponse,
} from "@/lib/creditex-registry";
import styles from "./CreditexRegistryWorkspace.module.css";
import { CreditexRegistryBatches } from "./CreditexRegistryBatches";

type Api = (path: string, init?: RequestInit, options?: { requestTimeoutMs?: number }) => Promise<Record<string, unknown>>;
type View = "claims" | "accounts" | "files" | "fees";
const money = (minor: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(minor / 100);
const dateLabel = (value: string) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("en-AU") : "Not recorded";
const statusLabels: Record<RegistryStatus | "unconfirmed", string> = {
  unconfirmed: "Not confirmed", submitted: "Lodged", assessment: "Under assessment",
  registered: "Registered", rejected: "Rejected", withdrawn: "Withdrawn",
};
const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

function accountIsCurrent(account: RegistryAccount) {
  return account.enabled && (!account.authorityExpiresOn || account.authorityExpiresOn >= new Date().toISOString().slice(0, 10));
}

function accountCoversClaim(account: RegistryAccount, claim: RegistryClaim) {
  return accountIsCurrent(account) && account.scheme === claim.scheme
    && Boolean(claim.activityTemplateId && account.activityScope.includes(claim.activityTemplateId));
}

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function previousRegistryDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readWorkspace(result: Record<string, unknown>): RegistryWorkspaceResponse {
  if (!["schemes", "accounts", "claims", "invoices", "payments", "results", "formats", "exports", "activityOptions", "unresolvedMatches"].every((key) => Array.isArray(result[key]))
    || !result.capabilities || typeof result.capabilities !== "object") {
    throw new Error("The submissions workspace could not be loaded. Refresh to try again.");
  }
  // The authenticated API is the shared contract boundary; individual mutations are validated server-side.
  return result as RegistryWorkspaceResponse;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className={styles.field}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function EvidenceField({ label = "Supporting evidence" }: { label?: string }) {
  return <Field label={label} hint="Private PDF, CSV, JSON or text file. Maximum 5 MB."><input name="evidence" type="file" accept=".pdf,.csv,.json,.txt" required /></Field>;
}

function Status({ value, scheme }: { value: RegistryStatus | "unconfirmed"; scheme?: RegistrySchemeKey }) {
  return <span className={styles.badge} data-tone={value === "registered" ? "good" : value === "rejected" ? "bad" : "neutral"}>{scheme === "accu" && value === "registered" ? "Issued" : statusLabels[value]}</span>;
}

export function CreditexRegistryWorkspace({ api, endpoint, outputEndpoint, children }: Readonly<{
  api: Api; endpoint: string; outputEndpoint: string; children: ReactNode;
}>) {
  const [workspace, setWorkspace] = useState<RegistryWorkspaceResponse | null>(null);
  const [view, setView] = useState<View>("claims");
  const [selectedPacket, setSelectedPacket] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [schemeFilter, setSchemeFilter] = useState("all");
  const [editingAccount, setEditingAccount] = useState<RegistryAccount | null>(null);
  const [accountFormVisible, setAccountFormVisible] = useState(false);
  const [accountScheme, setAccountScheme] = useState<RegistrySchemeKey>("veu");
  const [invoiceAccountId, setInvoiceAccountId] = useState("");
  const [exportAccountId, setExportAccountId] = useState("");
  const [exportFormatKey, setExportFormatKey] = useState("");
  const [openedExportId, setOpenedExportId] = useState("");
  const [exportPacketIds, setExportPacketIds] = useState<readonly string[]>([]);
  const [exportPreview, setExportPreview] = useState<Readonly<{ id: string; headers: readonly string[]; rows: readonly (readonly string[])[] }> | null>(null);
  const [previewRow, setPreviewRow] = useState(0);
  const [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setWorkspace(readWorkspace(await api(endpoint))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The submissions workspace could not be loaded."); }
    finally { setLoading(false); }
  }, [api, endpoint]);

  useEffect(() => {
    let current = true;
    void api(endpoint).then((result) => {
      if (current) setWorkspace(readWorkspace(result));
    }).catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : "The submissions workspace could not be loaded.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, endpoint]);

  async function run(label: string, task: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(label); setNotice(""); setError("");
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This action could not be completed."); }
    finally { inFlight.current = false; setBusy(""); }
  }

  async function mutate(body: Record<string, unknown>, message: string, options?: { requestTimeoutMs?: number }) {
    const result = await api(endpoint, { method: "POST", body: JSON.stringify(body) }, options);
    setWorkspace(readWorkspace(result));
    setNotice(message);
    return result;
  }

  async function uploadEvidence(form: FormData) {
    const file = form.get("evidence");
    if (!(file instanceof File) || !file.size) throw new Error("Choose the supporting evidence file.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Supporting evidence must be 5 MB or smaller.");
    if (!/\.(pdf|csv|json|txt)$/i.test(file.name)) throw new Error("Choose a PDF, CSV, JSON or text file.");
    const body = new FormData(); body.set("file", file);
    const result = await api(`${endpoint}?upload=evidence`, { method: "POST", body });
    if (typeof result.evidenceId !== "string" || !result.evidenceId) throw new Error("The evidence upload was not confirmed. Try again.");
    return result.evidenceId;
  }

  async function download(path: string, filename: string, init?: RequestInit) {
    await run("Preparing download", async () => {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("Sign in to download this document.");
      const token = await user.getIdToken();
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(path, { ...init, headers, cache: "no-store" });
      if (!response.ok) throw new Error("This document could not be downloaded. Refresh and try again.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url;
      const providedName = response.headers.get("Content-Disposition")?.match(/filename="([^"/\\]+)"/)?.[1];
      anchor.download = providedName || filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    });
  }

  function evidenceButton(evidenceId: string) {
    return <button type="button" data-variant="quiet" disabled={Boolean(busy)} onClick={() => void download(`${endpoint}?download=evidence&evidenceId=${encodeURIComponent(evidenceId)}`, "registry-evidence")}>Open evidence</button>;
  }

  function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run("Saving account", async () => {
      if (!form.getAll("activityScope").length) throw new Error("Choose at least one activity covered by this account's authority.");
      await mutate({
        action: "save_account", id: editingAccount?.id || "", expectedVersion: editingAccount?.version,
        scheme: field(form, "scheme"), accountReference: field(form, "accountReference"),
        submitterReference: field(form, "submitterReference"), legalName: field(form, "legalName"),
        financeEmail: field(form, "financeEmail"), resultsEmail: field(form, "resultsEmail"),
        activityScope: form.getAll("activityScope").filter((value): value is string => typeof value === "string"),
        authorityReference: field(form, "authorityReference"), authorityExpiresOn: field(form, "authorityExpiresOn"),
        enabled: true,
      }, "Account details saved. Direct submission remains subject to the scheme connection requirements.");
      setAccountFormVisible(false); setEditingAccount(null);
    });
  }

  function recordResult(event: FormEvent<HTMLFormElement>, claim: RegistryClaim) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    void run("Saving registry result", async () => {
      const evidenceId = await uploadEvidence(form);
      await mutate({ action: "record_result", packetId: claim.packetId, accountId: claim.accountId,
        expectedPacketSha256: claim.packetSha256, externalReference: claim.providerReference,
        registryStatus: field(form, "registryStatus"), quantity: field(form, "quantity"),
        occurredAt: new Date(field(form, "occurredAt")).toISOString(), evidenceId, note: field(form, "note"),
      }, "Result retained for independent review. The confirmed registry status changes after approval.");
      element.reset();
    });
  }

  function recordLodgement(event: FormEvent<HTMLFormElement>, claim: RegistryClaim) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run("Recording lodgement", async () => {
      if (!field(data, "providerReference")) throw new Error("Enter the actual reference returned by the registry.");
      if (!selectedAccount || !accountCoversClaim(selectedAccount, claim)) throw new Error("Choose an authorised account for this claim.");
      if (claim.accountId !== selectedAccount.id) await associateAccount(claim, selectedAccount);
      await api(outputEndpoint, { method: "POST", body: JSON.stringify({
        action: "record_manual_submission", packetId: claim.packetId, expectedPacketSha256: claim.packetSha256,
        providerName: field(data, "providerName"), providerReference: field(data, "providerReference"),
        submittedAt: new Date(field(data, "submittedAt")).toISOString(), submissionMethod: "manual_provider_portal",
      }) });
      // Reload authoritative state after recording, never infer registration from a receipt.
      setWorkspace(readWorkspace(await api(endpoint)));
      setNotice("Lodgement reference recorded. Add the original registry response for independent review; registration is not yet confirmed.");
    });
  }

  async function associateAccount(claim: RegistryClaim, account: RegistryAccount) {
    await mutate({ action: "attach_account", packetId: claim.packetId, expectedPacketSha256: claim.packetSha256,
      accountId: account.id }, "Saved account applied to this claim.");
  }

  function openSelectedFile() {
    if (!selected || !selectedAccount) return;
    if (selectedFile) {
      setOpenedExportId(selectedFile.id); setView("files"); void inspectExport(selectedFile.id); return;
    }
    void run("Preparing claim selection", async () => {
      if (selected.accountId !== selectedAccount.id) await associateAccount(selected, selectedAccount);
      setOpenedExportId(""); setExportAccountId(selectedAccount.id);
      setExportFormatKey(workspace?.formats.find((format) => registryFormatSupportsActivity(format.key, selected.activityTemplateId || "")
        && format.scheme === (selected.scheme === "stc" ? "SRES" : selected.scheme === "nsw_esc" ? "ESS" : "PDRS"))?.key || "");
      setExportPacketIds([selected.packetId]); setView("files");
    });
  }

  function recordInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    void run("Saving fee invoice", async () => {
      const packetIds = form.getAll("packetIds").filter((value): value is string => typeof value === "string");
      if (!packetIds.length) throw new Error("Select at least one claim covered by this invoice.");
      const evidenceId = await uploadEvidence(form);
      await mutate({ action: "record_invoice", accountId: field(form, "accountId"), reference: field(form, "reference"),
        amount: field(form, "amount"), dueDate: field(form, "dueDate"), evidenceId,
        packetIds,
      }, "Regulator fee invoice saved.");
      element.reset();
    });
  }

  function prepareExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const data = new FormData(element);
    void run("Checking registry file", async () => {
      if (!exportAccount || !exportFormat || !exportPacketIds.length) throw new Error("Choose an account, file format and at least one approved claim.");
      const file = data.get("csv");
      if (!(file instanceof File) || !file.size || !/\.csv$/i.test(file.name)) throw new Error("Choose the completed CSV file.");
      if (file.size > 2 * 1024 * 1024) throw new Error("The CSV must be 2 MB or smaller.");
      await mutate({ action: "prepare_export", accountId: exportAccount.id, formatKey: exportFormat.key,
        packetIds: exportPacketIds, baseVintage: field(data, "baseVintage"), csv: await file.text(),
      }, "Registry file checked and retained for independent review. It has not been lodged.");
      element.reset(); setExportPacketIds([]);
    });
  }

  async function inspectExport(id: string) {
    await run("Loading registry file", async () => {
      const result = await api(`${endpoint}?preview=export&exportId=${encodeURIComponent(id)}`);
      const headers: unknown = result.headers, rows: unknown = result.rows;
      if (!Array.isArray(headers) || !headers.every((value): value is string => typeof value === "string")
        || !Array.isArray(rows) || !rows.every((row): row is string[] => Array.isArray(row) && row.length === headers.length && row.every((value) => typeof value === "string"))) {
        throw new Error("The registry file could not be displayed. Refresh and try again.");
      }
      setExportPreview({ id, headers, rows }); setPreviewRow(0);
    });
  }

  async function syncAccount(accountId: string, date: string) {
    await run("Checking REC certificate status", async () => {
      // Allow the registry's 30-second response window plus evidence retention and reconciliation.
      const result = await mutate({ action: "sync_rec", accountId, date }, "REC status check completed.", { requestTimeoutMs: 60_000 });
      const summary = result.sync;
      if (summary && typeof summary === "object" && "matchedClaims" in summary && typeof summary.matchedClaims === "number"
        && "updatedClaims" in summary && typeof summary.updatedClaims === "number"
        && "unresolvedClaims" in summary && typeof summary.unresolvedClaims === "number") {
        setNotice(summary.matchedClaims === 0
          ? `No matching certificate actions were found for ${dateLabel(date)}. Claim statuses are unchanged. Check another event date or retain the original registry result for independent review.`
          : `${summary.matchedClaims} claims matched; ${summary.updatedClaims} updated from the official register.${summary.unresolvedClaims ? ` ${summary.unresolvedClaims} need reconciliation. Retain the original registry result in Claims for independent review; unresolved statuses are unchanged.` : " Matched results are available in Claims."}`);
      }
    });
  }

  const accounts = workspace?.accounts || [];
  const activeAccounts = accounts.filter(accountIsCurrent);
  const claims = workspace?.claims || [];
  const unresolvedSyncMatches = workspace?.unresolvedMatches || [];
  const pendingResults = workspace?.results.filter((result) => result.reviewStatus === "pending") || [];
  const filtered = claims.filter((claim) => {
    const match = `${claim.jobReference} ${claim.jobLabel} ${claim.customerLabel} ${claim.activityTitle}`.toLowerCase().includes(search.toLowerCase());
    return match && (schemeFilter === "all" || claim.scheme === schemeFilter)
      && (filter === "all" || (filter === "review" ? pendingResults.some((result) => result.packetId === claim.packetId)
        : filter === "unlodged" ? !claim.providerReference
        : filter === "reconciliation" ? claim.status === "reconciliation_required" || (claim.approved && claim.status === "prepared" && !claim.canSubmit)
        : claim.registryStatus === filter));
  });
  const selected = filtered.find((claim) => claim.packetId === selectedPacket) || filtered[0];
  const selectedScheme = REGISTRY_SCHEMES.find((scheme) => scheme.key === selected?.scheme);
  const selectedEligibleAccounts = selected ? activeAccounts.filter((account) => accountCoversClaim(account, selected)) : [];
  const selectedAccount = accounts.find((account) => account.id === selected?.accountId)
    || (!selected?.accountId && selectedEligibleAccounts.length === 1 ? selectedEligibleAccounts[0] : undefined);
  const invoiceAccounts = accounts.filter((account) => accountIsCurrent(account) || claims.some((claim) => claim.accountId === account.id && claim.providerReference));
  const invoiceAccount = invoiceAccounts.find((account) => account.id === invoiceAccountId) || invoiceAccounts[0];
  const exportAccounts = activeAccounts.filter((account) => ["stc", "nsw_esc", "nsw_prc"].includes(account.scheme));
  const exportAccount = exportAccounts.find((account) => account.id === exportAccountId) || exportAccounts[0];
  const exportFormats = workspace?.formats.filter((format) => format.scheme === (exportAccount?.scheme === "stc" ? "SRES" : exportAccount?.scheme === "nsw_esc" ? "ESS" : exportAccount?.scheme === "nsw_prc" ? "PDRS" : "")) || [];
  const exportFormat = exportFormats.find((format) => format.key === exportFormatKey) || exportFormats[0];
  const exportClaims = claims.filter((claim) => claim.accountId === exportAccount?.id && claim.approved && claim.status === "prepared" && claim.canSubmit && !claim.providerReference
    && exportAccount && accountCoversClaim(exportAccount, claim) && registryFormatSupportsActivity(exportFormat?.key || "", claim.activityTemplateId || ""));
  const selectedFile = workspace?.exports.find((item) => item.accountId === selected?.accountId && item.packetIds.includes(selected?.packetId || "") && item.reviewStatus !== "rejected");
  const canPrepareSelectedFile = Boolean(selected?.approved && selected.status === "prepared" && selected.canSubmit && !selected.providerReference && selectedAccount && accountCoversClaim(selectedAccount, selected)
    && ["stc", "nsw_esc", "nsw_prc"].includes(selectedAccount.scheme) && workspace?.capabilities.canOperate);
  const outstanding = workspace?.invoices.filter((invoice) => invoice.status === "active").reduce((total, invoice) => total + Math.max(0, invoice.amountMinor - invoice.paidMinor), 0) || 0;
  const locked = Boolean(busy);
  const selectedAccountReady = Boolean(selected && selectedAccount && accountCoversClaim(selectedAccount, selected));
  const selectedNeedsReconciliation = Boolean(selected && (selected.status === "reconciliation_required"
    || (workspace?.capabilities.canOperate && !selected.providerReference && selected.approved && !selected.canSubmit)));

  return <section className={styles.workspace} aria-label="Certificate submissions" aria-busy={loading || locked}>
    <header className={styles.heading}>
      <div><span className={styles.eyebrow}>Certificate operations</span><h2>Certificate submissions</h2><p>Prepare claims, lodge through the authorised scheme and follow each result through to registration.</p></div>
      <button type="button" data-variant="quiet" disabled={locked || loading} onClick={() => void refresh()}>Refresh</button>
    </header>
    {error && <p className={styles.notice} data-kind="error" role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {unresolvedSyncMatches.length > 0 && <div className={styles.section} aria-label="REC matches requiring reconciliation">{unresolvedSyncMatches.map((match) => <div className={styles.history} key={`${match.packetId}:${match.evidenceId}`}><strong>{claims.find((claim) => claim.packetId === match.packetId)?.jobLabel || "Claim requiring reconciliation"}</strong><p>The public register did not confirm the full approved quantity and status for {dateLabel(match.sourceDate)}. Open the retained response, then check the original registry result before recording evidence in Claims.</p><div className={styles.actions}>{evidenceButton(match.evidenceId)}<button type="button" data-variant="quiet" disabled={locked} onClick={() => { setView("claims"); setSearch(""); setFilter("all"); setSchemeFilter("all"); setSelectedPacket(match.packetId); }}>Open claim</button></div></div>)}</div>}
    {busy && <p className={styles.progress} role="status">{busy}…</p>}
    {loading && !workspace ? <p className={styles.empty}>Loading certificate submissions…</p> : workspace && <>
      <CreditexRegistryBatches api={api} endpoint={endpoint} reloadKey={workspace} onChanged={() => { void refresh(); }} />
      <div className={styles.summary}>
        <div><span>Claims</span><strong>{claims.length}</strong></div>
        <div><span>Awaiting result review</span><strong>{pendingResults.length}</strong></div>
        <div><span>Registered or issued claims</span><strong>{claims.filter((claim) => claim.registryStatus === "registered").length}</strong></div>
        <div><span>Fees outstanding</span><strong>{money(outstanding)}</strong></div>
      </div>
      <nav className={styles.navigation} aria-label="Submission workspace views">
        {([ ["claims", "Claims"], ["files", "Registry files"], ["accounts", "Scheme accounts"], ["fees", "Fees and payments"] ] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} disabled={locked} onClick={() => { setView(key); setOpenedExportId(""); }}>{label}</button>)}
      </nav>

      {view === "accounts" && <div className={styles.section}>
        <header className={styles.sectionHeading}><div><h3>Scheme accounts</h3><p>Keep the claiming organisation, permitted activities and finance contact together.</p></div>{workspace.capabilities.canManageAccounts && <button type="button" disabled={locked} onClick={() => { setEditingAccount(null); setAccountScheme("veu"); setAccountFormVisible(true); }}>Add account</button>}</header>
        {accountFormVisible && <form key={editingAccount?.id || "new"} onSubmit={saveAccount} className={styles.form}>
          <h4>{editingAccount ? "Edit scheme account" : "Add scheme account"}</h4>
          <fieldset disabled={locked} className={styles.formGrid}>
            <Field label="Scheme">{editingAccount ? <><input readOnly value={REGISTRY_SCHEMES.find((scheme) => scheme.key === editingAccount.scheme)?.title || editingAccount.scheme} /><input type="hidden" name="scheme" value={editingAccount.scheme} /></> : <select name="scheme" value={accountScheme} onChange={(event) => { const next = REGISTRY_SCHEMES.find((scheme) => scheme.key === event.target.value); if (next) setAccountScheme(next.key); }} required>{REGISTRY_SCHEMES.map((scheme) => <option key={scheme.key} value={scheme.key}>{scheme.title}</option>)}</select>}</Field>
            <Field label="Legal entity name"><input name="legalName" defaultValue={editingAccount?.legalName} readOnly={Boolean(editingAccount)} autoComplete="organization" required maxLength={200} /></Field>
            <Field label="Accredited or registry account ID" hint="For STCs, use the REC owner account ID, not the registered person number."><input name="accountReference" defaultValue={editingAccount?.accountReference} readOnly={Boolean(editingAccount)} required maxLength={120} /></Field>
            <Field label="Authorised submitter ID" hint="Enter the separate submitting account if required by the scheme."><input name="submitterReference" defaultValue={editingAccount?.submitterReference} maxLength={120} /></Field>
            <Field label="Finance email"><input name="financeEmail" type="email" defaultValue={editingAccount?.financeEmail} required /></Field>
            <Field label="Results email" hint="Use a monitored mailbox for registry results."><input name="resultsEmail" type="email" defaultValue={editingAccount?.resultsEmail} required /></Field>
            <fieldset className={styles.checkList} key={accountScheme}><legend>Activities covered by your authority</legend><p>Choose only activities this organisation is authorised to claim.</p>{workspace.activityOptions.filter((option) => option.scheme === accountScheme).map((option) => <label key={option.activityTemplateId}><input name="activityScope" type="checkbox" value={option.activityTemplateId} defaultChecked={editingAccount?.activityScope.includes(option.activityTemplateId)} /><span>{option.title}</span></label>)}{!workspace.activityOptions.some((option) => option.scheme === accountScheme) && <p>No activity definitions are available for this scheme.</p>}{editingAccount?.activityScope.filter((id) => !workspace.activityOptions.some((option) => option.activityTemplateId === id)).map((id) => <label key={id}><input name="activityScope" type="checkbox" value={id} defaultChecked /><span>Previously recorded activity: {id}</span></label>)}</fieldset>
            <Field label="Authority or delegation reference"><input name="authorityReference" defaultValue={editingAccount?.authorityReference} required maxLength={200} /></Field>
            <Field label="Authority expiry, if applicable"><input name="authorityExpiresOn" type="date" defaultValue={editingAccount?.authorityExpiresOn} /></Field>
            <div className={styles.formActions}><button type="submit">Save account</button><button type="button" data-variant="quiet" onClick={() => { setAccountFormVisible(false); setEditingAccount(null); }}>Cancel</button></div>
          </fieldset>
        </form>}
        <div className={styles.schemeGrid}>{REGISTRY_SCHEMES.map((scheme) => <article className={styles.card} key={scheme.key}>
          <div className={styles.cardTitle}><div><span className={styles.eyebrow}>{scheme.output}</span><h4>{scheme.title}</h4></div><span className={styles.badge}>{scheme.submissionMode === "provider_approval_required" ? "Connection approval required" : scheme.submissionMode === "retailer_reporting" ? "Retailer reporting" : "Official portal"}</span></div>
          <p>{scheme.connectionMessage}</p>
          {accounts.filter((account) => account.scheme === scheme.key).map((account) => <div className={styles.account} key={account.id}>
            <div><strong>{account.legalName}</strong><span>{account.accountReference} · {!account.enabled ? "Disabled" : accountIsCurrent(account) ? "Account saved" : "Authority expired"}</span><small>Activities: {account.activityScope.map((id) => workspace.activityOptions.find((option) => option.activityTemplateId === id)?.title || id).join(", ")}</small><small>Results: {account.resultsEmail}</small>{account.authorityExpiresOn && <small>Authority expires: {dateLabel(account.authorityExpiresOn)}</small>}</div>
            <div className={styles.actions}>
              {workspace.capabilities.canManageAccounts && <button type="button" data-variant="quiet" disabled={locked} onClick={() => { setEditingAccount(account); setAccountScheme(account.scheme); setAccountFormVisible(true); }}>Edit account</button>}
              {scheme.key === "veu" && <button type="button" data-variant="quiet" disabled={locked} onClick={() => void download(`${endpoint}?download=onboarding&accountId=${encodeURIComponent(account.id)}`, "veu-onboarding-request.txt")}>Download access request</button>}
              {workspace.capabilities.canManageAccounts && account.enabled && <details className={styles.inlineDetails}><summary>Disable account</summary><p>This removes the account from new claim selection. Existing records remain available.</p><button type="button" data-variant="danger" disabled={locked} onClick={() => void run("Disabling account", () => mutate({ action: "disable_account", accountId: account.id, expectedVersion: account.version }, "Account disabled for new operations."))}>Confirm disable</button></details>}
            </div>
            {scheme.key === "stc" && account.enabled && workspace.capabilities.canOperate && <details className={styles.details}><summary>Check REC certificate status</summary><p>The public REC feed is delayed by one day. Exact matches to this account, lodged reference and approved quantity can update a claim from the official register. Other results remain unchanged.</p><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void syncAccount(account.id, field(form, "date")); }}><fieldset disabled={locked} className={styles.formGrid}><Field label="Registry event date"><input name="date" type="date" max={previousRegistryDate()} defaultValue={previousRegistryDate()} required /></Field><div className={styles.formActions}><button type="submit">Check REC status</button></div></fieldset></form></details>}
          </div>)}
          {!accounts.some((account) => account.scheme === scheme.key) && <p className={styles.muted}>No account added.</p>}
          <a className={styles.portalLink} href={scheme.portalUrl} target="_blank" rel="noreferrer">Open {scheme.submissionMode === "retailer_reporting" ? "scheme guidance" : "official registry"} <span aria-hidden="true">↗</span></a>
        </article>)}</div>
      </div>}

      {view === "claims" && <div className={styles.section}>
        {!activeAccounts.length && <div className={styles.setup}><div><h3>Start with your scheme account</h3><p>Add the accredited organisation and its approved activity scope before associating a claim.</p></div><button type="button" disabled={locked} onClick={() => { setView("accounts"); if (workspace.capabilities.canManageAccounts) setAccountFormVisible(true); }}>Set up scheme accounts</button></div>}
        <div className={styles.filters}>
          <Field label="Find a claim"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Job, customer or activity" /></Field>
          <Field label="Certificate or scheme"><select value={schemeFilter} onChange={(event) => setSchemeFilter(event.target.value)}><option value="all">All schemes</option>{REGISTRY_SCHEMES.map((scheme) => <option key={scheme.key} value={scheme.key}>{scheme.output} · {scheme.title}</option>)}</select></Field>
          <Field label="Show"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All claims</option><option value="unlodged">Awaiting lodgement</option><option value="reconciliation">Check submission outcome</option><option value="review">Awaiting result review</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{key === "registered" ? "Registered or issued" : label}</option>)}</select></Field>
        </div>
        {!filtered.length ? <div className={styles.empty}><h3>{claims.length ? "No matching claims" : "Your prepared claims will appear here"}</h3><p>{claims.length ? "Change the search or status filter to see more claims." : "Use Prepare and review claims below to finish the evidence checks and create a claim packet."}</p></div> : <div className={styles.claimLayout}>
          <div className={styles.claimList} aria-label="Prepared claims">{filtered.map((claim) => <button type="button" key={claim.packetId} aria-pressed={selected?.packetId === claim.packetId} disabled={locked} onClick={() => setSelectedPacket(claim.packetId)}><span className={styles.cardTitle}><strong>{claim.jobLabel || claim.jobReference}</strong><Status value={claim.registryStatus} scheme={claim.scheme} /></span><span>{claim.customerLabel}</span><small>{claim.activityTitle}</small><small>{claim.quantity} {claim.unit}</small></button>)}</div>
          {selected && selectedScheme && <article className={styles.claimDetail} key={selected.packetId}>
            <header className={styles.sectionHeading}><div><span className={styles.eyebrow}>{selectedScheme.output} · {selected.jobReference}</span><h3>{selected.activityTitle}</h3><p>{selected.customerLabel}</p></div><Status value={selected.registryStatus} scheme={selected.scheme} /></header>
            <dl className={styles.claimFacts}><div><dt>Prepared quantity</dt><dd>{selected.quantity} {selected.unit}</dd></div><div><dt>Claim review</dt><dd>{selected.approved ? "Approved" : "Review required"}</dd></div><div><dt>{selected.scheme === "accu" ? "Issued quantity" : "Registered quantity"}</dt><dd>{selected.registryStatus === "registered" ? `${selected.registeredQuantity} ${selected.unit}` : "Not confirmed"}</dd></div><div><dt>Last checked</dt><dd>{dateLabel(selected.lastCheckedAt)}</dd></div></dl>
            <div className={styles.nextStep} aria-label="Next submission step">
              <div><span className={styles.eyebrow}>Next step</span><strong>{selected.registryStatus === "registered" ? selected.scheme === "accu" ? "Issuance confirmed" : "Registration confirmed" : selected.registryStatus === "rejected" || selected.registryStatus === "withdrawn" ? "Check the registry decision" : !selected.approved ? "Review the prepared claim" : selectedNeedsReconciliation ? "Check the previous submission outcome" : pendingResults.some((result) => result.packetId === selected.packetId) ? "Complete the independent result review" : selected.providerReference ? "Follow the registry result and fees" : !selectedAccountReady ? "Choose or update the authorised account" : selectedFile?.reviewStatus === "approved" ? "Download your approved file and lodge it" : selectedFile ? "Complete the independent file review" : canPrepareSelectedFile ? "Prepare the official registry file" : "Lodge through the authorised scheme"}</strong>
              <p>{selected.registryStatus === "registered" ? "The confirmed result is retained with this claim. Check any remaining fees separately." : !selected.approved ? "Open Prepare and review claims below to complete the evidence review." : selected.providerReference ? "Retain the original regulator invoice and returned result against this claim." : selectedFile ? "Your existing file is retained in Registry files with its review history." : canPrepareSelectedFile ? "The account and this claim will be selected for you. Choose the correct official format before completing the file." : selectedScheme.connectionMessage}</p></div>
              <div className={styles.actions}>{canPrepareSelectedFile && selectedAccount && <button type="button" disabled={locked} onClick={openSelectedFile}>{selectedFile ? "Open existing registry file" : "Prepare registry file"}</button>}{!selectedAccountReady && <button type="button" data-variant="quiet" disabled={locked} onClick={() => { setView("accounts"); if (selectedAccount && workspace.capabilities.canManageAccounts) { setEditingAccount(selectedAccount); setAccountScheme(selectedAccount.scheme); setAccountFormVisible(true); } }}>Manage scheme account</button>}{selected.providerReference && <button type="button" data-variant="quiet" disabled={locked} onClick={() => { setInvoiceAccountId(selected.accountId); setView("fees"); }}>Open fees and payments</button>}</div>
            </div>
            <div className={styles.actions}>{selected.approved && selectedAccountReady && !selectedNeedsReconciliation && (!canPrepareSelectedFile || selectedFile?.reviewStatus === "approved") && <a className={styles.primaryLink} href={selectedScheme.portalUrl} target="_blank" rel="noreferrer">Open {selectedScheme.submissionMode === "retailer_reporting" ? "scheme guidance" : "official registry"} ↗</a>}</div>
            <details className={styles.details}><summary>Scheme guidance and claim packet</summary><p>{selectedScheme.connectionMessage}</p><div className={styles.actions}><a className={styles.portalLink} href={selectedScheme.portalUrl} target="_blank" rel="noreferrer">Official scheme website ↗</a><button type="button" data-variant="quiet" disabled={locked} onClick={() => void download(`${outputEndpoint}?download=packet&packetId=${encodeURIComponent(selected.packetId)}`, "claim-packet.json")}>Download claim packet</button></div></details>
            {selected.providerReference && <p className={styles.reference}>External reference: <strong>{selected.providerReference}</strong></p>}
            <details className={styles.details} open={!selectedAccountReady}><summary>{selectedAccountReady ? `Claiming account: ${selectedAccount?.legalName}` : "Choose claiming account"}</summary>{workspace.capabilities.canOperate && !selected.providerReference ? <form key={`${selected.packetId}:${selected.accountId}`} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void run("Associating account", () => mutate({ action: "attach_account", packetId: selected.packetId, expectedPacketSha256: selected.packetSha256, accountId: field(data, "accountId") }, "Claiming account associated with this packet.")); }}><fieldset disabled={locked} className={styles.formGrid}><Field label="Authorised account"><select name="accountId" defaultValue={selectedAccount?.id || ""} required><option value="">Choose an account</option>{activeAccounts.filter((account) => accountCoversClaim(account, selected)).map((account) => <option value={account.id} key={account.id}>{account.legalName} · {account.accountReference}</option>)}</select></Field><div className={styles.formActions}><button type="submit">Save association</button></div></fieldset></form> : <p>{selectedAccount ? `${selectedAccount.legalName} · ${selectedAccount.accountReference}` : "An authorised operator must associate this claim with a scheme account."}</p>}</details>
            {selectedNeedsReconciliation && <p className={styles.notice} role="status">A submission may already be in progress or require reconciliation. Check its retained receipt and the official registry before attempting another lodgement.</p>}
            {!selected.providerReference && <p className={styles.connectionNotice}>After lodging through the official registry, record its actual submission reference here. Registry results can then be matched to this claim.</p>}
            {!selected.providerReference && selected.canSubmit && selectedAccountReady && workspace.capabilities.canOperate && <details className={styles.details}>
              <summary>Record lodgement reference</summary>
              <p>Use the receipt returned by the official registry. This records an existing lodgement and does not send another application.</p>
              <form onSubmit={(event) => recordLodgement(event, selected)}><fieldset disabled={locked} className={styles.formGrid}>
                <Field label="Registry or authorised provider"><input name="providerName" defaultValue={selectedScheme.title} required maxLength={180} /></Field>
                <Field label="Actual registry reference"><input name="providerReference" required maxLength={240} autoComplete="off" /></Field>
                <Field label="Lodged date and time"><input name="submittedAt" type="datetime-local" defaultValue={localDateTime()} required /></Field>
                <div className={styles.formActions}><button type="submit">Save lodgement reference</button></div>
              </fieldset></form>
            </details>}
            {selectedAccount && selected.accountId === selectedAccount.id && selected.providerReference && workspace.capabilities.canOperate && <details className={styles.details}><summary>Record a registry result</summary><p>Attach the original registry evidence. A different authorised reviewer must approve the result before it updates the confirmed status.</p><form onSubmit={(event) => recordResult(event, selected)}><fieldset disabled={locked} className={styles.formGrid}>
              <Field label="Recorded registry reference"><input value={selected.providerReference} readOnly /></Field>
              <Field label="Registry status"><select name="registryStatus" defaultValue="submitted">{Object.entries(statusLabels).filter(([key]) => key !== "unconfirmed" && (selectedScheme.submissionMode !== "retailer_reporting" || key !== "registered")).map(([key, label]) => <option key={key} value={key}>{key === "registered" && selected.scheme === "accu" ? "Issued" : label}</option>)}</select></Field>
              <Field label={selectedScheme.submissionMode === "retailer_reporting" ? "Reported quantity" : "Certificate quantity"}><input name="quantity" inputMode="numeric" defaultValue={selected.quantity} required pattern="[0-9]+" /></Field>
              <Field label="Registry event date and time"><input name="occurredAt" type="datetime-local" defaultValue={localDateTime()} required /></Field>
              <EvidenceField label="Original registry response" /><Field label="Result notes"><textarea name="note" rows={3} required maxLength={2000} /></Field>
              <div className={styles.formActions}><button type="submit">Save result for review</button></div>
            </fieldset></form></details>}
            <details className={styles.details} open={pendingResults.some((result) => result.packetId === selected.packetId)}><summary>Registry history and evidence</summary>{workspace.results.filter((result) => result.packetId === selected.packetId).length === 0 && <p className={styles.muted}>No registry evidence has been recorded for this claim.</p>}{workspace.results.filter((result) => result.packetId === selected.packetId).map((result) => <div className={styles.history} key={result.id}>
              <div className={styles.cardTitle}><strong>{result.registryStatus === "registered" && selected.scheme === "accu" ? "Issued" : statusLabels[result.registryStatus]} · {result.quantity} {selected.unit}</strong><span className={styles.badge}>{result.reviewStatus === "pending" ? "Review pending" : result.reviewStatus === "approved" ? "Evidence approved" : "Evidence rejected"}</span></div><p>{result.externalReference} · {dateLabel(result.occurredAt)}</p><small>{result.source === "rec_public_register" ? "REC public register" : "Retained registry document"}</small>{result.note && <p>{result.note}</p>}
              {evidenceButton(result.evidenceId)}
              {result.reviewStatus === "pending" && (result.canReview && workspace.capabilities.canReview ? <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void run("Reviewing registry result", () => mutate({ action: "review_result", resultId: result.id, decision: field(data, "decision"), note: field(data, "note") }, "Independent result review saved.")); }}><fieldset disabled={locked} className={styles.formGrid}><Field label="Review decision"><select name="decision" defaultValue="" required><option value="" disabled>Choose after checking evidence</option><option value="approved">Approve evidence</option><option value="rejected">Reject evidence</option></select></Field><Field label="Review note"><textarea name="note" required rows={2} maxLength={2000} /></Field><div className={styles.formActions}><button type="submit">Save independent review</button></div></fieldset></form> : <p className={styles.muted}>Awaiting a different authorised reviewer.</p>)}
            </div>)}</details>
          </article>}
        </div>}
        <details className={styles.details}><summary>Prepare and review claims</summary><p>Complete the governed preparation and approval steps here. Refresh the submissions workspace after preparing or approving a claim.</p>{children}</details>
      </div>}

      {view === "files" && <div className={styles.section}>
        <header className={styles.sectionHeading}><div><h3>Official registry files</h3><p>Create a CSV from approved claims, check its fields and retain an independent review before lodging through the official portal.</p></div>{openedExportId && <button type="button" data-variant="quiet" disabled={locked} onClick={() => setOpenedExportId("")}>All registry files</button>}</header>
        <p className={styles.connectionNotice}>The template supplies the official column order and claim references. Complete all installation details and declarations from the evidence. File checks do not establish eligibility or submit certificates.</p>
        {!openedExportId && (workspace.capabilities.canOperate && exportAccount && exportFormat ? <form className={styles.form} onSubmit={prepareExport}>
          <h4>Prepare a registry file</h4>
          <fieldset disabled={locked} className={styles.formGrid}>
            <Field label="Claiming account"><select name="accountId" value={exportAccount.id} required onChange={(event) => { setExportAccountId(event.target.value); setExportFormatKey(""); setExportPacketIds([]); }}>{exportAccounts.map((account) => <option key={account.id} value={account.id}>{account.legalName} · {account.accountReference}</option>)}</select></Field>
            <Field label="Official file format"><select name="formatKey" value={exportFormat.key} required onChange={(event) => { setExportFormatKey(event.target.value); setExportPacketIds([]); }}>{exportFormats.map((format) => <option key={format.key} value={format.key}>{format.label}</option>)}</select></Field>
            {exportAccount.scheme !== "stc" && <Field label="Base vintage year" hint="Use the same vintage selected for this accreditation in TESSA."><input name="baseVintage" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required placeholder="2026" /></Field>}
            <fieldset className={styles.checkList}><legend>Approved claims for this file</legend>{exportClaims.length > 0 && <div className={styles.actions}><button type="button" data-variant="quiet" onClick={() => setExportPacketIds(exportClaims.slice(0, exportFormat.maximumRecords).map((claim) => claim.packetId))}>Select {Math.min(exportClaims.length, exportFormat.maximumRecords)} claims</button><button type="button" data-variant="quiet" disabled={!exportPacketIds.length} onClick={() => setExportPacketIds([])}>Clear selection</button></div>}{exportClaims.map((claim) => <label key={claim.packetId}><input type="checkbox" checked={exportPacketIds.includes(claim.packetId)} disabled={!exportPacketIds.includes(claim.packetId) && exportPacketIds.length >= exportFormat.maximumRecords} onChange={(event) => setExportPacketIds(event.target.checked ? [...exportPacketIds, claim.packetId] : exportPacketIds.filter((id) => id !== claim.packetId))} /><span>{claim.jobLabel || claim.jobReference} · {claim.activityTitle} · {claim.quantity} {claim.unit}</span></label>)}{!exportClaims.length && <p>Only approved, unlodged claims covered by this account and official file format appear here. Change the format to see other eligible activities.</p>}</fieldset>
            <div className={styles.formActions}><button type="button" data-variant="quiet" disabled={!exportPacketIds.length || exportPacketIds.length > exportFormat.maximumRecords} onClick={() => void download(endpoint, `${exportFormat.key}-template.csv`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "download_template", accountId: exportAccount.id, formatKey: exportFormat.key, packetIds: exportPacketIds }) })}>Download template for selected claims</button><span className={styles.muted}>{exportPacketIds.length} selected · Maximum {exportFormat.maximumRecords} per file</span></div>
            <Field label="Completed official CSV" hint={`Keep the ${exportFormat.referenceField} values supplied in the template. Maximum 2 MB.`}><input name="csv" type="file" accept=".csv,text/csv" required /></Field>
            <div className={styles.formActions}><button type="submit" disabled={!exportPacketIds.length || exportPacketIds.length > exportFormat.maximumRecords}>Check file and request review</button></div>
          </fieldset>
        </form> : workspace.capabilities.canOperate && <div className={styles.empty}><h4>Add an eligible scheme account</h4><p>Official file preparation is available for STCs, NSW ESCs and NSW PRCs.</p><button type="button" onClick={() => setView("accounts")}>Set up scheme accounts</button></div>)}
        {!workspace.exports.length && <div className={styles.empty}><h4>No registry files prepared</h4><p>Checked files and their independent reviews will appear here.</p></div>}
        {workspace.exports.filter((item) => !openedExportId || item.id === openedExportId).map((item) => <article className={styles.card} key={item.id}>
          <div className={styles.cardTitle}><div><h4>{workspace.formats.find((format) => format.key === item.formatKey)?.label || item.formatKey}</h4><p>{accounts.find((account) => account.id === item.accountId)?.legalName || "Scheme account"} · {item.packetIds.length} claims · {dateLabel(item.createdAt)}{item.baseVintage && ` · Vintage ${item.baseVintage}`}</p></div><span className={styles.badge} data-tone={item.reviewStatus === "approved" ? "good" : item.reviewStatus === "rejected" ? "bad" : "neutral"}>{item.reviewStatus === "approved" ? "Approved file" : item.reviewStatus === "rejected" ? "File rejected" : "Review pending"}</span></div>
          <div className={styles.actions}><button type="button" data-variant="quiet" disabled={locked} onClick={() => void inspectExport(item.id)}>Inspect file contents</button>{item.reviewStatus === "approved" && <button type="button" disabled={locked} onClick={() => void download(`${endpoint}?download=export&exportId=${encodeURIComponent(item.id)}`, `${item.formatKey}-approved.csv`)}>Download approved registry file</button>}</div>
          {exportPreview?.id === item.id && <div className={styles.filePreview}>
            <Field label="Implementation to inspect"><select value={previewRow} onChange={(event) => setPreviewRow(Number(event.target.value))}>{exportPreview.rows.map((row, index) => <option key={index} value={index}>Row {index + 2}: {row[exportPreview.headers.indexOf(workspace.formats.find((format) => format.key === item.formatKey)?.referenceField || "")] || `Implementation ${index + 1}`}</option>)}</select></Field>
            <table><caption>Retained registry fields for row {previewRow + 2}</caption><thead><tr><th scope="col">Official field</th><th scope="col">Retained value</th></tr></thead><tbody>{exportPreview.headers.map((header, index) => <tr key={header}><th scope="row">{header}</th><td>{exportPreview.rows[previewRow]?.[index] || <span className={styles.muted}>Blank</span>}</td></tr>)}</tbody></table>
          </div>}
          {item.reviewStatus === "pending" && (item.canReview && workspace.capabilities.canReview ? <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void run("Reviewing registry file", () => mutate({ action: "review_export", exportId: item.id, decision: field(data, "decision"), note: field(data, "note") }, "Independent file review saved. Approved files can be downloaded for official portal lodgement.")); }}><p>Check every row against its approved claim, original evidence and current scheme requirements before approving.</p><fieldset disabled={locked} className={styles.formGrid}><Field label="File review decision"><select name="decision" defaultValue="" required><option value="" disabled>Choose after checking the file</option><option value="approved">Approve file</option><option value="rejected">Reject file</option></select></Field><Field label="File review note"><textarea name="note" required rows={2} maxLength={2000} /></Field><div className={styles.formActions}><button type="submit" disabled={exportPreview?.id !== item.id}>Save independent file review</button></div></fieldset></form> : <p className={styles.muted}>Awaiting a different authorised reviewer.</p>)}
          {item.reviewStatus === "approved" && <p className={styles.muted}>Lodge the approved file through the official registry, then record its returned reference against each claim.</p>}
        </article>)}
      </div>}

      {view === "fees" && <div className={styles.section}>
        <header className={styles.sectionHeading}><div><h3>Regulator fees and payments</h3><p>Track the original regulator invoice and settlement evidence separately from certificate registration.</p></div><strong className={styles.balance}>{money(outstanding)} outstanding</strong></header>
        <p className={styles.connectionNotice}>Pay using the original regulator invoice or official registry. Amounts paid below reflect retained payment evidence, not confirmation from the regulator. Recording a payment here does not register certificates.</p>
        {workspace.capabilities.canOperate && invoiceAccounts.length > 0 && <details className={styles.details}><summary>Record a regulator invoice</summary><form onSubmit={recordInvoice}><fieldset disabled={locked} className={styles.formGrid}>
          <Field label="Invoiced account"><select name="accountId" value={invoiceAccount?.id || ""} onChange={(event) => setInvoiceAccountId(event.target.value)} required>{invoiceAccounts.map((account) => <option value={account.id} key={account.id}>{account.legalName} · {account.accountReference}</option>)}</select></Field>
          <Field label="Invoice reference"><input name="reference" required maxLength={160} /></Field><Field label="Invoice total (AUD)"><input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required /></Field><Field label="Due date"><input name="dueDate" type="date" required /></Field><EvidenceField label="Original fee invoice" />
          <fieldset className={styles.checkList}><legend>Claims covered by this invoice</legend>{claims.filter((claim) => claim.accountId === invoiceAccount?.id).map((claim) => <label key={claim.packetId}><input name="packetIds" type="checkbox" value={claim.packetId} /><span>{claim.jobLabel || claim.jobReference} · {claim.activityTitle}</span></label>)}{!claims.some((claim) => claim.accountId === invoiceAccount?.id) && <p>Associate claims with this account first.</p>}</fieldset>
          <div className={styles.formActions}><button type="submit" disabled={!claims.some((claim) => claim.accountId === invoiceAccount?.id)}>Save regulator invoice</button></div>
        </fieldset></form></details>}
        {!workspace.invoices.length && <div className={styles.empty}><h3>No regulator invoices recorded</h3><p>After lodging, retain the regulator invoice against its claiming account and claims.</p>{!activeAccounts.length && <button type="button" onClick={() => setView("accounts")}>Set up scheme accounts</button>}</div>}
        <div className={styles.schemeGrid}>{workspace.invoices.map((invoice) => <article className={styles.card} key={invoice.id}>
          <div className={styles.cardTitle}><div><h4>{invoice.reference}</h4><p>{accounts.find((account) => account.id === invoice.accountId)?.legalName || "Scheme account"}</p></div><span className={styles.badge} data-tone={invoice.status === "active" && invoice.paidMinor >= invoice.amountMinor ? "good" : "neutral"}>{invoice.status === "void" ? "Void" : invoice.paidMinor >= invoice.amountMinor ? "Payment recorded" : invoice.paidMinor > 0 ? "Partial payment recorded" : "Payment due"}</span></div>
          <dl className={styles.claimFacts}><div><dt>Total</dt><dd>{money(invoice.amountMinor)}</dd></div><div><dt>Paid</dt><dd>{money(invoice.paidMinor)}</dd></div><div><dt>Due</dt><dd>{dateLabel(invoice.dueDate)}</dd></div><div><dt>Claims</dt><dd>{invoice.packetIds.length}</dd></div></dl>{evidenceButton(invoice.evidenceId)}
          {workspace.payments.filter((payment) => payment.invoiceId === invoice.id).map((payment) => <div className={styles.payment} key={payment.id}><div><strong>{money(payment.amountMinor)}</strong><span>{payment.reference} · {dateLabel(payment.paidAt)}</span></div>{evidenceButton(payment.evidenceId)}</div>)}
          {workspace.capabilities.canOperate && invoice.status === "active" && invoice.paidMinor < invoice.amountMinor && <details className={styles.details}><summary>Record payment evidence</summary><form onSubmit={(event) => { event.preventDefault(); const element = event.currentTarget; const data = new FormData(element); void run("Saving payment evidence", async () => { const evidenceId = await uploadEvidence(data); await mutate({ action: "record_payment", invoiceId: invoice.id, reference: field(data, "reference"), amount: field(data, "amount"), paidAt: new Date(field(data, "paidAt")).toISOString(), evidenceId }, "Payment evidence saved. Registry status is unchanged."); element.reset(); }); }}><fieldset disabled={locked} className={styles.formGrid}>
            <Field label="Payment reference"><input name="reference" required maxLength={160} /></Field><Field label="Amount paid (AUD)"><input name="amount" type="number" min="0.01" step="0.01" max={(invoice.amountMinor - invoice.paidMinor) / 100} defaultValue={((invoice.amountMinor - invoice.paidMinor) / 100).toFixed(2)} inputMode="decimal" required /></Field><Field label="Payment date and time"><input name="paidAt" type="datetime-local" defaultValue={localDateTime()} required /></Field><EvidenceField label="Payment receipt" /><div className={styles.formActions}><button type="submit">Save payment evidence</button></div>
          </fieldset></form></details>}
        </article>)}</div>
      </div>}
    </>}
  </section>;
}
