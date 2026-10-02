"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import { emptyMemberEngagement, type MemberEngagement, type MemberEngagementBusiness } from "@/lib/trade-member-engagement";
import { TradeMemberAgreementTemplates } from "./TradeMemberAgreementTemplates";
import styles from "./TradeMemberEngagementPanel.module.css";

type RecordResult = { ok?: boolean; error?: string; memberId: string; business?: MemberEngagementBusiness; details: MemberEngagement; revision: number; updatedAt: string; readOnly: boolean };
export type PrivateFile = { id: string; memberId: string; title: string; fileName: string; sizeBytes: number; createdAt: string };
type FileResult = { ok?: boolean; error?: string; files?: PrivateFile[]; file?: PrivateFile; cleanupPending?: boolean };

export function TradeMemberEngagementPanel({ user, memberId, displayName, onDirtyChange, onBusyChange }: { user: User; memberId: string; displayName: string; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  const fetch = useTradeBusinessFetch();
  const [record, setRecord] = useState<RecordResult | null>(null);
  const [draft, setDraft] = useState<MemberEngagement>({ ...emptyMemberEngagement });
  const [files, setFiles] = useState<PrivateFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reveal, setReveal] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [agreementDirty, setAgreementDirty] = useState(false);
  const [agreementBusy, setAgreementBusy] = useState(false);
  const headers = useCallback(async () => ({ Authorization: `Bearer ${await user.getIdToken()}` }), [user]);
  const fileUrl = `/api/trade-team/member-files?scope=employment&memberId=${encodeURIComponent(memberId)}`;
  const dirty = Boolean(record && JSON.stringify(draft) !== JSON.stringify(record.details));
  const hasUnsaved = dirty || agreementDirty;
  const operationBusy = Boolean(busy) || agreementBusy;
  useEffect(() => { onDirtyChange?.(hasUnsaved); }, [hasUnsaved, onDirtyChange]);
  useEffect(() => { onBusyChange?.(operationBusy); }, [operationBusy, onBusyChange]);
  useEffect(() => {
    if (!hasUnsaved) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasUnsaved]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = window.requestAnimationFrame(() => {
      setLoading(true); setRecord(null); setFiles([]); setReveal(false); setError(""); setMessage(""); setAgreementDirty(false); setAgreementBusy(false);
      void (async () => {
        try {
          const auth = await headers();
          const [detailResponse, fileResponse] = await Promise.all([
            fetch(`/api/trade-team/engagement?memberId=${encodeURIComponent(memberId)}`, { headers: auth, cache: "no-store", signal: controller.signal }),
            fetch(fileUrl, { headers: auth, cache: "no-store", signal: controller.signal }),
          ]);
          const detail = await detailResponse.json() as RecordResult;
          const documents = await fileResponse.json() as FileResult;
          if (!detailResponse.ok || !detail.ok) throw new Error(detail.error || "Private details could not be loaded.");
          if (!fileResponse.ok || !documents.ok) throw new Error(documents.error || "Private documents could not be loaded.");
          if (detail.memberId !== memberId || documents.files?.some(file => file.memberId !== memberId)) throw new Error("The private record did not match this team member. Reopen their details.");
          if (!controller.signal.aborted) { setRecord(detail); setDraft(detail.details); setFiles(documents.files || []); }
        } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Private details could not be loaded."); }
        finally { if (!controller.signal.aborted) setLoading(false); }
      })();
    });
    return () => { window.cancelAnimationFrame(frame); controller.abort(); };
  }, [fetch, fileUrl, headers, memberId, refresh]);

  function update<K extends keyof MemberEngagement>(key: K, value: MemberEngagement[K]) { setDraft(current => ({ ...current, [key]: value })); setMessage(""); }
  function reload() {
    if (hasUnsaved && !window.confirm("Discard unsaved private details or agreement draft and reload the saved record?")) return;
    setRefresh(value => value + 1);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!record || record.readOnly || operationBusy) return;
    setBusy("save"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/trade-team/engagement", { method: "PUT", headers: { ...await headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, revision: record.revision, details: draft }) });
      const result = await response.json() as RecordResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The private record could not be saved.");
      if (result.memberId !== memberId) throw new Error("The saved record did not match this member. Reload the private details.");
      setRecord(result); setDraft(result.details); setReveal(false); setMessage("Private pay and onboarding details saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The private record could not be saved."); }
    finally { setBusy(""); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!record || record.readOnly || operationBusy) return;
    const form = event.currentTarget; const body = new FormData(form);
    body.set("memberId", memberId); body.set("category", "other"); body.set("scope", "employment");
    setBusy("upload"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/trade-team/member-files", { method: "POST", headers: await headers(), body });
      const result = await response.json() as FileResult;
      if (!response.ok || !result.ok || !result.file || result.file.memberId !== memberId) throw new Error(result.error || "The private document could not be saved.");
      const savedFile = result.file;
      setFiles(current => [savedFile, ...current]); form.reset(); setMessage("Private document saved. Only the business owner can open it.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The private document could not be saved."); }
    finally { setBusy(""); }
  }
  async function download(file: PrivateFile) {
    if (operationBusy) return;
    setBusy(file.id); setError("");
    try {
      const response = await fetch(`${fileUrl}&fileId=${encodeURIComponent(file.id)}&download=1`, { headers: await headers(), cache: "no-store" });
      if (!response.ok) { const result = await response.json() as FileResult; throw new Error(result.error || "The private document could not be downloaded."); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = file.fileName; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The private document could not be downloaded."); }
    finally { setBusy(""); }
  }
  async function remove(file: PrivateFile) {
    if (operationBusy || record?.readOnly || !window.confirm(`Delete the private document "${file.title}"?`)) return;
    setBusy(file.id); setError(""); setMessage("");
    try {
      const response = await fetch(`${fileUrl}&fileId=${encodeURIComponent(file.id)}`, { method: "DELETE", headers: await headers() });
      const result = await response.json() as FileResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "The private document could not be deleted.");
      setFiles(current => current.filter(item => item.id !== file.id));
      setMessage(result.cleanupPending ? "Document removed from access. Storage cleanup is queued." : "Private document deleted.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The private document could not be deleted."); }
    finally { setBusy(""); }
  }

  return <section className={styles.panel} aria-label={`Private pay and onboarding for ${displayName}`}>
    <header><div><h4>Pay &amp; onboarding</h4><p>Private to the business owner. Save agreed terms, payment details and contracts for {displayName}.</p></div><button type="button" disabled={loading || operationBusy} onClick={reload}>Reload saved record</button></header>
    {loading && <p role="status">Loading private details...</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.notice} role="status">{message}</p>}
    {record && !loading && <>
      {record.readOnly && <p className={styles.notice}>Archived member. These records and documents are read-only.</p>}
      <form onSubmit={save}>
        <fieldset disabled={record.readOnly || operationBusy}><legend>Agreed terms</legend><div className={styles.grid}>
          <label>Engagement<select value={draft.engagementType} onChange={event => update("engagementType", event.target.value === "employee" ? "employee" : event.target.value === "contractor" ? "contractor" : "")}><option value="">Not recorded</option><option value="employee">Employee (PAYG)</option><option value="contractor">Contractor</option></select></label>
          <label>Pay basis<select value={draft.rateBasis} onChange={event => update("rateBasis", event.target.value === "hourly" ? "hourly" : event.target.value === "annual_salary" ? "annual_salary" : event.target.value === "per_job" ? "per_job" : "")}><option value="">Not recorded</option><option value="hourly">Hourly rate</option><option value="annual_salary">Annual salary</option><option value="per_job">Per job</option></select></label>
          <label>Agreed amount (AUD)<input inputMode="decimal" type="number" min="0.01" max="999999999.99" step="0.01" value={draft.rateAmount} onChange={event => update("rateAmount", event.target.value)} /></label>
          <label>Start date, optional<input type="date" value={draft.startDate} onChange={event => update("startDate", event.target.value)} /></label>
          <label>Payment method<select value={draft.paymentMethod} onChange={event => update("paymentMethod", event.target.value === "bank_transfer" ? "bank_transfer" : event.target.value === "cash" ? "cash" : event.target.value === "other" ? "other" : "")}><option value="">Not recorded</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="other">Other agreed method</option></select></label>
          <label>Payment frequency<select value={draft.paymentFrequency} onChange={event => update("paymentFrequency", event.target.value === "weekly" ? "weekly" : event.target.value === "fortnightly" ? "fortnightly" : event.target.value === "monthly" ? "monthly" : event.target.value === "per_job" ? "per_job" : event.target.value === "by_agreement" ? "by_agreement" : "")}><option value="">Not recorded</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="per_job">Per job</option><option value="by_agreement">By agreement</option></select></label>
        </div><p>Engagement type and pay basis are separate. These are agreed records; TLink does not calculate payroll, tax or super, or make payments here.</p></fieldset>
        <fieldset disabled={record.readOnly || operationBusy}><legend>Bank and super details, optional</legend><div className={styles.grid}>
          <label>Account name<input autoComplete="off" maxLength={180} value={draft.bankAccountName} onChange={event => update("bankAccountName", event.target.value)} /></label>
          <label>BSB<input autoComplete="off" type={reveal ? "text" : "password"} inputMode="numeric" maxLength={12} value={draft.bankBsb} onChange={event => update("bankBsb", event.target.value)} /></label>
          <label>Account number<input autoComplete="off" type={reveal ? "text" : "password"} inputMode="numeric" maxLength={20} value={draft.bankAccountNumber} onChange={event => update("bankAccountNumber", event.target.value)} /></label>
          <label>Super fund<input autoComplete="off" maxLength={180} value={draft.superFundName} onChange={event => update("superFundName", event.target.value)} /></label>
          <label>Fund USI<input autoComplete="off" type={reveal ? "text" : "password"} maxLength={80} value={draft.superUsi} onChange={event => update("superUsi", event.target.value)} /></label>
          <label>Super member number<input autoComplete="off" type={reveal ? "text" : "password"} maxLength={80} value={draft.superMemberNumber} onChange={event => update("superMemberNumber", event.target.value)} /></label>
        </div></fieldset>
        <div className={styles.actions}><button type="button" aria-pressed={reveal} onClick={() => setReveal(current => !current)}>{reveal ? "Hide account identifiers" : "Show account identifiers"}</button>{!record.readOnly && <button className={styles.primary} disabled={operationBusy || !dirty}>{busy === "save" ? "Saving..." : "Save private details"}</button>}{dirty && <span>Unsaved private details</span>}</div>
      </form>
      <section className={styles.documents} aria-label="Private contracts and onboarding documents"><h5>Contracts &amp; onboarding documents</h5><p>Saved for this person in this business. Keep licences and insurance in their regular Documents section so authorised team managers can use them.</p>
        <TradeMemberAgreementTemplates user={user} memberId={memberId} displayName={displayName} engagement={record.details} businessContext={record.business} disabled={Boolean(busy) || dirty} readOnly={record.readOnly} onSavedFile={file => setFiles(current => [file, ...current])} onBusyChange={setAgreementBusy} onDirtyChange={setAgreementDirty} />
        {!record.readOnly && <form onSubmit={upload}><label>Document title<input name="title" required maxLength={180} placeholder="Employment agreement or contractor onboarding" /></label><label>PDF, JPEG or PNG, up to 12 MB<input name="file" type="file" required accept="application/pdf,image/jpeg,image/png" /></label><button disabled={operationBusy}>{busy === "upload" ? "Uploading..." : "Add private document"}</button></form>}
        {files.length ? <ul>{files.map(file => <li key={file.id}><div><strong>{file.title}</strong><small>{new Date(file.createdAt).toLocaleDateString("en-AU")} | {Math.ceil(file.sizeBytes / 1024)} KB</small></div><div className={styles.actions}><button type="button" disabled={operationBusy} onClick={() => void download(file)}>Download</button>{!record.readOnly && <button type="button" disabled={operationBusy} onClick={() => void remove(file)}>Delete</button>}</div></li>)}</ul> : <p>No private documents saved.</p>}
      </section>
    </>}
  </section>;
}
