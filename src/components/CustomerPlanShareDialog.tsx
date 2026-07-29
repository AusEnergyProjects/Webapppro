"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type PlanDocument = {
  heading: string;
  planTitle: string;
  summary: string;
  preparedDate: string;
  overview: {
    goals: string[];
    propertyType: string;
    tenure: string;
    approval: string;
    pace: string;
    budget: string;
    state: string;
  };
  climate: null | {
    label: string;
    summary: string;
    boundary: string;
  };
  evidence: {
    total: number;
    known: number;
    unknown: number;
  };
  actions: Array<{
    number: number;
    id: string;
    stage: string;
    title: string;
    description: string;
    completed: boolean;
    guideLabel: string;
    guideHref: string;
    guidance: {
      basedOn: string[];
      stillUncertain: string[];
      reconsiderIf: string[];
    };
  }>;
  questions: Array<{
    number: number;
    prompt: string;
    whyItMatters: string;
  }>;
  permissionSections: Array<{
    label: string;
    items: Array<{ title: string; note: string }>;
  }>;
  permissionBoundary: string;
  omitted: Record<string, number>;
  privacyNote: string;
  adviceBoundary: string;
};

export function CustomerPlanShareDialog({
  open,
  defaultRecipient,
  busy,
  status,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  defaultRecipient: string;
  busy: boolean;
  status: string;
  error: string;
  onClose: () => void;
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
            controlled goals, ordered advisor actions, rationale, open
            questions and safety boundaries.
          </p>
          <ul>
            <li>No exact postcode, account details or private project labels</li>
            <li>No room names, routines, filenames or private notes</li>
            <li>No customer review text or home-specific custom wording</li>
          </ul>
        </div>
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

function GuidanceGroup({
  label,
  items,
}: {
  label: string;
  items: string[];
}) {
  if (!items.length) return null;
  return (
    <section>
      <strong>{label}</strong>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}

export function CustomerPlanPrintReport({
  document,
}: {
  document: PlanDocument;
}) {
  const omittedTotal = Object.values(document.omitted)
    .reduce((total, count) => total + Number(count || 0), 0);
  return (
    <article className="customer-plan-print-report" aria-hidden="true">
      <header>
        <div>
          <span>Australian Energy Assessments</span>
          <h1>{document.heading}</h1>
          <p>{document.planTitle}</p>
        </div>
        <small>Prepared {document.preparedDate}</small>
      </header>
      <section className="customer-plan-print-intro">
        <p>{document.summary}</p>
        <dl>
          <div>
            <dt>Goals</dt>
            <dd>{document.overview.goals.join(", ") || "Not recorded"}</dd>
          </div>
          <div>
            <dt>Home and tenure</dt>
            <dd>
              {document.overview.propertyType}, {document.overview.tenure},{" "}
              {document.overview.state}
            </dd>
          </div>
          <div>
            <dt>Approval context</dt>
            <dd>{document.overview.approval}</dd>
          </div>
          <div>
            <dt>Plan boundary</dt>
            <dd>{document.overview.pace}, {document.overview.budget}</dd>
          </div>
        </dl>
      </section>
      {document.climate && (
        <section className="customer-plan-print-climate">
          <span>Broad climate planning context</span>
          <h2>{document.climate.label}</h2>
          <p>{document.climate.summary}</p>
          <small>{document.climate.boundary}</small>
        </section>
      )}
      <section className="customer-plan-print-evidence">
        <strong>Evidence boundary</strong>
        <p>
          {document.evidence.known} of {document.evidence.total} tracked home
          facts have a customer-selected source. {document.evidence.unknown}{" "}
          remain not known or not checked.
        </p>
      </section>
      <section className="customer-plan-print-roadmap">
        <span>Ordered roadmap</span>
        <h2>What to consider, in order</h2>
        <ol>
          {document.actions.map((action) => (
            <li key={action.id}>
              <b>{action.completed ? "Done" : String(action.number).padStart(2, "0")}</b>
              <div>
                <small>{action.stage}</small>
                <h3>{action.title}</h3>
                <p>{action.description}</p>
                {action.guideHref && action.guideLabel && (
                  <a href={action.guideHref}>
                    {action.guideLabel}
                  </a>
                )}
                <div className="customer-plan-print-guidance">
                  <GuidanceGroup label="Based on" items={action.guidance.basedOn} />
                  <GuidanceGroup
                    label="Still uncertain"
                    items={action.guidance.stillUncertain}
                  />
                  <GuidanceGroup
                    label="Could change if"
                    items={action.guidance.reconsiderIf}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {document.questions.length > 0 && (
        <section className="customer-plan-print-questions">
          <span>Questions that could improve the plan</span>
          <ol>
            {document.questions.map((question) => (
              <li key={question.number}>
                <strong>{question.prompt}</strong>
                <p>{question.whyItMatters}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {document.permissionSections.length > 0 && (
        <section className="customer-plan-print-permissions">
          <span>Permission and licensed-work boundary</span>
          <div>
            {document.permissionSections.map((section) => (
              <article key={section.label}>
                <h3>{section.label}</h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={`${section.label}:${item.title}`}>
                      <strong>{item.title}</strong>
                      {item.note && <p>{item.note}</p>}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <small>{document.permissionBoundary}</small>
        </section>
      )}
      <footer>
        <strong>Private by design</strong>
        <p>
          {document.privacyNote}
          {omittedTotal
            ? ` ${omittedTotal} private or customer-written records were omitted from this copy.`
            : ""}
        </p>
        <small>{document.adviceBoundary}</small>
      </footer>
    </article>
  );
}
