"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type SupplierProfile = {
  uid: string; businessName: string; abn: string; summary: string; website: string; salesEmail: string;
  contactName: string; contactNumber: string; serviceStates: string[]; capabilities: string[];
  productCount: number; brandCount: number; categoryCount: number;
  locations: Array<{ id: string; locationName: string; locationType: string; addressLine1: string; suburb: string;
    addressState: string; postcode: string; salesEmail: string; contactNumber: string; dispatchNotes: string; serviceStates: string[] }>;
  products: Array<{ id: string; modelNumber: string; brand: string; name: string; category: string;
    unitPriceCentsExGst: number; stockStatus: string; leadTimeDays: number; warrantyYears: number; datasheetUrl: string }>;
};

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function WholesalerProfileDrawer({ user, supplierUid, onClose }: { user: User; supplierUid: string; onClose: () => void }) {
  const [profile, setProfile] = useState<SupplierProfile | null>(null);
  const [status, setStatus] = useState("Loading wholesaler profile...");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void user.getIdToken().then((token) => fetch(`/api/product-marketplace/supplier?supplierUid=${encodeURIComponent(supplierUid)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" }))
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as { supplier?: SupplierProfile; error?: string };
        if (!response.ok || !result.supplier) throw new Error(result.error || "The wholesaler profile could not be loaded.");
        if (active) { setProfile(result.supplier); setStatus(""); }
      }).catch((error) => { if (active && !controller.signal.aborted) setStatus(error instanceof Error ? error.message : "The wholesaler profile could not be loaded."); });
    return () => { active = false; controller.abort(); };
  }, [supplierUid, user]);

  const products = useMemo(() => profile?.products.filter((product) => `${product.brand} ${product.modelNumber} ${product.name}`.toLowerCase().includes(search.toLowerCase())) || [], [profile, search]);

  return <div className="wholesaler-profile-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="wholesaler-profile-drawer" role="dialog" aria-modal="true" aria-labelledby="wholesaler-profile-title">
      <header><div><span>Verified TLink wholesaler</span><h2 id="wholesaler-profile-title">{profile?.businessName || "Wholesaler profile"}</h2><p>{profile?.summary || status}</p></div><button type="button" onClick={onClose} aria-label="Close wholesaler profile">Close</button></header>
      {profile && <>
        <div className="wholesaler-profile-stats"><div><strong>{profile.productCount}</strong><span>approved products</span></div><div><strong>{profile.brandCount}</strong><span>brands</span></div><div><strong>{profile.categoryCount}</strong><span>categories</span></div></div>
        <section><h3>Sales and trade contact</h3><dl><div><dt>Sales email</dt><dd>{profile.salesEmail ? <a href={`mailto:${profile.salesEmail}`}>{profile.salesEmail}</a> : "Not supplied"}</dd></div><div><dt>Contact number</dt><dd>{profile.contactNumber ? <a href={`tel:${profile.contactNumber}`}>{profile.contactNumber}</a> : "Not supplied"}</dd></div><div><dt>Contact</dt><dd>{profile.contactName || "Sales team"}</dd></div><div><dt>ABN</dt><dd>{profile.abn}</dd></div><div><dt>Service states</dt><dd>{profile.serviceStates.join(", ") || "Confirm with wholesaler"}</dd></div>{profile.website && <div><dt>Website</dt><dd><a href={profile.website} target="_blank" rel="noreferrer">Open website</a></dd></div>}</dl></section>
        <section><h3>Dispatch and warehouse locations</h3><div className="wholesaler-location-list">{profile.locations.map((location) => <article key={location.id}><span>{readable(location.locationType)}</span><strong>{location.locationName}</strong><p>{[location.addressLine1, location.suburb, location.addressState, location.postcode].filter(Boolean).join(", ")}</p><small>{location.serviceStates.length ? `Dispatches to ${location.serviceStates.join(", ")}` : "Dispatch coverage: confirm with wholesaler"}</small>{location.salesEmail && <a href={`mailto:${location.salesEmail}`}>{location.salesEmail}</a>}{location.contactNumber && <a href={`tel:${location.contactNumber}`}>{location.contactNumber}</a>}{location.dispatchNotes && <em>{location.dispatchNotes}</em>}</article>)}</div></section>
        <section className="wholesaler-profile-catalogue"><div><h3>Approved product catalogue</h3><label><span>Search this wholesaler</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Brand, model or product" /></label></div><div>{products.length ? products.map((product) => <article key={product.id}><div><span>{product.brand}</span><strong>{product.name}</strong><small>{product.modelNumber} | {readable(product.category)}</small></div><div><strong>{money.format(product.unitPriceCentsExGst / 100)} ex GST</strong><small>{readable(product.stockStatus)} | {product.leadTimeDays ? `${product.leadTimeDays} days` : "Available now"}</small>{product.datasheetUrl && <a href={product.datasheetUrl} target="_blank" rel="noreferrer">Product details</a>}</div></article>) : <p>No approved products match this search.</p>}</div></section>
      </>}
      {!profile && <p className="dashboard-settings-status" role="status">{status}</p>}
    </aside>
  </div>;
}
