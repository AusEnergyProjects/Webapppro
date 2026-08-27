"use client";

import { useCallback, useEffect, useState } from "react";

type ReviewStatus = "pending" | "reviewed" | "dismissed";

type AnswerReview = {
  id: string;
  answerId: string;
  question: string;
  answer: string;
  status: ReviewStatus;
  reviewerUid: string;
  reviewNote: string;
  createdAt: string;
  updatedAt: string;
};

type ApiResult = { reviews?: AnswerReview[]; review?: AnswerReview } & Record<string, unknown>;
type Api = (path: string, init?: RequestInit) => Promise<ApiResult>;

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export function AdminSurgeAnswerReviews({
  api,
  setStatus,
}: {
  api: Api;
  setStatus: (value: string) => void;
}) {
  const [filter, setFilter] = useState<ReviewStatus>("pending");
  const [reviews, setReviews] = useState<AnswerReview[]>([]);
  const [busyId, setBusyId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const result = await api(`/api/admin/energy-assistant-reviews?status=${filter}`);
    return result.reviews || [];
  }, [api, filter]);

  useEffect(() => {
    let active = true;
    void load()
      .then((nextReviews) => {
        if (active) setReviews(nextReviews);
      })
      .catch((error) => {
        if (active) setStatus(error instanceof Error ? error.message : "Surge answer reviews could not be loaded.");
      });
    return () => { active = false; };
  }, [load, setStatus]);

  const refresh = async () => {
    try {
      setReviews(await load());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Surge answer reviews could not be loaded.");
    }
  };

  const update = async (review: AnswerReview, status: "reviewed" | "dismissed") => {
    setBusyId(review.id);
    setStatus("");
    try {
      await api("/api/admin/energy-assistant-reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: review.id, status, reviewNote: notes[review.id] || "" }),
      });
      setReviews((current) => current.filter((item) => item.id !== review.id));
      setStatus(`Surge answer marked ${status}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The Surge answer review could not be updated.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="admin-surge-reviews">
      <header className="admin-page-heading">
        <span>Surge quality</span>
        <h1>Answers sent for review</h1>
        <p>Each item contains only the question and the single Surge answer the customer deliberately submitted.</p>
      </header>
      <div className="admin-surge-review-filter">
        <label htmlFor="surge-review-status">Show</label>
        <select id="surge-review-status" value={filter} onChange={(event) => setFilter(event.target.value as ReviewStatus)}>
          <option value="pending">Pending</option>
          <option value="reviewed">Reviewed</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <button type="button" onClick={() => void refresh()}>Refresh</button>
      </div>
      {reviews.length ? (
        <div className="admin-surge-review-list">
          {reviews.map((review) => (
            <article key={review.id}>
              <header><strong>{dateTime(review.createdAt)}</strong><span>{review.status}</span></header>
              <section><small>Customer asked</small><p>{review.question}</p></section>
              <section><small>Surge answered</small><p>{review.answer}</p></section>
              {filter === "pending" ? (
                <div className="admin-surge-review-actions">
                  <label htmlFor={`surge-review-note-${review.id}`}>Internal note, optional</label>
                  <textarea
                    id={`surge-review-note-${review.id}`}
                    maxLength={1_000}
                    rows={2}
                    value={notes[review.id] || ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [review.id]: event.target.value }))}
                  />
                  <div>
                    <button type="button" disabled={busyId === review.id} onClick={() => void update(review, "reviewed")}>Mark reviewed</button>
                    <button type="button" disabled={busyId === review.id} onClick={() => void update(review, "dismissed")}>Dismiss</button>
                  </div>
                </div>
              ) : review.reviewNote ? <p className="admin-surge-review-note"><strong>Review note:</strong> {review.reviewNote}</p> : null}
            </article>
          ))}
        </div>
      ) : <p className="admin-empty-state">No {filter} Surge answers.</p>}
    </section>
  );
}
