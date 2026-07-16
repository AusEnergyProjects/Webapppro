"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type PartnerType = "installer" | "supplier";
type OrderItem = {
  id: string; productId: string; modelNumber: string; brand: string; name: string; unitLabel: string;
  quantity: number; fulfilledQuantity: number; unitPriceCentsExGst: number; warrantyYears: number;
};
type WarrantyClaim = {
  id: string; claimNumber: string; itemId: string; status: string; issueCategory: string; summary: string;
  serialNumber: string; supplierResponse: string; resolution: string; submittedAt: string; resolvedAt: string; updatedAt: string;
};
type PurchaseOrder = {
  id: string; orderNumber: string; enquiryId: string; listId: string; status: string; installerReference: string;
  supplierReference: string; deliveryMethod: string; deliveryNotes: string; supplierNote: string; expectedAt: string;
  subtotalCentsExGst: number; gstCents: number; totalCentsIncGst: number; submittedAt: string; confirmedAt: string;
  fulfilledAt: string; updatedAt: string; installerBusiness: string; supplierBusiness: string; listName: string;
  projectPostcode: string; items: OrderItem[]; events: Array<{ id: string; summary: string; createdAt: string }>;
  claims: WarrantyClaim[];
};
type EligibleEnquiry = {
  id: string; listId: string; supplierUid: string; status: string; supplierNote: string; updatedAt: string;
  listName: string; projectPostcode: string; supplierBusiness: string;
};
type PurchasingResult = { ok?: boolean; orders?: PurchaseOrder[]; eligibleEnquiries?: EligibleEnquiry[]; error?: string };

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const displayDate = (value: string) => value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "Not set";

