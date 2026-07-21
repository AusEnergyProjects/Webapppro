"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./AdminDatabaseWorkspace.module.css";

type DatabaseTableSummary = {
  name: string;
  canInsert: boolean;
  canDelete: boolean;
  reason: string;
};

type DatabaseColumn = {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
  protected: boolean;
};

type DatabaseRow = {
  values: Record<string, unknown>;
  clippedColumns: string[];
  deleteConfirmation: string;
};

type DatabaseTableDetail = DatabaseTableSummary & {
  columns: DatabaseColumn[];
  primaryKey: string[];
  rows: DatabaseRow[];
  pagination: {
    offset: number;
    pageSize: number;
    total: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
};

type DatabaseApiResult = {
  tables?: DatabaseTableSummary[];
  table?: DatabaseTableDetail;
};

type AdminDatabaseWorkspaceProps = {
  api: (path: string, init?: RequestInit) => Promise<DatabaseApiResult>;
  setStatus: (status: string) => void;
};

function displayValue(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function inputType(column: DatabaseColumn) {
  if (column.protected) return "password";
  return /INT|REAL|FLOA|DOUB|NUMERIC|DECIMAL|BOOLEAN/.test(column.type) ? "number" : "text";
}

function isGeneratedColumn(column: DatabaseColumn) {
  return (column.name === "id" && column.primaryKeyPosition === 1 && /CHAR|CLOB|TEXT/.test(column.type))
    || ["created_at", "updated_at"].includes(column.name);
}

export function AdminDatabaseWorkspace({ api, setStatus }: AdminDatabaseWorkspaceProps) {
  const [tables, setTables] = useState<DatabaseTableSummary[]>([]);
  const [tableSearch, setTableSearch] = useState("");
  const [selectedTable, setSelectedTable] = useState("");
  const [detail, setDetail] = useState<DatabaseTableDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addValues, setAddValues] = useState<Record<string, string>>({});
  const [includedColumns, setIncludedColumns] = useState<Record<string, boolean>>({});
  const [nullColumns, setNullColumns] = useState<Record<string, boolean>>({});
  const [addConfirmation, setAddConfirmation] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DatabaseRow | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const loadGeneration = useRef(0);
  const addPanel = useRef<HTMLFormElement>(null);
  const deletePanel = useRef<HTMLFormElement>(null);

  const loadTable = useCallback(async (name: string, offset = 0, pageSize = 25, announce = false) => {
    const generation = ++loadGeneration.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({ table: name, offset: String(offset), pageSize: String(pageSize) });
      const result = await api(`/api/admin/database?${params}`);
      if (generation !== loadGeneration.current) return;
      setTables(result.tables || []);
      setDetail(result.table || null);
      setSelectedTable(name);
      setAddOpen(false);
      setDeleteTarget(null);
      if (announce && result.table) setStatus(`${result.table.rows.length} rows shown from ${name}.`);
    } catch (error) {
      if (generation === loadGeneration.current) setStatus(error instanceof Error ? error.message : "The live database table could not be loaded.");
    } finally {
      if (generation === loadGeneration.current) setBusy(false);
    }
  }, [api, setStatus]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setBusy(true);
        try {
          const result = await api("/api/admin/database");
          if (!active) return;
          const nextTables = result.tables || [];
          setTables(nextTables);
          const preferred = nextTables.find((table) => table.name === "trade_work_orders")?.name || nextTables[0]?.name || "";
          if (preferred) await loadTable(preferred);
        } catch (error) {
          if (active) setStatus(error instanceof Error ? error.message : "The live database catalogue could not be loaded.");
        } finally {
          if (active) setBusy(false);
        }
      })();
    }, 0);
    return () => { active = false; loadGeneration.current += 1; window.clearTimeout(timer); };
  }, [api, loadTable, setStatus]);

  useEffect(() => {
    const panel = addOpen ? addPanel.current : deleteTarget ? deletePanel.current : null;
    if (!panel) return;
    const frame = window.requestAnimationFrame(() => {
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [addOpen, deleteTarget]);

  const filteredTables = useMemo(() => {
    const search = tableSearch.trim().toLowerCase();
    return search ? tables.filter((table) => table.name.toLowerCase().includes(search)) : tables;
  }, [tableSearch, tables]);

  function openAdd() {
    if (!detail?.canInsert) return;
    const included: Record<string, boolean> = {};
    const values: Record<string, string> = {};
    for (const column of detail.columns) {
      const generated = isGeneratedColumn(column);
      included[column.name] = !generated && column.notNull && column.defaultValue === null;
      values[column.name] = "";
    }
    setIncludedColumns(included);
    setAddValues(values);
    setNullColumns({});
    setAddConfirmation("");
    setDeleteTarget(null);
    setAddOpen(true);
  }

  async function addRow(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const values: Record<string, unknown> = {};
    for (const column of detail.columns) {
      if (!includedColumns[column.name] || isGeneratedColumn(column)) continue;
      values[column.name] = nullColumns[column.name] ? null : addValues[column.name] || "";
    }
    setBusy(true);
    setStatus(`Adding one row to ${detail.name}...`);
    try {
      await api("/api/admin/database", {
        method: "POST",
        body: JSON.stringify({ table: detail.name, values, confirmation: addConfirmation }),
      });
      setStatus(`One row was added to ${detail.name} and recorded in the administrator audit log.`);
      await loadTable(detail.name, detail.pagination.offset, detail.pagination.pageSize);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The row could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(event: FormEvent) {
    event.preventDefault();
    if (!detail || !deleteTarget) return;
    const key = Object.fromEntries(detail.primaryKey.map((name) => [name, deleteTarget.values[name]]));
    setBusy(true);
    setStatus(`Deleting one row from ${detail.name}...`);
    try {
      await api("/api/admin/database", {
        method: "DELETE",
        body: JSON.stringify({ table: detail.name, key, confirmation: deleteConfirmation }),
      });
      setStatus(`One row was deleted from ${detail.name} and recorded in the administrator audit log.`);
      setDeleteTarget(null);
      setDeleteConfirmation("");
      const nextOffset = detail.rows.length === 1 && detail.pagination.offset > 0
        ? Math.max(0, detail.pagination.offset - detail.pagination.pageSize)
        : detail.pagination.offset;
      await loadTable(detail.name, nextOffset, detail.pagination.pageSize);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The row could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.workspace}>
    <header className="admin-page-heading">
      <span>Owner controls</span>
      <h1>Live database console</h1>
      <p>Browse the Sites-managed production database directly. Approved low-risk tables also support deliberate single-row repair without Cloudflare dashboard access.</p>
    </header>

    <section className={styles.warning} aria-label="Production database warning">
      <strong>Live production data</strong>
      <p>Changes take effect immediately and cannot be undone here. Use the normal product workflow when it is available. Raw SQL, bulk changes and schema controls are not exposed.</p>
    </section>

    <div className={styles.layout}>
      <aside className={`admin-panel ${styles.catalogue}`}>
        <div className="admin-panel-heading">
          <span>Database catalogue</span>
          <h2>{tables.length} application tables</h2>
        </div>
        <label className={styles.search}>
          <span>Find a table</span>
          <input value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="customer, job, quote..." />
        </label>
        <div className={styles.tableList}>
          {filteredTables.map((table) => <button
            type="button"
            key={table.name}
            className={selectedTable === table.name ? styles.selected : ""}
            disabled={busy}
            onClick={() => void loadTable(table.name)}
          >
            <code>{table.name}</code>
            <span>{table.canInsert || table.canDelete ? "Row controls" : "Browse only"}</span>
          </button>)}
          {!filteredTables.length && <p>No table names match this search.</p>}
        </div>
      </aside>

      <section className={styles.content} aria-busy={busy}>
        {detail ? <>
          <section className={`admin-panel ${styles.tablePanel}`}>
            <div className={styles.tableHeading}>
              <div>
                <span>Selected table</span>
                <h2><code>{detail.name}</code></h2>
                <p>{detail.reason}</p>
              </div>
              <div className={styles.badges}>
                <span>{detail.pagination.total.toLocaleString("en-AU")} rows</span>
                <span>{detail.columns.length} columns</span>
                <span>{detail.primaryKey.length ? `Key: ${detail.primaryKey.join(", ")}` : "No primary key"}</span>
              </div>
            </div>
            <div className={styles.toolbar}>
              <label>Rows per page
                <select disabled={busy} value={detail.pagination.pageSize} onChange={(event) => void loadTable(detail.name, 0, Number(event.target.value))}>
                  <option value="25">25</option><option value="50">50</option><option value="100">100</option>
                </select>
              </label>
              <button type="button" disabled={!detail.pagination.hasPrevious || busy} onClick={() => void loadTable(detail.name, Math.max(0, detail.pagination.offset - detail.pagination.pageSize), detail.pagination.pageSize)}>Previous</button>
              <button type="button" disabled={!detail.pagination.hasNext || busy} onClick={() => void loadTable(detail.name, detail.pagination.offset + detail.pagination.pageSize, detail.pagination.pageSize)}>Next</button>
              <span>Rows {detail.pagination.total ? detail.pagination.offset + 1 : 0} to {Math.min(detail.pagination.offset + detail.rows.length, detail.pagination.total)}</span>
              {detail.canInsert && <button type="button" className={styles.primary} disabled={busy} onClick={openAdd}>Add one row</button>}
            </div>
            <div className={styles.grid} tabIndex={0} role="region" aria-label={`${detail.name} rows`}>
              <table>
                <thead><tr>{detail.columns.map((column) => <th key={column.name} scope="col"><code>{column.name}</code><small>{column.type || "untyped"}{column.primaryKeyPosition ? " | primary key" : ""}</small></th>)}{detail.canDelete && <th scope="col">Action</th>}</tr></thead>
                <tbody>
                  {detail.rows.map((row, index) => <tr key={detail.primaryKey.map((name) => displayValue(row.values[name])).join(":") || index}>
                    {detail.columns.map((column) => <td key={column.name} className={row.clippedColumns.includes(column.name) ? styles.clipped : ""} title={row.clippedColumns.includes(column.name) ? "This long value is clipped in the console." : undefined}>{displayValue(row.values[column.name])}</td>)}
                    {detail.canDelete && <td><button type="button" className={styles.deleteButton} disabled={busy} aria-label={`Delete ${detail.name} row ${detail.primaryKey.map((name) => displayValue(row.values[name])).join(", ")}`} onClick={() => { setAddOpen(false); setDeleteConfirmation(""); setDeleteTarget(row); }}>Delete</button></td>}
                  </tr>)}
                  {!detail.rows.length && <tr><td colSpan={detail.columns.length + (detail.canDelete ? 1 : 0)}>No rows are stored in this table.</td></tr>}
                </tbody>
              </table>
            </div>
            {detail.rows.some((row) => row.clippedColumns.length) && <p className={styles.note}>Long values are clipped to keep the live console bounded. Protected tokens, hashes, credentials and object keys are never returned in clear text.</p>}
          </section>

          {addOpen && detail.canInsert && <form ref={addPanel} tabIndex={-1} role="dialog" aria-labelledby="database-add-heading" className={`admin-panel ${styles.editor}`} onSubmit={addRow}>
            <div className="admin-panel-heading"><span>Deliberate insert</span><h2 id="database-add-heading">Add one row to <code>{detail.name}</code></h2><p>Only included fields are sent. Omitted fields keep their database default. IDs and standard timestamps are generated by the server.</p></div>
            <div className={styles.fields}>
              {detail.columns.map((column) => {
                const generated = isGeneratedColumn(column);
                const blob = !column.type || column.type.includes("BLOB");
                return <fieldset key={column.name} className={generated || blob ? styles.disabledField : ""}>
                  <legend><code>{column.name}</code></legend>
                  <div className={styles.fieldMeta}>{column.type || "untyped"}{column.notNull ? " | required" : " | nullable"}{column.defaultValue !== null ? ` | default ${column.defaultValue}` : ""}</div>
                  {generated ? <p>Generated automatically.</p> : blob ? <p>BLOB entry is not available in this console.</p> : <>
                    <label className={styles.check}><input type="checkbox" checked={Boolean(includedColumns[column.name])} onChange={(event) => setIncludedColumns((current) => ({ ...current, [column.name]: event.target.checked }))} />Include this field</label>
                    {includedColumns[column.name] && <>
                      {!column.notNull && <label className={styles.check}><input type="checkbox" checked={Boolean(nullColumns[column.name])} onChange={(event) => setNullColumns((current) => ({ ...current, [column.name]: event.target.checked }))} />Use NULL</label>}
                      {!nullColumns[column.name] && <input aria-label={`Value for ${column.name}`} type={inputType(column)} step={inputType(column) === "number" ? "any" : undefined} value={addValues[column.name] || ""} onChange={(event) => setAddValues((current) => ({ ...current, [column.name]: event.target.value }))} autoComplete="off" />}
                    </>}
                  </>}
                </fieldset>;
              })}
            </div>
            <label className={styles.confirm}>Type <code>ADD {detail.name}</code> to confirm
              <input value={addConfirmation} onChange={(event) => setAddConfirmation(event.target.value)} autoComplete="off" />
            </label>
            <div className={styles.actions}><button type="button" onClick={() => setAddOpen(false)}>Cancel</button><button type="submit" className={styles.primary} disabled={busy || addConfirmation !== `ADD ${detail.name}`}>Add one live row</button></div>
          </form>}

          {deleteTarget && detail.canDelete && <form ref={deletePanel} tabIndex={-1} role="dialog" aria-labelledby="database-delete-heading" className={`admin-panel ${styles.deletePanel}`} onSubmit={deleteRow}>
            <div className="admin-panel-heading"><span>Destructive action</span><h2 id="database-delete-heading">Delete one live row</h2><p>Check the selected row carefully. The audit log records a privacy-safe key fingerprint, but this console cannot restore the deleted data.</p></div>
            <dl>{detail.primaryKey.map((name) => <div key={name}><dt><code>{name}</code></dt><dd>{displayValue(deleteTarget.values[name])}</dd></div>)}</dl>
            <div className={styles.preview}>
              <strong>Selected row preview</strong>
              <dl>{detail.columns.filter((column) => !column.protected && !detail.primaryKey.includes(column.name) && deleteTarget.values[column.name] !== null).slice(0, 3).map((column) => <div key={column.name}><dt><code>{column.name}</code></dt><dd>{displayValue(deleteTarget.values[column.name])}</dd></div>)}</dl>
            </div>
            <label className={styles.confirm}>Type <code>{deleteTarget.deleteConfirmation}</code> to confirm this exact row
              <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" />
            </label>
            <div className={styles.actions}><button type="button" onClick={() => setDeleteTarget(null)}>Cancel</button><button type="submit" className={styles.danger} disabled={busy || deleteConfirmation !== deleteTarget.deleteConfirmation}>Delete this live row</button></div>
          </form>}
        </> : <section className="admin-panel"><p>{busy ? "Loading the live database..." : "Choose an application table."}</p></section>}
      </section>
    </div>
  </div>;
}
