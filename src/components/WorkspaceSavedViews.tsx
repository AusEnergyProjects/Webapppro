"use client";

import { FormEvent, useState } from "react";
import type { WorkspaceListPreferences } from "./WorkspaceListControls";

export type NamedWorkspaceListView = {
  id: string;
  name: string;
  preferences: WorkspaceListPreferences;
  updatedAt: string;
};

export function WorkspaceSavedViews({ presets, activeId, busy, onApply, onClear, onCreate, onRename, onDelete }: {
  presets: NamedWorkspaceListView[];
  activeId: string;
  busy?: boolean;
  onApply: (preset: NamedWorkspaceListView) => void;
  onClear: () => void;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const active = presets.find((preset) => preset.id === activeId);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const saved = active ? await onRename(active.id, trimmed) : await onCreate(trimmed);
    if (saved && !active) setName(trimmed);
  }

  return <div className="workspace-saved-views" aria-label="Saved views">
    <label><span>Saved view</span><select value={activeId} disabled={busy} onChange={(event) => {
      const preset = presets.find((item) => item.id === event.target.value);
      if (preset) { setName(preset.name); onApply(preset); }
      else { setName(""); onClear(); }
    }}><option value="">Current filters</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
    <details>
      <summary>{active ? "Update view" : "Save current view"}</summary>
      <form onSubmit={save}>
        <label><span>{active ? "View name" : "Name this view"}</span><input value={name} maxLength={60} required onChange={(event) => setName(event.target.value)} placeholder="Northside jobs" /></label>
        <button type="submit" disabled={busy || !name.trim()}>{active ? "Update view" : "Save view"}</button>
        {active && <button type="button" className="danger" disabled={busy} onClick={() => { setName(""); void onDelete(active.id); }}>Delete</button>}
      </form>
    </details>
  </div>;
}
