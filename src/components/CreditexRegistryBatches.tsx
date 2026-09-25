"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { firebaseAuth } from "@/lib/firebase-client";
import { REGISTRY_SCHEMES, type RegistrySchemeKey } from "@/lib/creditex-registry";
import type { RegistryBatchSummary, RegistryBatchWorkspace, RegistryBatchLodgementOutcome } from "@/lib/creditex-registry-batches";
import styles from "./CreditexRegistryBatches.module.css";

type Api = (path: string, init?: RequestInit, options?: { requestTimeoutMs?: number }) => Promise<Record<string, unknown>>;
type ExportAttempt = { requestId: string; expectedPacketIds: string[]; scheme?: RegistrySchemeKey };

function readBatchWorkspace(result: Record<string, unknown>): RegistryBatchWorkspace {
  if (!Array.isArray(result.readyGroups) || !Array.isArray(result.blockedClaims) || !Array.isArray(result.batches)
    || !result.capabilities || typeof result.capabilities !== "object") throw new Error("The batch list could not be loaded. Refresh to try again.");
  return result as RegistryBatchWorkspace;
}

const schemeTitle = (key: string) => REGISTRY_SCHEMES.find(scheme => scheme.key === key)?.title || key;
const batchDate = (value: string) => new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });

export function CreditexRegistryBatches({ api, endpoint, reloadKey, onChanged }: Readonly<{
  api: Api; endpoint: string; reloadKey?: unknown; onChanged: () => void;
}>) {
  const [data, setData] = useState<RegistryBatchWorkspace | null>(null);
  const [scheme, setScheme] = useState("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<{ batchId: string; accountId: string; lodgedAt: string } | null>(null);
  const [individualReferences, setIndividualReferences] = useState(false);
  const inFlight = useRef(false);
  const [attempt, setAttempt] = useState<ExportAttempt | null>(null);

  const refresh = useCallback(async () => {
    setData(readBatchWorkspace(await api(`${endpoint}?view=batches`)));
    setAttempt(null);
  }, [api, endpoint]);

  useEffect(() => {
    let current = true;
    void api(`${endpoint}?view=batches`).then(result => { if (current) setData(readBatchWorkspace(result)); })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : "The batch list could not be loaded."); });
    return () => { current = false; };
  }, [api, endpoint, reloadKey]);

  async function run(label: string, task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(label); setError(""); setNotice("");
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This batch action could not be completed."); }
    finally { inFlight.current = false; setBusy(""); }
  }

  async function downloadBatch(batchId: string) {
    const user = firebaseAuth.currentUser;
    if (!user) throw new Error("Sign in to download this batch.");
    const response = await fetch(`${endpoint}?download=batch&batchId=${encodeURIComponent(batchId)}`, {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store",
    });
    if (!response.ok) throw new Error("The batch is saved, but its download could not be completed. Use Download again below.");
    const url = URL.createObjectURL(await response.blob());
    try {
      const link = document.createElement("a");
      link.href = url; link.download = `tlink-submissions-${batchId}.zip`;
      document.body.appendChild(link); link.click(); link.remove();
    } finally { URL.revokeObjectURL(url); }
  }

  const readyGroups = (data?.readyGroups || []).filter(group => scheme === "all" || group.scheme === scheme);
  const readyIds = [...new Set(readyGroups.flatMap(group => group.packetIds))];
  const blocked = (data?.blockedClaims || []).filter(claim => scheme === "all" || claim.scheme === scheme);
  const canOperate = data?.capabilities.canOperate === true;

  function exportReady() {
    void run("Preparing your batch", async () => {
      if (!readyIds.length && !attempt) throw new Error("There are no ready jobs to export.");
      const currentAttempt = attempt || { requestId: crypto.randomUUID(), expectedPacketIds: readyIds,
        ...(scheme === "all" ? {} : { scheme: scheme as RegistrySchemeKey }) };
      setAttempt(currentAttempt);
      const result = await api(endpoint, { method: "POST", body: JSON.stringify({ action: "export_ready_batch", ...currentAttempt }) }, { requestTimeoutMs: 120_000 });
      const batch = result.batch;
      if (!batch || typeof batch !== "object" || !("id" in batch) || typeof batch.id !== "string") throw new Error("The batch was not confirmed. Retry to recover the same request.");
      setData(readBatchWorkspace(result)); setAttempt(null);
      onChanged();
      await downloadBatch(batch.id);
      setNotice("Batch exported. Jobs stay Audited until you record the actual lodgement below.");
    });
  }

  function confirmLodgement(event: FormEvent<HTMLFormElement>, batch: RegistryBatchSummary, accountId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const items = batch.items.filter(item => item.accountId === accountId && !item.providerReference);
    const providerReference = String(form.get("providerReference") || "").trim();
    const submittedAt = String(form.get("submittedAt") || "");
    void run("Recording batch lodgement", async () => {
      if (form.get("lodged") !== "yes") throw new Error("Confirm the batch was actually lodged with the registry or retailer.");
      if (!submittedAt || !Number.isFinite(Date.parse(submittedAt))) throw new Error("Enter the actual lodgement time.");
      const packetReferences = individualReferences ? items.map(item => ({ packetId: item.packetId,
        providerReference: String(form.get(`reference:${item.packetId}`) || "").trim() })) : undefined;
      if (packetReferences?.some(item => !item.providerReference) || (!individualReferences && !providerReference)) throw new Error("Enter the reference returned for every included job.");
      const body = JSON.stringify({ action: "record_batch_lodgement", batchId: batch.id, accountId, packetIds: items.map(item => item.packetId),
        providerReference, submittedAt: new Date(submittedAt).toISOString(), packetReferences });
      let previousRemaining = items.length + 1;
      while (true) {
        const result = await api(endpoint, { method: "POST", body }, { requestTimeoutMs: 120_000 });
        setData(readBatchWorkspace(result));
        const outcome = result.outcome as RegistryBatchLodgementOutcome | undefined;
        if (!outcome || !Array.isArray(outcome.results) || !Number.isInteger(outcome.remainingCount)) throw new Error("The batch result could not be confirmed. Refresh before continuing.");
        const failed = outcome.results.filter(item => item.status === "failed");
        if (failed.length) {
          onChanged();
          setError(`${outcome.submittedCount} job(s) recorded; ${failed.length} need attention. ${failed.map(item => `${items.find(job => job.packetId === item.packetId)?.jobReference || item.packetId}: ${item.error || "Check the retained claim."}`).join(" ")}`);
          break;
        }
        if (!outcome.remainingCount) {
          onChanged(); setConfirming(null);
          setNotice(`${outcome.submittedCount} job(s) marked Submitted. Government acceptance and Creditex payout remain separate.`);
          break;
        }
        if (outcome.remainingCount >= previousRemaining) throw new Error("Some jobs are still awaiting confirmation. Refresh the batch before retrying; recorded lodgements have been kept.");
        previousRemaining = outcome.remainingCount;
        setBusy(`Recording batch lodgement · ${outcome.remainingCount} remaining`);
      }
    });
  }

  function confirmation(batch: RegistryBatchSummary, accountId: string) {
    const items = batch.items.filter(item => item.accountId === accountId && !item.providerReference);
    const localTime = confirming?.lodgedAt || "";
    return <form className={styles.confirmation} onSubmit={event => confirmLodgement(event, batch, accountId)}>
      <h4>Confirm {items.length} lodged job{items.length === 1 ? "" : "s"}</h4>
      <p>Use the receipt returned by the registry or retailer. Downloading the batch does not lodge it.</p>
      <label className={styles.check}><input type="checkbox" checked={individualReferences} onChange={event => setIndividualReferences(event.target.checked)} disabled={Boolean(busy)} />Different reference for each job</label>
      {individualReferences ? items.map(item => <label key={item.packetId}>{item.jobReference}<input name={`reference:${item.packetId}`} defaultValue={item.providerReference} required maxLength={240} /></label>)
        : <label>Registry or retailer batch reference<input name="providerReference" required maxLength={240} /></label>}
      <label>Lodged at<input type="datetime-local" name="submittedAt" defaultValue={localTime} step="1" required /></label>
      <label className={styles.check}><input type="checkbox" name="lodged" value="yes" required />I have lodged these jobs and checked the returned reference{individualReferences ? "s" : ""}.</label>
      <div className={styles.actions}><button type="submit" disabled={Boolean(busy)}>Mark {items.length} job{items.length === 1 ? "" : "s"} Submitted</button><button type="button" data-quiet onClick={() => setConfirming(null)} disabled={Boolean(busy)}>Cancel</button></div>
    </form>;
  }

  return <section className={styles.panel} aria-label="Bulk job submissions" aria-busy={Boolean(busy)}>
    <header className={styles.heading}><div><h3>Export ready jobs</h3><p>One download, grouped for each scheme. Confirm lodgement once to update the included jobs.</p></div>
      <button type="button" data-quiet disabled={Boolean(busy)} onClick={() => void run("Refreshing batches", refresh)}>Refresh batches</button></header>
    {error && <p className={styles.message} role="alert" data-error>{error}</p>}
    {notice && <p className={styles.message} role="status">{notice}</p>}
    {busy && <p role="status">{busy}…</p>}
    {!data ? <p>Checking ready jobs…</p> : <>
      <div className={styles.actions}><label>Scheme<select value={scheme} disabled={Boolean(busy)} onChange={event => { setScheme(event.target.value); setAttempt(null); }}><option value="all">All schemes</option>{REGISTRY_SCHEMES.map(item => <option key={item.key} value={item.key}>{item.output} · {item.title}</option>)}</select></label>
        <button type="button" disabled={!canOperate || Boolean(busy) || (!readyIds.length && !attempt)} onClick={exportReady}>Export {scheme === "all" ? "all " : ""}ready jobs ({readyIds.length})</button></div>
      {readyGroups.length ? <ul className={styles.groups}>{readyGroups.map(group => <li key={group.key}><strong>{group.packetIds.length} job{group.packetIds.length === 1 ? "" : "s"} · {schemeTitle(group.scheme)}</strong><span>{group.accountName} · {group.kind === "official_upload" ? group.formatLabel : "Provider handover records"}{group.baseVintage ? ` · ${group.baseVintage}` : ""}</span></li>)}</ul>
        : <p className={styles.muted}>No jobs are ready to export for this selection. Complete the claim and file reviews below; exported jobs are kept in Batch history.</p>}
      {readyGroups.some(group => group.kind === "provider_handover") && <p className={styles.muted}>Provider handover records contain approved claim details. Use the retailer or registry’s required reporting form and evidence; these records are not an official import file.</p>}
      {blocked.length > 0 && <details className={styles.details}><summary>{blocked.length} job{blocked.length === 1 ? " needs" : "s need"} attention</summary><ul>{blocked.map(item => <li key={item.packetId}><strong>{item.jobReference}</strong> · {item.reason}</li>)}</ul></details>}
      <details className={styles.details} open={Boolean(confirming) || data.batches.some(batch => batch.submittedCount < batch.packetCount)}><summary>Batch history ({data.batches.length})</summary>
        {!data.batches.length && <p>No batches exported yet.</p>}
        {data.batches.map(batch => <article key={batch.id} className={styles.batch}>
          <header><strong>{batch.packetCount} job{batch.packetCount === 1 ? "" : "s"} · {batchDate(batch.createdAt)}</strong><span>{batch.submittedCount === batch.packetCount ? "Submitted" : batch.submittedCount ? `${batch.submittedCount} submitted · ${batch.packetCount - batch.submittedCount} awaiting lodgement` : "Exported · awaiting lodgement"}</span></header>
          <button type="button" data-quiet disabled={Boolean(busy)} onClick={() => void run("Downloading saved batch", () => downloadBatch(batch.id))}>Download again</button>
          {[...new Set(batch.groups.map(group => group.accountId))].map(accountId => {
            const groups = batch.groups.filter(group => group.accountId === accountId);
            const items = batch.items.filter(item => item.accountId === accountId);
            const pending = items.filter(item => !item.providerReference);
            const active = confirming?.batchId === batch.id && confirming.accountId === accountId;
            const portal = REGISTRY_SCHEMES.find(item => item.key === groups[0]?.scheme);
            return <div key={accountId} className={styles.account}><strong>{groups[0]?.accountName} · {schemeTitle(groups[0]?.scheme || "")}</strong><p>{items.length} job{items.length === 1 ? "" : "s"}{groups.some(group => group.kind === "provider_handover") ? " · Provider handover records" : " · Approved upload files"}</p>
              <div className={styles.actions}>{portal && <a href={portal.portalUrl} target="_blank" rel="noreferrer">{portal.submissionMode === "retailer_reporting" ? "Reporting guidance" : "Open registry"} ↗</a>}{pending.length > 0 && canOperate && !active && <button type="button" disabled={Boolean(busy)} onClick={() => {
                const date = new Date(Math.ceil(Date.now() / 1000) * 1000);
                const lodgedAt = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
                setConfirming({ batchId: batch.id, accountId, lodgedAt }); setIndividualReferences(false);
              }}>Confirm batch lodged</button>}</div>
              {active && confirmation(batch, accountId)}
              {!pending.length && <p className={styles.muted}>Lodgement recorded for these jobs. Registry results and Creditex payout are tracked separately.</p>}
            </div>;
          })}
        </article>)}
      </details>
    </>}
  </section>;
}
