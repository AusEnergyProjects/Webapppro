"use client";

import { useEffect, useId, useRef, useState } from "react";

export type SearchableLookupOption = { id: string; label: string; secondary?: string };

export function SearchableLookup({ label, value, placeholder, required, disabled, load, onChange }: {
  label: string;
  value: string;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
  load: (query: string, selected: string) => Promise<SearchableLookupOption[]>;
  onChange: (id: string, option?: SearchableLookupOption) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchableLookupOption[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedValue = useRef("");

  function choose(option: SearchableLookupOption) {
    setQuery(option.label);
    setOpen(false);
    selectedValue.current = option.id;
    onChange(option.id, option);
  }

  useEffect(() => {
    if (!value || selectedValue.current === value) return;
    let active = true;
    void load("", value).then((items) => {
      if (!active) return;
      setOptions(items);
      const selected = items.find((item) => item.id === value);
      if (selected) { selectedValue.current = value; setQuery(selected.label); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [load, value]);

  useEffect(() => {
    if (query.trim().length < 2 || (value && selectedValue.current === value)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void load(query.trim(), "").then((items) => {
        if (!active) return;
        setOptions(items);
        setActiveIndex(0);
        setOpen(true);
      }).catch(() => active && setOptions([])).finally(() => active && setBusy(false));
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [load, query, value]);

  return <label className="searchable-lookup" htmlFor={id}>
    <span>{label}</span>
    <input id={id} value={query} disabled={disabled} required={required && !value} autoComplete="off"
      placeholder={placeholder} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`}
      aria-activedescendant={open && options[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
      onFocus={() => query.length >= 2 && setOpen(true)}
      onChange={(event) => { selectedValue.current = ""; setQuery(event.target.value); setActiveIndex(0); onChange(""); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); return; }
        if (!open || !options.length) return;
        if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((current) => Math.min(current + 1, options.length - 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); }
        if (event.key === "Enter") { event.preventDefault(); choose(options[activeIndex]); }
      }} />
    {busy && <small className="searchable-lookup-status">Searching...</small>}
    {open && <div id={`${id}-options`} role="listbox">
      {options.length ? options.map((option, index) => <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={index === activeIndex} key={option.id}
        onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
        <strong>{option.label}</strong>{option.secondary && <small>{option.secondary}</small>}
      </button>) : !busy && <p>No matching records</p>}
    </div>}
  </label>;
}
