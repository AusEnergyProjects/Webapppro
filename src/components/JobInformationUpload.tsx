"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { prepareCustomerPhotoUpload } from "@/lib/customer-photo-upload";
import type { PhotoRequirementReview } from "@/lib/photo-request-review";
import type { PhotoRequirement } from "@/lib/trade-photo-requests";
import styles from "./JobInformationUpload.module.css";

type Upload = { id: string; requirementId: string; label: string; contentType: string; sizeBytes: number; createdAt: string };
type StagedPhoto = { id: string; file: File; originalName: string };
type Result = {
  ok?: boolean;
  businessName?: string;
  job?: { workNumber: string; title: string; serviceCategory: string };
  appointment?: null | { startsAt: string; endsAt: string; timeZone: string; googleCalendarUrl: string };
  request?: { revision: number; expiresAt: string; checklistVersion: string; requirements: PhotoRequirement[];
    completion: null | { revision: number; completedAt: string; current: boolean }; reviews: PhotoRequirementReview[];
    outstandingRequirementIds: string[]; proofReady: boolean };
  uploads?: Upload[];
  missingRequirements?: string[];
  error?: string;
};

const sizeLabel = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

function appointmentLabel(startsAt: string, endsAt: string) {
  const start = new Date(`${startsAt}:00Z`);
  const end = new Date(`${endsAt}:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const date = start.toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const startTime = start.toLocaleTimeString("en-AU", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("en-AU", { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
  return `${date}, ${startTime} to ${endTime}`;
}

export function JobInformationUpload({ token }: { token: string }) {
  const [data, setData] = useState<Result>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [staged, setStaged] = useState<Record<string, StagedPhoto[]>>({});
  const [checks, setChecks] = useState({ clarity: false, relevance: false, privacy: false });
  const [completionConfirmed, setCompletionConfirmed] = useState(false);
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
  const stagedTotal = Object.values(staged).reduce((total, items) => total + items.length, 0);
  const allConfirmed = checks.clarity && checks.relevance && checks.privacy;

  async function stagePhotos(requirement: PhotoRequirement, files: File[]) {
    const used = Number(counts[requirement.id] || 0) + (staged[requirement.id]?.length || 0);
    const remaining = Math.max(0, 3 - used);
    if (!remaining) { setStatus(`${requirement.label} already has its maximum of 3 photos.`); return; }
    const nextFiles = files.slice(0, remaining);
    if (!nextFiles.length) return;
    setBusy(`prepare:${requirement.id}`);
    setStatus(`Preparing ${nextFiles.length === 1 ? "the photo" : `${nextFiles.length} photos`} for secure upload...`);
    try {
      const prepared: StagedPhoto[] = [];
      for (const file of nextFiles) {
        const safePhoto = await prepareCustomerPhotoUpload(file, requirement.id);
        prepared.push({ id: crypto.randomUUID(), file: safePhoto, originalName: file.name });
      }
      setStaged((current) => ({ ...current, [requirement.id]: [...(current[requirement.id] || []), ...prepared] }));
      setStatus(`${prepared.length} ${prepared.length === 1 ? "photo is" : "photos are"} ready. Continue through the request, then send the whole set once.`);
    } catch (error) {
      setStatus(error instanceof Error && error.message === "PHOTO_TOO_LARGE"
        ? "This phone photo stayed too large after preparation. Choose another photo or use a lower camera resolution."
        : "This phone photo could not be prepared. Choose another photo or take it again.");
    } finally { setBusy(""); }
  }

  function removeStaged(requirementId: string, photoId: string) {
    setStaged((current) => ({ ...current, [requirementId]: (current[requirementId] || []).filter((item) => item.id !== photoId) }));
  }

  async function uploadPrepared(requirement: PhotoRequirement, photo: StagedPhoto) {
    if (!data.request) throw new Error("This photo request could not be opened.");
    const form = new FormData();
    form.set("requirementId", requirement.id);
    form.set("file", photo.file);
    form.set("checklistVersion", data.request.checklistVersion);
    form.set("confirmClarity", String(checks.clarity));
    form.set("confirmRelevance", String(checks.relevance));
    form.set("confirmPrivacy", String(checks.privacy));
    const response = await fetch(endpoint, { method: "POST", body: form });
    const result = await response.json().catch(() => ({})) as Result;
    if (!response.ok || !result.ok) throw new Error(response.status === 413
      ? "The prepared photo was still too large for the secure upload. Choose it again or take another photo."
      : result.error || "The photo could not be uploaded.");
    setData(result);
    setStaged((current) => ({ ...current, [requirement.id]: (current[requirement.id] || []).filter((item) => item.id !== photo.id) }));
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

  async function finish() {
    if (!data.request || !completionConfirmed) return;
    if (stagedTotal && !allConfirmed) { setStatus("Complete the clear, relevant and privacy checks before sending these photos."); return; }
    const queue = data.request.requirements.flatMap((requirement) => (staged[requirement.id] || []).map((photo) => ({ requirement, photo })));
    try {
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        setBusy(`upload:${item.photo.id}`);
        setStatus(`Securely uploading photo ${index + 1} of ${queue.length}...`);
        await uploadPrepared(item.requirement, item.photo);
      }
      setBusy("complete"); setStatus("Checking the required photos...");
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete_request", checklistVersion: data.request.checklistVersion, confirmed: true }) });
      const result = await response.json().catch(() => ({})) as Result;
      if (!response.ok || !result.ok) throw new Error(result.missingRequirements?.length
        ? `Still needed: ${result.missingRequirements.join(", ")}.` : result.error || "The request could not be finished.");
      setData(result); setCompletionConfirmed(false); setStatus("Your photos were uploaded and are ready for installer review.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The photos could not be uploaded.");
    } finally { setBusy(""); }
  }

  if (loading) return <main className={styles.shell}><section className={styles.state}><span>Secure photo request</span><h1>Opening your installer request</h1><p>Checking the private link...</p></section></main>;
  if (!data.ok || !data.request || !data.job) return <main className={styles.shell}><section className={styles.state}><span>Secure photo request</span><h1>This link cannot be used</h1><p>{status || data.error || "Ask the installer for a new link."}</p></section></main>;

  const required = data.request.requirements.filter((item) => item.required);
  const suppliedCount = (requirementId: string) => Number(counts[requirementId] || 0) + (staged[requirementId]?.length || 0);
  const requiredComplete = required.filter((item) => suppliedCount(item.id) > 0).length;
  const outstandingIds = new Set([...data.request.outstandingRequirementIds,
    ...required.filter((item) => suppliedCount(item.id) === 0).map((item) => item.id)]);
  const outstandingCount = Array.from(outstandingIds).filter((id) => !(staged[id]?.length)).length;
  const reviewChecksOutstanding = stagedTotal > 0 && !allConfirmed;
  const currentCompletion = data.request.completion?.current && stagedTotal === 0;
  return <main className={styles.shell}>
    <header className={styles.header}><Link href="/">TLink</Link><span>Private customer upload</span></header>
    <section className={styles.hero}>
      <span>Requested by {data.businessName || "your installer"}</span>
      <h1>Add photos to {data.job.workNumber}</h1>
      <p>{data.job.title}</p>
      <div><strong>{requiredComplete} of {required.length}</strong><span>required photo types ready</span></div>
    </section>
    {data.appointment && <section className={styles.appointment}>
      <div><span>Appointment</span><h2>{appointmentLabel(data.appointment.startsAt, data.appointment.endsAt)}</h2><p>The calendar entry contains the installer and job reference, not your address.</p></div>
      <a href={data.appointment.googleCalendarUrl} target="_blank" rel="noreferrer">Add to Google Calendar</a>
    </section>}
    <section className={styles.privacy}>
      <strong>Your photos go only into this installer job</strong>
      <p>The link does not ask for your name, address or account. Remove people, documents, street numbers, number plates and unrelated belongings before sending.</p>
    </section>
    <section className={styles.review} aria-labelledby="photo-self-review">
      <div><span>Before sending</span><h2 id="photo-self-review">Private photo self-review</h2><p>Confirm these checks once for the photos you are about to send.</p></div>
      <label><input type="checkbox" checked={checks.clarity} onChange={(event) => setChecks((current) => ({ ...current, clarity: event.target.checked }))} /><span><strong>Clear</strong>The requested equipment or area is visible and in focus.</span></label>
      <label><input type="checkbox" checked={checks.relevance} onChange={(event) => setChecks((current) => ({ ...current, relevance: event.target.checked }))} /><span><strong>Relevant</strong>Each photo matches one request below and does not show unrelated rooms or belongings.</span></label>
      <label><input type="checkbox" checked={checks.privacy} onChange={(event) => setChecks((current) => ({ ...current, privacy: event.target.checked }))} /><span><strong>Privacy checked</strong>No people, personal documents, street numbers, number plates or private information are visible.</span></label>
    </section>
    <section className={styles.requirements} aria-label="Requested photos">
      {data.request.requirements.map((requirement, index) => {
        const requirementUploads = (data.uploads || []).filter((item) => item.requirementId === requirement.id);
        const requirementStaged = staged[requirement.id] || [];
        const total = requirementUploads.length + requirementStaged.length;
        const review = data.request?.reviews.find((item) => item.requirementId === requirement.id);
        return <article key={requirement.id} className={styles.requirement}>
          <header><span>{String(index + 1).padStart(2, "0")}</span><div><small>{requirement.required ? "Required" : "Optional"}</small><h2>{requirement.label}</h2></div><strong>{total} of 3 ready</strong></header>
          <p>{requirement.guidance}</p>
          {review?.status === "retake_requested" && <div className={styles.retake}><strong>{review.retakeAnswered ? "Replacement received" : "Retake requested"}</strong><span>{review.guidance}</span><small>{review.retakeAnswered ? "Finish the request again when every outstanding item is ready." : "Your original photo remains in the installer job. Add a new photo below."}</small></div>}
          {(review?.status === "accepted" || review?.status === "not_needed") && <div className={styles.reviewed}><strong>{review.status === "accepted" ? "Accepted by installer" : "No longer needed"}</strong><span>The original job evidence remains in the review history.</span></div>}
          <div className={styles.examples}><span><b>Useful</b>{requirement.usefulExample}</span><span><b>Avoid</b>{requirement.avoidExample}</span></div>
          {requirementUploads.length > 0 && <ul className={styles.uploads}>{requirementUploads.map((item) => <li key={item.id}><span><strong>{item.label}</strong><small>{sizeLabel(item.sizeBytes)} | uploaded {new Date(item.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</small></span><button type="button" disabled={busy === `remove:${item.id}`} onClick={() => void remove(item)}>{busy === `remove:${item.id}` ? "Removing..." : "Remove"}</button></li>)}</ul>}
          {requirementStaged.length > 0 && <ul className={`${styles.uploads} ${styles.pending}`}>{requirementStaged.map((item) => <li key={item.id}><span><strong>{item.originalName}</strong><small>{sizeLabel(item.file.size)} | ready to upload</small></span><button type="button" disabled={Boolean(busy)} onClick={() => removeStaged(requirement.id, item.id)}>Remove</button></li>)}</ul>}
          <div className={styles.capture}>
            {total < 3 ? <label><span>{total ? "Add another photo" : "Choose or take photos"}</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={Boolean(busy)} onChange={(event) => {
              const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; void stagePhotos(requirement, files);
            }} /></label> : <strong className={styles.limit}>3 photos ready for this section</strong>}
            <small>Choose up to 3 photos or image files for this section. They upload together when you finish.</small>
          </div>
        </article>;
      })}
    </section>
    <section className={styles.completion} aria-labelledby="photo-request-completion">
      <div><span>Finish this request</span><h2 id="photo-request-completion">Upload the set for installer review</h2><p>{currentCompletion
        ? `Submitted on ${new Date(data.request.completion?.completedAt || "").toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}. Additions or retake requests will reopen completion.`
        : reviewChecksOutstanding ? "Complete the clear, relevant and privacy checks above before sending the selected photos."
          : outstandingCount ? `${outstandingCount} requested section${outstandingCount === 1 ? " is" : "s are"} still outstanding.`
          : stagedTotal ? `${stagedTotal} selected ${stagedTotal === 1 ? "photo is" : "photos are"} ready to upload together.`
            : "Every required photo is uploaded. Confirm the set is ready."}</p></div>
      {!currentCompletion && <><label><input type="checkbox" checked={completionConfirmed} onChange={(event) => setCompletionConfirmed(event.target.checked)} /><span>I confirm the selected and uploaded photos are ready for the installer to review.</span></label><button type="button" disabled={reviewChecksOutstanding || outstandingCount > 0 || !completionConfirmed || Boolean(busy)} onClick={() => void finish()}>{busy ? "Uploading and checking..." : stagedTotal ? "Upload photos and notify installer" : "Finish and notify installer"}</button></>}
      {currentCompletion && <strong className={styles.complete}>Ready for installer review</strong>}
    </section>
    {status && <p className={styles.status} role="status">{status}</p>}
    <footer className={styles.footer}><span>Secure link expires {new Date(data.request.expiresAt).toLocaleDateString("en-AU", { dateStyle: "long" })}</span><a href="/privacy">Privacy</a></footer>
  </main>;
}
