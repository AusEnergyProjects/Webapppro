"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { IMPORT_DEFINITIONS, importTemplateCsv } from "@/lib/trade-data-imports.mjs";

type ImportType = "customers" | "jobs" | "products";
type ImportBatch = {
  id: string; importType: ImportType; fileName: string; rowCount: number; readyCount: number; warningCount: number;
  duplicateCount: number; errorCount: number; importedCount: number; skippedCount: number; failedCount: number;
  status: string; committedAt: string; rollbackUntil: string; rolledBackAt: string; createdAt: string; updatedAt: string;
};
type ImportRow = {
  id: string; rowNumber: number; key: string; values: Record<string, unknown>; status: "ready" | "warning" | "duplicate" | "error";
  issues: Array<{ level: string; message: string }>; resolution: "import" | "skip"; resultStatus: string;
  targetEntityType: string; targetEntityId: string; error: string;
};
type ImportResult = { ok?: boolean; partnerType?: "installer" | "supplier"; batches?: ImportBatch[]; batch?: ImportBatch; rows?: ImportRow[]; rolledBack?: number; blocked?: number; error?: string };

const labels: Record<ImportType, { eyebrow: string; title: string; description: string }> = {
  customers: { eyebrow: "Private installer contacts", title: "Customers", description: "Move customers who contacted your business directly. Never import AEA protected household details." },
  jobs: { eyebrow: "Historical business records", title: "Jobs", description: "Bring across previous and active jobs. Job IDs are assigned by AEA and cannot be imported or edited." },
  products: { eyebrow: "Wholesaler catalogue", title: "Products", description: "Move catalogue items into draft review. Imported products remain invisible to installers until approved." },
};

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function rowTitle(row: ImportRow, type: ImportType) {
  if (type === "customers") return String(row.values.businessName || [row.values.firstName, row.values.lastName].filter(Boolean).join(" ") || "Unnamed customer");
  if (type === "jobs") return String(row.values.title || "Untitled job");
  return `${String(row.values.modelNumber || "No model")} | ${String(row.values.name || "Unnamed product")}`;
}

