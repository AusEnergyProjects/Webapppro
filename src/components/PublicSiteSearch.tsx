"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { searchPublicSite, type PublicSiteSearchResult } from "@/lib/public-site-search";
import styles from "./PublicSiteSearch.module.css";

export function PublicSiteSearch() {
  const router = useRouter();
  const inputId = useId();
  const listboxId = `${inputId}-results`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const results = useMemo(() => searchPublicSite(query), [query]);
  const showResults = open && query.trim().length > 0;

  useEffect(() => {
    if (!showResults || results.length === 0) return;
    router.prefetch(results[activeIndex >= 0 ? activeIndex : 0].path);
  }, [activeIndex, results, router, showResults]);

  useEffect(() => {
    function closeWhenOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
      document.querySelectorAll<HTMLDetailsElement>(".site-nav-shell details[open]").forEach((disclosure) => {
        if (!disclosure.contains(event.target as Node)) disclosure.open = false;
      });
    }

    function closeNavigationOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      const disclosures = [...document.querySelectorAll<HTMLDetailsElement>(".site-nav-shell details[open]")];
      if (!disclosures.length) return;
      const focusedDisclosure = document.activeElement instanceof Element
        ? document.activeElement.closest<HTMLDetailsElement>("details[open]")
        : null;
      disclosures.forEach((disclosure) => { disclosure.open = false; });
      focusedDisclosure?.querySelector<HTMLElement>("summary")?.focus();
    }

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeNavigationOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeNavigationOnEscape);
    };
  }, []);

  function goTo(result: PublicSiteSearchResult) {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    router.push(result.path);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!showResults || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      goTo(results[activeIndex >= 0 ? activeIndex : 0]);
    }
  }

  return (
    <div className={`public-site-search ${styles.root}${showResults ? ` ${styles.open}` : ""}`} role="search" ref={rootRef}>
      <label className={styles.field} htmlFor={inputId}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" focusable="false">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        </svg>
        <input
          id={inputId}
          type="search"
          value={query}
          placeholder="Search"
          autoComplete="off"
          spellCheck="true"
          role="combobox"
          aria-label="Search Australian Energy Assessments"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showResults}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            if (query.trim()) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </label>

      {showResults ? (
        <div className={styles.results} id={listboxId} role="listbox" aria-label="Suggested pages">
          {results.length > 0 ? results.map((result, index) => (
            <button
              key={result.path}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              onPointerDown={(event) => event.preventDefault()}
              onMouseEnter={() => {
                setActiveIndex(index);
                router.prefetch(result.path);
              }}
              onFocus={() => router.prefetch(result.path)}
              onClick={() => goTo(result)}
            >
              <strong>{result.title}</strong>
              <span>{result.description}</span>
            </button>
          )) : (
            <p role="status">No close match yet. Try “rebates”, “NatHERS” or “book a call”.</p>
          )}
        </div>
      ) : null}
      <span className={styles.status} role="status" aria-live="polite">
        {showResults ? `${results.length} suggested ${results.length === 1 ? "page" : "pages"}` : ""}
      </span>
    </div>
  );
}
