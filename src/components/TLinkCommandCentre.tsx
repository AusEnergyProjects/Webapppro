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
  searchText: string;
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

const readable = (value: unknown) => String(value || "")
  .replaceAll("_", " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const money = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

export function TLinkCommandCentre({ user, partnerType, features, onNavigate }: CommandProps) {
  const { businessOperations, marketplace, teamAccess } = features;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchKind | "all">("all");
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (!open || loaded || loading) return;
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      setLoading(true);
      setStatus("Opening your business records...");
      void loadRecords(user, partnerType, { businessOperations, marketplace, teamAccess }, (batch) => {
        if (!active) return;
        setRecords((current) => {
          const known = new Set(current.map((record) => `${record.kind}:${record.id}`));
          return [...current, ...batch.filter((record) => !known.has(`${record.kind}:${record.id}`))];
        });
      })
        .then((nextRecords) => {
          if (!active) return;
          setRecords(nextRecords);
          setLoaded(true);
          setStatus(nextRecords.length ? "" : "No searchable records are available yet.");
        })
        .catch((error) => {
          if (active) {
            setLoaded(true);
            setStatus(error instanceof Error ? error.message : "TLink search could not be loaded.");
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [businessOperations, loaded, loading, marketplace, open, partnerType, teamAccess, user]);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2) return [];
    return records
      .filter((record) => category === "all" || record.kind === category)
      .filter((record) => record.searchText.includes(term))
      .sort((left, right) => {
        const leftExact = left.searchText.startsWith(term) ? 0 : 1;
        const rightExact = right.searchText.startsWith(term) ? 0 : 1;
        return leftExact - rightExact || left.title.localeCompare(right.title);
      })
      .slice(0, 24);
  }, [category, query, records]);

  const availableKinds = useMemo(() => (["job", "customer", "product", "order", "team"] as SearchKind[])
    .filter((kind) => records.some((record) => record.kind === kind)), [records]);

  function close() {
    setOpen(false);
    setQuery("");
    setCategory("all");
    setActiveIndex(0);
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
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={onInputKeyDown}
            placeholder={partnerType === "supplier" ? "Search product, model, order or installer" : "Search job, customer, product, order or team member"}
            aria-label="Search TLink business records"
            aria-controls="tlink-command-results"
          />
          <kbd>Esc</kbd>
        </label>
        <nav className="tlink-command-filters" aria-label="Search record type">
          {(["all", ...availableKinds] as Array<SearchKind | "all">).map((kind) => <button key={kind} type="button" className={category === kind ? "active" : ""} onClick={() => { setCategory(kind); setActiveIndex(0); }}>
            {kindLabels[kind]}{kind !== "all" ? ` ${records.filter((record) => record.kind === kind).length}` : ""}
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
          {query.trim().length >= 2 && loading && !results.length && <div className="tlink-command-empty loading"><strong>Searching your workspace</strong><span>Opening the latest business records...</span></div>}
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
          {status && !query.trim() && <p className="tlink-command-status" role="status">{status}</p>}
        </div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer>
      </section>
    </div>}
  </>;
}

async function loadRecords(user: User, partnerType: "installer" | "supplier", features: CommandFeatures, onBatch: (records: SearchRecord[]) => void) {
  const token = await user.getIdToken();
  const request = async (path: string) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || "A TLink record source could not be opened.");
      return result;
    } finally {
      window.clearTimeout(timeout);
    }
  };
  const sources: Array<Promise<Record<string, unknown>>> = [];
  if (partnerType === "installer") {
    if (features.businessOperations) sources.push(request("/api/trade-crm"));
    if (features.marketplace) sources.push(request("/api/product-marketplace"));
    if (features.businessOperations) sources.push(request("/api/trade-purchasing"));
    if (features.teamAccess) sources.push(request("/api/trade-team"));
  } else {
    sources.push(request("/api/supplier-products"));
    if (features.businessOperations) sources.push(request("/api/trade-purchasing"));
  }
  const settled = await Promise.allSettled(sources.map((source) => source.then((payload) => {
    onBatch(toSearchRecords(payload));
    return payload;
  })));
  const payloads = settled.filter((item): item is PromiseFulfilledResult<Record<string, unknown>> => item.status === "fulfilled").map((item) => item.value);
  if (!payloads.length && settled.length) {
    throw new Error("TLink search is taking longer than expected. Close it and try again.");
  }
  return payloads.flatMap(toSearchRecords);
}

