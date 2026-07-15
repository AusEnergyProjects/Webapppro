"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { ASSET_SAFETY_SEVERITIES } from "@/lib/asset-lifecycle.mjs";
import { HANDOVER_ASSET_CATEGORIES } from "@/lib/trade-handover.mjs";

type AdminRole = "owner" | "admin" | "reviewer" | "support";
type Notice = { id: string; title: string; summary: string; severity: string; assetCategory: string; brand: string; modelNumber: string; sourceUrl: string; sourceLabel: string; effectiveAt: string; expiresAt: string; status: string; publishedAt: string; createdAt: string; affectedAssetCount: number; acknowledgementCount: number };

const severities = ASSET_SAFETY_SEVERITIES as Array<[string, string]>;
const categories = HANDOVER_ASSET_CATEGORIES as Array<[string, string]>;
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function AdminAssetSafety({ user, role }: { user: User; role: AdminRole }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [filter, setFilter] = useState("active");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const canManage = role === "owner" || role === "admin";

  const request = useCallback(async (method: "GET" | "POST" | "PATCH" = "GET", body?: Record<string, unknown>) => {
    const token = await user.getIdToken();
    const response = await fetch("/api/admin/asset-safety", { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || "The product safety workspace could not be loaded.");
    setNotices(result.notices || []);
  }, [user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void request().catch((error) => active && setStatus(error instanceof Error ? error.message : "The product safety workspace could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [request]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("create"); setStatus("Saving the sourced product safety notice...");
    try {
      await request("POST", { title: data.get("title"), summary: data.get("summary"), severity: data.get("severity"), assetCategory: data.get("assetCategory"), brand: data.get("brand"), modelNumber: data.get("modelNumber"), sourceUrl: data.get("sourceUrl"), sourceLabel: data.get("sourceLabel"), effectiveAt: data.get("effectiveAt"), expiresAt: data.get("expiresAt"), publishNow: data.get("publishNow") === "on" });
      form.reset(); setStatus("Safety notice saved. Published notices are now matched to private asset records without exposing customer identities.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The safety notice could not be saved."); }
    finally { setBusy(""); }
  }

  async function transition(id: string, action: "publish" | "withdraw") {
    setBusy(id); setStatus(action === "publish" ? "Publishing the safety notice..." : "Withdrawing the safety notice...");
    try { await request("PATCH", { id, action }); setStatus(action === "publish" ? "Notice published to matched asset libraries." : "Notice withdrawn from active asset libraries. The audit history remains available."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The safety notice could not be updated."); }
    finally { setBusy(""); }
  }

  const visible = useMemo(() => notices.filter((notice) => filter === "all" || filter === "active" ? filter === "all" || notice.status === "published" : notice.status === filter), [filter, notices]);
  const published = notices.filter((notice) => notice.status === "published");
  const affected = published.reduce((sum, notice) => sum + notice.affectedAssetCount, 0);
  const acknowledged = published.reduce((sum, notice) => sum + notice.acknowledgementCount, 0);

  return <>
    <header className="admin-page-heading"><span>Product stewardship</span><h1>Asset safety and recall notices</h1><p>Publish sourced notices to matching private asset libraries by category, brand or model. Matching uses installed product records only and never exposes customer contact details.</p></header>
    <section className="admin-metric-grid"><article><span>Active notices</span><strong>{published.length}</strong><small>Currently visible to matched accounts</small></article><article><span>Matched assets</span><strong>{affected}</strong><small>Count only, no household identities</small></article><article><span>Reviewed</span><strong>{acknowledged}</strong><small>Customer acknowledgements</small></article><article><span>Audit coverage</span><strong>{notices.length}</strong><small>Draft, active and withdrawn history</small></article></section>
    {canManage && <form className="admin-panel admin-safety-form" onSubmit={create}><div className="admin-panel-heading"><span>Sourced publication</span><h2>Create a targeted safety notice</h2><p>Use an official regulator or manufacturer HTTPS source. At least one matching field is required.</p></div><div className="admin-safety-form-grid"><label>Title<input name="title" required maxLength={140} /></label><label>Severity<select name="severity" defaultValue="advisory">{severities.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Asset category<select name="assetCategory" defaultValue=""><option value="">Any category</option>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Brand<input name="brand" maxLength={100} placeholder="Exact match, optional" /></label><label>Model number<input name="modelNumber" maxLength={120} placeholder="Exact match, optional" /></label><label>Effective date<input name="effectiveAt" type="date" /></label><label>Expiry date<input name="expiresAt" type="date" /></label><label>Source label<input name="sourceLabel" maxLength={120} defaultValue="Official safety source" /></label><label className="wide">Official source URL<input name="sourceUrl" type="url" inputMode="url" required pattern="https:.+" placeholder="https://" /></label><label className="wide">Customer-facing summary<textarea name="summary" required maxLength={1200} rows={5} /></label><label className="admin-safety-publish"><input name="publishNow" type="checkbox" /><span><strong>Publish immediately</strong><small>Leave clear to save as a draft for a second check.</small></span></label><button type="submit" disabled={busy === "create"}>{busy === "create" ? "Saving..." : "Save safety notice"}</button></div></form>}
    <div className="admin-filterbar admin-handover-filterbar"><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">Active notices</option><option value="draft">Drafts</option><option value="withdrawn">Withdrawn</option><option value="all">All notices</option></select><button type="button" onClick={() => void request()}>Refresh</button></div>
    <section className="admin-panel admin-safety-list"><div className="admin-panel-heading"><span>Privacy-safe matching</span><h2>Notice register</h2></div>{loading ? <p className="admin-empty">Loading safety notices...</p> : visible.length ? <div>{visible.map((notice) => <article className={`severity-${notice.severity}`} key={notice.id}><header><div><span>{readable(notice.severity)} | {readable(notice.status)}</span><h3>{notice.title}</h3><small>{[notice.assetCategory && readable(notice.assetCategory), notice.brand, notice.modelNumber].filter(Boolean).join(" | ")}</small></div><strong>{notice.affectedAssetCount} matched asset{notice.affectedAssetCount === 1 ? "" : "s"}</strong></header><p>{notice.summary}</p><div className="admin-safety-facts"><span>{notice.acknowledgementCount} customer review{notice.acknowledgementCount === 1 ? "" : "s"}</span><span>{notice.effectiveAt ? `Effective ${notice.effectiveAt}` : "Effective immediately"}</span><span>{notice.expiresAt ? `Expires ${notice.expiresAt}` : "No expiry set"}</span><a href={notice.sourceUrl} target="_blank" rel="noreferrer">Open {notice.sourceLabel}</a></div>{canManage && <div className="admin-safety-actions">{notice.status !== "published" && <button type="button" disabled={busy === notice.id} onClick={() => void transition(notice.id, "publish")}>Publish</button>}{notice.status === "published" && <button type="button" className="danger" disabled={busy === notice.id} onClick={() => void transition(notice.id, "withdraw")}>Withdraw</button>}</div>}</article>)}</div> : <p className="admin-empty">No notices match this state.</p>}</section>
    {status && <p className="admin-global-status" role="status">{status}</p>}
  </>;
}
