"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type AdminRole = "owner" | "admin" | "reviewer" | "support";
type TransferEvent = { id: string; eventType: string; actorType: string; summary: string; createdAt: string };
type Transfer = { id: string; handoverPackId: string; status: string; workNumber: string; serviceCategory: string; senderConsentAt: string; recipientConsentAt: string; expiresAt: string; reviewNote: string; reviewedAt: string; createdAt: string; updatedAt: string; senderAccountActive: boolean; recipientAccountActive: boolean; senderStillOwns: boolean; customerDocumentCount: number; assets: Array<{ id: string; assetCategory: string; brand: string; modelNumber: string; serialNumber: string; quantity: number; warrantyEnd: string }>; events: TransferEvent[] };
type Correction = { id: string; handoverPackId: string; workOrderId: string; assetId: string; versionNumber: number; fieldKey: string; fieldLabel: string; previousValue: string; proposedValue: string; reason: string; status: string; submittedAt: string; publishedAt: string; reviewNote: string; reviewedAt: string; updatedAt: string; assetLabel: string; workNumber: string; workTitle: string; installerBusiness: string };
type TransferResult = { ok?: boolean; transfers?: Transfer[]; error?: string };
type CorrectionResult = { ok?: boolean; corrections?: Correction[]; error?: string };

const readable = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value: string) => value ? new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Not yet";

