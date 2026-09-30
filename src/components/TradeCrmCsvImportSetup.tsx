import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { useTradeBusinessFetch } from "./TradeBusinessProvider";
import { parseStrictImportCsv } from "@/lib/creditex-dataforce-job-csv";
import { CRM_CSV_CUSTOMER_FIELDS, CRM_CSV_JOB_FIELDS, detectTradeCrmCsvRole, suggestTradeCrmCsvMapping, type TradeCrmCsvRole } from "@/lib/trade-crm-csv-import-metadata";
import { defaultTradeDataforceServiceCategory, isTradeDataforceServiceCategory, TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS } from "@/lib/trade-dataforce-import-metadata";
import type { DataforceResult, DataforceSourceFile } from "./TradeDataforceImportWorkspace";

type PreparedFile = { id: string; fileName: string; csvText: string; role: TradeCrmCsvRole; headers: readonly string[]; rows: ReadonlyArray<{ rowNumber: number; values: readonly string[] }>; mapping: Record<string, string> };
const fileSizeLimit = 10 * 1024 * 1024;
const fileLabel = (name: string) => name.replace(/Dataforce/gi, "job-import");

function prepare(source: DataforceSourceFile, id: string): PreparedFile {
  if (new Blob([source.csv]).size > fileSizeLimit) throw new Error("Choose CSV files no larger than 10 MB combined.");
  const parsed = parseStrictImportCsv(source.csv);
  if (!parsed.rows.length) throw new Error("Each file needs a header row and at least one record.");
  const role = detectTradeCrmCsvRole(parsed.headers) || "jobs";
  return { id, fileName: source.name, csvText: source.csv, role, headers: parsed.headers, rows: parsed.rows, mapping: suggestTradeCrmCsvMapping(parsed.headers, role) };
}

