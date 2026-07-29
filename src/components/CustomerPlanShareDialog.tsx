"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CustomerPlanReportView } from "@/lib/customer-plan-report";

export function CustomerPlanShareDialog({
  open,
  defaultRecipient,
  readiness,
  busy,
  status,
  error,
  onClose,
  onReviewHomeDetails,
  onSubmit,
}: {
  open: boolean;
  defaultRecipient: string;
  readiness: CustomerPlanReportView["readiness"];
  busy: boolean;
  status: string;
  error: string;
  onClose: () => void;
  onReviewHomeDetails: () => void;
  onSubmit: (recipient: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = window.document.activeElement as HTMLElement;
    window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => returnFocusRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && window.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && window.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || busy) return;
    await onSubmit(recipient);
  };

  return (
    <div
      className="customer-plan-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="customer-plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-plan-dialog-title"
        aria-describedby="customer-plan-dialog-description"
        onKeyDown={trapFocus}
      >
        <header>
          <div>
            <span>Email your independent plan</span>
            <h2 id="customer-plan-dialog-title">
              Send a clear, private-by-design copy
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close plan email window"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="customer-plan-dialog-preview">
          <strong>What the recipient receives</strong>
          <p id="customer-plan-dialog-description">
            A carefully formatted independent home energy plan with your
            planning snapshot, key questions and complete ordered roadmap.
          </p>
          <ul>
            <li>No exact postcode, account details or private project labels</li>
            <li>No room names, routines, filenames or private notes</li>
            <li>No customer review text or home-specific custom wording</li>
          </ul>
        </div>
        <section
          className={`customer-plan-dialog-readiness${
            readiness.missing ? " needs-review" : " is-ready"
          }`}
          aria-labelledby="customer-plan-dialog-readiness-title"
        >
          <div>
            <span>Home-detail check</span>
            <h3 id="customer-plan-dialog-readiness-title">
              {readiness.missing
                ? `${readiness.missing} question${readiness.missing === 1 ? "" : "s"} still need an answer`
                : "Your home questions are addressed"}
            </h3>
            <p>
              {readiness.answered} answered, {readiness.notSure} marked Not sure
              {readiness.linked
                ? `, and ${readiness.linked} linked to supporting evidence`
                : ""}.
            </p>
          </div>
          {readiness.missing > 0 && (
            <>
              <ul>
                {readiness.missingLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
                {readiness.missing > readiness.missingLabels.length && (
                  <li>
                    And {readiness.missing - readiness.missingLabels.length} more
                  </li>
                )}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={onReviewHomeDetails}
              >
                Review home details
              </button>
            </>
          )}
          <small>{readiness.boundary}</small>
        </section>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            <span>Recipient email address</span>
            <input
              ref={inputRef}
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          <label className="customer-plan-dialog-consent">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I confirm that this person should receive the plan. The address
              and privacy-filtered plan will be passed to the configured email
              delivery provider for this message only.
            </span>
          </label>
          {error && <p className="customer-plan-dialog-error" role="alert">{error}</p>}
          {status && (
            <p className="customer-plan-dialog-status" role="status" aria-live="polite">
              {status}
            </p>
          )}
          <footer>
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="submit"
              disabled={busy || !confirmed || !recipient.trim()}
            >
              {busy ? "Requesting delivery..." : "Email this plan"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export function CustomerPlanPrintReport({
  report,
}: {
  report: CustomerPlanReportView;
}) {
  return (
    <article className="customer-plan-print-report customer-plan-print-report-visible">
      <header>
        <div>
          <span>Australian Energy Assessments</span>
          <h1>{report.heading}</h1>
          <p>{report.planTitle}</p>
        </div>
        <small>Generated {report.preparedDate}</small>
      </header>
      <section className="customer-plan-print-intro">
        <p>{report.summary}</p>
        <dl>
          {report.planningSnapshot.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {report.climate && (
        <section className="customer-plan-print-climate">
          <span>Broad climate planning context</span>
          <h2>{report.climate.label}</h2>
          <p>{report.climate.summary}</p>
        </section>
      )}
      <section className="customer-plan-print-readiness">
        <span>Before spending money</span>
        <p>{report.readiness.message}</p>
        <small>{report.readiness.boundary}</small>
        {report.questions.length > 0 && (
          <ol>
            {report.questions.map((question) => (
              <li key={question.number}>
                <strong>{question.prompt}</strong>
                <p>{question.whyItMatters}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      {report.professionalReview && (
        <section className="customer-plan-print-professional-review">
          <h2>Professional review, self-declared</h2>
          <p>{report.professionalReview.statement}</p>
          {report.professionalReview.notes && (
            <blockquote>
              <strong>Adviser notes</strong>
              <p>{report.professionalReview.notes}</p>
            </blockquote>
          )}
          <small>{report.professionalReview.boundary}</small>
        </section>
      )}
      {report.everydayActions.length > 0 && (
        <section className="customer-plan-print-everyday">
          <h2>Helpful things you can try now</h2>
          <p>{report.everydayActionsBoundary}</p>
          <div>
            {report.everydayActions.map((action) => (
              <article key={action.id}>
                <small>{action.category}</small>
                <h3>{action.title}</h3>
                <p>{action.description}</p>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="customer-plan-print-basis">
        <span>Why this order</span>
        <ul>
          {report.decisionBasis.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
      <section className="customer-plan-print-roadmap">
        <span>Ordered roadmap</span>
        <h2>What to consider, in order</h2>
        <p>
          The first three unfinished steps are highlighted. Every remaining
          step stays in its original order.
        </p>
        <ol>
          {report.actions.map((action) => (
            <li
              className={action.priority ? "is-priority" : "is-compact"}
              key={action.id}
            >
              <b>{action.completed ? "Done" : String(action.number).padStart(2, "0")}</b>
              <div>
                {action.priority && <em>Priority step</em>}
                <small>{action.stage}</small>
                <h3>{action.title}</h3>
                <p>{action.description}</p>
                {action.guideHref && action.guideLabel && (
                  <a href={action.guideHref}>
                    {action.guideLabel}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="customer-plan-print-change">
        <strong>What could change this order</strong>
        <p>{report.changeBoundary}</p>
      </section>
      <section className="customer-plan-print-before-trade">
        <span>Before engaging a trade</span>
        <ul>
          {report.beforeTrade.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
      <footer>
        <strong>Private by design</strong>
        <p>{report.privacyNote}</p>
        <small>{report.adviceBoundary}</small>
      </footer>
    </article>
  );
}
