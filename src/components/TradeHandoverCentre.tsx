"use client";

import { FormEvent, useState } from "react";
import type { User } from "firebase/auth";
import {
  HANDOVER_ASSET_CATEGORIES,
  HANDOVER_DOCUMENT_CATEGORIES,
} from "@/lib/trade-handover.mjs";

type InstalledAsset = {
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
};

type ComplianceItem = {
  id: string;
  label: string;
  guidance: string;
  status: "pending" | "complete" | "not_applicable";
  completedAt: string;
};

type HandoverDocument = {
  id: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  customerVisible: boolean;
  createdAt: string;
};

type HandoverPack = {
  id: string;
  status: "draft" | "submitted" | "changes_requested" | "published" | "rejected";
  reviewNote: string;
  submittedAt: string;
  publishedAt: string;
  canEdit: boolean;
  assets: InstalledAsset[];
  complianceItems: ComplianceItem[];
  documents: HandoverDocument[];
  readiness: { ready: boolean; blockers: string[] };
};

type HandoverResult = {
  ok?: boolean;
  pack?: HandoverPack | null;
  customerLinked?: boolean;
  error?: string;
};

const assetCategoryOptions = HANDOVER_ASSET_CATEGORIES as Array<[string, string]>;
const documentCategoryOptions = HANDOVER_DOCUMENT_CATEGORIES as Array<[string, string]>;
const assetLabels = Object.fromEntries(assetCategoryOptions) as Record<string, string>;
const documentLabels = Object.fromEntries(documentCategoryOptions) as Record<string, string>;

function dateLabel(value: string) {
  if (!value) return "Not recorded";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function fileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "Preparing",
    submitted: "Under platform review",
    changes_requested: "Changes requested",
    published: "Published to customer",
    rejected: "Review closed",
  };
  return labels[value] || value.replaceAll("_", " ");
}

