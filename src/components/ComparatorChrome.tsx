/* The electricity tab uses this exact brandmark asset. Keep the gas tab on the same source. */
/* eslint-disable @next/next/no-img-element */
import { ReactNode } from "react";
import Link from "next/link";
import { ResponsiveSiteNav } from "@/components/ResponsiveSiteNav";
import { PublicSiteSearch } from "@/components/PublicSiteSearch";
import { SurgeHeaderButton } from "@/components/SurgeHeaderButton";
import { PUBLIC_SITE } from "@/lib/public-site";

export function BrandBar() {
  return (
    <Link href="/" className="brandbar" aria-label="Australian Energy Assessments home">
      <span className="brandmark" aria-hidden="true"><img src="/api/aea-brandmark" alt="" width="34" height="34" decoding="async" /></span>
      <span className="brandtext">
        <strong className="brandname">Australian Energy Assessments</strong>
        <span className="brandtag">Independent energy assessments</span>
      </span>
    </Link>
  );
}

export type SiteActive = "start" | "plan" | "calculator" | "account" | "direct-trade-request" | "direct-trade-partners" | "direct-trade-dashboard" | "direct-trade-verification" | "direct-trade-access" | "direct-trade-standards" | "assessments" | "electricity" | "gas" | "certificates" | "guides" | "rebates" | "case-studies" | "surge";

export function SiteNav({ active }: { active: SiteActive }) {
  return <ResponsiveSiteNav active={active} />;
}

export function SiteHeader({ active }: { active: SiteActive }) {
  return (
    <>
      <header className="site-header">
        <BrandBar />
        <PublicSiteSearch />
        <SiteNav active={active} />
        <div className="site-header-actions">
          {active === "account" ? (
            <Link className="site-account-link active" href="/account" prefetch={false} aria-current="page">
              <span aria-hidden="true">&#9679;</span> Account
            </Link>
          ) : null}
          <Link
            className="site-book-link"
            href="/book-an-assessment"
            aria-label="Book a five-minute assessment call"
          >
            <span className="site-action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
                <path d="M7 3v3m10-3v3M5 9h14M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                <path d="m9.2 14 1.8 1.8 3.9-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            </span>
            <span>Book now</span>
          </Link>
          <a
            className="site-call-link"
            href={PUBLIC_SITE.phoneHref}
            aria-label={`Call Australian Energy Assessments on ${PUBLIC_SITE.phoneDisplay}`}
          >
            <span className="site-action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
                <path d="M7.4 4.2 10 8.7 8.2 10a13.5 13.5 0 0 0 5.8 5.8l1.3-1.8 4.5 2.6-.8 2.7c-.2.7-.9 1.2-1.7 1.1A15.4 15.4 0 0 1 3.6 6.7c-.1-.8.4-1.5 1.1-1.7l2.7-.8Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            </span>
            <span>Call</span>
          </a>
          <SurgeHeaderButton active={active === "surge"} />
          <Link
            className="site-tlink-link"
            href="/direct-trade/dashboard"
            prefetch={false}
            aria-label="Open TLink"
            title="TLink"
          >
            <img className="site-tlink-mark" src="/tlink-icon-192.png" width="38" height="38" alt="" aria-hidden="true" decoding="async" />
            <span className="site-tlink-copy"><strong>TLink</strong></span>
          </Link>
        </div>
      </header>
      <span className="site-content-anchor" id="site-content" tabIndex={-1} />
    </>
  );
}

export { SiteFooter } from "./SiteFooter";

export function ComparatorHero({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="hero">
      <h1>{title}</h1>
      {children}
    </header>
  );
}

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
    <section className="comparison-journey" aria-label={title}>
      <div className="comparison-journey-heading">
        <div><span>Simple guided comparison</span><h2>{title}</h2></div>
        <strong>Step {safeCurrent} of {steps.length}</strong>
      </div>
      <ol>
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const state = stepNumber < safeCurrent ? "complete" : stepNumber === safeCurrent ? "current" : "upcoming";
          return <li className={state} key={step.label} aria-current={state === "current" ? "step" : undefined}><b>{stepNumber}</b><span><strong>{step.label}</strong><small>{step.description}</small></span></li>;
        })}
      </ol>
      <div className="comparison-journey-track" role="progressbar" aria-label={`${title} progress`} aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={safeCurrent}><span style={{ width: `${safeCurrent / steps.length * 100}%` }} /></div>
    </section>
  );
}

export function StepCard({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>
        <span className="stepnum">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Field({ label, optional, hint, children }: { label: string; optional?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="f">
      {label} {optional && <span className="opt">{optional}</span>}
      <span className="field-control">{children}</span>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export const inputClass = "";
