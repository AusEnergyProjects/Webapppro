"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { HANDOVER_CORRECTION_DATE_FIELDS, HANDOVER_CORRECTION_FIELDS } from "@/lib/handover-corrections.mjs";

type Asset = { id: string; brand: string; modelNumber: string; serialNumber: string; quantity: number; installedAt: string; warrantyProvider: string; warrantyReference: string; warrantyStart: string; warrantyEnd: string };
type Correction = { id: string; assetId: string; versionNumber: number; fieldKey: string; fieldLabel: string; previousValue: string; proposedValue: string; reason: string; status: string; submittedAt: string; publishedAt: string; reviewNote: string; reviewedAt: string; assetLabel: string };
type Result = { ok?: boolean; corrections?: Correction[]; error?: string };

const fields = HANDOVER_CORRECTION_FIELDS as Array<[string, string]>;
const dateFields = HANDOVER_CORRECTION_DATE_FIELDS as Set<string>;
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value: string) => value ? new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "Not yet";

export function TradeHandoverCorrections({ user, workOrderId, assets }: { user: User; workOrderId: string; assets: Asset[] }) {
  const [result, setResult] = useState<Result>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [fieldKey, setFieldKey] = useState("brand");
  const [assetId, setAssetId] = useState(assets[0]?.id || "");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/trade-handover-corrections?workOrderId=${encodeURIComponent(workOrderId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as Result;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "The correction history could not be loaded.");
    setResult(payload);
  }, [user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "The correction history could not be loaded.")).finally(() => active && setLoading(false)));
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  const defaultValue = useMemo(() => {
    const asset = assets.find((item) => item.id === assetId) || assets[0];
    if (!asset) return "";
    const map: Record<string, string | number> = { brand: asset.brand, model_number: asset.modelNumber, serial_number: asset.serialNumber, quantity: asset.quantity, installed_at: asset.installedAt, warranty_provider: asset.warrantyProvider, warranty_reference: asset.warrantyReference, warranty_start: asset.warrantyStart, warranty_end: asset.warrantyEnd };
    return String(map[fieldKey] ?? "");
  }, [assetId, assets, fieldKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setStatus("Submitting a versioned correction for platform review...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-handover-corrections", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ workOrderId, assetId: form.get("assetId"), fieldKey: form.get("fieldKey"), proposedValue: form.get("proposedValue"), reason: form.get("reason") }) });
      const payload = await response.json().catch(() => ({})) as Result;
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "The correction could not be submitted.");
      setResult(payload); formElement.reset(); setFieldKey("brand"); setAssetId(assets[0]?.id || "");
      setStatus("Correction submitted. The previous approved value remains active until administrator approval.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The correction could not be submitted."); }
    finally { setBusy(false); }
  }

  return <section className="handover-corrections">
    <header><div><span>Versioned corrections</span><h4>Correct the published asset record without overwriting history</h4></div><small>Only the selected field is proposed. The approved value stays active until an administrator reviews the new version.</small></header>
    {loading ? <p>Loading correction history...</p> : <>
      <form onSubmit={submit}>
        <label><span>Installed asset</span><select name="assetId" required value={assetId} onChange={(event) => setAssetId(event.target.value)}>{assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.brand} {asset.modelNumber}{asset.serialNumber ? ` | ${asset.serialNumber}` : ""}</option>)}</select></label>
        <label><span>Field to correct</span><select name="fieldKey" value={fieldKey} onChange={(event) => setFieldKey(event.target.value)}>{fields.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>Current approved value</span><input value={defaultValue || "Not recorded"} disabled /></label>
        <label><span>Proposed value</span><input name="proposedValue" required={!["serial_number", "installed_at", "warranty_provider", "warranty_reference", "warranty_start", "warranty_end"].includes(fieldKey)} type={fieldKey === "quantity" ? "number" : dateFields.has(fieldKey) ? "date" : "text"} min={fieldKey === "quantity" ? 1 : undefined} max={fieldKey === "quantity" ? 9999 : undefined} maxLength={fieldKey === "quantity" ? undefined : 180} /></label>
        <label className="wide"><span>Reason for correction</span><textarea name="reason" required minLength={10} maxLength={600} rows={3} placeholder="Explain the source of the corrected value and why the published record needs updating." /></label>
        <button type="submit" disabled={busy || !assets.length}>{busy ? "Submitting..." : "Submit correction for review"}</button>
      </form>
      {(result.corrections || []).length ? <div className="handover-correction-list">{(result.corrections || []).map((correction) => <article key={correction.id} className={`status-${correction.status}`}><header><div><span>Version {correction.versionNumber}</span><strong>{correction.assetLabel}</strong></div><b>{readable(correction.status)}</b></header><dl><div><dt>Field</dt><dd>{correction.fieldLabel}</dd></div><div><dt>Approved value</dt><dd>{correction.previousValue || "Not recorded"}</dd></div><div><dt>Proposed value</dt><dd>{correction.proposedValue || "Not recorded"}</dd></div><div><dt>Submitted</dt><dd>{dateTime(correction.submittedAt)}</dd></div></dl><p>{correction.reason}</p>{correction.reviewNote && <small>Review note: {correction.reviewNote}</small>}</article>)}</div> : <p className="handover-empty">No published record corrections have been submitted.</p>}
    </>}
    {status && <p className="handover-inline-status" role="status">{status}</p>}
  </section>;
}
