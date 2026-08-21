/* The electricity tab uses this exact brandmark asset. Keep the gas tab on the same source. */
/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages */
import { ReactNode } from "react";
import { AEA_BRANDMARK_PNG_DATA_URI } from "@/lib/aea-brand-assets.mjs";
import { ResponsiveSiteNav } from "@/components/ResponsiveSiteNav";
import { SurgeHeaderButton } from "@/components/SurgeHeaderButton";

export function BrandBar() {
  return (
    <a href="/" className="brandbar" aria-label="Australian Energy Assessments home">
      <span className="brandmark" aria-hidden="true"><img src={AEA_BRANDMARK_PNG_DATA_URI} alt="" width="30" height="30" decoding="async" /></span>
      <span className="brandtext">
        <strong className="brandname">Australian Energy Assessments</strong>
        <span className="brandtag">Independent energy assessments</span>
      </span>
    </a>
  );
}

export type SiteActive = "start" | "plan" | "calculator" | "account" | "direct-trade-request" | "direct-trade-partners" | "direct-trade-dashboard" | "direct-trade-verification" | "direct-trade-access" | "direct-trade-standards" | "assessments" | "electricity" | "gas" | "certificates" | "guides" | "rebates" | "case-studies" | "surge";

export function SiteNav({ active }: { active: SiteActive }) {
  const links = [
    { key: "start", href: "/", label: "Start" },
    { key: "plan", href: "/plan", label: "My energy plan" },
    { key: "calculator", href: "/calculator", label: "Rebate calculator" },
    { key: "electricity", href: "/compare", label: "Electricity compare" },
    { key: "gas", href: "/gas-compare", label: "Gas compare" },
    { key: "certificates", href: "/guides/certificate-prices", label: "Certificates" },
    { key: "guides", href: "/guides", label: "Guides and rebates" },
    { key: "assessments", href: "/assessments", label: "Assessments" },
  ] as const;
  return (
    <ResponsiveSiteNav>
      {links.map((link) => (
        <a
          className={active === link.key ? "active" : "inactive"}
          href={link.href}
          key={link.key}
          aria-current={active === link.key ? "page" : undefined}
        >
          {link.label}
        </a>
      ))}
    </ResponsiveSiteNav>
  );
}

export function SiteHeader({ active }: { active: SiteActive }) {
  return (
    <>
      <header className="site-header">
        <BrandBar />
        <SiteNav active={active} />
        <div className="site-header-actions">
          {active === "account" ? (
            <a className="site-account-link active" href="/account" aria-current="page">
              <span aria-hidden="true">&#9679;</span> Account
            </a>
          ) : null}
          <SurgeHeaderButton active={active === "surge"} />
          <a
            className="site-tlink-link"
            href="/direct-trade/dashboard"
            aria-label="Open the TLink trade workspace"
            title="TLink trade workspace"
          >
            <img className="site-tlink-mark" src="/tlink-icon-192.png" width="38" height="38" alt="" aria-hidden="true" decoding="async" />
            <span className="site-tlink-copy"><strong>TLink</strong><small>Trade workspace</small></span>
          </a>
        </div>
      </header>
      <span className="site-content-anchor" id="site-content" tabIndex={-1} />
    </>
  );
}

export function SiteFooter({ children }: { children: ReactNode }) {
  return <footer className="site-footer"><p>{children}</p><p>Powered by <a href="https://www.ausenergyassessments.com/" target="_blank" rel="noreferrer">Australian Energy Assessments</a> | <a href="/privacy">Privacy</a> | Independent energy assessments | 1300 241 149</p></footer>;
}

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