export function TradePurchasingWorkspace({ user, partnerType }: { user: User; partnerType: PartnerType }) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [eligible, setEligible] = useState<EligibleEnquiry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("active");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const apply = useCallback((result: PurchasingResult) => {
    const next = result.orders || [];
    setOrders(next);
    setEligible(result.eligibleEnquiries || []);
    setSelectedId((current) => current && next.some((order) => order.id === current) ? current : next[0]?.id || "");
  }, []);

  const request = useCallback(async (method: "GET" | "POST" | "PATCH", body?: Record<string, unknown>) => {
    const token = await user.getIdToken();
    const response = await fetch("/api/trade-purchasing", {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({})) as PurchasingResult;
    if (!response.ok || result.ok === false) throw new Error(result.error || "The purchasing workspace could not be updated.");
    apply(result);
  }, [apply, user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void request("GET").catch((error) => active && setStatus(error instanceof Error ? error.message : "The purchasing workspace could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [request]);

  async function submit(body: Record<string, unknown>, key: string, success: string) {
    setBusy(key); setStatus("Saving the business purchasing record...");
    try { await request(key.startsWith("create") ? "POST" : "PATCH", body); setStatus(success); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The purchasing update could not be saved."); }
    finally { setBusy(""); }
  }

  const visible = useMemo(() => orders.filter((order) => {
    if (filter === "all") return true;
    if (filter === "claims") return order.claims.some((claim) => !["resolved", "rejected", "withdrawn"].includes(claim.status));
    if (filter === "complete") return ["fulfilled", "cancelled"].includes(order.status);
    return !["fulfilled", "cancelled"].includes(order.status);
  }), [filter, orders]);
  const selected = orders.find((order) => order.id === selectedId) || null;
  const openClaims = orders.flatMap((order) => order.claims).filter((claim) => !["resolved", "rejected", "withdrawn"].includes(claim.status)).length;
  const waiting = orders.filter((order) => ["submitted", "confirmed", "part_fulfilled"].includes(order.status)).length;

  if (loading) return <section className="dashboard-panel purchasing-loading"><strong>Opening purchasing records</strong><p>Loading private business orders and claims...</p></section>;

  return <section className="trade-purchasing" aria-labelledby="trade-purchasing-title">
    <header className="purchasing-hero">
      <div><span>{partnerType === "supplier" ? "Wholesaler order desk" : "Business purchasing"}</span><h2 id="trade-purchasing-title">{partnerType === "supplier" ? "Orders and fulfilment" : "Orders, fulfilment and warranties"}</h2><p>{partnerType === "supplier" ? "Confirm trade orders, record supplied quantities and resolve warranty requests from one focused queue. Household information never enters this workspace." : "Move approved products from a wholesaler response into a traceable business order. Household names, contacts and street addresses are never included."}</p></div>
      <div className="purchasing-boundary"><strong>B2B only</strong><span>Installer and wholesaler business records</span><span>Postcode-level planning only</span></div>
    </header>
    {status && <p className="crm-inline-status" role="status">{status}</p>}
    <section className="crm-metrics purchasing-metrics" aria-label="Purchasing summary">
      <article><span>Orders</span><strong>{orders.length}</strong><small>System numbered</small></article>
      <article className={waiting ? "attention" : ""}><span>In progress</span><strong>{waiting}</strong><small>Awaiting or fulfilling</small></article>
      <article><span>Fulfilled</span><strong>{orders.filter((order) => order.status === "fulfilled").length}</strong><small>Completed supply</small></article>
      <article className={openClaims ? "attention" : ""}><span>Open claims</span><strong>{openClaims}</strong><small>Warranty follow-up</small></article>
    </section>

    <section className="purchasing-flow-strip" aria-label="Purchasing workflow">
      <article><span>01</span><strong>Commercial request</strong><small>{partnerType === "supplier" ? "Review installer product demand" : "Send a product list to a wholesaler"}</small></article>
      <article className={waiting ? "attention" : ""}><span>02</span><strong>Purchase order</strong><small>{waiting ? `${waiting} order${waiting === 1 ? "" : "s"} moving` : "No orders waiting"}</small></article>
      <article><span>03</span><strong>Fulfilment</strong><small>Confirm stock, quantities and expected dates</small></article>
      <article className={openClaims ? "attention" : ""}><span>04</span><strong>Warranty</strong><small>{openClaims ? `${openClaims} open claim${openClaims === 1 ? "" : "s"}` : "No warranty follow-up"}</small></article>
    </section>

    {partnerType === "installer" && <section className="dashboard-panel purchasing-start">
      <div className="dashboard-panel-heading"><span>Ready to order</span><h3>Wholesaler responses</h3><p>A purchase order becomes available after the wholesaler marks a product enquiry as responded.</p></div>
      {eligible.length ? <div className="purchasing-ready-list">{eligible.map((enquiry) => <article key={enquiry.id}>
        <div><span>{enquiry.supplierBusiness}</span><strong>{enquiry.listName}</strong><small>{enquiry.projectPostcode ? `Planning postcode ${enquiry.projectPostcode}` : "No planning postcode"}{enquiry.supplierNote ? ` | ${enquiry.supplierNote}` : ""}</small></div>
        <details><summary>Create purchase order</summary><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void submit({ action: "create_order", enquiryId: enquiry.id, installerReference: data.get("installerReference"), deliveryMethod: data.get("deliveryMethod"), deliveryNotes: data.get("deliveryNotes") }, `create-order:${enquiry.id}`, "Purchase order submitted."); }}>
          <label><span>Your reference, optional</span><input name="installerReference" maxLength={100} placeholder="Internal project or buyer reference" /></label>
          <label><span>Delivery preference</span><select name="deliveryMethod"><option value="confirm_with_supplier">Confirm with wholesaler</option><option value="collection">Trade collection</option><option value="installer_business">Installer business address</option></select></label>
          <label className="wide"><span>Business delivery note</span><textarea name="deliveryNotes" maxLength={800} placeholder="Access, receiving hours or commercial freight instructions. Never add a household address." /></label>
          <button disabled={Boolean(busy)}>{busy === `create-order:${enquiry.id}` ? "Submitting..." : "Submit purchase order"}</button>
        </form></details>
      </article>)}</div> : <div className="dashboard-empty-state"><strong>No responded enquiries ready to order</strong><p>Build a product list in Products, send it to the relevant wholesalers and return here after a response.</p></div>}
    </section>}

    <div className="purchasing-toolbar"><div role="group" aria-label="Filter purchase orders">{[["active", "In progress"], ["claims", "Open claims"], ["complete", "Completed"], ["all", "All"]].map(([value, label]) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><span>{visible.length} shown</span></div>
    <div className="purchasing-layout">
      <aside className="purchasing-order-list" aria-label="Purchase orders">{visible.length ? visible.map((order) => <button type="button" key={order.id} className={selectedId === order.id ? "active" : ""} onClick={() => setSelectedId(order.id)}><span><b>{order.orderNumber}</b><em>{readable(order.status)}</em></span><strong>{partnerType === "supplier" ? order.installerBusiness : order.supplierBusiness}</strong><small>{order.listName} | {money.format(order.totalCentsIncGst / 100)} inc GST</small></button>) : <div className="dashboard-empty-state"><strong>No orders in this view</strong><p>Change the filter to review another order state.</p></div>}</aside>
      <main className="purchasing-order-detail">{selected ? <OrderDetail key={selected.id} order={selected} partnerType={partnerType} busy={busy} submit={submit} /> : <div className="dashboard-empty-state"><strong>No purchase order selected</strong><p>New orders will appear here with quantities, fulfilment and warranty history.</p></div>}</main>
    </div>
  </section>;
}

function OrderDetail({ order, partnerType, busy, submit }: { order: PurchaseOrder; partnerType: PartnerType; busy: string; submit: (body: Record<string, unknown>, key: string, success: string) => Promise<void> }) {
  const [tab, setTab] = useState<"order" | "fulfilment" | "warranty" | "history">("order");
  const otherBusiness = partnerType === "supplier" ? order.installerBusiness : order.supplierBusiness;
  const claimable = partnerType === "installer" && ["part_fulfilled", "fulfilled"].includes(order.status);
  return <article className="purchasing-order-card">
    <header><div><span>{order.orderNumber}</span><h3>{order.listName}</h3><small>{otherBusiness} | Submitted {displayDate(order.submittedAt)}</small></div><strong className={`admin-pill admin-pill-${order.status}`}>{readable(order.status)}</strong></header>
    <nav aria-label="Purchase order sections">{[["order", "Order"], ["fulfilment", "Fulfilment"], ["warranty", `Warranty (${order.claims.length})`], ["history", "History"]].map(([value, label]) => <button type="button" key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value as typeof tab)}>{label}</button>)}</nav>
    {tab === "order" && <section>
      <div className="purchasing-order-summary"><article><span>Ex GST</span><strong>{money.format(order.subtotalCentsExGst / 100)}</strong></article><article><span>GST</span><strong>{money.format(order.gstCents / 100)}</strong></article><article><span>Total</span><strong>{money.format(order.totalCentsIncGst / 100)}</strong></article></div>
      <div className="purchasing-items">{order.items.map((item) => <article key={item.id}><div><span>{item.brand} {item.modelNumber}</span><strong>{item.name}</strong><small>{item.warrantyYears ? `${item.warrantyYears} year stated product warranty` : "Warranty term not stated"}</small></div><div><strong>{item.quantity} {item.unitLabel}</strong><span>{money.format(item.quantity * item.unitPriceCentsExGst / 100)} ex GST</span></div></article>)}</div>
      <dl className="purchasing-details"><div><dt>Installer reference</dt><dd>{order.installerReference || "Not supplied"}</dd></div><div><dt>Wholesaler reference</dt><dd>{order.supplierReference || "Not supplied"}</dd></div><div><dt>Delivery</dt><dd>{readable(order.deliveryMethod)}</dd></div><div><dt>Planning postcode</dt><dd>{order.projectPostcode || "Not supplied"}</dd></div></dl>
      {order.deliveryNotes && <p className="purchasing-note"><strong>Delivery note</strong>{order.deliveryNotes}</p>}
    </section>}
    {tab === "fulfilment" && <section>
      <div className="purchasing-items">{order.items.map((item) => <article key={item.id}><div><span>{item.brand} {item.modelNumber}</span><strong>{item.name}</strong></div><div><strong>{item.fulfilledQuantity} of {item.quantity}</strong><span>fulfilled</span></div></article>)}</div>
      {partnerType === "supplier" && !["fulfilled", "cancelled"].includes(order.status) ? <form className="purchasing-update-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); void submit({ action: "update_order", orderId: order.id, status: data.get("status"), supplierReference: data.get("supplierReference"), supplierNote: data.get("supplierNote"), expectedAt: data.get("expectedAt"), itemQuantities: order.items.map((item) => ({ itemId: item.id, fulfilledQuantity: data.get(`fulfilled:${item.id}`) })) }, `update-order:${order.id}`, "Purchase order fulfilment updated."); }}>
        <div className="purchasing-quantity-grid">{order.items.map((item) => <label key={item.id}><span>{item.brand} {item.modelNumber} fulfilled</span><input name={`fulfilled:${item.id}`} type="number" min={0} max={item.quantity} defaultValue={item.fulfilledQuantity} /></label>)}</div>
        <label><span>Order status</span><select name="status" defaultValue={order.status === "submitted" ? "confirmed" : order.status}><option value="confirmed">Confirmed</option><option value="part_fulfilled">Part fulfilled</option><option value="fulfilled">Fulfilled</option><option value="cancelled">Cancelled</option></select></label>
        <label><span>Wholesaler reference</span><input name="supplierReference" maxLength={100} defaultValue={order.supplierReference} /></label>
        <label><span>Expected date</span><input name="expectedAt" type="date" defaultValue={order.expectedAt.slice(0, 10)} /></label>
        <label className="wide"><span>Supply note</span><textarea name="supplierNote" maxLength={800} defaultValue={order.supplierNote} /></label>
        <button disabled={Boolean(busy)}>Save fulfilment update</button>
      </form> : <div className="purchasing-status-callout"><strong>{readable(order.status)}</strong><p>{order.supplierNote || (order.expectedAt ? `Expected ${displayDate(order.expectedAt)}` : "The wholesaler has not added a fulfilment note.")}</p></div>}
    </section>}
    {tab === "warranty" && <section>
      {claimable && <details className="purchasing-claim-create"><summary>Lodge a warranty claim</summary><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void submit({ action: "create_claim", orderId: order.id, itemId: data.get("itemId"), issueCategory: data.get("issueCategory"), serialNumber: data.get("serialNumber"), summary: data.get("summary") }, `create-claim:${order.id}`, "Warranty claim submitted."); }}><label><span>Order item</span><select name="itemId">{order.items.filter((item) => item.fulfilledQuantity > 0).map((item) => <option key={item.id} value={item.id}>{item.brand} {item.modelNumber}</option>)}</select></label><label><span>Issue type</span><select name="issueCategory"><option value="fault">Product fault</option><option value="damage">Freight or arrival damage</option><option value="missing_part">Missing part</option><option value="performance">Performance concern</option><option value="other">Other</option></select></label><label><span>Serial number, optional</span><input name="serialNumber" maxLength={120} /></label><label className="wide"><span>Business issue summary</span><textarea required name="summary" maxLength={1200} placeholder="Describe the product issue and checks completed. Do not include household details." /></label><button disabled={Boolean(busy)}>Submit warranty claim</button></form></details>}
      {order.claims.length ? <div className="purchasing-claims">{order.claims.map((claim) => <article key={claim.id}><header><div><span>{claim.claimNumber}</span><strong>{readable(claim.issueCategory)}</strong><small>Lodged {displayDate(claim.submittedAt)}{claim.serialNumber ? ` | Serial ${claim.serialNumber}` : ""}</small></div><b>{readable(claim.status)}</b></header><p>{claim.summary}</p>{claim.supplierResponse && <p><strong>Wholesaler response</strong>{claim.supplierResponse}</p>}{claim.resolution && <p><strong>Resolution</strong>{claim.resolution}</p>}{partnerType === "supplier" && !["resolved", "rejected", "withdrawn"].includes(claim.status) && <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void submit({ action: "update_claim", claimId: claim.id, status: data.get("status"), supplierResponse: data.get("supplierResponse"), resolution: data.get("resolution") }, `update-claim:${claim.id}`, "Warranty claim updated."); }}><label><span>Status</span><select name="status" defaultValue={claim.status === "submitted" ? "acknowledged" : claim.status}><option value="acknowledged">Acknowledged</option><option value="assessment">Assessment</option><option value="replacement">Replacement</option><option value="credit">Credit</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option></select></label><label><span>Response</span><textarea name="supplierResponse" defaultValue={claim.supplierResponse} maxLength={1200} /></label><label><span>Resolution</span><textarea name="resolution" defaultValue={claim.resolution} maxLength={1200} /></label><button disabled={Boolean(busy)}>Save claim update</button></form>}</article>)}</div> : <div className="dashboard-empty-state"><strong>No warranty claims</strong><p>Claims can be lodged against products after the wholesaler records fulfilled quantities.</p></div>}
    </section>}
    {tab === "history" && <section><ol className="purchasing-history">{order.events.map((event) => <li key={event.id}><span>{displayDate(event.createdAt)}</span><strong>{event.summary}</strong></li>)}</ol></section>}
  </article>;
}
