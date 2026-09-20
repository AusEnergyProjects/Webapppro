"use client";

import { useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import styles from "./AdminDemoCleanupPanel.module.css";

type Preview = { digest: string; total: number; groups: { key: string; label: string; count: number; records: { id: string; status: string; updatedAt: string }[] }[] };
type Receipt = { id: string; completed: boolean; archivedPilotIds: string[]; applied: Record<string, number>; remaining: Record<string, number> | null; error: string; historicalRecordsDeleted: false };

export default function AdminDemoCleanupPanel({ user }: { user: User }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");

  async function request(body?: object) {
    const token = await user.getIdToken();
    const response = await fetch("/api/admin/demo-cleanup", { method: body ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json() as { ok: boolean; error?: string; preview?: Preview; receipt?: Receipt };
    if (!response.ok || !value.ok) throw new Error(value.error || "Demo archival could not be confirmed. Refresh the preview before continuing.");
    return value;
  }

  async function inspect() {
    if (busy) return;
    setBusy(true); setError(""); setConfirmation("");
    try { const result = await request(); setPreview(result.preview || null); }
    catch (failure) { setPreview(null); setError(failure instanceof Error ? failure.message : "The preview could not be loaded."); }
    finally { setBusy(false); }
  }

  async function archive(event: FormEvent) {
    event.preventDefault();
    if (busy || !preview || confirmation !== "ARCHIVE DEMO DATA") return;
    setBusy(true); setError(""); setReceipt(null);
    try { const result = await request({ digest: preview.digest, confirmation }); setReceipt(result.receipt || null); setPreview(result.preview || null); }
    catch (failure) { setPreview(null); setError(failure instanceof Error ? failure.message : "The result is unconfirmed. Refresh the preview before continuing."); }
    finally { setBusy(false); setConfirmation(""); }
  }

  return <section className={styles.panel} aria-labelledby="admin-demo-cleanup-title">
    <div className={styles.heading}><h2 id="admin-demo-cleanup-title">Archive demo data</h2><span>Owner only</span></div>
    <p>Close explicitly marked demo customer and trade accounts, archive demo products and deactivate their open opportunities. Synthetic VEU pilots are archived first. Audit, financial and source history is retained.</p>
    <p className={styles.muted}>This uses the stored synthetic flag. Names containing “test” or “demo” are not enough. Creditex administrator access is also required for its pilot. Sign in again if your session is more than two hours old.</p>
    <button type="button" disabled={busy} onClick={() => void inspect()}>{busy ? "Working…" : "Preview demo records"}</button>
    {preview && <>
      <div className={styles.counts}>{preview.groups.map(group => <div key={group.key}><strong>{group.count}</strong><span>{group.label}</span></div>)}</div>
      {preview.total > 0 ? <>
        <details><summary>Review exact records and current status</summary><div className={styles.records}>{preview.groups.filter(group => group.count > 0).map(group => <section key={group.key}><h3>{group.label}</h3><ul>{group.records.map(record => <li key={record.id}><code>{record.id}</code><span>{record.status}</span></li>)}</ul></section>)}</div></details>
        <form onSubmit={(event) => void archive(event)} className={styles.confirmation}><label>Type ARCHIVE DEMO DATA to apply this preview<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></label><button type="submit" disabled={busy || confirmation !== "ARCHIVE DEMO DATA"}>Archive reviewed demo data</button></form>
      </> : <p role="status">No active records remain in this demo archival scope.</p>}
    </>}
    {receipt && <div className={styles.receipt} role="status"><strong>{receipt.completed ? "Demo archival completed" : "Demo archival needs follow-up"}</strong><p>Receipt: <code>{receipt.id}</code></p><p>{receipt.archivedPilotIds.length} pilot run(s) archived. {Object.values(receipt.applied).reduce((sum, count) => sum + count, 0)} additional record(s) updated. Historical records were retained.</p>{receipt.error && <p>{receipt.error}</p>}</div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
