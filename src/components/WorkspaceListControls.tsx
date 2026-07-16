"use client";

export type WorkspaceListPreferences = {
  search: string;
  filter: string;
  sort: string;
  pageSize: number;
  type?: string;
  synthetic?: string;
};

export function WorkspaceListControls({
  page,
  pageCount,
  pageSize,
  total,
  saved,
  busy,
  onPage,
  onPageSize,
  onSave,
  onReset,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  saved: boolean;
  busy?: boolean;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);
  return <div className="workspace-list-controls" aria-label="List controls">
    <div className="workspace-list-range"><strong>{total ? `${first}-${last}` : "0"}</strong><span>of {total}</span></div>
    <label><span>Rows</span><select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
    <div className="workspace-list-pages">
      <button type="button" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>Previous</button>
      <span>Page {page} of {Math.max(1, pageCount)}</span>
      <button type="button" disabled={page >= pageCount || busy} onClick={() => onPage(page + 1)}>Next</button>
    </div>
    <div className="workspace-list-view-actions">
      <button type="button" disabled={busy} onClick={onSave}>{saved ? "Update default view" : "Save as default"}</button>
      {saved && <button type="button" disabled={busy} onClick={onReset}>Reset view</button>}
    </div>
  </div>;
}
