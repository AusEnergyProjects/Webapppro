"use client";

import { useState } from "react";
import { gemsCountReview, gemsReviewWasPublished } from "@/lib/creditex-gems-count-review";
import styles from "./CreditexCompliancePortal.module.css";

type Api = (
  path: string, init?: RequestInit, options?: { requestTimeoutMs?: number },
) => Promise<Record<string, unknown>>;

const endpoint = "/api/creditex/official-products";

export function CreditexGemsCountReview({ api }: { api: Api }) {
  const [review, setReview] = useState<ReturnType<typeof gemsCountReview>>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function loadReview() {
    setBusy(true);
    setReview(null);
    setNote("");
    try {
      const result = await api(endpoint);
      const next = gemsCountReview(result.registries);
      setReview(next);
      setNotice(next ? "" : "The GEMS registry status could not be verified.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The GEMS registry status could not be retrieved.");
    } finally {
      setBusy(false);
    }
  }

  const reviewNote = note.trim().replace(/\s+/g, " ");
  async function submitReview() {
    if (busy || !review?.sources.length || reviewNote.length < 20 || reviewNote.length > 1000) return;
    setBusy(true);
    setNotice("Rechecking the official files and applying your review…");
    try {
      const response = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({
          action: "refresh-reviewed-decrease", registryCode: "gems-products",
          reviewNote, sources: review.sources,
        }),
      }, { requestTimeoutMs: 120_000 });
      const published = gemsReviewWasPublished(response);
      setNotice(published
        ? `GEMS review recorded. The current snapshot contains ${published.recordCount.toLocaleString("en-AU")} records.`
        : "Publication could not be verified. Check the latest registry status before submitting another review.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The request did not complete.";
      setNotice(`${reason} Check the latest registry status before submitting another review.`);
    } finally {
      setReview(null);
      setNote("");
      setBusy(false);
    }
  }

  return (
    <details className={styles.supportingTools}>
      <summary>Review GEMS product counts</summary>
      <div>
        <button className={styles.secondaryButton} type="button" disabled={busy} onClick={loadReview}>
          Check latest GEMS status
        </button>
        {review && <>
          <p>Registry status: {review.status}. Accepted snapshot: {review.recordCount.toLocaleString("en-AU")} records.</p>
          {review.attemptAt && <p>Last refresh attempt: {new Date(review.attemptAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} (Sydney).</p>}
          {review.sources.length > 0 ? <>
            <p>Compare each decrease with the <a href="https://reg.energyrating.gov.au/comparator/" target="_blank" rel="noreferrer">official GEMS register</a> before approving it.</p>
            <table>
              <caption>Sources with fewer records</caption>
              <thead><tr><th scope="col">Source</th><th scope="col">Previously accepted</th><th scope="col">Official import</th></tr></thead>
              <tbody>{review.sources.map(source => <tr key={source.sourceKey}>
                <th scope="row">{source.sourceKey.replace(/^gems-/, "").replaceAll("-", " ")}</th>
                <td>{source.previousRecordCount.toLocaleString("en-AU")}</td>
                <td>{source.acceptedRecordCount.toLocaleString("en-AU")}</td>
              </tr>)}</tbody>
            </table>
            <p><label>Reason for accepting these decreases (20 to 1,000 characters)
              <textarea className={styles.textarea} value={note} maxLength={1000} disabled={busy}
                onChange={event => setNote(event.target.value)} />
            </label></p>
            <button className={styles.button} type="button" disabled={busy || reviewNote.length < 20}
              onClick={submitReview}>Approve these decreases and refresh GEMS</button>
          </> : <p>{review.message || "The latest refresh has no count decreases awaiting approval."}</p>}
        </>}
        <p role="status">{notice}</p>
      </div>
    </details>
  );
}
