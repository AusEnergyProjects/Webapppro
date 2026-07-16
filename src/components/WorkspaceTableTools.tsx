"use client";

export type WorkspaceTableColumn = {
  key: string;
  label: string;
};

type CsvValue = string | number | boolean | null | undefined;

function safeCsvValue(value: CsvValue) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function downloadWorkspaceCsv(
  filename: string,
  columns: WorkspaceTableColumn[],
  rows: Array<Record<string, CsvValue>>,
) {
  const lines = [
    columns.map((column) => safeCsvValue(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => safeCsvValue(row[column.key])).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function WorkspaceTableTools({
  columns,
  visibleKeys,
  onVisibleKeys,
  onExport,
  exportDisabled = false,
  noun = "rows",
}: {
  columns: WorkspaceTableColumn[];
  visibleKeys: string[];
  onVisibleKeys: (keys: string[]) => void;
  onExport: () => void;
  exportDisabled?: boolean;
  noun?: string;
}) {
  const visible = visibleKeys.filter((key) => columns.some((column) => column.key === key));
  const ordered = [
    ...visible.map((key) => columns.find((column) => column.key === key)).filter(Boolean),
    ...columns.filter((column) => !visible.includes(column.key)),
  ] as WorkspaceTableColumn[];

  function toggle(key: string) {
    if (visible.includes(key)) {
      if (visible.length === 1) return;
      onVisibleKeys(visible.filter((item) => item !== key));
      return;
    }
    onVisibleKeys([...visible, key]);
  }

  function move(key: string, direction: -1 | 1) {
    const index = visible.indexOf(key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= visible.length) return;
    const next = [...visible];
    [next[index], next[target]] = [next[target], next[index]];
    onVisibleKeys(next);
  }

  function pinLeft(key: string) {
    if (!visible.includes(key)) return;
    onVisibleKeys([key, ...visible.filter((item) => item !== key)]);
  }

  return (
    <div className="workspace-table-actionbar">
      <details className="workspace-column-manager">
        <summary>Columns</summary>
        <div>
          <p>Choose the fields, move them into order or pin an important field to the left.</p>
          <div className="workspace-column-list">
            {ordered.map((column) => {
              const index = visible.indexOf(column.key);
              const isVisible = index >= 0;
              return (
                <div key={column.key}>
                  <label><input type="checkbox" checked={isVisible} onChange={() => toggle(column.key)} />{column.label}</label>
                  <span>
                    <button type="button" disabled={!isVisible || index === 0} onClick={() => pinLeft(column.key)}>Pin left</button>
                    <button type="button" aria-label={`Move ${column.label} left`} disabled={!isVisible || index === 0} onClick={() => move(column.key, -1)}>Left</button>
                    <button type="button" aria-label={`Move ${column.label} right`} disabled={!isVisible || index === visible.length - 1} onClick={() => move(column.key, 1)}>Right</button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </details>
      <button className="workspace-csv-export" type="button" disabled={exportDisabled} onClick={onExport}>
        Export visible {noun} CSV
      </button>
    </div>
  );
}
