"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type AdminHandover = {
  id: string;
  workOrderId: string;
  customerLinked: boolean;
  serviceCategory: string;
  status: string;
  submittedAt: string;
  publishedAt: string;
  reviewNote: string;
  reviewedAt: string;
  updatedAt: string;
  workNumber: string;
  workTitle: string;
  workStage: string;
  installerBusiness: string;
  assets: Array<{
    id: string;
    assetCategory: string;
    brand: string;
    modelNumber: string;
    serialNumber: string;
    quantity: number;
    installedAt: string;
    warrantyProvider: string;
    warrantyReference: string;
    warrantyStart: string;
    warrantyEnd: string;
  }>;
  complianceItems: Array<{ id: string; label: string; guidance: string; status: string; completedAt: string }>;
  documents: Array<{ id: string; category: string; fileName: string; sizeBytes: number; customerVisible: boolean; createdAt: string }>;
};

function readable(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

function fileSize(value: number) {
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function AdminHandoverReview({ user, role }: { user: User; role: "owner" | "admin" | "reviewer" | "support" }) {
  const [handovers, setHandovers] = useState<AdminHandover[]>([]);
  const [filter, setFilter] = useState("submitted");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = await user.getIdToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(result.error || "The handover review workspace could not be loaded.");
    return result;
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request("/api/admin/handovers");
      setHandovers(result.handovers || []);
      setNotes(Object.fromEntries((result.handovers || []).map((item: AdminHandover) => [item.id, item.reviewNote || ""])));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The handover review workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  async function review(item: AdminHandover, decision: "approve" | "changes_requested" | "reject") {
    setBusy(item.id);
    setStatus("Saving the handover review decision...");
    try {
      await request("/api/admin/handovers", {
        method: "PATCH",
        body: JSON.stringify({ id: item.id, decision, reviewNote: notes[item.id] || "" }),
      });
      await load();
      setStatus(decision === "approve" ? "Handover approved and published to the private customer project." : "Review decision saved for the installer.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The handover review decision could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function download(document: AdminHandover["documents"][number]) {
    setBusy(document.id);
    setStatus("Preparing the protected handover document...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-handover/documents?download=${encodeURIComponent(document.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "The handover document could not be downloaded.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Protected handover document download started and was recorded in the audit history.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The handover document could not be downloaded.");
    } finally {
      setBusy("");
    }
  }

  const visible = useMemo(() => handovers.filter((item) => filter === "all" || item.status === filter), [filter, handovers]);
  const submitted = handovers.filter((item) => item.status === "submitted").length;
  const published = handovers.filter((item) => item.status === "published").length;
  const changes = handovers.filter((item) => item.status === "changes_requested").length;

  return <>
    <header className="admin-page-heading">
      <span>Completion assurance</span>
      <h1>Customer handover review</h1>
      <p>Review installed assets, warranty records, completion checks and protected documents before a pack appears in the household dashboard.</p>
    </header>
    <section className="admin-metric-grid">
      <article><span>Awaiting review</span><strong>{submitted}</strong><small>Customer access remains closed</small></article>
      <article><span>Published</span><strong>{published}</strong><small>Available in private customer projects</small></article>
      <article><span>Changes requested</span><strong>{changes}</strong><small>Returned to the installer</small></article>
      <article><span>Protected records</span><strong>{handovers.length}</strong><small>No customer contact fields shown</small></article>
    </section>
    <div className="admin-filterbar admin-handover-filterbar" role="group" aria-label="Filter customer handovers">
      <select value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="submitted">Awaiting review</option>
        <option value="changes_requested">Changes requested</option>
        <option value="published">Published</option>
        <option value="rejected">Rejected</option>
        <option value="all">All handovers</option>
      </select>
      <button type="button" onClick={() => void load()}>Refresh</button>
    </div>
    <section className="admin-panel admin-handover-workspace">
      <div className="admin-panel-heading">
        <span>Privacy-safe review</span>
        <h2>Installed asset and evidence packs</h2>
        <p>Reviewers see the installer business, platform work reference and completion evidence. Customer names, contact details, notes and street addresses are excluded.</p>
      </div>
      {loading ? <p className="admin-empty">Loading protected handover records...</p> : visible.length ? <div className="admin-handover-list">{visible.map((item) => {
        const resolved = item.complianceItems.filter((check) => ["complete", "not_applicable"].includes(check.status)).length;
        return <article key={item.id}>
          <header><div><span>{item.workNumber} | {readable(item.serviceCategory)}</span><h3>{item.workTitle}</h3><small>{item.installerBusiness} | Submitted {dateTime(item.submittedAt)}</small></div><span className={`admin-pill admin-pill-${item.status}`}>{readable(item.status)}</span></header>
          <div className="admin-handover-facts"><span>{item.assets.length} installed assets</span><span>{resolved}/{item.complianceItems.length} checks resolved</span><span>{item.documents.length} protected documents</span><span>{item.customerLinked ? "Private customer project linked" : "No customer project link"}</span></div>
          <details><summary>Review installed assets and warranties</summary><div className="admin-handover-assets">{item.assets.map((asset) => <section key={asset.id}><div><span>{readable(asset.assetCategory)}</span><strong>{asset.brand} {asset.modelNumber}</strong><small>{asset.serialNumber ? `Serial ${asset.serialNumber}` : "Serial not recorded"} | Quantity {asset.quantity}</small></div><dl><div><dt>Installed</dt><dd>{asset.installedAt || "Not recorded"}</dd></div><div><dt>Warranty provider</dt><dd>{asset.warrantyProvider || "Not recorded"}</dd></div><div><dt>Reference</dt><dd>{asset.warrantyReference || "Not recorded"}</dd></div><div><dt>Coverage end</dt><dd>{asset.warrantyEnd || "Not recorded"}</dd></div></dl></section>)}</div></details>
          <details><summary>Review completion checklist</summary><ul className="admin-handover-checks">{item.complianceItems.map((check) => <li key={check.id}><span>{check.label}<small>{check.guidance}</small></span><strong>{readable(check.status)}</strong></li>)}</ul></details>
          <details><summary>Review protected documents</summary><div className="admin-handover-documents">{item.documents.map((document) => <section key={document.id}><div><span>{readable(document.category)}</span><strong>{document.fileName}</strong><small>{fileSize(document.sizeBytes)} | {document.customerVisible ? "Customer-visible after approval" : "Internal evidence only"}</small></div><button type="button" disabled={busy === document.id} onClick={() => void download(document)}>Download</button></section>)}</div></details>
          {item.status === "submitted" ? role === "support" ? <p className="admin-handover-review-note"><strong>Review decision required</strong>A reviewer, administrator or owner must decide this handover.</p> : <div className="admin-handover-decision"><label>Review note<textarea value={notes[item.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Required for changes or rejection. Do not include customer contact or address details." /></label><div><button type="button" disabled={busy === item.id || !item.customerLinked} onClick={() => void review(item, "approve")}>Approve and publish</button><button type="button" disabled={busy === item.id} onClick={() => void review(item, "changes_requested")}>Request changes</button><button type="button" className="danger" disabled={busy === item.id} onClick={() => void review(item, "reject")}>Reject</button></div></div> : item.reviewNote && <p className="admin-handover-review-note"><strong>Review note</strong>{item.reviewNote}</p>}
        </article>;
      })}</div> : <p className="admin-empty">No handover packs match this review state.</p>}
    </section>
    {status && <p className="admin-global-status" role="status">{status}</p>}
  </>;
}
