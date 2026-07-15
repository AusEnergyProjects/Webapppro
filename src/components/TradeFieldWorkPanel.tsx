"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type TimeEntry = { id: string; staffLabel: string; workDate: string; durationMinutes: number; notes: string; createdAt: string };
type Media = { id: string; category: string; fileName: string; contentType: string; sizeBytes: number; caption: string; createdAt: string };
type Signoff = { id: string; signerRole: string; signerName: string; confirmationText: string; method: string; signedAt: string };
type Result = { ok?: boolean; protectedJob?: boolean; timeEntries?: TimeEntry[]; media?: Media[]; signoffs?: Signoff[]; error?: string };

const day = () => new Date().toISOString().slice(0, 10);
const timeLabel = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ""}`.trim() : `${minutes}m`;

export function TradeFieldWorkPanel({ user, workOrderId, isProtected }: { user: User; workOrderId: string; isProtected: boolean }) {
  const [data, setData] = useState<Result>({ protectedJob: isProtected, timeEntries: [], media: [], signoffs: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const token = await user.getIdToken();
    const response = await fetch(`/api/trade-field-work?workOrderId=${encodeURIComponent(workOrderId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok) throw new Error(result.error || "Field records could not be loaded.");
    setData(result);
  }, [user, workOrderId]);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((error) => active && setStatus(error instanceof Error ? error.message : "Field records could not be loaded."))
        .finally(() => active && setLoading(false));
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [load]);

  const totalMinutes = useMemo(() => (data.timeEntries || []).reduce((sum, item) => sum + item.durationMinutes, 0), [data.timeEntries]);

  async function jsonAction(event: FormEvent<HTMLFormElement>, action: string, success: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setBusy(action); setStatus("Saving the field record...");
    try {
      const token = await user.getIdToken();
      const body: Record<string, unknown> = { action, workOrderId, ...values };
      if (action === "add_time") body.durationMinutes = Number(values.durationMinutes);
      if (action === "add_signoff") body.confirmed = values.confirmed === "yes";
      const response = await fetch("/api/trade-field-work", { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(result.error || "The field record could not be saved.");
      setData(result); form.reset(); setStatus(success);
    } catch (error) { setStatus(error instanceof Error ? error.message : "The field record could not be saved."); }
    finally { setBusy(""); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    values.set("workOrderId", workOrderId); setBusy("upload"); setStatus("Uploading the private job file...");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/trade-field-work", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: values });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(result.error || "The job file could not be uploaded.");
      setData(result); form.reset(); setStatus("Job photo or document added.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The job file could not be uploaded."); }
    finally { setBusy(""); }
  }

  async function download(id: string, fileName: string) {
    setBusy(`download:${id}`); setStatus(`Opening ${fileName}...`);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/trade-field-work?download=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const result = await response.json().catch(() => ({})) as Result; throw new Error(result.error || "The file could not be opened."); }
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url); setStatus("File ready.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The file could not be opened."); }
    finally { setBusy(""); }
  }

  if (loading) return <div className="crm-empty"><strong>Opening field tools</strong><span>Loading time, files and sign-offs...</span></div>;

  return <div className="crm-field-work">
    <div className={`crm-field-privacy ${isProtected ? "protected" : "owned"}`}>
      <strong>{isProtected ? "AEA protected field record" : "Direct customer field record"}</strong>
      <span>{isProtected ? "Record work, time and site evidence without names, contact details or a precise address. Customer sign-off stays with AEA." : "This job belongs to your business, so the customer may complete a recorded sign-off."}</span>
    </div>
    <section className="crm-field-summary"><article><span>Time recorded</span><strong>{timeLabel(totalMinutes)}</strong></article><article><span>Job files</span><strong>{(data.media || []).length}</strong></article><article><span>Sign-offs</span><strong>{(data.signoffs || []).length}</strong></article></section>
    <div className="crm-field-grid">
      <section className="crm-field-card"><header><div><span>Technician time</span><h4>Log work completed</h4></div></header>
        <form className="crm-field-form" onSubmit={(event) => void jsonAction(event, "add_time", "Technician time added.")}>
          <label><span>Work date</span><input type="date" name="workDate" required defaultValue={day()} /></label>
          <label><span>Minutes worked</span><input type="number" name="durationMinutes" min="1" max="1440" required placeholder="90" /></label>
          <label className="wide"><span>Team member</span><input name="staffLabel" maxLength={80} placeholder="Name or crew" /></label>
          <label className="wide"><span>Work note</span><textarea name="notes" rows={2} maxLength={500} placeholder="What was completed" /></label>
          <button disabled={busy === "add_time"}>{busy === "add_time" ? "Saving..." : "Add time"}</button>
        </form>
        {(data.timeEntries || []).length > 0 && <ol className="crm-field-records">{(data.timeEntries || []).slice(0, 8).map((entry) => <li key={entry.id}><div><strong>{timeLabel(entry.durationMinutes)} | {entry.staffLabel || "Team"}</strong><span>{new Date(`${entry.workDate}T00:00:00`).toLocaleDateString("en-AU", { dateStyle: "medium" })}</span>{entry.notes && <p>{entry.notes}</p>}</div></li>)}</ol>}
      </section>
      <section className="crm-field-card"><header><div><span>Photos and files</span><h4>Keep site evidence together</h4></div></header>
        <form className="crm-field-form" onSubmit={(event) => void upload(event)}>
          <label><span>Type</span><select name="category"><option value="before">Before work</option><option value="progress">Work in progress</option><option value="after">Completed work</option><option value="document">Document</option></select></label>
          <label><span>Photo or PDF</span><input type="file" name="file" required accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
          <label className="wide"><span>Caption</span><input name="caption" maxLength={300} placeholder="Switchboard before upgrade" /></label>
          <button disabled={busy === "upload"}>{busy === "upload" ? "Uploading..." : "Add file"}</button>
        </form>
        {(data.media || []).length > 0 && <ol className="crm-field-records">{(data.media || []).map((item) => <li key={item.id}><div><strong>{item.caption || item.fileName}</strong><span>{item.category.replaceAll("_", " ")} | {Math.max(1, Math.round(item.sizeBytes / 1024))} KB</span></div><button type="button" disabled={busy === `download:${item.id}`} onClick={() => void download(item.id, item.fileName)}>Open</button></li>)}</ol>}
      </section>
      <section className="crm-field-card wide"><header><div><span>Digital sign-off</span><h4>Create a timestamped acknowledgement</h4><p>This is an operational record. Your business remains responsible for deciding when a formal contract or regulated certificate is required.</p></div></header>
        <form className="crm-field-form signoff" onSubmit={(event) => void jsonAction(event, "add_signoff", "Digital sign-off recorded.")}>
          <label><span>Signer</span><select name="signerRole"><option value="technician">Technician</option>{!isProtected && <option value="customer">Direct customer</option>}</select></label>
          <label><span>Full name</span><input name="signerName" required maxLength={100} /></label>
          <label className="wide confirm"><input type="checkbox" name="confirmed" value="yes" required /><span>I confirm this record is accurate and I am authorised to sign it.</span></label>
          <button disabled={busy === "add_signoff"}>{busy === "add_signoff" ? "Recording..." : "Record sign-off"}</button>
        </form>
        {(data.signoffs || []).length > 0 && <ol className="crm-field-records signoffs">{(data.signoffs || []).map((item) => <li key={item.id}><div><strong>{item.signerName}</strong><span>{item.signerRole} | {new Date(item.signedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span><p>{item.confirmationText}</p></div></li>)}</ol>}
      </section>
    </div>
    {status && <p className="crm-inline-status" role="status">{status}</p>}
  </div>;
}
