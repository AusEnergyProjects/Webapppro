"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type Site = { id: string; siteLabel: string; addressLine1?: string; suburb?: string; addressState?: string; postcode?: string };
type Asset = {
  id: string; customerId: string; serviceSiteId: string; sourceType: string; sourceReference: string; reviewStatus: string;
  assetStatus: string; assetLabel: string; commissioningReference: string; assetCategory: string; brand: string; modelNumber: string;
  serialNumber: string; quantity: number; installedAt: string; warrantyProvider: string; warrantyReference: string; warrantyStart: string;
  warrantyEnd: string; customerNumber: string; customerName: string; siteLabel: string; siteSummary: string; workOrderId: string;
  workNumber: string; workTitle: string; proposedCustomerId?: string; proposedSiteId?: string; updatedAt: string;
};
type TimelineEntry = {
  id: string; sourceType: string; eventType: string; title: string; summary: string; occurredAt: string;
  sourceReference: string; serviceSiteId: string; workOrderId: string;
};
type AssetResult = { ok?: boolean; assets?: Asset[]; pendingReviews?: Asset[]; timeline?: TimelineEntry[]; id?: string; error?: string };

const CATEGORIES = ["solar", "battery", "hot-water", "heating-cooling", "ev-charging", "electrical", "insulation-draughts", "controls", "other"];
const readable = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateLabel = (value: string) => value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleString("en-AU", value.length === 10 ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
const warrantyState = (end: string) => {
  if (!end) return { key: "no_date", label: "Warranty date not recorded" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${end}T00:00:00`); const ninety = new Date(today); ninety.setDate(ninety.getDate() + 90);
  if (due < today) return { key: "expired", label: `Warranty expired ${dateLabel(end)}` };
  if (due <= ninety) return { key: "due_90", label: `Warranty ends ${dateLabel(end)}` };
  return { key: "covered", label: `Warranty to ${dateLabel(end)}` };
};

export function TradeAssetWorkspace({ user, customerId = "", sites = [], compact = false, onOpenJob }: {
  user: User; customerId?: string; sites?: Site[]; compact?: boolean; onOpenJob?: (id: string) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pending, setPending] = useState<Asset[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [search, setSearch] = useState(""); const [assetStatus, setAssetStatus] = useState("");
  const [warranty, setWarranty] = useState(""); const [category, setCategory] = useState(""); const [siteId, setSiteId] = useState("");
  const [creating, setCreating] = useState(false); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");

  const request = useCallback(async (init: RequestInit = {}, query = "") => {
    const token = await user.getIdToken(); const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`/api/trade-assets${query}`, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as AssetResult;
    if (!response.ok || result.ok === false) throw new Error(result.error || "The asset register request could not be completed.");
    return result;
  }, [user]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ search, status: assetStatus, warranty, category, customerId, siteId });
    const result = await request({}, `?${params}`); setAssets(result.assets || []); setPending(result.pendingReviews || []); setTimeline(result.timeline || []);
  }, [assetStatus, category, customerId, request, search, siteId, warranty]);

  useEffect(() => { const timer = window.setTimeout(() => void load().catch((error) => setMessage(error.message)), 150); return () => window.clearTimeout(timer); }, [load]);

  async function mutate(body: Record<string, unknown>, key: string, success: string, method = "POST") {
    setBusy(key); setMessage("");
    try { await request({ method, body: JSON.stringify(body) }); await load(); setMessage(success); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : "The asset could not be updated."); return false; }
    finally { setBusy(""); }
  }

  async function createAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (await mutate({ action: "create_asset", customerId, ...Object.fromEntries(data) }, "create", "Installed asset added.")) { form.reset(); setCreating(false); }
  }

  return <section className={`asset-workspace${compact ? " compact" : ""}`} aria-labelledby={compact ? `asset-title-${customerId}` : "asset-register-title"}>
    <header className="asset-hero"><div><span>Customer equipment history</span><h2 id={compact ? `asset-title-${customerId}` : "asset-register-title"}>{compact ? "Assets and timeline" : "Installed asset register"}</h2><p>{compact ? "Review installed products, warranties and the full customer and site history." : "Find installed equipment, review handover imports and act before warranties expire."}</p></div>{customerId && <button type="button" onClick={() => setCreating((value) => !value)} disabled={!sites.length}>{creating ? "Close form" : "Add asset"}</button>}</header>
    {customerId && !sites.length && <p className="asset-notice">Add a service site before registering equipment.</p>}
    {creating && <form className="crm-form asset-create" onSubmit={createAsset}><div className="crm-form-grid"><label><span>Service site</span><select name="serviceSiteId" required defaultValue={siteId || sites[0]?.id || ""}>{sites.map((site) => <option key={site.id} value={site.id}>{site.siteLabel}</option>)}</select></label><label><span>Asset type</span><select name="assetCategory" required>{CATEGORIES.map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label><label><span>Asset label</span><input name="assetLabel" placeholder="Main switchboard battery" /></label><label><span>Brand</span><input name="brand" required /></label><label><span>Model</span><input name="modelNumber" required /></label><label><span>Serial number</span><input name="serialNumber" /></label><label><span>Quantity</span><input name="quantity" type="number" min="1" max="9999" defaultValue="1" /></label><label><span>Installed</span><input name="installedAt" type="date" /></label><label><span>Commissioning reference</span><input name="commissioningReference" /></label><label><span>Warranty provider</span><input name="warrantyProvider" /></label><label><span>Warranty reference</span><input name="warrantyReference" /></label><label><span>Warranty starts</span><input name="warrantyStart" type="date" /></label><label><span>Warranty ends</span><input name="warrantyEnd" type="date" /></label></div><button className="btn" disabled={busy === "create"}>{busy === "create" ? "Adding..." : "Add installed asset"}</button></form>}
    <div className="asset-filters"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search model, serial, customer or site" aria-label="Search installed assets" /><select value={assetStatus} onChange={(event) => setAssetStatus(event.target.value)} aria-label="Filter asset status"><option value="">All asset statuses</option><option value="active">Active</option><option value="retired">Retired</option><option value="replaced">Replaced</option></select><select value={warranty} onChange={(event) => setWarranty(event.target.value)} aria-label="Filter warranty"><option value="">All warranties</option><option value="expired">Expired</option><option value="due_90">Ends within 90 days</option><option value="covered">Covered beyond 90 days</option><option value="no_date">No warranty date</option></select><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter asset type"><option value="">All asset types</option>{CATEGORIES.map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select>{customerId && <select value={siteId} onChange={(event) => setSiteId(event.target.value)} aria-label="Filter service site"><option value="">All service sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.siteLabel}</option>)}</select>}</div>
    {pending.length > 0 && <section className="asset-review"><header><div><span>Installer review required</span><h3>{pending.length} handover asset{pending.length === 1 ? "" : "s"} waiting</h3><p>Confirm each existing handover record before it joins the authoritative customer and service site history.</p></div></header><div>{pending.map((asset) => <article key={asset.id}><div><strong>{asset.brand} {asset.modelNumber}</strong><span>{asset.workNumber || "Handover record"} | {asset.customerName} | {asset.siteLabel}</span><small>{asset.serialNumber ? `Serial ${asset.serialNumber}` : "Serial not recorded"}</small></div><button type="button" disabled={busy === `review:${asset.id}`} onClick={() => void mutate({ action: "review_handover_asset", assetId: asset.id, serviceSiteId: asset.proposedSiteId }, `review:${asset.id}`, "Handover asset reviewed and linked.")}>{busy === `review:${asset.id}` ? "Linking..." : "Confirm link"}</button></article>)}</div></section>}
    <div className="asset-list">{assets.length ? assets.map((asset) => { const warrantyInfo = warrantyState(asset.warrantyEnd); return <article key={asset.id}><header><div><span>{readable(asset.assetCategory)} | {asset.sourceType === "handover" ? "Handover" : "Manual record"}</span><h3>{asset.assetLabel || `${asset.brand} ${asset.modelNumber}`}</h3><p>{asset.assetLabel && `${asset.brand} ${asset.modelNumber}`}</p></div><em className={warrantyInfo.key}>{warrantyInfo.label}</em></header><dl><div><dt>Customer</dt><dd>{asset.customerName} {asset.customerNumber && `| ${asset.customerNumber}`}</dd></div><div><dt>Service site</dt><dd>{asset.siteLabel}{asset.siteSummary ? ` | ${asset.siteSummary}` : ""}</dd></div><div><dt>Serial</dt><dd>{asset.serialNumber || "Not recorded"}</dd></div><div><dt>Installed</dt><dd>{dateLabel(asset.installedAt)}</dd></div><div><dt>Commissioning</dt><dd>{asset.commissioningReference || "Not recorded"}</dd></div><div><dt>Warranty reference</dt><dd>{[asset.warrantyProvider, asset.warrantyReference].filter(Boolean).join(" | ") || "Not recorded"}</dd></div></dl><footer><label><span>Asset status</span><select value={asset.assetStatus} disabled={busy === `status:${asset.id}`} onChange={(event) => void mutate({ assetId: asset.id, assetStatus: event.target.value }, `status:${asset.id}`, "Asset status updated.", "PATCH")}><option value="active">Active</option><option value="retired">Retired</option><option value="replaced">Replaced</option></select></label>{asset.workOrderId && onOpenJob && <button type="button" onClick={() => onOpenJob(asset.workOrderId)}>Open {asset.workNumber || "job"}</button>}</footer></article>; }) : <div className="crm-empty"><strong>No installed assets match this view</strong><span>Clear a filter, review a handover candidate or add an asset to a customer.</span></div>}</div>
    {customerId && <section className="asset-timeline"><header><div><span>One chronological record</span><h3>Customer and site timeline</h3><p>Enquiries, jobs, appointments, notes, handovers, installed assets and service events appear in one private view.</p></div></header>{timeline.length ? <ol>{timeline.map((entry) => <li key={`${entry.sourceType}:${entry.id}`}><span>{readable(entry.sourceType)} | {readable(entry.eventType)}</span><strong>{entry.title}</strong><p>{entry.summary}</p><small>{dateLabel(entry.occurredAt)}{entry.sourceReference ? ` | ${entry.sourceReference}` : ""}</small>{entry.workOrderId && onOpenJob && <button type="button" onClick={() => onOpenJob(entry.workOrderId)}>Open job</button>}</li>)}</ol> : <div className="crm-empty"><strong>No timeline events match this site</strong><span>Choose all service sites or add the first customer activity.</span></div>}</section>}
    {message && <p className="trade-import-status" role="status">{message}</p>}
  </section>;
}
