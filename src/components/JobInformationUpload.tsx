"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { prepareCustomerPhotoUpload } from "@/lib/customer-photo-upload";
import type { PhotoRequirement } from "@/lib/trade-photo-requests";
import styles from "./JobInformationUpload.module.css";

type Upload = { id: string; requirementId: string; label: string; contentType: string; sizeBytes: number; createdAt: string };
type Result = {
  ok?: boolean;
  businessName?: string;
  job?: { workNumber: string; title: string; serviceCategory: string };
  request?: { revision: number; expiresAt: string; checklistVersion: string; requirements: PhotoRequirement[] };
  uploads?: Upload[];
  error?: string;
};

const sizeLabel = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function JobInformationUpload({ token }: { token: string }) {
  const [data, setData] = useState<Result>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<Record<string, File | undefined>>({});
  const [checks, setChecks] = useState({ clarity: false, relevance: false, privacy: false });
  const endpoint = `/api/job-information/${encodeURIComponent(token)}`;

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        const result = await response.json().catch(() => ({})) as Result;
        if (!response.ok || !result.ok) throw new Error(result.error || "This photo request could not be opened.");
        if (active) setData(result);
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : "This photo request could not be opened.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [endpoint]);

  const counts = useMemo(() => Object.fromEntries((data.uploads || []).map((item) => item.requirementId)
    .map((id) => [id, (data.uploads || []).filter((item) => item.requirementId === id).length])), [data.uploads]);
  const allConfirmed = checks.clarity && checks.relevance && checks.privacy;

  async function upload(requirement: PhotoRequirement) {
    const file = selected[requirement.id];
    if (!file || !data.request) return;
    setBusy(requirement.id); setStatus("Preparing and securely uploading your photo...");
    try {
      const safePhoto = await prepareCustomerPhotoUpload(file, requirement.id);
      const form = new FormData();
      form.set("requirementId", requirement.id);
      form.set("file", safePhoto);
      form.set("checklistVersion", data.request.checklistVersion);
      form.set("confirmClarity", String(checks.clarity));
      form.set("confirmRelevance", String(checks.relevance));
      form.set("confirmPrivacy", String(checks.privacy));
      const response = await fetch(endpoint, { method: "POST", body: form });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) throw new Error(result.error || "The photo could not be uploaded.");
      setData(result);
      setSelected((current) => ({ ...current, [requirement.id]: undefined }));
      setChecks({ clarity: false, relevance: false, privacy: false });
      setStatus(`${requirement.label} was added to the installer job.`);
    } catch (error) {
      setStatus(error instanceof Error && error.message === "PHOTO_CONVERSION_FAILED"
        ? "This phone photo could not be prepared. Choose another photo or take it again."
        : error instanceof Error ? error.message : "The photo could not be uploaded.");
    } finally { setBusy(""); }
  }

  async function remove(item: Upload) {
    setBusy(`remove:${item.id}`); setStatus("Removing the photo...");
    try {
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) throw new Error(result.error || "The photo could not be removed.");
      setData(result); setStatus("The photo was removed from the installer job.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The photo could not be removed."); }
    finally { setBusy(""); }
  }

  if (loading) return <main className={styles.shell}><section className={styles.state}><span>Secure photo request</span><h1>Opening your installer request</h1><p>Checking the private link...</p></section></main>;
  if (!data.ok || !data.request || !data.job) return <main className={styles.shell}><section className={styles.state}><span>Secure photo request</span><h1>This link cannot be used</h1><p>{status || data.error || "Ask the installer for a new link."}</p></section></main>;

  const required = data.request.requirements.filter((item) => item.required);
  const requiredComplete = required.filter((item) => Number(counts[item.id] || 0) > 0).length;
  return <main className={styles.shell}>
    <header className={styles.header}><Link href="/">TLink</Link><span>Private customer upload</span></header>
    <section className={styles.hero}>
      <span>Requested by {data.businessName || "your installer"}</span>
      <h1>Add photos to {data.job.workNumber}</h1>
      <p>{data.job.title}</p>
      <div><strong>{requiredComplete} of {required.length}</strong><span>required photo types supplied</span></div>
    </section>
    <section className={styles.privacy}>
      <strong>Your photos go only into this installer job</strong>
      <p>The link does not ask for your name, address or account. Remove people, documents, street numbers, number plates and unrelated belongings before sending.</p>
    </section>
    <section className={styles.review} aria-labelledby="photo-self-review">
      <div><span>Before each upload</span><h2 id="photo-self-review">Private photo self-review</h2><p>Confirm these three checks for the next photo you send.</p></div>
      <label><input type="checkbox" checked={checks.clarity} onChange={(event) => setChecks((current) => ({ ...current, clarity: event.target.checked }))} /><span><strong>Clear</strong>The requested equipment or area is visible and in focus.</span></label>
      <label><input type="checkbox" checked={checks.relevance} onChange={(event) => setChecks((current) => ({ ...current, relevance: event.target.checked }))} /><span><strong>Relevant</strong>The photo matches one request below and does not show unrelated rooms or belongings.</span></label>
      <label><input type="checkbox" checked={checks.privacy} onChange={(event) => setChecks((current) => ({ ...current, privacy: event.target.checked }))} /><span><strong>Privacy checked</strong>No people, personal documents, street numbers, number plates or private information are visible.</span></label>
    </section>
    <section className={styles.requirements} aria-label="Requested photos">
      {data.request.requirements.map((requirement, index) => {
        const requirementUploads = (data.uploads || []).filter((item) => item.requirementId === requirement.id);
        return <article key={requirement.id} className={styles.requirement}>
          <header><span>{String(index + 1).padStart(2, "0")}</span><div><small>{requirement.required ? "Required" : "Optional"}</small><h2>{requirement.label}</h2></div><strong>{requirementUploads.length} added</strong></header>
          <p>{requirement.guidance}</p>
          <div className={styles.examples}><span><b>Useful</b>{requirement.usefulExample}</span><span><b>Avoid</b>{requirement.avoidExample}</span></div>
          {requirementUploads.length > 0 && <ul className={styles.uploads}>{requirementUploads.map((item) => <li key={item.id}><span><strong>{item.label}</strong><small>{sizeLabel(item.sizeBytes)} | sent {new Date(item.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</small></span><button type="button" disabled={busy === `remove:${item.id}`} onClick={() => void remove(item)}>{busy === `remove:${item.id}` ? "Removing..." : "Remove"}</button></li>)}</ul>}
          <div className={styles.capture}>
            <label><span>{selected[requirement.id] ? "Choose a different photo" : "Choose or take a photo"}</span><input type="file" accept="image/*" capture="environment" onChange={(event) => setSelected((current) => ({ ...current, [requirement.id]: event.target.files?.[0] }))} /></label>
            {selected[requirement.id] && <small>{selected[requirement.id]?.name} | {sizeLabel(selected[requirement.id]?.size || 0)}</small>}
            <button type="button" disabled={!selected[requirement.id] || !allConfirmed || Boolean(busy)} onClick={() => void upload(requirement)}>{busy === requirement.id ? "Uploading..." : "Add to installer job"}</button>
          </div>
        </article>;
      })}
    </section>
    {status && <p className={styles.status} role="status">{status}</p>}
    <footer className={styles.footer}><span>Secure link expires {new Date(data.request.expiresAt).toLocaleDateString("en-AU", { dateStyle: "long" })}</span><a href="/privacy">Privacy</a></footer>
  </main>;
}
