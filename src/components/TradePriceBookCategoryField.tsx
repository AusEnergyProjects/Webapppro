"use client";

import { useId, useRef, useState } from "react";
import styles from "./TradePriceBookWorkspace.module.css";

export function TradePriceBookCategoryField({ value, categories, onChange }: {
  value: string;
  categories: string[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const options = [...new Map([...categories, "Insulation", "Solar panels", "Heat pumps"]
    .map((category) => category.trim()).filter(Boolean)
    .map((category) => [category.toLowerCase(), category])).values()]
    .filter((category) => category.toLowerCase().includes(query.trim().toLowerCase()));

  function close() { setOpen(false); setActiveIndex(-1); }
  function show() { setQuery(""); setActiveIndex(-1); setOpen(true); }
  function choose(category: string) { onChange(category); input.current?.focus(); close(); }

  return <div className={styles.categoryField} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <label htmlFor={id}><span>Category</span></label>
    <div className={styles.categoryControl}>
      <input ref={input} id={id} role="combobox" autoComplete="off" maxLength={80}
        value={value} placeholder="Choose or type your own" aria-autocomplete="list"
        aria-expanded={open} aria-controls={open ? `${id}-options` : undefined}
        aria-describedby={`${id}-help`}
        aria-activedescendant={open && options[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
        onFocus={show}
        onChange={(event) => { onChange(event.target.value); setQuery(event.target.value); setActiveIndex(-1); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === "Tab") close();
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) { show(); return; }
            setActiveIndex((current) => event.key === "ArrowDown"
              ? Math.min(current + 1, options.length - 1)
              : current < 0 ? options.length - 1 : Math.max(current - 1, 0));
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            if (options[activeIndex]) choose(options[activeIndex]); else close();
          }
        }} />
      <button type="button" className={styles.categoryToggle} tabIndex={-1}
        aria-label={open ? "Hide category suggestions" : "Show category suggestions"}
        aria-expanded={open} aria-controls={open ? `${id}-options` : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { if (open) close(); else { input.current?.focus(); show(); } }}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <div className={styles.categoryMenu}>
        <div id={`${id}-options`} role="listbox" aria-label="Categories">
          {options.map((category, index) => <button type="button" role="option" tabIndex={-1}
            key={category} id={`${id}-option-${index}`} aria-selected={index === activeIndex}
            ref={(node) => { if (node && index === activeIndex) node.scrollIntoView({ block: "nearest" }); }}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(category)}>{category}</button>)}
        </div>
        {!options.length && <p role="status">{value.trim() ? `Use “${value.trim()}” as a new category.` : "Type your own category."}</p>}
      </div>}
    </div>
    <small id={`${id}-help`}>Choose a suggestion or type your own category.</small>
  </div>;
}