export function AdminAssetGovernance({ user, role }: { user: User; role: AdminRole }) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const canReview = ["owner", "admin", "reviewer"].includes(role);

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const headers = { Authorization: `Bearer ${token}` };
    const [transferResponse, correctionResponse] = await Promise.all([
      fetch("/api/admin/asset-transfers", { headers, cache: "no-store" }),
      fetch("/api/admin/handover-corrections", { headers, cache: "no-store" }),
    ]);
    const [transferPayload, correctionPayload] = await Promise.all([
      transferResponse.json().catch(() => ({})) as Promise<TransferResult>,
      correctionResponse.json().catch(() => ({})) as Promise<CorrectionResult>,
    ]);
    if (!transferResponse.ok || transferPayload.ok === false) throw new Error(transferPayload.error || "Asset transfers could not be loaded.");
    if (!correctionResponse.ok || correctionPayload.ok === false) throw new Error(correctionPayload.error || "Handover corrections could not be loaded.");
    setTransfers(transferPayload.transfers || []); setCorrections(correctionPayload.corrections || []);
  }, [user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "Asset governance records could not be loaded.")).finally(() => active && setLoading(false)));
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  async function decide(formElement: HTMLFormElement, kind: "transfer" | "correction", id: string, decision: "approve" | "reject") {
    const form = new FormData(formElement);
    const reviewNote = String(form.get("reviewNote") || "");
    setBusy(`${kind}:${id}:${decision}`); setStatus(`${decision === "approve" ? "Approving" : "Rejecting"} the ${kind} record...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch(kind === "transfer" ? "/api/admin/asset-transfers" : "/api/admin/handover-corrections", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id, decision, reviewNote }) });
      const payload = await response.json().catch(() => ({})) as TransferResult & CorrectionResult;
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `The ${kind} decision could not be saved.`);
      if (kind === "transfer") setTransfers(payload.transfers || []); else setCorrections(payload.corrections || []);
      setStatus(`${kind === "transfer" ? "Ownership transfer" : "Handover correction"} ${decision === "approve" ? "approved" : "rejected"}. The audit record has been saved.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : `The ${kind} decision could not be saved.`); }
    finally { setBusy(""); }
  }

  const readyTransfers = transfers.filter((item) => item.status === "awaiting_admin");
  const pendingCorrections = corrections.filter((item) => item.status === "submitted");
  return <section className="admin-asset-governance">
    <header className="admin-page-heading"><span>Asset governance</span><h1>Ownership transfers and handover corrections</h1><p>Review dual-consent ownership changes and versioned installer corrections without exposing household identities or overwriting approved history.</p></header>
    <section className="admin-metric-grid"><article><span>Transfers to review</span><strong>{readyTransfers.length}</strong><small>Both households consented</small></article><article><span>Waiting for recipient</span><strong>{transfers.filter((item) => item.status === "awaiting_recipient").length}</strong><small>No administrator action yet</small></article><article><span>Corrections to review</span><strong>{pendingCorrections.length}</strong><small>Previous values remain active</small></article><article><span>Published corrections</span><strong>{corrections.filter((item) => item.status === "published").length}</strong><small>Immutable version history</small></article></section>
    {loading ? <div className="admin-empty"><strong>Loading asset governance records...</strong></div> : <div className="admin-governance-grid">
      <section><header><div><span>Dual household consent</span><h2>Ownership transfer queue</h2></div><small>{transfers.length} total records</small></header>{!transfers.length ? <div className="admin-empty"><strong>No asset transfers yet</strong><p>Started and completed transfers will appear here.</p></div> : <div className="admin-governance-list">{transfers.map((transfer) => <article key={transfer.id} className={`status-${transfer.status}`}><header><div><span>{transfer.workNumber}</span><h3>{readable(transfer.serviceCategory)}</h3></div><strong>{readable(transfer.status)}</strong></header><div className="admin-governance-checks"><span className={transfer.senderConsentAt ? "pass" : "fail"}>Current owner consent</span><span className={transfer.recipientConsentAt ? "pass" : "fail"}>New owner consent</span><span className={transfer.senderAccountActive && transfer.senderStillOwns ? "pass" : "fail"}>Current ownership valid</span><span className={transfer.recipientAccountActive ? "pass" : "fail"}>Receiving account active</span></div><dl><div><dt>Expires</dt><dd>{dateTime(transfer.expiresAt)}</dd></div><div><dt>Protected documents</dt><dd>{transfer.customerDocumentCount}</dd></div><div><dt>Installed assets</dt><dd>{transfer.assets.length}</dd></div><div><dt>Updated</dt><dd>{dateTime(transfer.updatedAt)}</dd></div></dl><ul className="admin-governance-assets">{transfer.assets.map((asset) => <li key={asset.id}><strong>{asset.brand} {asset.modelNumber}</strong><span>{readable(asset.assetCategory)} | Quantity {asset.quantity}</span></li>)}</ul><details><summary>Consent and decision history</summary><ol>{transfer.events.map((event) => <li key={event.id}><strong>{event.summary}</strong><small>{readable(event.actorType)} | {dateTime(event.createdAt)}</small></li>)}</ol></details>{transfer.reviewNote && <p className="admin-review-note">Review note: {transfer.reviewNote}</p>}{transfer.status === "awaiting_admin" && canReview && <form className="admin-governance-actions" onSubmit={(event) => event.preventDefault()}><label><span>Review note</span><textarea name="reviewNote" maxLength={800} rows={2} placeholder="Optional for approval, required for rejection. Do not add customer details." /></label><div><button type="button" onClick={(event) => void decide(event.currentTarget.form!, "transfer", transfer.id, "approve")} disabled={busy.startsWith(`transfer:${transfer.id}`)}>Approve transfer</button><button type="button" className="danger" onClick={(event) => void decide(event.currentTarget.form!, "transfer", transfer.id, "reject")} disabled={busy.startsWith(`transfer:${transfer.id}`)}>Reject</button></div></form>}</article>)}</div>}</section>
      <section><header><div><span>Immutable record changes</span><h2>Handover correction queue</h2></div><small>{corrections.length} total versions</small></header>{!corrections.length ? <div className="admin-empty"><strong>No corrections yet</strong><p>Installer proposals against published records will appear here.</p></div> : <div className="admin-governance-list">{corrections.map((correction) => <article key={correction.id} className={`status-${correction.status}`}><header><div><span>{correction.workNumber} | Version {correction.versionNumber}</span><h3>{correction.fieldLabel}</h3></div><strong>{readable(correction.status)}</strong></header><p><strong>{correction.installerBusiness}</strong> proposed a correction for {correction.assetLabel}.</p><div className="admin-correction-comparison"><section><span>Current approved value</span><strong>{correction.previousValue || "Not recorded"}</strong></section><section><span>Proposed value</span><strong>{correction.proposedValue || "Not recorded"}</strong></section></div><blockquote>{correction.reason}</blockquote><small>Submitted {dateTime(correction.submittedAt)}</small>{correction.reviewNote && <p className="admin-review-note">Review note: {correction.reviewNote}</p>}{correction.status === "submitted" && canReview && <form className="admin-governance-actions" onSubmit={(event) => event.preventDefault()}><label><span>Review note</span><textarea name="reviewNote" maxLength={800} rows={2} placeholder="Optional for approval, required for rejection. Do not add customer details." /></label><div><button type="button" onClick={(event) => void decide(event.currentTarget.form!, "correction", correction.id, "approve")} disabled={busy.startsWith(`correction:${correction.id}`)}>Approve and publish</button><button type="button" className="danger" onClick={(event) => void decide(event.currentTarget.form!, "correction", correction.id, "reject")} disabled={busy.startsWith(`correction:${correction.id}`)}>Reject</button></div></form>}</article>)}</div>}</section>
    </div>}
    {!canReview && <p className="admin-banner">Support access is read only. An owner, administrator or reviewer must complete decisions.</p>}
    {status && <p className="admin-banner" role="status">{status}</p>}
  </section>;
}
