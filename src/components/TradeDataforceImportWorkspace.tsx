import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import { parseDataforceJobCsv } from "@/lib/creditex-dataforce-job-csv";
import { defaultTradeDataforceServiceCategory, isTradeDataforceImport, isTradeDataforceServiceCategory, TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS } from "@/lib/trade-dataforce-import-metadata";

export type DataforceSourceFile = { name: string; csv: string };

type DataforceBatch = {
  id: string; fileName: string; rowCount: number; readyCount: number; warningCount: number;
  duplicateCount: number; errorCount: number; conflictCount: number; importedCount: number;
  skippedCount: number; failedCount: number; pendingCount: number;
  status: "preview" | "committing" | "committed" | "needs_review";
  createdAt: string; updatedAt: string; committedAt: string; integrityWarning?: string;
};
type DataforceRow = {
  id: string; rowNumber: number; key: string;
  values: { record: Record<string, string>; job?: { serviceCategory: string } };
  status: "ready" | "warning" | "error" | "duplicate" | "conflict";
  issues: Array<{ level: string; message: string }>;
  resultStatus: "pending" | "imported" | "duplicate" | "conflict" | "invalid";
  targetEntityId: string; error: string;
};
type FieldMapping = { header: string; target: string; note: string };
type Reconciliation = { jobs: number; customers: number; sites: number; appointments: number; contacts: number; brokenLinks: number; sourceRows?: number; sourceCells?: number; mismatchedSourceRows?: number; mappedFieldMismatches?: number };
type DataforceResult = {
  ok?: boolean; error?: string; batches?: DataforceBatch[]; batch?: DataforceBatch;
  rows?: DataforceRow[]; total?: number; nextOffset?: number | null;
  fieldMappings?: FieldMapping[]; processedCount?: number; hasMore?: boolean; reused?: boolean; reconciliation?: Reconciliation;
};

const pageSize = 100;
const fileSizeLimit = 10 * 1024 * 1024;

function sourceFileLabel(name: string) {
  return name.replace(/Dataforce/gi, "job-import");
}

function dateLabel(value: string) {
  return value ? new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Not yet";
}

function statusLabel(status: string) {
  return ({ preview: "Ready for review", committing: "Import in progress", committed: "Import complete", needs_review: "Needs review", invalid: "Invalid", imported: "Imported", pending: "Pending", duplicate: "Already imported", conflict: "Conflict", warning: "Warning", error: "Invalid", ready: "Ready" } as Record<string, string>)[status] || status;
}

function saveDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TradeDataforceImportWorkspace({ user, initialSource, onBack, onImported }: {
  user: User; initialSource?: DataforceSourceFile | null; onBack: () => void; onImported?: () => void | Promise<void>;
}) {
  const fetch = useTradeBusinessFetch();
  const [batches, setBatches] = useState<DataforceBatch[]>([]);
  const [batch, setBatch] = useState<DataforceBatch | null>(null);
  const [rows, setRows] = useState<DataforceRow[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sourceFile, setSourceFile] = useState<DataforceSourceFile | null>(null);
  const [workTypes, setWorkTypes] = useState<Array<{ name: string; count: number }>>([]);
  const [serviceCategoryMappings, setServiceCategoryMappings] = useState<Record<string, string>>({});
  const stopRequested = useRef(false);
  const mounted = useRef(true);
  const running = useRef(false);
  const initialSourceHandled = useRef(false);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    let result: DataforceResult;
    try { result = await response.json() as DataforceResult; }
    catch { throw new Error("TLink returned an unreadable import response. Reload the saved batch before resuming."); }
    if (!response.ok || result.ok !== true) throw new Error(result.error || "The job import request could not be completed.");
    return result;
  }, [fetch, user]);

  const applyBatch = useCallback((result: DataforceResult, pageOffset = 0) => {
    if (!result.batch) throw new Error("The saved import batch was missing from the response. Refresh import history before continuing.");
    setBatch(result.batch);
    setReconciliation(result.reconciliation || null);
    setBatches(current => [result.batch!, ...current.filter(item => item.id !== result.batch!.id)]);
    if (result.rows) { setRows(result.rows); setOffset(pageOffset); setNextOffset(result.nextOffset ?? null); }
    if (result.fieldMappings) setFieldMappings(result.fieldMappings);
  }, []);

  const loadBatch = useCallback(async (batchId: string, pageOffset = 0) => {
    const result = await request(`/api/trade-imports/dataforce?batchId=${encodeURIComponent(batchId)}&offset=${pageOffset}&limit=${pageSize}`);
    if (mounted.current) applyBatch(result, pageOffset);
  }, [applyBatch, request]);

  const prepareSource = useCallback((source: DataforceSourceFile) => {
    setError(""); setSourceFile(null); setWorkTypes([]); setServiceCategoryMappings({});
    setBatch(null); setRows([]); setFieldMappings([]); setReconciliation(null); setOffset(0); setNextOffset(null);
    try {
      if (new Blob([source.csv]).size > fileSizeLimit) throw new Error("Choose a job CSV no larger than 10 MB.");
      const parsed = parseDataforceJobCsv(source.csv);
      if (!isTradeDataforceImport(parsed.headers)) throw new Error("Choose a job export with all 23 original column headings.");
      const workTypeIndex = parsed.headers.indexOf("Work Type");
      const counts = new Map<string, number>();
      for (const row of parsed.rows) {
        const name = row.values[workTypeIndex] || "";
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      if (!counts.size) throw new Error("The job CSV must contain at least one job.");
      setSourceFile(source);
      setWorkTypes([...counts].map(([name, count]) => ({ name, count })));
      setStatus("File ready. Confirm the service category for each work type, then preview your records.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The job CSV could not be read."); }
    finally { setBusy(""); }
  }, []);

  const preview = useCallback(async () => {
    if (!sourceFile) return;
    setBusy("preview"); setError(""); setStatus("Checking all source rows and matching existing records. Your CRM has not changed.");
    setBatch(null); setRows([]); setFieldMappings([]); setReconciliation(null); setOffset(0); setNextOffset(null);
    try {
      const result = await request("/api/trade-imports/dataforce", { method: "POST", body: JSON.stringify({ action: "preview", csvText: sourceFile.csv, fileName: sourceFile.name, serviceCategoryMappings }) });
      if (!mounted.current) return;
      applyBatch(result);
      setStatus(result.reused ? "This file already has a saved batch. Its current progress is shown below." : "Preview saved. Review the mappings and issues before importing.");
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "The job CSV could not be checked.");
    } finally { if (mounted.current) setBusy(""); }
  }, [applyBatch, request, serviceCategoryMappings, sourceFile]);

  useEffect(() => {
    mounted.current = true;
    const frame = window.requestAnimationFrame(() => {
      void request("/api/trade-imports/dataforce").then(result => {
        if (mounted.current) setBatches(current => [...current, ...(result.batches || []).filter(item => !current.some(existing => existing.id === item.id))]);
      }).catch(failure => {
        if (mounted.current) setError(failure instanceof Error ? failure.message : "Import history could not be loaded.");
      }).finally(() => { if (mounted.current) setLoading(false); });
      if (initialSource && !initialSourceHandled.current) {
        initialSourceHandled.current = true;
        prepareSource(initialSource);
      }
    });
    return () => { mounted.current = false; stopRequested.current = true; window.cancelAnimationFrame(frame); };
  }, [initialSource, prepareSource, request]);

  async function chooseFile(file: File) {
    if (file.size > fileSizeLimit) { setError("Choose a job CSV no larger than 10 MB."); return; }
    setBusy("reading"); setError("");
    try { prepareSource({ name: file.name, csv: await file.text() }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The file could not be read."); setBusy(""); }
  }

  async function openBatch(batchId: string, pageOffset = 0) {
    setBusy("loading"); setError(""); setStatus("");
    try { await loadBatch(batchId, pageOffset); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The saved batch could not be loaded."); }
    finally { if (mounted.current) setBusy(""); }
  }

  async function commit() {
    if (!batch || running.current) return;
    running.current = true; stopRequested.current = false;
    setBusy("commit"); setError(""); setStatus("Importing the reviewed records. Each completed group is saved.");
    const batchId = batch.id;
    try {
      let hasMore = true;
      while (hasMore && !stopRequested.current) {
        const result = await request("/api/trade-imports/dataforce", { method: "POST", body: JSON.stringify({ action: "commit", batchId }) });
        if (!mounted.current) return;
        applyBatch(result);
        if (typeof result.hasMore !== "boolean") throw new Error("The import response did not confirm its progress. Reload the saved batch before resuming.");
        hasMore = result.hasMore;
        if (hasMore && !result.processedCount) throw new Error("The import has paused because no rows progressed. Reload the batch to review its current state.");
        setStatus(`${result.batch!.importedCount.toLocaleString("en-AU")} of ${result.batch!.rowCount.toLocaleString("en-AU")} source rows imported. ${result.batch!.pendingCount.toLocaleString("en-AU")} still pending.`);
      }
      if (!mounted.current) return;
      await loadBatch(batchId);
      setStatus(hasMore ? "Import paused. Completed records are saved. Resume this batch when ready." : "Processing finished. Check the reconciliation counts and any rows needing review below.");
      try { await onImported?.(); }
      catch { setError("The import progress is saved, but the workspace could not refresh. Reload TLink to see the imported records."); }
    } catch (failure) {
      if (mounted.current) setError(`${failure instanceof Error ? failure.message : "The import was interrupted."} Completed records remain saved. Refresh this batch before resuming.`);
    } finally { running.current = false; if (mounted.current) setBusy(""); }
  }

  async function downloadSource() {
    if (!batch) return;
    setBusy("download"); setError("");
    try {
      const response = await fetch(`/api/trade-imports/dataforce?batchId=${encodeURIComponent(batch.id)}&format=source`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store" });
      if (!response.ok) throw new Error("The saved source file could not be downloaded.");
      saveDownload(await response.blob(), "job-import-source.csv");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The saved source file could not be downloaded."); }
    finally { setBusy(""); }
  }

  async function downloadReconciliation() {
    if (!batch) return;
    setBusy("reconciliation"); setError("");
    try {
      const allRows: DataforceRow[] = [];
      let integrityWarning = batch.integrityWarning || "";
      let pageOffset: number | null = 0;
      while (pageOffset !== null) {
        const result = await request(`/api/trade-imports/dataforce?batchId=${encodeURIComponent(batch.id)}&offset=${pageOffset}&limit=${pageSize}`);
        if (!result.rows || !result.batch) throw new Error("The reconciliation response was incomplete. Try downloading again.");
        if (result.batch.integrityWarning) integrityWarning = result.batch.integrityWarning;
        allRows.push(...result.rows);
        if (result.nextOffset != null && result.nextOffset <= pageOffset) throw new Error("The reconciliation pages did not advance. Try downloading again.");
        pageOffset = result.nextOffset ?? null;
      }
      if (allRows.length !== batch.rowCount) throw new Error("The reconciliation did not include every source row. Refresh the batch and try downloading again.");
      // Protect a spreadsheet opening the report from treating source text as a formula.
      const cell = (value: string | number) => {
        const source = String(value);
        return `"${(/^[\s]*[=+@-]/.test(source) ? `'${source}` : source).replaceAll('"', '""')}"`;
      };
      const report = [["Source row", "Original job ID", "Original app ID", "TLink job reference", "Preview status", "Import result", "Issues", "Current batch integrity"], ...allRows.map(row => [row.rowNumber, row.values.record["Job Id"], row.values.record["App Id"], row.targetEntityId, statusLabel(row.status), statusLabel(row.resultStatus), [...row.issues.map(issue => issue.message), row.error].filter(Boolean).join(" "), integrityWarning])];
      saveDownload(new Blob(["\uFEFF", report.map(row => row.map(cell).join(",")).join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" }), "job-import-reconciliation.csv");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The reconciliation report could not be downloaded."); }
    finally { setBusy(""); }
  }

  const canCommit = batch && batch.pendingCount > 0 && ["preview", "committing", "needs_review"].includes(batch.status);
  const processed = batch ? batch.rowCount - batch.pendingCount : 0;

  return <section className="trade-import-workspace" aria-labelledby="dataforce-import-title">
    <div><button className="trade-import-close" type="button" disabled={Boolean(busy)} onClick={onBack}>Other import types</button></div>
    <header className="trade-import-hero">
      <div><span>Job import</span><h2 id="dataforce-import-title">Your jobs, customers and history together</h2><p>Upload your original job export once. TLink maps its 23 columns and links customers, service addresses and jobs while keeping the original values.</p></div>
      <aside><strong>Review, then import</strong><span>Up to 20,000 rows and 10 MB</span><span>Existing records are protected</span><span>Saved progress can be resumed</span></aside>
    </header>
    <ol className="trade-import-steps" aria-label="Job import steps">
      <li className="active"><span>1</span><strong>Upload</strong><small>Original job CSV</small></li>
      <li className={batch ? "active" : ""}><span>2</span><strong>Review</strong><small>Mappings and row checks</small></li>
      <li className={batch && batch.status !== "preview" ? "active" : ""}><span>3</span><strong>Import</strong><small>Saved in small groups</small></li>
      <li className={batch && ["committed", "needs_review"].includes(batch.status) ? "active" : ""}><span>4</span><strong>Reconcile</strong><small>Account for every row</small></li>
    </ol>
    <label className={`trade-import-dropzone ${busy === "preview" || busy === "reading" ? "busy" : ""}`}>
      <span>{busy === "preview" ? "Checking job export..." : "Choose your job CSV"}</span>
      <small>Keep the original column headings. Choose service categories, then preview without changing your CRM.</small>
      <input aria-label="Job CSV file" type="file" accept=".csv,text/csv" disabled={Boolean(busy)} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void chooseFile(file); }} />
    </label>
    {sourceFile && !batch && <section className="trade-import-mapping" aria-labelledby="dataforce-service-mapping-title">
      <header><div><span>{sourceFileLabel(sourceFile.name)}</span><h3 id="dataforce-service-mapping-title">Match your work types to TLink services</h3><p>These choices apply only to this import. Original work type labels are kept. Unrecognised work types stay in Other with a review warning until you choose their category.</p></div></header>
      <div>{workTypes.map(workType => {
        const suggested = defaultTradeDataforceServiceCategory(workType.name);
        const suggestedLabel = TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS.find(option => option.value === suggested)?.label || "Other";
        return <label key={workType.name}><span>{workType.name || "Work type missing"} ({workType.count.toLocaleString("en-AU")} {workType.count === 1 ? "job" : "jobs"})</span><select aria-label={`TLink service category for ${workType.name || "missing work type"}`} value={Object.hasOwn(serviceCategoryMappings, workType.name) ? serviceCategoryMappings[workType.name] : ""} disabled={Boolean(busy)} onChange={event => {
          const category = event.target.value;
          if (category && !isTradeDataforceServiceCategory(category)) return;
          setServiceCategoryMappings(current => {
            const entries = Object.entries(current).filter(([name]) => name !== workType.name);
            if (category) entries.push([workType.name, category]);
            return Object.fromEntries(entries);
          });
        }}><option value="">Suggested: {suggestedLabel}{suggested === "other" ? " (needs review)" : ""}</option>{TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
      })}</div>
      <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void preview()}>{busy === "preview" ? "Checking..." : "Preview job mapping"}</button>
    </section>}
    <section className="trade-import-template-card"><div><strong>What your export contains</strong><p>Customer contacts, addresses, job and application references, source statuses, scheduled dates, worker names and historical financial fields are retained. Photos, documents and detailed field forms are not included in this CSV. Imported balances and certificate values remain historical records; importing does not approve certificates or issue invoices.</p><p>Imported appointments do not send automatic reminders or follow-ups. New appointments you create in TLink can use your normal automation settings.</p></div></section>
    {error && <p className="trade-import-status" role="alert">{error}</p>}
    {status && <p role="status" aria-live="polite">{status}</p>}
    {batch && <section className="trade-import-review" aria-labelledby="dataforce-review-title">
      <header><div><span>{sourceFileLabel(batch.fileName)}</span><h3 id="dataforce-review-title">{statusLabel(batch.status)}</h3><p>Saved {dateLabel(batch.updatedAt || batch.createdAt)}. Review all pages before starting.</p></div><div><button className="trade-import-close" type="button" disabled={Boolean(busy)} onClick={() => void openBatch(batch.id, offset)}>Refresh batch</button><button className="trade-import-close" type="button" disabled={Boolean(busy)} onClick={() => void downloadSource()}>Download saved source</button><button className="trade-import-close" type="button" disabled={Boolean(busy)} onClick={() => void downloadReconciliation()}>Download reconciliation</button></div></header>
      <div className="trade-import-summary">
        <article><span>Source rows</span><strong>{batch.rowCount.toLocaleString("en-AU")}</strong></article>
        <article className="ready"><span>{batch.status === "preview" ? "Ready" : "Imported"}</span><strong>{(batch.status === "preview" ? batch.readyCount : batch.importedCount).toLocaleString("en-AU")}</strong></article>
        <article className="warning"><span>Warnings</span><strong>{batch.warningCount.toLocaleString("en-AU")}</strong></article>
        <article className="duplicate"><span>Already imported</span><strong>{batch.duplicateCount.toLocaleString("en-AU")}</strong></article>
        <article className="error"><span>Invalid / conflicts</span><strong>{batch.errorCount.toLocaleString("en-AU")} / {batch.conflictCount.toLocaleString("en-AU")}</strong></article>
      </div>
      <p><strong>{batch.pendingCount.toLocaleString("en-AU")} pending</strong> · {batch.importedCount.toLocaleString("en-AU")} imported · {batch.skippedCount.toLocaleString("en-AU")} skipped · {batch.failedCount.toLocaleString("en-AU")} failed</p>
      {batch.integrityWarning && <p className="trade-import-status" role="alert">{batch.integrityWarning}</p>}
      {reconciliation && batch.importedCount > 0 && <section aria-label="Linked record reconciliation"><h4>Records linked by this batch</h4><div className="trade-import-summary">
        <article><span>Jobs</span><strong>{reconciliation.jobs.toLocaleString("en-AU")}</strong></article>
        <article><span>Customers</span><strong>{reconciliation.customers.toLocaleString("en-AU")}</strong></article>
        <article><span>Service sites</span><strong>{reconciliation.sites.toLocaleString("en-AU")}</strong></article>
        <article><span>Appointments</span><strong>{reconciliation.appointments.toLocaleString("en-AU")}</strong></article>
        <article><span>Contacts</span><strong>{reconciliation.contacts.toLocaleString("en-AU")}</strong></article>
      </div><p>{reconciliation.brokenLinks ? `${reconciliation.brokenLinks.toLocaleString("en-AU")} source record${reconciliation.brokenLinks === 1 ? " has" : "s have"} links requiring review.` : "All imported job, customer and service-site links are accounted for."}</p>{typeof reconciliation.sourceRows === "number" && typeof reconciliation.sourceCells === "number" && typeof reconciliation.mismatchedSourceRows === "number" && <p>{reconciliation.mismatchedSourceRows ? `${reconciliation.mismatchedSourceRows.toLocaleString("en-AU")} source rows need a value reconciliation review.` : `${reconciliation.sourceRows.toLocaleString("en-AU")} source rows and ${reconciliation.sourceCells.toLocaleString("en-AU")} original field values reconciled.`}</p>}</section>}
      {reconciliation && batch.importedCount > 0 && typeof reconciliation.mappedFieldMismatches === "number" && <p>{reconciliation.mappedFieldMismatches ? `${reconciliation.mappedFieldMismatches.toLocaleString("en-AU")} linked records now differ from the reviewed mapping. This can include changes made in TLink after import; original source values remain available.` : "Customer details, both contact numbers, addresses, service categories, job stages and scheduled times match the reviewed mapping."}</p>}
      <p>Rows with warnings can be imported. Invalid rows are excluded. Identical jobs already imported are skipped; changed source jobs are held as conflicts so existing work is never silently overwritten. Worker names are retained without granting team access.</p>
      {fieldMappings.length > 0 && <details className="trade-import-mapping"><summary><strong>View all {fieldMappings.length} column mappings</strong></summary><div>{fieldMappings.map(mapping => <div key={mapping.header}><strong>{mapping.header}</strong><p>{mapping.target}</p><small>{mapping.note}</small></div>)}</div></details>}
      <div className="trade-import-actions"><div><strong>Rows {rows.length ? offset + 1 : 0} to {offset + rows.length} of {batch.rowCount.toLocaleString("en-AU")}</strong><span>Expand a row to compare all original source values.</span></div><nav className="trade-import-filters" aria-label="Imported row pages"><button type="button" disabled={Boolean(busy) || offset === 0} onClick={() => void openBatch(batch.id, Math.max(0, offset - pageSize))}>Previous</button><button type="button" disabled={Boolean(busy) || nextOffset === null} onClick={() => nextOffset !== null && void openBatch(batch.id, nextOffset)}>Next</button></nav></div>
      <div className="trade-import-row-list">{rows.map(row => <article key={row.id} className={`trade-import-row ${row.status === "conflict" ? "error" : row.status}`}><div>
        <span>Row {row.rowNumber} · {statusLabel(row.resultStatus === "pending" ? row.status : row.resultStatus)}</span>
        <strong>{row.values.record.Customer || row.values.record["Company Name"] || "Unnamed customer"} · Original job ID {row.values.record["Job Id"] || "missing"}</strong>
        <small>{[row.values.record.Address, row.values.record.Suburb, row.values.record.Postcode].filter(Boolean).join(", ")}</small>
        {row.values.job && <small>TLink service: {TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS.find(option => option.value === row.values.job!.serviceCategory)?.label || row.values.job.serviceCategory}</small>}
        <small>{row.issues.length ? row.issues.map(issue => issue.message).join(" ") : "Source fields checked."}</small>
        {row.error && <small>{row.error}</small>}
        {row.targetEntityId && <a href={`/direct-trade/dashboard?workspace=work&crm=jobs&jobId=${encodeURIComponent(row.targetEntityId)}`} aria-label={`Open TLink job for original job ID ${row.values.record["Job Id"]}`}>Open TLink job</a>}
        <details><summary>Original imported record</summary><dl>{Object.entries(row.values.record).map(([header, value]) => <div key={header}><dt>{header}</dt><dd>{value || "Empty in source"}</dd></div>)}</dl></details>
      </div></article>)}</div>
      <footer className="trade-import-actions"><div><strong>{busy === "commit" ? "Importing your records" : canCommit ? "Ready to continue" : "Review your reconciliation"}</strong><span>{processed.toLocaleString("en-AU")} of {batch.rowCount.toLocaleString("en-AU")} rows processed. Completed records stay saved if you leave.</span>{busy === "commit" && <progress aria-label="Job import progress" max={batch.rowCount} value={processed} />}</div>
        {busy === "commit" ? <button className="trade-import-close" type="button" onClick={() => { stopRequested.current = true; setStatus("Pausing after the current group is saved..."); }}>Pause after this group</button> : canCommit && <button className="btn" type="button" disabled={Boolean(busy)} onClick={() => void commit()}>{batch.status === "preview" ? "Import reviewed job rows" : "Resume import"}</button>}
      </footer>
    </section>}
    <section className="trade-import-history"><header><div><span>Job import history</span><h3>Saved batches</h3></div></header>{loading ? <p>Loading import history...</p> : batches.length ? <div>{batches.map(item => <button type="button" key={item.id} disabled={Boolean(busy)} onClick={() => void openBatch(item.id)}><span>{dateLabel(item.createdAt)}</span><strong>{sourceFileLabel(item.fileName)}</strong><small>{item.rowCount.toLocaleString("en-AU")} rows · {statusLabel(item.status)} · {item.pendingCount.toLocaleString("en-AU")} pending</small></button>)}</div> : <p>No job imports have been prepared yet.</p>}</section>
  </section>;
}