function toSearchRecords(payload: Record<string, unknown>): SearchRecord[] {
  const records: SearchRecord[] = [];
  const rows = <T,>(key: string) => Array.isArray(payload[key]) ? payload[key] as T[] : [];
  rows<Record<string, unknown>>("jobs").forEach((job) => records.push({
    id: String(job.id), kind: "job", label: "JB", title: String(job.title || "Untitled job"),
    detail: String(job.workNumber || "Job"), meta: [readable(job.stage), job.siteArea, job.assigneeLabel].filter(Boolean).join(" | "),
    query: String(job.workNumber || job.title || ""), searchText: `${job.workNumber || ""} ${job.title || ""} ${job.serviceCategory || ""} ${job.siteArea || ""} ${job.assigneeLabel || ""}`.toLowerCase(),
  }));
  rows<Record<string, unknown>>("customers").forEach((customer) => records.push({
    id: String(customer.id), kind: "customer", label: "CU", title: String(customer.displayName || customer.customerNumber || "Customer"),
    detail: String(customer.customerNumber || "Direct customer"), meta: [customer.suburb, customer.addressState, customer.phone].filter(Boolean).join(" | "),
    query: String(customer.displayName || customer.customerNumber || ""), searchText: `${customer.customerNumber || ""} ${customer.displayName || ""} ${customer.email || ""} ${customer.phone || ""} ${customer.suburb || ""} ${customer.addressState || ""} ${customer.postcode || ""}`.toLowerCase(),
  }));
  rows<Record<string, unknown>>("products").forEach((product) => records.push({
    id: String(product.id), kind: "product", label: "PR", title: String(product.name || product.modelNumber || "Product"),
    detail: [product.brand, product.modelNumber].filter(Boolean).join(" "), meta: [product.supplierName || "Your catalogue", readable(product.stockStatus), money.format(Number(product.unitPriceCentsExGst || 0) / 100)].filter(Boolean).join(" | "),
    query: String(product.modelNumber || product.name || ""), searchText: `${product.modelNumber || ""} ${product.brand || ""} ${product.name || ""} ${product.category || ""} ${product.supplierName || ""} ${product.stockStatus || ""}`.toLowerCase(),
  }));
  rows<Record<string, unknown>>("orders").forEach((order) => records.push({
    id: String(order.id), kind: "order", label: "PO", title: String(order.listName || "Purchase order"),
    detail: String(order.orderNumber || "Order"), meta: [order.supplierBusiness || order.installerBusiness, readable(order.status), money.format(Number(order.totalCentsIncGst || 0) / 100)].filter(Boolean).join(" | "),
    query: String(order.orderNumber || order.listName || ""), searchText: `${order.orderNumber || ""} ${order.listName || ""} ${order.installerReference || ""} ${order.supplierReference || ""} ${order.supplierBusiness || ""} ${order.installerBusiness || ""} ${order.status || ""}`.toLowerCase(),
  }));
  rows<Record<string, unknown>>("members").forEach((member) => records.push({
    id: String(member.id), kind: "team", label: "TM", title: String(member.displayName || member.email || "Team member"),
    detail: readable(member.role), meta: [member.email, readable(member.status)].filter(Boolean).join(" | "),
    query: String(member.displayName || member.email || ""), searchText: `${member.displayName || ""} ${member.email || ""} ${member.role || ""} ${member.status || ""}`.toLowerCase(),
  }));
  return records;
}
