"use client";

import { useMemo, useState } from "react";

type Option = { value: string; label: string };

export function MarketplaceColumnFilter({ label, options, include, exclude, onChange }: {
  label: string;
  options: Option[];
  include: string[];
  exclude: string[];
  onChange: (next: { include: string[]; exclude: string[] }) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => options.filter((option) => option.label.toLowerCase().includes(search.toLowerCase())), [options, search]);
  const count = include.length + exclude.length;
  function toggle(kind: "include" | "exclude", value: string, checked: boolean) {
    const own = kind === "include" ? include : exclude;
    const other = kind === "include" ? exclude : include;
    const nextOwn = checked ? [...new Set([...own, value])] : own.filter((item) => item !== value);
    const nextOther = checked ? other.filter((item) => item !== value) : other;
    onChange(kind === "include" ? { include: nextOwn, exclude: nextOther } : { include: nextOther, exclude: nextOwn });
  }
  return <details className="marketplace-column-filter">
    <summary aria-label={`Filter ${label}`}>{count ? `Filter (${count})` : "Filter"}</summary>
    <div className="marketplace-column-filter-menu">
      <label><span>Search {label.toLowerCase()}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Find ${label.toLowerCase()}`} /></label>
      <div className="marketplace-column-filter-list">
        {visible.map((option) => <div key={option.value}><strong title={option.label}>{option.label}</strong><label><input type="checkbox" checked={include.includes(option.value)} onChange={(event) => toggle("include", option.value, event.target.checked)} /> Include</label><label><input type="checkbox" checked={exclude.includes(option.value)} onChange={(event) => toggle("exclude", option.value, event.target.checked)} /> Exclude</label></div>)}
        {!visible.length && <p>No matches.</p>}
      </div>
      {count > 0 && <button type="button" onClick={() => onChange({ include: [], exclude: [] })}>Clear {label.toLowerCase()} filter</button>}
    </div>
  </details>;
}