export function TradeCrmCsvImportSetup({ user, initialSource, onPreview }: { user: User; initialSource?: DataforceSourceFile | null; onPreview: (result: DataforceResult) => void }) {
  const fetch = useTradeBusinessFetch();
  const [initial] = useState(() => {
    try { return { files: initialSource ? [prepare(initialSource, "file-1")] : [], error: "" }; }
    catch (failure) { return { files: [], error: failure instanceof Error ? failure.message : "The CSV could not be read." }; }
  });
  const [files, setFiles] = useState<PreparedFile[]>(initial.files);
  const [sourceNamespace, setSourceNamespace] = useState("Previous CRM");
  const [unmatchedJobs, setUnmatchedJobs] = useState<"block" | "use_job_contacts">("block");
  const [serviceCategoryMappings, setServiceCategoryMappings] = useState<Record<string, string>>({});
  const [excludedRows, setExcludedRows] = useState<Record<string, number[]>>({});
  const [rowPages, setRowPages] = useState<Record<string, number>>({});
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial.error);
  const nextFileNumber = useRef(initialSource ? 2 : 1);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const categories = useMemo(() => {
    const jobFile = files.find(file => file.role === "jobs");
    const categoryHeader = jobFile?.mapping["job.category"];
    if (!jobFile || !categoryHeader) return [];
    const column = jobFile.headers.indexOf(categoryHeader);
    const counts = new Map<string, number>();
    for (const row of jobFile.rows) { if (excludedRows[jobFile.id]?.includes(row.rowNumber)) continue; const value = row.values[column] || ""; counts.set(value, (counts.get(value) || 0) + 1); }
    return [...counts].map(([name, count]) => ({ name, count }));
  }, [excludedRows, files]);

  async function chooseFiles(selected: File[]) {
    setError(""); setReviewConfirmed(false);
    if (files.length + selected.length > 2) { setError("Choose one customers CSV and one jobs CSV at most. Remove a file before replacing it."); return; }
    const savedBytes = files.reduce((total, file) => total + new Blob([file.csvText]).size, 0);
    if (savedBytes + selected.reduce((total, file) => total + file.size, 0) > fileSizeLimit) { setError("Choose CSV files no larger than 10 MB combined."); return; }
    setBusy(true);
    try {
      const prepared: PreparedFile[] = [];
      for (const file of selected) {
        if (file.size > fileSizeLimit) throw new Error("Choose CSV files no larger than 10 MB combined.");
        prepared.push(prepare({ name: file.name, csv: await file.text() }, `file-${nextFileNumber.current++}`));
      }
      if (savedBytes + prepared.reduce((total, file) => total + new Blob([file.csvText]).size, 0) > fileSizeLimit) throw new Error("Choose CSV files no larger than 10 MB combined.");
      if ([...files, ...prepared].reduce((total, file) => total + file.rows.length, 0) > 20_000) throw new Error("An import supports up to 20,000 combined customer and job rows.");
      if (mounted.current) { setFiles(current => [...current, ...prepared]); setServiceCategoryMappings({}); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "The selected files could not be read."); }
    finally { if (mounted.current) setBusy(false); }
  }

  function changeRole(id: string, role: TradeCrmCsvRole) {
    setFiles(current => current.map(file => file.id === id ? { ...file, role, mapping: suggestTradeCrmCsvMapping(file.headers, role) } : file));
    setServiceCategoryMappings({}); setReviewConfirmed(false);
  }

  function changeMapping(id: string, fieldId: string, header: string) {
    setFiles(current => current.map(file => file.id === id ? { ...file, mapping: { ...file.mapping, [fieldId]: header } } : file));
    setServiceCategoryMappings({}); setReviewConfirmed(false);
  }

  const duplicateRole = new Set(files.map(file => file.role)).size !== files.length;
  const missingFields = files.flatMap(file => (file.role === "customers" ? CRM_CSV_CUSTOMER_FIELDS : CRM_CSV_JOB_FIELDS).filter(field => field.required && !file.mapping[field.id]).map(field => `${fileLabel(file.fileName)}: ${field.label}`));
  const canPreview = files.length > 0 && !duplicateRole && missingFields.length === 0 && Boolean(sourceNamespace.trim()) && reviewConfirmed && !busy;

  function includeRow(fileId: string, rowNumber: number, include: boolean) {
    setExcludedRows(current => ({ ...current, [fileId]: include ? (current[fileId] || []).filter(value => value !== rowNumber) : [...(current[fileId] || []).filter(value => value !== rowNumber), rowNumber] }));
    setReviewConfirmed(false);
  }

  async function preview() {
    if (!canPreview) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/trade-imports/csv", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", files: files.map(({ id, fileName, csvText, role, mapping }) => ({ id, fileName, csvText, role, mapping })), options: { sourceNamespace: sourceNamespace.trim(), unmatchedJobs, serviceCategoryMappings, excludedRows: Object.fromEntries(files.filter(file => excludedRows[file.id]?.length).map(file => [file.id, excludedRows[file.id]])) } }) });
      let result: DataforceResult;
      try { result = await response.json() as DataforceResult; } catch { throw new Error("TLink returned an unreadable preview response. Your CRM has not changed."); }
      if (!response.ok || result.ok !== true) throw new Error(result.error || "The mapped files could not be checked.");
      if (!result.batch || !result.rows) throw new Error("The preview did not include its saved rows. Your files remain ready to review.");
      if (mounted.current) onPreview(result);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "The mapped files could not be checked."); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <section className="trade-crm-csv-setup" aria-label="Map CSV import files">
    <label className={`trade-import-dropzone ${busy ? "busy" : ""}`}><span>{busy ? "Checking your files..." : "Choose customers or jobs CSV files"}</span><small>Add either file, or both together. Up to 10 MB and 20,000 rows combined. Original columns and values are retained.</small><input type="file" aria-label="Customers and jobs CSV files" accept=".csv,text/csv" multiple disabled={busy || files.length >= 2} onChange={event => { const selected = Array.from(event.target.files || []); event.currentTarget.value = ""; if (selected.length) void chooseFiles(selected); }} /></label>
    {error && <p className="trade-import-status" role="alert">{error}</p>}
    {files.length > 0 && <>
      <section className="trade-import-mapping"><header><div><h3>Review how your files connect</h3><p>Match the client key in your jobs file to the unique source client key in your customers file. Source statuses remain historical; new jobs start in Imported.</p></div></header><div><label><span>Import source label</span><input value={sourceNamespace} maxLength={120} disabled={busy} onChange={event => { setSourceNamespace(event.target.value); setReviewConfirmed(false); }} /><small>Use this same label when importing later exports from this account, so existing records can be recognised.</small></label><label><span>Jobs without a matching customer</span><select value={unmatchedJobs} disabled={busy} onChange={event => { if (event.target.value === "block" || event.target.value === "use_job_contacts") setUnmatchedJobs(event.target.value); setReviewConfirmed(false); }}><option value="block">Hold unmatched jobs for review</option><option value="use_job_contacts">Use contact details from each unmatched job</option></select><small>Using job contacts creates separate customer records only when a reliable client match is unavailable. Existing customers are never guessed from similar names.</small></label></div></section>
      {files.map(file => {
        const fields = file.role === "customers" ? CRM_CSV_CUSTOMER_FIELDS : CRM_CSV_JOB_FIELDS;
        const usedHeaders = new Set(Object.values(file.mapping).filter(Boolean));
        const originalOnly = file.headers.filter(header => !usedHeaders.has(header));
        const page = rowPages[file.id] || 0; const pageRows = file.rows.slice(page * 50, (page + 1) * 50);
        const keyHeader = file.mapping[file.role === "customers" ? "customer.externalId" : "job.sourceId"];
        return <section className="trade-import-mapping" key={file.id}><header><div><span>{fileLabel(file.fileName)}</span><h3>{file.rows.length.toLocaleString("en-AU")} source {file.rows.length === 1 ? "record" : "records"}</h3></div><button className="trade-import-close" type="button" disabled={busy} onClick={() => { setFiles(current => current.filter(item => item.id !== file.id)); setServiceCategoryMappings({}); setReviewConfirmed(false); }}>Remove file</button></header><label><span>Records in {fileLabel(file.fileName)}</span><select aria-label={`Record type for ${fileLabel(file.fileName)}`} value={file.role} disabled={busy} onChange={event => { if (event.target.value === "customers" || event.target.value === "jobs") changeRole(file.id, event.target.value); }}><option value="customers">Customers</option><option value="jobs">Jobs</option></select></label><details open><summary>Review column mapping</summary><div>{fields.map(field => <label key={field.id}><span>{field.label}{field.required ? " (required)" : ""}</span><select aria-label={`${field.label} in ${fileLabel(file.fileName)}`} value={file.mapping[field.id] || ""} disabled={busy} onChange={event => changeMapping(file.id, field.id, event.target.value)}><option value="">Not mapped</option>{file.headers.map(header => <option key={header} value={header}>{header}</option>)}</select>{file.mapping[field.id] && <small>Example: {file.rows.slice(0, 2).map(row => row.values[file.headers.indexOf(file.mapping[field.id])] || "Empty").join("; ")}</small>}</label>)}</div></details>{originalOnly.length > 0 && <p>Kept in the original record: {originalOnly.join(", ")}.</p>}
          <details className="trade-import-source-rows"><summary>Choose rows to include · {excludedRows[file.id]?.length || 0} excluded</summary><p>All rows start included. Clear any example, guide or unwanted row. Its original values remain in the saved source file.</p><div className="trade-import-source-row-list">{pageRows.map(row => {
            const excluded = excludedRows[file.id]?.includes(row.rowNumber) || false;
            const key = row.values[file.headers.indexOf(keyHeader)] || "No source key mapped";
            return <article key={row.rowNumber} className={excluded ? "excluded" : ""}><label className="trade-import-confirm"><input type="checkbox" checked={!excluded} disabled={busy} aria-label={`Include row ${row.rowNumber} in ${fileLabel(file.fileName)}`} onChange={event => includeRow(file.id, row.rowNumber, event.target.checked)} /><span>Row {row.rowNumber} · {key} · {excluded ? "Excluded" : "Included"}</span></label><details><summary>View original values</summary><dl>{file.headers.map((header, index) => <div key={header}><dt>{header}</dt><dd>{row.values[index] || "Empty in source"}</dd></div>)}</dl></details></article>;
          })}</div><nav className="trade-import-filters" aria-label={`Source row pages for ${fileLabel(file.fileName)}`}><button type="button" disabled={busy || page === 0} onClick={() => setRowPages(current => ({ ...current, [file.id]: page - 1 }))}>Previous source rows</button><span>Rows {page * 50 + 1} to {page * 50 + pageRows.length} of {file.rows.length}</span><button type="button" disabled={busy || (page + 1) * 50 >= file.rows.length} onClick={() => setRowPages(current => ({ ...current, [file.id]: page + 1 }))}>Next source rows</button></nav></details>
        </section>;
      })}
      {categories.length > 0 && <section className="trade-import-mapping"><header><div><h3>Match service categories</h3><p>These choices apply only to this import. The original category is retained.</p></div></header><div>{categories.map(category => <label key={category.name}><span>{category.name || "Category missing"} ({category.count} jobs)</span><select aria-label={`TLink service category for ${category.name || "missing category"}`} value={Object.hasOwn(serviceCategoryMappings, category.name) ? serviceCategoryMappings[category.name] : ""} disabled={busy} onChange={event => { const value = event.target.value; if (value && !isTradeDataforceServiceCategory(value)) return; setServiceCategoryMappings(current => Object.fromEntries([...Object.entries(current).filter(([name]) => name !== category.name), ...(value ? [[category.name, value]] : [])])); setReviewConfirmed(false); }}><option value="">Suggested: {TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS.find(option => option.value === defaultTradeDataforceServiceCategory(category.name))?.label || "Other"}</option>{TRADE_DATAFORCE_SERVICE_CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}</div></section>}
      {duplicateRole && <p className="trade-import-status" role="alert">Choose one file per record type. A paired import needs one Customers file and one Jobs file.</p>}
      {missingFields.length > 0 && <p className="trade-import-status" role="alert">Map the required fields before previewing: {missingFields.join("; ")}.</p>}
      <label className="trade-import-confirm"><input type="checkbox" checked={reviewConfirmed} disabled={busy} onChange={event => setReviewConfirmed(event.target.checked)} /> I have reviewed the source label, record types, client keys and column mappings.</label>
      <button className="btn" type="button" disabled={!canPreview} onClick={() => void preview()}>{busy ? "Checking mapped files..." : "Preview mapped files"}</button>
    </>}
  </section>;
}
