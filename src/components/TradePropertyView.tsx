"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";

type PropertyResult = {
  ok?: boolean; found?: boolean; address?: string; matchedAddress?: string; placeId?: string;
  verifiedAt?: string; matchQuality?: string; mapsUrl?: string; error?: string;
};

export function TradePropertyView({ user, workOrderId, isProtected, hasDirectCustomer }: { user: User; workOrderId: string; isProtected: boolean; hasDirectCustomer: boolean }) {
  const [result, setResult] = useState<PropertyResult | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const imageObjectUrl = useRef("");

  const loadImage = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/trade-property-map?workOrderId=${encodeURIComponent(workOrderId)}&image=1`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(failure.error || "Satellite imagery could not be loaded.");
    }
    const nextUrl = URL.createObjectURL(await response.blob());
    if (imageObjectUrl.current) URL.revokeObjectURL(imageObjectUrl.current);
    imageObjectUrl.current = nextUrl;
    setImageUrl(nextUrl);
  }, [user, workOrderId]);

  const load = useCallback(async () => {
    if (isProtected || !hasDirectCustomer) return;
    const token = await user.getIdToken();
    const response = await fetch(`/api/trade-property-map?workOrderId=${encodeURIComponent(workOrderId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const next = await response.json().catch(() => ({})) as PropertyResult;
    if (!response.ok) throw new Error(next.error || "Property details could not be loaded.");
    setResult(next);
    if (next.found) await loadImage();
  }, [hasDirectCustomer, isProtected, loadImage, user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((failure) => active && setError(failure instanceof Error ? failure.message : "Property details could not be loaded."));
    });
    return () => {
      active = false; window.cancelAnimationFrame(frame);
      if (imageObjectUrl.current) URL.revokeObjectURL(imageObjectUrl.current);
      imageObjectUrl.current = "";
    };
  }, [load]);

  async function searchAddress() {
    setBusy(true); setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-property-map", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workOrderId }),
      });
      const next = await response.json().catch(() => ({})) as PropertyResult;
      if (!response.ok) throw new Error(next.error || "Google could not match the property.");
      setResult(next); await loadImage();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Google could not match the property."); }
    finally { setBusy(false); }
  }

  if (isProtected) return <section className="crm-job-section"><div className="crm-property-locked"><span>Protected by design</span><h4>Exact property tools are unavailable</h4><p>AEA manages this household relationship. The installer receives only the service region and project requirements, never the customer&apos;s street address or satellite property view.</p></div></section>;
  if (!hasDirectCustomer) return <section className="crm-job-section"><div className="crm-empty"><strong>Link your direct customer first</strong><span>A complete customer address is required before property tools can be used.</span></div></section>;
  return <section className="crm-job-section crm-property-view">
    <div className="crm-section-heading"><div><span>Property workspace</span><h4>Google address match and satellite view</h4><p>Use this to review roof access, visible obstructions and site context before a visit. Always confirm conditions on site.</p></div></div>
    <div className="crm-property-address"><div><span>Direct customer address</span><strong>{result?.address || "Loading address..."}</strong>{result?.matchedAddress && <small>Google matched: {result.matchedAddress}</small>}</div><button type="button" disabled={busy} onClick={() => void searchAddress()}>{busy ? "Searching..." : result?.found ? "Refresh Google match" : "Search address with Google"}</button></div>
    {imageUrl ? <figure><Image unoptimized width={1280} height={720} src={imageUrl} alt="Google satellite view of the direct customer's property" /><figcaption>Google satellite imagery. Confirm boundaries, access and roof conditions during the site visit.</figcaption></figure> : result?.found ? <div className="crm-empty"><strong>Loading satellite image</strong><span>The image is requested only while this tab is open.</span></div> : <div className="crm-property-placeholder"><strong>No Google lookup used yet</strong><span>Search only when it helps the job. This keeps early operating costs controlled.</span></div>}
    {result?.mapsUrl && <a className="crm-map-link" href={result.mapsUrl} target="_blank" rel="noreferrer">Open this match in Google Maps</a>}
    {error && <p className="crm-inline-status error" role="status">{error}</p>}
  </section>;
}
