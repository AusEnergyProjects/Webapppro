"use client";

import chromeStyles from "./ComparatorChrome.module.css";

export type ComparisonJourneyStep = {
  label: string;
  description: string;
};

export function ComparisonJourney({ title, current, steps }: {
  title: string;
  current: number;
  steps: readonly ComparisonJourneyStep[];
}) {
  const safeCurrent = Math.min(Math.max(1, current), steps.length);
  return (
    <section className={chromeStyles.journey} aria-label={title}>
      <div className={chromeStyles.journeyHeading}>
        <div><span>Simple guided comparison</span><h2>{title}</h2></div>
        <strong role="status" aria-live="polite" aria-atomic="true">Step {safeCurrent} of {steps.length}</strong>
      </div>
      <ol>
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const state = stepNumber < safeCurrent ? "complete" : stepNumber === safeCurrent ? "current" : "upcoming";
          return <li className={chromeStyles[state]} key={step.label} aria-current={state === "current" ? "step" : undefined}><b>{stepNumber}</b><span><strong>{step.label}</strong><small>{step.description}</small></span></li>;
        })}
      </ol>
      <div className={chromeStyles.journeyTrack} role="progressbar" aria-label={`${title} progress`} aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={safeCurrent}><span style={{ width: `${safeCurrent / steps.length * 100}%` }} /></div>
    </section>
  );
}

export function ComparisonStepActions({
  step,
  total,
  onBack,
  onContinue,
  continueLabel = "Continue",
  submitting = false,
}: {
  step: number;
  total: number;
  onBack?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  submitting?: boolean;
}) {
  return (
    <div className={chromeStyles.stepActions}>
      <span>Step {step} of {total}</span>
      <div>
        {onBack && <button className="btn ghost" type="button" onClick={onBack}>Back</button>}
        {onContinue && (
          <button className="btn" type="button" onClick={onContinue} disabled={submitting}>
            {continueLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function ComparisonWorkingState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <section className={chromeStyles.working} role="status" aria-live="polite" aria-busy="true">
      <div>
        <span className={chromeStyles.workingMark} aria-hidden="true" />
        <div><strong>{title}</strong><p>{message}</p></div>
      </div>
      <div className={chromeStyles.workingTrack} aria-hidden="true"><span /></div>
      <small>Please keep this page open. Your answers will stay here.</small>
    </section>
  );
}
