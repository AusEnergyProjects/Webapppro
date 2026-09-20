"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import type { PriceBookImportField, PriceBookImportPreview, PriceBookImportRow } from "@/lib/trade-price-book-import";
import { detectPriceBookColumns, mapPriceBookRows, priceBookHeaderGstBasis, priceBookHeaderRow, priceBookTemplateCsv,
  readPriceBookSpreadsheet, PRICE_BOOK_IMPORT_COLUMNS, type PriceBookColumnMapping, type PriceBookSheet } from "@/lib/trade-price-book-spreadsheet";
import styles from "./TradePriceBookImport.module.css";

type ImportResponse = { ok?: boolean; error?: string; preview?: PriceBookImportPreview; imported?: boolean };
const money = (cents: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);

export function TradePriceBookImport({ user, onClose, onImported }: {
  user: User; onClose: () => void; onImported: (preview: PriceBookImportPreview) => Promise<void>;
}) {
  const [fileName, setFileName] = useState(""); const [sheets, setSheets] = useState<PriceBookSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0); const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<PriceBookColumnMapping>({}); const [pricesIncludeGst, setPricesIncludeGst] = useState(false);
  const [preview, setPreview] = useState<PriceBookImportPreview | null>(null); const [rows, setRows] = useState<PriceBookImportRow[]>([]);
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [imported, setImported] = useState(false);
  const [showAll, setShowAll] = useState(false); const controller = useRef<AbortController | null>(null);
  const saving = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);
  const sheet = sheets[sheetIndex]; const headers = sheet?.data[headerRow] || [];
  const basis = priceBookHeaderGstBasis(headers, mapping);

  async function request(body: Record<string, unknown>) {
    const current = new AbortController(); controller.current?.abort(); controller.current = current;
    const timer = window.setTimeout(() => current.abort(), 25_000);
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error("The connection took too long. Your file is still here. Check the preview again before importing."));
      current.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      return await Promise.race([aborted, (async () => {
        const token = await user.getIdToken();
        if (current.signal.aborted) throw new Error("The request was cancelled.");
        const response = await fetch("/api/trade-price-book/import", { method: "POST", cache: "no-store", signal: current.signal,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const result = await response.json().catch(() => ({})) as ImportResponse;
        if (!response.ok || !result.ok) {
          if (result.preview) setPreview(result.preview);
          throw new Error(result.error || "The price sheet could not be checked. Try again.");
        }
        if (!result.preview) throw new Error("The price sheet check did not return a preview. Try again.");
        return { ...result, preview: result.preview };
      })()]);
    } finally {
      window.clearTimeout(timer);
      if (rejectAbort) current.signal.removeEventListener("abort", rejectAbort);
      if (controller.current === current) controller.current = null;
    }
  }

  async function check(nextSheet = sheet, nextHeader = headerRow, nextMapping = mapping, includeGst = pricesIncludeGst) {
    if (!nextSheet) return;
    setBusy("checking"); setError(""); setPreview(null); setImported(false); setShowAll(false);
    try {
      if (priceBookHeaderGstBasis(nextSheet.data[nextHeader] || [], nextMapping) === "mixed") throw new Error("The cost and sell price headings use different GST bases. Save both as ex GST or both as including GST, then upload again.");
      const nextRows = mapPriceBookRows(nextSheet, nextHeader, nextMapping); setRows(nextRows);
      const result = await request({ action: "preview", rows: nextRows, pricesIncludeGst: includeGst });
      setPreview(result.preview);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The price sheet could not be checked."); }
    finally { setBusy(""); }
  }

  async function selectSheet(nextSheets: PriceBookSheet[], index: number) {
    const selected = nextSheets[index]; const header = priceBookHeaderRow(selected.data);
    const columns = detectPriceBookColumns(selected.data[header] || []);
    const includeGst = priceBookHeaderGstBasis(selected.data[header] || [], columns) === "inclusive";
    setSheetIndex(index); setHeaderRow(header); setMapping(columns); setPricesIncludeGst(includeGst);
    await check(selected, header, columns, includeGst);
  }

  async function upload(file: File) {
    setFileName(file.name); setBusy("reading"); setError(""); setPreview(null); setRows([]); setSheets([]); setImported(false);
    try {
      const nextSheets = await readPriceBookSpreadsheet(file);
      if (!nextSheets.length) throw new Error("The workbook has no readable sheets.");
      setSheets(nextSheets);
      const first = nextSheets.findIndex((candidate) => {
        const columns = detectPriceBookColumns(candidate.data[priceBookHeaderRow(candidate.data)] || []);
        return columns.name !== undefined && (columns.sellPrice !== undefined || columns.supplierCost !== undefined);
      });
      await selectSheet(nextSheets, Math.max(0, first));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "This file could not be read."); setBusy(""); }
  }

  function changeMapping(field: PriceBookImportField, value: string) {
    const next = { ...mapping }; if (value === "") delete next[field]; else next[field] = Number(value);
    setMapping(next); setPreview(null); setError(""); setImported(false);
    const nextBasis = priceBookHeaderGstBasis(headers, next);
    if (nextBasis === "inclusive" || nextBasis === "exclusive") setPricesIncludeGst(nextBasis === "inclusive");
  }

  async function save() {
    if (!preview?.canImport || imported || saving.current) return;
    saving.current = true;
    setBusy("importing"); setError("");
    try {
      const result = await request({ action: "import", rows, previewToken: preview.token, pricesIncludeGst });
      if (!result.imported) throw new Error("The prices were not saved. Check the preview and try again.");
      setPreview(result.preview); setImported(true); setBusy("");
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([onImported(result.preview), new Promise<never>((_, reject) => { refreshTimer = setTimeout(() => reject(new Error("Refresh timed out.")), 15_000); })]); }
      catch { setError("Your prices were imported, but the list could not refresh. Close this panel and reload the price book."); }
      finally { clearTimeout(refreshTimer); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The prices could not be imported. Your file is still here."); }
    finally { setBusy(""); saving.current = false; }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob(["\uFEFF", priceBookTemplateCsv()], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "TLink-price-book-template.csv";
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className={styles.panel} aria-labelledby="price-book-import-title" aria-busy={Boolean(busy)}>
    <header><div><h4 id="price-book-import-title">Upload your price sheet</h4><p>Add your catalogue once. Upload it again whenever your costs or prices change.</p></div><button type="button" disabled={Boolean(busy)} onClick={onClose}>{imported ? "Done" : "Close"}</button></header>
    <p className={styles.hint}>Matching items are updated using their TLink code, SKU, or exact item name. Blank cells keep saved details. Existing quotes and invoices keep their prices.</p>
    <div className={styles.upload}><label><span>Excel or CSV file</span><input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /><small>Up to 2,000 items and 5 MB. Keep the same names or SKUs when updating prices.</small></label><button type="button" onClick={downloadTemplate}>Download example sheet</button></div>
    {fileName && <p className={styles.fileName}>{fileName}{rows.length ? ` | ${rows.length.toLocaleString()} rows` : ""}</p>}
    {sheet && <>
      <div className={styles.settings}>
        {sheets.length > 1 && <label><span>Sheet to import</span><select value={sheetIndex} disabled={Boolean(busy)} onChange={(event) => void selectSheet(sheets, Number(event.target.value))}>{sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label>}
        <label><span>Prices and costs in this file</span><select value={pricesIncludeGst ? "inclusive" : "exclusive"} disabled={Boolean(busy) || imported || basis !== "unspecified"} onChange={(event) => { setPricesIncludeGst(event.target.value === "inclusive"); setPreview(null); setError(""); }}><option value="exclusive">Exclude GST</option><option value="inclusive">Include GST</option></select><small>{basis === "inclusive" || basis === "exclusive" ? "Set from your spreadsheet headings." : "Check this matches your spreadsheet before importing."} TLink saves prices excluding GST.</small></label>
      </div>
      <details className={styles.mapping} open={!preview && !busy && Boolean(error)}><summary>Change column choices</summary><p>Only change these if a heading was not recognised. A name or code and a price or cost column are needed.</p><div>
        <label><span>Heading row</span><select disabled={Boolean(busy) || imported} value={headerRow} onChange={(event) => { const next = Number(event.target.value); setHeaderRow(next); const columns = detectPriceBookColumns(sheet.data[next] || []); setMapping(columns); setPricesIncludeGst(priceBookHeaderGstBasis(sheet.data[next] || [], columns) === "inclusive"); setPreview(null); setError(""); }}>{sheet.data.slice(0, 20).map((row, index) => <option key={index} value={index}>Row {index + 1}: {row.filter((cell) => cell !== null).slice(0, 3).join(" / ").slice(0, 90)}</option>)}</select></label>
        {PRICE_BOOK_IMPORT_COLUMNS.filter(({ key }) => !["itemType", "unitLabel"].includes(key) || mapping[key] !== undefined).map(({ key, label }) => <label key={key}><span>{label}</span><select value={mapping[key] ?? ""} disabled={Boolean(busy) || imported} onChange={(event) => changeMapping(key, event.target.value)}><option value="">Not supplied</option>{headers.map((header, index) => <option value={index} key={index}>{String(header || `Column ${index + 1}`)}</option>)}</select></label>)}
      </div></details>
    </>}
    {busy && <p role="status">{busy === "reading" ? "Reading your spreadsheet..." : busy === "checking" ? "Checking items and matching current prices..." : "Saving your catalogue..."}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {preview && <>
      <div className={styles.counts} aria-label="Import totals"><div><strong>{preview.counts.added}</strong><span>New items</span></div><div><strong>{preview.counts.updated}</strong><span>Updated items</span></div><div><strong>{preview.counts.unchanged}</strong><span>Unchanged</span></div></div>
      {preview.counts.superseded > 0 && <p className={styles.hint}>{preview.counts.superseded} earlier {preview.counts.superseded === 1 ? "row is" : "rows are"} replaced by a later matching row in this file.</p>}
      {preview.issues.length > 0 && <div className={styles.error}><strong>Fix these rows in your file, then upload it again.</strong><ul>{preview.issues.map((issue, index) => <li key={`${issue.rowNumber}:${index}`}>Row {issue.rowNumber}: {issue.message}</li>)}</ul></div>}
      {preview.items.length > 0 && <><p className={styles.tableHeading}>Preview of prices excluding GST</p><div className={styles.tableScroll}><table><thead><tr><th scope="col">Item</th><th scope="col">Action</th><th scope="col">Sell price ex GST</th><th scope="col">Cost ex GST</th></tr></thead><tbody>{(showAll ? preview.items : preview.items.slice(0, 20)).map((item) => <tr key={item.rowNumber}><th scope="row">{item.name}<small>Row {item.rowNumber}{item.itemCode ? ` | ${item.itemCode}` : ""}</small></th><td>{item.status === "added" ? "Add" : item.status === "updated" ? "Update" : "Keep"}</td><td>{item.before && item.before.sellPriceCentsExGst !== item.after.sellPriceCentsExGst && <del>{money(item.before.sellPriceCentsExGst)}</del>}<strong>{money(item.after.sellPriceCentsExGst)}</strong></td><td>{item.before && item.before.supplierCostCentsExGst !== item.after.supplierCostCentsExGst && <del>{money(item.before.supplierCostCentsExGst)}</del>}{money(item.after.supplierCostCentsExGst)}</td></tr>)}</tbody></table></div>{preview.items.length > 20 && <button type="button" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer rows" : `Show all ${preview.items.length} rows`}</button>}</>}
      {imported && <p className={styles.success} role="status">Import complete. {preview.counts.added} added, {preview.counts.updated} updated and {preview.counts.unchanged} unchanged.</p>}
    </>}
    {sheet && !imported && <div className={styles.actions}>{!preview || error ? <button type="button" disabled={Boolean(busy)} onClick={() => void check()}>Check preview</button> : null}{preview?.canImport && <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => void save()}>{busy === "importing" ? "Importing..." : preview.counts.added + preview.counts.updated === 0 ? "Confirm unchanged prices" : `Import ${preview.counts.added + preview.counts.updated} ${preview.counts.added + preview.counts.updated === 1 ? "item" : "items"}`}</button>}</div>}
  </section>;
}