export function TradeHandoverCentre({
  user,
  workOrderId,
  fullAccess,
}: {
  user: User;
  workOrderId: string;
  fullAccess: boolean;
}) {
  const [pack, setPack] = useState<HandoverPack | null>(null);
  const [customerLinked, setCustomerLinked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  function apply(result: HandoverResult) {
    setPack(result.pack || null);
    setCustomerLinked(Boolean(result.customerLinked));
  }

  async function load() {
    setLoading(true);
    setStatus("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-handover?workOrderId=${encodeURIComponent(workOrderId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as HandoverResult;
      if (!response.ok) throw new Error(result.error || "The handover record could not be loaded.");
      apply(result);
      setLoaded(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The handover record could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function update(method: "POST" | "PATCH", body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setStatus("Saving the protected handover record...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-handover", {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...body, workOrderId }),
      });
      const result = await response.json().catch(() => ({})) as HandoverResult;
      if (!response.ok) throw new Error(result.error || "The handover update could not be saved.");
      apply(result);
      setLoaded(true);
      setStatus(body.action === "submit_handover" ? "Submitted for platform review. Customer access remains closed until approval." : "Asset and handover record updated.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The handover update could not be saved.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function addAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await update("POST", {
      action: "add_asset",
      assetCategory: data.get("assetCategory"),
      brand: data.get("brand"),
      modelNumber: data.get("modelNumber"),
      serialNumber: data.get("serialNumber"),
      quantity: data.get("quantity"),
      installedAt: data.get("installedAt"),
      warrantyProvider: data.get("warrantyProvider"),
      warrantyReference: data.get("warrantyReference"),
      warrantyStart: data.get("warrantyStart"),
      warrantyEnd: data.get("warrantyEnd"),
    }, "asset");
    if (saved) form.reset();
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("workOrderId", workOrderId);
    data.set("customerVisible", data.get("customerVisible") ? "true" : "false");
    setBusy("document");
    setStatus("Uploading the protected handover document...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-handover/documents", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: data,
      });
      const result = await response.json().catch(() => ({})) as HandoverResult;
      if (!response.ok) throw new Error(result.error || "The document could not be uploaded.");
      form.reset();
      await load();
      setStatus("Protected handover document added.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The document could not be uploaded.");
    } finally {
      setBusy("");
    }
  }

  async function downloadDocument(document: HandoverDocument) {
    setBusy(`download:${document.id}`);
    setStatus("Preparing the protected document...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-handover/documents?download=${encodeURIComponent(document.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "The document could not be downloaded.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Protected document download started.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The document could not be downloaded.");
    } finally {
      setBusy("");
    }
  }

  async function deleteDocument(document: HandoverDocument) {
    setBusy(`delete:${document.id}`);
    setStatus("Removing the handover document...");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-handover/documents?id=${encodeURIComponent(document.id)}&workOrderId=${encodeURIComponent(workOrderId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The document could not be removed.");
      await load();
      setStatus("Handover document removed.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The document could not be removed.");
    } finally {
      setBusy("");
    }
  }

  const resolvedCompliance = pack?.complianceItems.filter((item) => item.status !== "pending").length || 0;
  const customerDocuments = pack?.documents.filter((item) => item.customerVisible).length || 0;

  return <details className="trade-handover-centre" onToggle={(event) => {
    if (event.currentTarget.open && !loaded && !loading && fullAccess) void load();
  }}>
    <summary>
      <span><strong>Assets, warranties and handover</strong><small>{fullAccess ? pack ? statusLabel(pack.status) : "Build a verified completion record" : "Premium Business Hub feature"}</small></span>
      <b>{pack ? `${pack.assets.length} asset${pack.assets.length === 1 ? "" : "s"}` : "Open"}</b>
    </summary>

    {!fullAccess ? <div className="handover-locked">
      <span>Premium operations</span>
      <h4>Turn completed work into a durable customer asset record</h4>
      <p>Paid Business Hub access, or an administrator feature grant, adds warranties, completion evidence, compliance checklists and reviewed customer handover packs.</p>
      <a href="#membership">View membership access</a>
    </div> : loading ? <div className="handover-loading">Loading the protected handover workspace...</div> : !pack ? <div className="handover-start">
      <div><span>Start once, keep for the life of the job</span><h4>Create the installed asset and handover record</h4><p>The record contains product, warranty and completion evidence only. No customer name, email, phone or street address is stored here.</p></div>
      <button type="button" disabled={busy === "start"} onClick={() => void update("POST", { action: "initialize_pack" }, "start")}>{busy === "start" ? "Starting..." : "Start handover record"}</button>
    </div> : <div className="handover-workspace">
      <div className="handover-statusbar">
        <div><span>Review state</span><strong>{statusLabel(pack.status)}</strong></div>
        <div><span>Installed assets</span><strong>{pack.assets.length}</strong></div>
        <div><span>Checklist</span><strong>{resolvedCompliance}/{pack.complianceItems.length}</strong></div>
        <div><span>Customer documents</span><strong>{customerDocuments}</strong></div>
      </div>

      <div className={`handover-customer-link ${customerLinked ? "linked" : "internal"}`}>
        <strong>{customerLinked ? "Private customer project linked" : "Business-only record"}</strong>
        <span>{customerLinked ? "The approved pack will appear inside that household account without exposing their contact details." : "Assets and warranties can be stored here, but customer publishing is available only for eligible platform projects."}</span>
      </div>

      {pack.reviewNote && <div className="handover-review-note"><strong>Platform review note</strong><p>{pack.reviewNote}</p></div>}

      <section className="handover-assets">
        <header><div><span>Installed asset register</span><h4>Record what was actually installed</h4></div><small>Brand and model are required. Serial and warranty details strengthen the customer record.</small></header>
        {pack.assets.length ? <div className="handover-asset-list">{pack.assets.map((asset) => <article key={asset.id}>
          <div><span>{assetLabels[asset.assetCategory] || asset.assetCategory}</span><h5>{asset.brand} {asset.modelNumber}</h5><small>{asset.serialNumber ? `Serial ${asset.serialNumber}` : "Serial not recorded"} | Quantity {asset.quantity}</small></div>
          <dl><div><dt>Installed</dt><dd>{dateLabel(asset.installedAt)}</dd></div><div><dt>Warranty provider</dt><dd>{asset.warrantyProvider || "Not recorded"}</dd></div><div><dt>Warranty reference</dt><dd>{asset.warrantyReference || "Not recorded"}</dd></div><div><dt>Coverage</dt><dd>{asset.warrantyStart || asset.warrantyEnd ? `${dateLabel(asset.warrantyStart)} to ${dateLabel(asset.warrantyEnd)}` : "Not recorded"}</dd></div></dl>
          {pack.canEdit && <button type="button" disabled={busy === `asset:${asset.id}`} onClick={() => void update("PATCH", { action: "archive_asset", assetId: asset.id }, `asset:${asset.id}`)}>Remove before review</button>}
        </article>)}</div> : <p className="handover-empty">No installed assets recorded yet.</p>}
        {pack.canEdit && <details className="handover-add-record"><summary>Add installed asset</summary><form onSubmit={addAsset}>
          <label><span>Asset type</span><select name="assetCategory" required>{assetCategoryOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>Brand</span><input name="brand" required maxLength={100} /></label>
          <label><span>Model number</span><input name="modelNumber" required maxLength={120} /></label>
          <label><span>Serial number</span><input name="serialNumber" maxLength={140} /></label>
          <label><span>Quantity</span><input name="quantity" type="number" min="1" max="9999" defaultValue="1" /></label>
          <label><span>Installed date</span><input name="installedAt" type="date" /></label>
          <label><span>Warranty provider</span><input name="warrantyProvider" maxLength={120} /></label>
          <label><span>Warranty reference</span><input name="warrantyReference" maxLength={140} /></label>
          <label><span>Warranty start</span><input name="warrantyStart" type="date" /></label>
          <label><span>Warranty end</span><input name="warrantyEnd" type="date" /></label>
          <button type="submit" disabled={busy === "asset"}>{busy === "asset" ? "Adding..." : "Add installed asset"}</button>
        </form></details>}
      </section>

      <section className="handover-compliance">
        <header><div><span>Completion checklist</span><h4>Resolve the evidence expected for this work category</h4></div><small>These prompts organise the handover. They do not replace the installer&apos;s legal or scheme obligations.</small></header>
        <div>{pack.complianceItems.map((item) => <article className={`status-${item.status}`} key={item.id}>
          <div><strong>{item.label}</strong><small>{item.guidance}</small></div>
          <select aria-label={`Status for ${item.label}`} value={item.status} disabled={!pack.canEdit || busy === `compliance:${item.id}`} onChange={(event) => void update("PATCH", { action: "update_compliance", itemId: item.id, status: event.target.value }, `compliance:${item.id}`)}>
            <option value="pending">Pending</option><option value="complete">Complete</option><option value="not_applicable">Not applicable</option>
          </select>
        </article>)}</div>
      </section>

      <section className="handover-documents">
        <header><div><span>Protected evidence library</span><h4>Attach certificates, manuals and commissioning evidence</h4></div><small>Use redacted copies when a document contains unnecessary household contact or address details. Customer-visible files are released only after approval.</small></header>
        {pack.documents.length ? <div className="handover-document-list">{pack.documents.map((document) => <article key={document.id}>
          <div><span>{documentLabels[document.category] || document.category}</span><strong>{document.fileName}</strong><small>{fileSize(document.sizeBytes)} | {document.customerVisible ? "Included in customer pack" : "Internal evidence only"}</small></div>
          <div><button type="button" disabled={busy === `download:${document.id}`} onClick={() => void downloadDocument(document)}>Download</button>{pack.canEdit && <button type="button" disabled={busy === `delete:${document.id}`} onClick={() => void deleteDocument(document)}>Remove</button>}</div>
        </article>)}</div> : <p className="handover-empty">No completion documents uploaded yet.</p>}
        {pack.canEdit && <form className="handover-document-form" onSubmit={uploadDocument}>
          <label><span>Document type</span><select name="category" required>{documentCategoryOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>PDF, JPEG or PNG up to 8 MB</span><input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label>
          <label className="handover-visible-check"><input name="customerVisible" type="checkbox" defaultChecked /><span><strong>Include after approval</strong><small>Customer can download this file only from their private project.</small></span></label>
          <button type="submit" disabled={busy === "document"}>{busy === "document" ? "Uploading..." : "Upload protected document"}</button>
        </form>}
      </section>

      <section className={`handover-readiness ${pack.readiness.ready ? "ready" : "blocked"}`}>
        <div><span>Customer handover readiness</span><h4>{pack.readiness.ready ? "Ready for platform review" : "Finish the remaining safeguards"}</h4></div>
        {pack.readiness.blockers.length > 0 && <ul>{pack.readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
        {pack.canEdit && <button type="button" disabled={!pack.readiness.ready || busy === "submit"} onClick={() => void update("PATCH", { action: "submit_handover" }, "submit")}>{busy === "submit" ? "Submitting..." : "Submit for platform review"}</button>}
        {pack.status === "submitted" && <p>The record is locked during review. The customer cannot see it yet.</p>}
        {pack.status === "published" && <p>The approved pack is available inside the linked customer project.</p>}
      </section>
    </div>}
    {status && <p className="handover-inline-status" role="status">{status}</p>}
  </details>;
}
