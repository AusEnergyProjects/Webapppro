"use client";

import { useCallback, useEffect, useState } from "react";
import { customerJobNextStep, type CustomerJobJourney } from "@/lib/customer-job-journey";
import { QuoteLinkReview } from "./QuoteLinkReview";
import { JobInformationUpload } from "./JobInformationUpload";
import styles from "./CustomerJobWorkspace.module.css";

type View = "overview" | "document" | "photos";
type Result = { ok?: boolean; journey?: CustomerJobJourney; error?: string };

/** A token change remounts every private view, including unsaved input. */
export function CustomerJobWorkspace({ token }: { token: string }) {
  return <Workspace key={token} token={token} />;
}

function Workspace({ token }: { token: string }) {
  const [journey, setJourney] = useState<CustomerJobJourney | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<View>("overview");
  const [opened, setOpened] = useState({ document: false, photos: false });
  const [recordFallback, setRecordFallback] = useState(false);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const endpoint = `/api/quote-review/${encodeURIComponent(token)}/job`;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as Result;
        if (!response.ok || !result.ok || !result.journey) throw new Error(result.error || "Job updates could not be opened.");
        if (active) {
          setJourney(result.journey); setError("");
          if (!result.journey.current?.photos) setView(current => current === "photos" ? "overview" : current);
        }
      } catch (failure) {
        if (active) {
          setJourney(null);
          setError(controller.signal.aborted ? "Job updates took too long to load. Please try again." : failure instanceof Error ? failure.message : "Job updates could not be opened.");
        }
      } finally { window.clearTimeout(timeout); if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [endpoint, revision]);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  function open(next: View) {
    setView(next);
    if (next !== "overview") setOpened(current => ({ ...current, [next]: true }));
  }

  if (!journey) return <main id="site-content" className={styles.shell}>
    <div className={styles.container}>
      <div className={styles.brand}><strong>TLink<span>●</span></strong><span>Secure customer link</span></div>
      <section className={styles.state} aria-busy={loading}>
        <h1>{loading ? "Opening your job" : "Job updates are unavailable"}</h1>
        <p role={error ? "alert" : undefined}>{loading ? "Checking your secure link…" : error}</p>
        {!loading && <div className={styles.actions}><button type="button" onClick={refresh}>Try again</button><button type="button" className={styles.secondary} onClick={() => setRecordFallback(true)}>Open quote record</button></div>}
      </section>
      {recordFallback && <div className={styles.embedded}><QuoteLinkReview token={token} embedded /></div>}
    </div>
  </main>;

  const next = customerJobNextStep(journey);
  const photos = journey.current?.photos;
  const appointment = journey.current?.appointment;
  const documentLabel = journey.decision === "active" ? "Quote" : journey.decision === "declined" ? "Decision" : "Quote & invoice";
  return <main id="site-content" className={styles.shell}>
    <div className={styles.container}>
      <div className={styles.brand}><strong>TLink<span>●</span></strong><span>Secure customer link</span></div>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>{journey.businessName}</span><h1>{journey.title}</h1><p>{journey.workNumber}</p></div>
        <button className={styles.refresh} type="button" onClick={refresh} disabled={loading}>{loading ? "Updating…" : "Refresh"}</button>
      </header>
      <nav className={styles.nav} aria-label="Your job">
        <button type="button" aria-current={view === "overview" ? "page" : undefined} onClick={() => open("overview")}>Overview</button>
        <button type="button" aria-current={view === "document" ? "page" : undefined} onClick={() => open("document")}>{documentLabel}</button>
        {photos && <button type="button" aria-current={view === "photos" ? "page" : undefined} onClick={() => open("photos")}>Photos{photos.status === "needed" && <span className={styles.actionDot} aria-label="Action needed" />}</button>}
      </nav>
      <section hidden={view !== "overview"} className={styles.overview} aria-label="Job overview">
        <div className={styles.next}>
          <span className={styles.eyebrow}>{next.action ? "Next step" : "You’re up to date"}</span>
          <h2>{next.title}</h2><p>{next.detail}</p>
          {next.action && <button type="button" onClick={() => { if (next.action) open(next.action); }}>{next.label}</button>}
        </div>
        <div className={styles.cards}>
          {appointment && <section className={styles.card} aria-label="Appointment">
            <span className={styles.eyebrow}>Appointment</span><h2>{appointment.label}</h2><p>Local time at the job location</p>
            <a href={appointment.googleCalendarUrl} target="_blank" rel="noreferrer">Add to calendar</a>
          </section>}
          <section className={styles.card} aria-label="Your documents">
            <span className={styles.eyebrow}>Your record</span><h2>{journey.decision === "active" ? "Scope, price and questions" : "Your saved decision"}</h2>
            <p>{journey.decision === "active" ? "Review the details or ask the business a question." : "Open the signed record and available invoice details."}</p>
            <button type="button" onClick={() => open("document")}>{journey.decision === "active" ? "Open quote" : "Open record"}</button>
          </section>
          {photos && <section className={styles.card} aria-label="Requested photos">
            <span className={styles.eyebrow}>Requested photos</span><h2>{photos.status === "reviewed" ? "Photos reviewed" : photos.status === "submitted" ? "Photos received" : "Photos to add"}</h2>
            <p>{photos.status === "reviewed" ? "The business has reviewed your photos." : photos.status === "submitted" ? "Your photos are ready for the business to review." : "Only the requested photos are needed. Your details are already saved."}</p>
            <button type="button" onClick={() => open("photos")}>{photos.status === "needed" ? "Add photos" : "View request"}</button>
          </section>}
        </div>
      </section>
      <div hidden={view !== "document"} className={styles.embedded}>
        {opened.document && <QuoteLinkReview token={token} embedded refreshVersion={revision} onDecisionRecorded={refresh} />}
      </div>
      <div hidden={view !== "photos" || !photos} className={styles.embedded}>
        {opened.photos && photos && <JobInformationUpload token={token} endpoint={`${endpoint}/photos`} embedded refreshVersion={revision} onCompleted={refresh} />}
      </div>
      <footer className={styles.footer}><span>Private link · expires {new Date(journey.expiresAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</span><a href="/privacy">Privacy</a></footer>
    </div>
  </main>;
}
