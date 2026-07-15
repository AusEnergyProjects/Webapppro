"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { CustomerAssetLifecycle } from "@/components/CustomerAssetLifecycle";

type Asset = { id: string; assetCategory: string; brand: string; modelNumber: string; serialNumber: string; quantity: number; installedAt: string; warrantyProvider: string; warrantyReference: string; warrantyStart: string; warrantyEnd: string };
type Document = { id: string; category: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string };
type Correction = { id: string; assetId: string; versionNumber: number; fieldKey: string; fieldLabel: string; previousValue: string; proposedValue: string; reason: string; publishedAt: string };
type TransferEvent = { id: string; eventType: string; actorType: string; summary: string; createdAt: string };
type Transfer = { id: string; handoverPackId: string; direction: "outgoing" | "incoming"; status: string; senderConsentAt: string; recipientConsentAt: string; expiresAt: string; reviewNote: string; reviewedAt: string; createdAt: string; updatedAt: string; canCancel: boolean; events: TransferEvent[] };
type Pack = { id: string; serviceCategory: string; workNumber: string; publishedAt: string; ownershipStartedAt: string; sourceType: string; assets: Asset[]; documents: Document[]; corrections: Correction[]; activeTransfer: Transfer | null };
type Result = { ok?: boolean; packs?: Pack[]; transfers?: Transfer[]; claimCode?: string; error?: string };