export function TradeDataImportWorkspace({ user, partnerType, onImported }: { user: User; partnerType: "installer" | "supplier"; onImported?: () => void | Promise<void> }) {
  const availableTypes = useMemo(() => (partnerType === "supplier" ? ["products"] : ["customers", "jobs"]) as ImportType[], [partnerType]);
  const [importType, setImportType] = useState<ImportType>(availableTypes[0]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [activeBatch, setActiveBatch] = useState<ImportBatch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [rowFilter, setRowFilter] = useState("all");

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = await user.getIdToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as ImportResult;
    if (!response.ok || result.ok === false) throw new Error(result.error || "The import request could not be completed.");
    return result;
  }, [user]);

  const load = useCallback(async (batchId = "") => {
    const result = await request(`/api/trade-imports${batchId ? `?batchId=${encodeURIComponent(batchId)}` : ""}`);
    setBatches(result.batches || []);
    if (batchId) {
      setActiveBatch((result.batches || []).find((batch) => batch.id === batchId) || null);
      setRows(result.rows || []);
    }
  }, [request]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "Import history could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  function downloadTemplate() {
    const csv = importTemplateCsv(importType);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aea-${importType}-import-template.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function preview(file: File) {
    setBusy("preview");
    setStatus("Checking the file without changing your CRM...");
    try {
      const csvText = await file.text();
      const result = await request("/api/trade-imports", {
        method: "POST",
        body: JSON.stringify({ action: "preview", importType, fileName: file.name, fileSizeBytes: file.size, csvText }),
      });
      setActiveBatch(result.batch || null);
      setRows(result.rows || []);
      setBatches((current) => result.batch ? [result.batch, ...current.filter((batch) => batch.id !== result.batch!.id)] : current);
      setRowFilter("all");
      setStatus("Preview ready. Nothing has been added yet.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The CSV could not be checked."); }
    finally { setBusy(""); }
  }

  async function resolveRow(row: ImportRow, resolution: "import" | "skip") {
    if (!activeBatch) return;
    setBusy(`row:${row.id}`);
    try {
      const result = await request("/api/trade-imports", { method: "PATCH", body: JSON.stringify({ action: "resolve_row", batchId: activeBatch.id, rowId: row.id, resolution }) });
      setRows(result.rows || []);
      setStatus(resolution === "import" ? `Row ${row.rowNumber} will be included.` : `Row ${row.rowNumber} will be skipped.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The row decision could not be saved."); }
    finally { setBusy(""); }
  }

  async function commit() {
    if (!activeBatch) return;
    setBusy("commit");
    setStatus("Importing the reviewed rows and assigning system IDs...");
    try {
      const result = await request("/api/trade-imports", { method: "POST", body: JSON.stringify({ action: "commit", batchId: activeBatch.id }) });
      setActiveBatch(result.batch || null);
      setRows(result.rows || []);
      await load(result.batch?.id || activeBatch.id);
      await onImported?.();
      setStatus(`${result.batch?.importedCount || 0} record${result.batch?.importedCount === 1 ? "" : "s"} imported. Rollback is available for seven days if unchanged records need to be removed.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The import could not be completed."); }
    finally { setBusy(""); }
  }

  async function rollback() {
    if (!activeBatch) return;
    setBusy("rollback");
    setStatus("Checking imported records before rollback...");
    try {
      const result = await request("/api/trade-imports", { method: "PATCH", body: JSON.stringify({ action: "rollback", batchId: activeBatch.id }) });
      setActiveBatch(result.batch || null);
      setRows(result.rows || []);
      await load(result.batch?.id || activeBatch.id);
      await onImported?.();
      setStatus(result.blocked ? `${result.rolledBack || 0} unchanged records rolled back. ${result.blocked} edited records were protected and left in place.` : `${result.rolledBack || 0} imported records rolled back.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The rollback could not be completed."); }
    finally { setBusy(""); }
  }

  const filteredRows = rows.filter((row) => rowFilter === "all" || row.status === rowFilter);
  const includeCount = rows.filter((row) => row.resolution === "import" && row.status !== "error").length;
  const canCommit = activeBatch?.status === "preview" && includeCount > 0;
  const canRollback = activeBatch && ["committed", "failed", "rollback_partial"].includes(activeBatch.status) && (activeBatch.status === "failed" || Boolean(activeBatch.rollbackUntil));

  return <section className="trade-import-workspace" aria-labelledby="trade-import-title">
    <header className="trade-import-hero">
      <div><span>Guided migration</span><h2 id="trade-import-title">Bring your business records across safely</h2><p>Use a clear template, check every row, decide what to do with duplicates, then import. A preview never changes your CRM.</p></div>
      <aside><strong>Import safety</strong><span>Maximum 500 rows per batch</span><span>System IDs stay controlled by AEA</span><span>Seven-day rollback for unchanged records</span></aside>
    </header>

    <ol className="trade-import-steps" aria-label="Import steps">
      <li className="active"><span>1</span><strong>Choose</strong><small>Pick the record type</small></li>
      <li className={activeBatch ? "active" : ""}><span>2</span><strong>Preview</strong><small>Check rows and duplicates</small></li>
      <li className={activeBatch?.status === "preview" ? "active" : ""}><span>3</span><strong>Review</strong><small>Include or skip</small></li>
      <li className={activeBatch && activeBatch.status !== "preview" ? "active" : ""}><span>4</span><strong>Finish</strong><small>Import or rollback</small></li>
    </ol>

    <section className="trade-import-choose">
      <div className="trade-import-type-grid">{availableTypes.map((type) => <button key={type} type="button" className={importType === type ? "active" : ""} onClick={() => { setImportType(type); setActiveBatch(null); setRows([]); setStatus(""); }}><span>{labels[type].eyebrow}</span><strong>{labels[type].title}</strong><small>{labels[type].description}</small></button>)}</div>
      <div className="trade-import-template-card"><div><span>Start with the correct columns</span><strong>{IMPORT_DEFINITIONS[importType].label} template</strong><p>The examples are fictional. Remove them before adding business data.</p></div><div><button type="button" onClick={downloadTemplate}>Download CSV template</button><a href="/downloads/aea-business-data-import-templates.xlsx" download>Download all templates in Excel</a></div></div>
      <label className={`trade-import-dropzone ${busy === "preview" ? "busy" : ""}`}><span>{busy === "preview" ? "Checking file..." : `Choose completed ${labels[importType].title.toLowerCase()} CSV`}</span><small>CSV only, up to 2 MB and 500 rows. Previewing makes no changes.</small><input type="file" accept=".csv,text/csv" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void preview(file); event.currentTarget.value = ""; }} /></label>
    </section>

    {activeBatch && <section className="trade-import-review">
      <header><div><span>{activeBatch.fileName}</span><h3>{activeBatch.status === "preview" ? "Review before importing" : `Import ${readable(activeBatch.status)}`}</h3><p>{activeBatch.status === "preview" ? `${includeCount} of ${activeBatch.rowCount} rows are currently selected.` : `${activeBatch.importedCount} imported, ${activeBatch.skippedCount} skipped.`}</p></div><button type="button" className="trade-import-close" onClick={() => { setActiveBatch(null); setRows([]); }}>Close preview</button></header>
      <div className="trade-import-summary"><article><span>Total</span><strong>{activeBatch.rowCount}</strong></article><article className="ready"><span>Ready</span><strong>{activeBatch.readyCount}</strong></article><article className="warning"><span>Warnings</span><strong>{activeBatch.warningCount}</strong></article><article className="duplicate"><span>Duplicates</span><strong>{activeBatch.duplicateCount}</strong></article><article className="error"><span>Invalid</span><strong>{activeBatch.errorCount}</strong></article></div>
      <nav className="trade-import-filters" aria-label="Filter import rows">{["all", "ready", "warning", "duplicate", "error"].map((filter) => <button key={filter} type="button" className={rowFilter === filter ? "active" : ""} onClick={() => setRowFilter(filter)}>{readable(filter)}{filter !== "all" ? ` (${rows.filter((row) => row.status === filter).length})` : ""}</button>)}</nav>
      <div className="trade-import-row-list">{filteredRows.map((row) => <article key={row.id} className={`trade-import-row ${row.status}`}><div><span>Row {row.rowNumber} | {readable(row.status)}</span><strong>{rowTitle(row, activeBatch.importType)}</strong><small>{row.issues.length ? row.issues.map((issue) => issue.message).join(" ") : "Ready to import."}</small>{row.resultStatus !== "pending" && <em>{readable(row.resultStatus)}</em>}</div>{activeBatch.status === "preview" && row.status !== "error" && <button type="button" disabled={busy === `row:${row.id}` || (activeBatch.importType === "products" && row.status === "duplicate")} className={row.resolution === "import" ? "include" : "skip"} onClick={() => void resolveRow(row, row.resolution === "import" ? "skip" : "import")}>{activeBatch.importType === "products" && row.status === "duplicate" ? "Keep existing" : row.resolution === "import" ? "Included" : "Skipped"}</button>}</article>)}</div>
      <footer className="trade-import-actions">{activeBatch.status === "preview" ? <><div><strong>{includeCount} rows selected</strong><span>Invalid and skipped rows will not be added.</span></div><button type="button" className="btn" disabled={!canCommit || Boolean(busy)} onClick={() => void commit()}>{busy === "commit" ? "Importing..." : "Import reviewed rows"}</button></> : <><div><strong>{readable(activeBatch.status)}</strong><span>{activeBatch.rollbackUntil ? `Rollback available until ${dateLabel(activeBatch.rollbackUntil)}.` : "Rollback is not available for this batch."}</span></div>{canRollback && <button type="button" className="trade-import-rollback" disabled={Boolean(busy)} onClick={() => void rollback()}>{busy === "rollback" ? "Checking..." : "Rollback unchanged records"}</button>}</>}</footer>
    </section>}

    <section className="trade-import-history"><header><div><span>Import history</span><h3>Recent batches</h3></div></header>{loading ? <p>Loading import history...</p> : batches.length ? <div>{batches.map((batch) => <button type="button" key={batch.id} onClick={() => void load(batch.id)}><span>{readable(batch.importType)} | {dateLabel(batch.createdAt)}</span><strong>{batch.fileName}</strong><small>{batch.rowCount} rows | {readable(batch.status)}</small></button>)}</div> : <p>No imports have been prepared yet.</p>}</section>
    {status && <p className="trade-import-status" role="status">{status}</p>}
  </section>;
}
