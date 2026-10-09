"use client";

import chromeStyles from "./ComparatorChrome.module.css";
import { WattzunMascot } from "./WattzunMascot";

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
  submitLabel,
}: {
  step: number;
  total: number;
  onBack?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  submitting?: boolean;
  submitLabel?: string;
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
        {submitLabel && <button className="btn" type="submit" disabled={submitting}>{submitLabel}</button>}
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
        <WattzunMascot className={chromeStyles.workingMascot} />
        <div><span className={chromeStyles.workingEyebrow}>Wattzun is on the case</span><strong>{title}</strong><p>{message}</p></div>
      </div>
      <div className={chromeStyles.workingTrack} aria-hidden="true"><span /></div>
      <small>A little happy dance while we check published offers for your home. Your answers stay here.</small>
    </section>
  );
}
