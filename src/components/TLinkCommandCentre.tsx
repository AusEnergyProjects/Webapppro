"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";

export type TLinkCommandTarget = {
  workspace: "work" | "products" | "orders";
  kind: "job" | "customer" | "product" | "order" | "team" | "new-job" | "new-customer";
  id: string;
  query: string;
  nonce: number;
};

type SearchKind = "job" | "customer" | "product" | "order" | "team";
type SearchRecord = {
  id: string;
  kind: SearchKind;
  label: string;
  title: string;
  detail: string;
  meta: string;
  query: string;
};

type CommandFeatures = {
  businessOperations: boolean;
  marketplace: boolean;
  teamAccess: boolean;
};

type CommandProps = {
  user: User;
  partnerType: "installer" | "supplier";
  features: CommandFeatures;
  onNavigate: (target: TLinkCommandTarget) => void;
};

const kindLabels: Record<SearchKind | "all", string> = {
  all: "All",
  job: "Jobs",
  customer: "Customers",
  product: "Products",
  order: "Orders",
  team: "Team",
};

export function TLinkCommandCentre({ user, partnerType, features, onNavigate }: CommandProps) {
  const { businessOperations, marketplace, teamAccess } = features;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchKind | "all">("all");
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      const element = event.target as HTMLElement | null;
      const typing = element?.matches("input, textarea, select, [contenteditable='true']");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (!typing && event.key === "/") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    requestRef.current?.abort();
    if (!open || term.length < 2) return;
    let active = true;
    const controller = new AbortController();
    requestRef.current = controller;
    const debounce = window.setTimeout(() => {
      setLoading(true);
      setStatus("");
      const timeout = window.setTimeout(() => controller.abort(), 6000);
      void user.getIdToken().then((token) => fetch(`/api/tlink-search?q=${encodeURIComponent(term)}&kind=${category}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
      })).then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error(result.error || "TLink search could not be completed.");
        if (active) setRecords(Array.isArray(result.records) ? result.records : []);
      }).catch((error) => {
        if (!active || controller.signal.aborted) return;
        setRecords([]);
        setStatus(error instanceof Error ? error.message : "TLink search could not be completed.");
      }).finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [category, open, query, user]);

  const results = records;
  const availableKinds = useMemo(() => (["job", "customer", "product", "order", "team"] as SearchKind[])
    .filter((kind) => {
      if (partnerType === "supplier") return kind === "product" || (kind === "order" && businessOperations);
      if (kind === "product") return marketplace;
      if (kind === "team") return teamAccess;
      return businessOperations;
    }), [businessOperations, marketplace, partnerType, teamAccess]);

  function close() {
    setOpen(false);
    setQuery("");
    setCategory("all");
    setActiveIndex(0);
    requestRef.current?.abort();
  }

  function navigate(record: SearchRecord) {
    const workspace = record.kind === "product" ? "products" : record.kind === "order" ? "orders" : "work";
    onNavigate({ workspace, kind: record.kind, id: record.id, query: record.query, nonce: Date.now() });
    close();
  }

  function navigateAction(kind: TLinkCommandTarget["kind"], workspace: TLinkCommandTarget["workspace"]) {
    onNavigate({ workspace, kind, id: "", query: "", nonce: Date.now() });
    close();
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      navigate(results[Math.min(activeIndex, results.length - 1)]);
    }
  }

  return <>
    <button className="tlink-command-launcher" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span className="tlink-command-search-icon" aria-hidden="true" />
      <span>Search TLink</span>
      <kbd>Ctrl K</kbd>
    </button>
    {open && <div className="tlink-command-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) close();
    }}>
      <section className="tlink-command-dialog" role="dialog" aria-modal="true" aria-labelledby="tlink-command-title">
        <header>
          <div>
            <span>Command centre</span>
            <strong id="tlink-command-title">Find anything in TLink</strong>
          </div>
          <button type="button" onClick={close} aria-label="Close TLink search">Close</button>
        </header>
        <label className="tlink-command-input">
          <span className="tlink-command-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              setActiveIndex(0);
              if (value.trim().length < 2) { setRecords([]); setLoading(false); setStatus(""); }
            }}
            onKeyDown={onInputKeyDown}
            placeholder={partnerType === "supplier" ? "Search product, model, order or installer" : "Search job, customer, product, order or team member"}
            aria-label="Search TLink business records"
            aria-controls="tlink-command-results"
          />
          <kbd>Esc</kbd>
        </label>
        <nav className="tlink-command-filters" aria-label="Search record type">
          {(["all", ...availableKinds] as Array<SearchKind | "all">).map((kind) => <button key={kind} type="button" className={category === kind ? "active" : ""} onClick={() => { setCategory(kind); setActiveIndex(0); setRecords([]); setStatus(""); }}>
            {kindLabels[kind]}
          </button>)}
        </nav>
        <div className="tlink-command-body" id="tlink-command-results">
          {!query.trim() && <div className="tlink-command-start">
            <div><span>Quick actions</span><strong>Go straight to the work</strong></div>
            <div className="tlink-command-actions">
              {partnerType === "installer" && businessOperations && <>
                <button type="button" onClick={() => navigateAction("new-job", "work")}><b>+</b><span><strong>New job</strong><small>Start a system numbered job</small></span></button>
                <button type="button" onClick={() => navigateAction("new-customer", "work")}><b>+</b><span><strong>New customer</strong><small>Add a direct business contact</small></span></button>
              </>}
              {(partnerType === "supplier" || marketplace) && <button type="button" onClick={() => navigateAction("product", "products")}><b>P</b><span><strong>Products</strong><small>{partnerType === "supplier" ? "Open your catalogue" : "Search approved equipment"}</small></span></button>}
              {businessOperations && <button type="button" onClick={() => navigateAction("order", "orders")}><b>O</b><span><strong>Orders</strong><small>Open purchasing and fulfilment</small></span></button>}
              {partnerType === "installer" && teamAccess && <button type="button" onClick={() => navigateAction("team", "work")}><b>T</b><span><strong>Team</strong><small>Open people and dispatch</small></span></button>}
            </div>
            <p>Only records this business can already access are included. AEA protected household contact details are never indexed.</p>
          </div>}
          {query.trim().length === 1 && <div className="tlink-command-empty"><strong>Keep typing</strong><span>Enter at least two characters to search.</span></div>}
          {query.trim().length >= 2 && loading && !results.length && <div className="tlink-command-empty loading"><strong>Searching your workspace</strong><span>Checking the latest matching records...</span></div>}
          {query.trim().length >= 2 && !loading && !results.length && <div className="tlink-command-empty"><strong>No matching records</strong><span>Try a job ID, customer name, model code, order number or team member.</span></div>}
          {results.length > 0 && <div className="tlink-command-results" role="listbox" aria-label="TLink search results">
            {results.map((record, index) => <button
              key={`${record.kind}:${record.id}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => navigate(record)}
            >
              <b aria-hidden="true">{record.label}</b>
              <span><strong>{record.title}</strong><small>{record.detail}</small></span>
              <em>{record.meta}</em>
            </button>)}
          </div>}
          {status && <p className="tlink-command-status" role="status">{status}</p>}
        </div>
        <footer><span><kbd>Up</kbd><kbd>Down</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer>
      </section>
    </div>}
  </>;
}