const readable = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateLabel = (value: string) => value ? new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Not yet";
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function CustomerAssetOwnershipCentre({ user }: { user: User }) {
  const [result, setResult] = useState<Result>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [claimCode, setClaimCode] = useState("");

  const request = useCallback(async (method = "GET", body?: Record<string, unknown>) => {
    const token = await user.getIdToken();
    const response = await fetch("/api/customer-asset-ownership", {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as Result;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Your private asset library could not be loaded.");
    setResult(payload);
    if (payload.claimCode) setClaimCode(payload.claimCode);
  }, [user]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => void request().catch((error) => active && setStatus(error instanceof Error ? error.message : "Your private asset library could not be loaded.")).finally(() => active && setLoading(false)));
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [request]);

  async function createTransfer(event: FormEvent<HTMLFormElement>, packId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("consent") !== "on") { setStatus("Confirm that you intend to transfer this asset record."); return; }
    setBusy(`create:${packId}`); setStatus("Creating a private, expiring transfer code..."); setClaimCode("");
    try { await request("POST", { action: "create_transfer", handoverPackId: packId, consent: true }); setStatus("Transfer invitation created. Share the one-time code with the new household outside this platform."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The transfer invitation could not be created."); }
    finally { setBusy(""); }
  }

  async function claimTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (form.get("consent") !== "on") { setStatus("Confirm that you accept responsibility for this asset record."); return; }
    setBusy("claim"); setStatus("Checking the private transfer invitation...");
    try { await request("POST", { action: "claim_transfer", claimCode: String(form.get("claimCode") || ""), consent: true }); formElement.reset(); setStatus("Transfer accepted. An administrator will verify the dual consent before access changes."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The transfer invitation could not be accepted."); }
    finally { setBusy(""); }
  }

  async function cancelTransfer(transferId: string) {
    setBusy(`cancel:${transferId}`); setStatus("Withdrawing transfer consent...");
    try { await request("PATCH", { transferId }); setStatus("Transfer consent withdrawn. Existing ownership remains unchanged."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "The transfer could not be cancelled."); }
    finally { setBusy(""); }
  }

  async function download(document: Document) {
    setBusy(`download:${document.id}`); setStatus("Preparing your protected document...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-handover/documents?download=${encodeURIComponent(document.id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || "The protected document could not be downloaded."); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = document.fileName; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus("Protected document download started.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The protected document could not be downloaded."); }
    finally { setBusy(""); }
  }

  const packs = result.packs || [];
  const transfers = result.transfers || [];
  if (loading) return <section className="customer-loading-state"><span /><div><strong>Opening your home records</strong><p>Loading products, warranties and documents...</p></div></section>;

  return <section className="customer-assets-centre">
    <header className="customer-assets-hero"><div><span>Free home records</span><h1>Your products, warranties and documents</h1><p>Everything your installer has approved for your home, kept together in plain language and available whenever you need it.</p></div><aside><strong>Your privacy stays protected</strong><ul><li>Trades cannot see your account or contact details</li><li>Documents open only from your signed-in account</li><li>Home transfers need consent from both households</li><li>AEA reviews access before anything changes</li></ul></aside></header>
    <details className="customer-asset-move-tools"><summary><strong>Moving home or taking ownership?</strong><span>Open the secure transfer tools</span></summary><section className="customer-asset-claim"><div><span>Taking ownership</span><h2>Use a transfer code</h2><p>Ask the current household for its one-time code. Both accounts consent, then AEA checks the change.</p></div><form onSubmit={claimTransfer}><label><span>Transfer code</span><input name="claimCode" required autoComplete="off" placeholder="AEA-XXXX-XXXX-XXXX-XXXX" maxLength={40} /></label><label className="customer-asset-consent"><input type="checkbox" name="consent" /><span>I accept responsibility for this home record and understand access changes only after review.</span></label><button type="submit" disabled={busy === "claim"}>{busy === "claim" ? "Checking..." : "Accept transfer invitation"}</button></form></section></details>
    {claimCode && <section className="customer-transfer-code" role="status"><div><span>Shown once</span><h2>{claimCode}</h2><p>Share this code privately with the new household. It expires after 7 days. AEA stores only its secure hash and cannot show it again.</p></div><button type="button" onClick={() => void navigator.clipboard.writeText(claimCode).then(() => setStatus("One-time transfer code copied.")).catch(() => setStatus("Copy was blocked by your browser. Select and copy the code manually."))}>Copy code</button></section>}
    <div className="customer-asset-metrics"><article><strong>{packs.reduce((sum, pack) => sum + pack.assets.length, 0)}</strong><span>products recorded</span></article><article><strong>{packs.reduce((sum, pack) => sum + pack.documents.length, 0)}</strong><span>documents ready</span></article><article><strong>{packs.reduce((sum, pack) => sum + pack.assets.filter((asset) => asset.warrantyEnd).length, 0)}</strong><span>warranties recorded</span></article><article><strong>{packs.length}</strong><span>completed projects</span></article></div>
    {!packs.length ? <section className="customer-empty-state"><span>Nothing to transfer yet</span><h2>Your approved asset records will appear here</h2><p>When an installer handover is reviewed and published, the installed products, documents, service schedules and transfer controls are added automatically.</p></section> : <div className="customer-owned-packs">{packs.map((pack) => <article key={pack.id} className="customer-owned-pack"><header><div><span>{pack.workNumber}</span><h2>{readable(pack.serviceCategory)}</h2><small>Ownership active since {dateLabel(pack.ownershipStartedAt)}</small></div><strong>{pack.sourceType === "transfer" ? "Transferred ownership" : "Original household"}</strong></header>
      <div className="customer-handover-assets">{pack.assets.map((asset) => <section key={asset.id}><div><span>{readable(asset.assetCategory)}</span><h3>{asset.brand} {asset.modelNumber}</h3><small>{asset.serialNumber ? `Serial ${asset.serialNumber}` : "Serial not recorded"} | Quantity {asset.quantity}</small></div><dl><div><dt>Installed</dt><dd>{asset.installedAt || "Not recorded"}</dd></div><div><dt>Warranty provider</dt><dd>{asset.warrantyProvider || "Not recorded"}</dd></div><div><dt>Warranty reference</dt><dd>{asset.warrantyReference || "Not recorded"}</dd></div><div><dt>Warranty end</dt><dd>{asset.warrantyEnd || "Not recorded"}</dd></div></dl></section>)}</div>
      {pack.documents.length > 0 && <section className="customer-handover-documents"><h3>Protected documents</h3>{pack.documents.map((document) => <section key={document.id}><div><span>{readable(document.category)}</span><strong>{document.fileName}</strong><small>{fileSize(document.sizeBytes)}</small></div><button type="button" disabled={busy === `download:${document.id}`} onClick={() => void download(document)}>Download</button></section>)}</section>}
      {pack.corrections.length > 0 && <details className="customer-correction-history"><summary>Approved correction history ({pack.corrections.length})</summary><ol>{pack.corrections.map((correction) => <li key={correction.id}><span>Version {correction.versionNumber}</span><strong>{correction.fieldLabel}: {correction.previousValue || "Not recorded"} to {correction.proposedValue || "Not recorded"}</strong><p>{correction.reason}</p><small>Published {dateLabel(correction.publishedAt)}</small></li>)}</ol></details>}
      <CustomerAssetLifecycle user={user} packId={pack.id} />
      <details className="customer-pack-transfer"><summary>Moving out? Transfer this home record</summary><section className="customer-transfer-panel"><div><span>Home ownership change</span><h3>Pass this record to the next household</h3><p>The products, documents, care dates and safety notices move only after both households consent and AEA approves the change.</p></div>{pack.activeTransfer ? <div className="customer-active-transfer"><strong>{readable(pack.activeTransfer.status)}</strong><p>{pack.activeTransfer.status === "awaiting_recipient" ? "Waiting for the new household to use the one-time code." : "Both households consented. AEA review is pending."}</p><small>Invitation expires {dateLabel(pack.activeTransfer.expiresAt)}</small><button type="button" disabled={busy === `cancel:${pack.activeTransfer.id}`} onClick={() => void cancelTransfer(pack.activeTransfer!.id)}>Withdraw consent</button></div> : <form onSubmit={(event) => void createTransfer(event, pack.id)}><label className="customer-asset-consent"><input type="checkbox" name="consent" /><span>I intend to transfer this home record and understand my access ends after approval.</span></label><button type="submit" disabled={busy === `create:${pack.id}`}>{busy === `create:${pack.id}` ? "Creating..." : "Create one-time transfer code"}</button></form>}</section></details>
    </article>)}</div>}
    {transfers.length > 0 && <section className="customer-transfer-history"><div><span>Consent ledger</span><h2>Transfer history</h2><p>Status and event records are visible without revealing either customer account&apos;s identity.</p></div><div>{transfers.map((transfer) => <details key={transfer.id}><summary><span>{transfer.direction === "outgoing" ? "Sent" : "Received"}</span><strong>{readable(transfer.status)}</strong><small>{dateLabel(transfer.updatedAt)}</small></summary><ol>{transfer.events.map((event) => <li key={event.id}><strong>{event.summary}</strong><small>{readable(event.actorType)} | {dateLabel(event.createdAt)}</small></li>)}</ol>{transfer.reviewNote && <p>Review note: {transfer.reviewNote}</p>}{transfer.canCancel && <button type="button" disabled={busy === `cancel:${transfer.id}`} onClick={() => void cancelTransfer(transfer.id)}>Withdraw consent</button>}</details>)}</div></section>}
    {status && <p className="customer-dashboard-status" role="status">{status}</p>}
  </section>;
}
