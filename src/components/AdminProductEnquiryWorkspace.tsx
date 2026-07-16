"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { dateTime, readable, workspaceError } from "@/components/admin-workspace";
import styles from "./AdminProductEnquiryWorkspace.module.css";

export type AdminProductEnquiry = {
  id: string;
  status: string;
  message: string;
  supplierNote: string;
  createdAt: string;
  updatedAt: string;
  listId: string;
  listName: string;
  projectPostcode: string;
  installerBusiness: string;
  installerEmail: string;
  supplierBusiness: string;
  supplierEmail: string;
  itemCount: number;
  subtotalCentsExGst: number;
};

export type ProductEnquirySummary = { total: number; open: number; responded: number; valueCents: number };

type AdminApiResult = { enquiries?: AdminProductEnquiry[] };

export function summariseProductEnquiries(enquiries: AdminProductEnquiry[]): ProductEnquirySummary {
  return {
    total: enquiries.length,
    open: enquiries.filter((item) => ["new", "viewed"].includes(item.status)).length,
    responded: enquiries.filter((item) => item.status === "responded").length,
    valueCents: enquiries.reduce((total, item) => total + item.subtotalCentsExGst, 0),
  };
}

export type AdminProductEnquiryWorkspaceProps = {
  api: (path: string, init?: RequestInit) => Promise<AdminApiResult>;
  setStatus: (status: string) => void;
  onSummary: (summary: ProductEnquirySummary) => void;
};

export function AdminProductEnquiryWorkspace({ api, setStatus, onSummary }: AdminProductEnquiryWorkspaceProps) {
  const [productEnquiries, setProductEnquiries] = useState<AdminProductEnquiry[]>([]);
  const [enquirySearch, setEnquirySearch] = useState("");
  const [enquiryStatus, setEnquiryStatus] = useState("");
  const loadProductEnquiries = useCallback(async (announce = false) => {
    const params = new URLSearchParams();
    if (enquirySearch.trim()) params.set("search", enquirySearch.trim());
    if (enquiryStatus) params.set("status", enquiryStatus);
    try {
      const result = await api(`/api/admin/product-enquiries?${params}`);
      const enquiries = result.enquiries || [];
      setProductEnquiries(enquiries);
      onSummary(summariseProductEnquiries(enquiries));
      if (announce) setStatus(`${enquiries.length} product enquiries shown.`);
    } catch (error) { setStatus(workspaceError(error, "The secure product-enquiry action could not be completed.")); }
  }, [api, enquirySearch, enquiryStatus, onSummary, setStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProductEnquiries(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProductEnquiries]);
  async function searchProductEnquiries(event?: FormEvent) { event?.preventDefault(); setStatus("Refreshing product enquiries..."); await loadProductEnquiries(true); }

  const summary = summariseProductEnquiries(productEnquiries);
  return <>
    <header className="admin-page-heading"><span>Trade supply workflow</span><h1>Installer product enquiries</h1><p>Monitor which paid installers are selecting approved products, whether wholesalers are responding and the indicative ex-GST value moving through the trade supply network.</p></header>
    <section className="admin-metric-grid">
      <article><span>Total enquiries</span><strong>{summary.total}</strong><small>One enquiry per project list and wholesaler</small></article>
      <article><span>Awaiting response</span><strong>{summary.open}</strong><small>New or reviewed by the wholesaler</small></article>
      <article><span>Responded</span><strong>{summary.responded}</strong><small>Wholesaler follow-up recorded</small></article>
      <article><span>Indicative value</span><strong>{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(summary.valueCents / 100)}</strong><small>Selected product snapshots before GST</small></article>
    </section>
    <form className={`admin-filterbar ${styles.filters}`} onSubmit={searchProductEnquiries}>
      <input aria-label="Search product enquiries" placeholder="Installer, wholesaler, project list or postcode" value={enquirySearch} onChange={(event) => setEnquirySearch(event.target.value)} />
      <select aria-label="Product enquiry status" value={enquiryStatus} onChange={(event) => setEnquiryStatus(event.target.value)}><option value="">All enquiry states</option><option value="new">New</option><option value="viewed">Viewed</option><option value="responded">Responded</option><option value="closed">Closed</option></select>
      <button type="submit">Apply filters</button>
    </form>
    <section className="admin-panel">
      <div className="admin-panel-heading"><span>Commercial handoff</span><h2>Selection and response history</h2><p>Product enquiries contain installer business details and commercial project context only. Household contact details and street addresses are outside this workflow.</p></div>
      <div className={`${styles.list} tlink-data-table`}>
        {productEnquiries.length ? productEnquiries.map((item) => <article key={item.id}>
          <header><div><span>{item.projectPostcode || "No postcode"} · {dateTime(item.createdAt)}</span><h3>{item.listName}</h3></div><span className={`admin-pill admin-pill-${item.status}`}>{readable(item.status)}</span></header>
          <div className={styles.parties}><div><span>Installer</span><strong>{item.installerBusiness}</strong><small>{item.installerEmail}</small></div><b aria-hidden="true">to</b><div><span>Wholesaler</span><strong>{item.supplierBusiness}</strong><small>{item.supplierEmail}</small></div></div>
          <div className={styles.facts}><span>{item.itemCount} selected item{item.itemCount === 1 ? "" : "s"}</span><span>{new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(item.subtotalCentsExGst / 100)} ex GST indicative</span><span>Updated {dateTime(item.updatedAt)}</span></div>
          {item.message && <p>{item.message}</p>}
          {item.supplierNote && <small className={styles.note}>Wholesaler note: {item.supplierNote}</small>}
        </article>) : <p className="admin-empty">No product enquiries match this view.</p>}
      </div>
    </section>
  </>;
}
