/* The electricity tab uses this exact brandmark asset. Keep the gas tab on the same source. */
/* eslint-disable @next/next/no-img-element */
import { ReactNode } from "react";
import Link from "next/link";
import { AEA_BRANDMARK_PNG_DATA_URI } from "@/lib/aea-brand-assets.mjs";
import { ResponsiveSiteNav } from "@/components/ResponsiveSiteNav";
import { PublicSiteSearch } from "@/components/PublicSiteSearch";
import { SurgeHeaderButton } from "@/components/SurgeHeaderButton";
import { PUBLIC_SITE } from "@/lib/public-site";

export function BrandBar() {
  return (
    <Link href="/" className="brandbar" aria-label="Australian Energy Assessments home">
      <span className="brandmark" aria-hidden="true"><img src={AEA_BRANDMARK_PNG_DATA_URI} alt="" width="30" height="30" decoding="async" /></span>
      <span className="brandtext">
        <strong className="brandname">Australian Energy Assessments</strong>
        <span className="brandtag">Independent energy assessments</span>
      </span>
    </Link>
  );
}

export type SiteActive = "start" | "plan" | "calculator" | "account" | "direct-trade-request" | "direct-trade-partners" | "direct-trade-dashboard" | "direct-trade-verification" | "direct-trade-access" | "direct-trade-standards" | "assessments" | "electricity" | "gas" | "certificates" | "guides" | "rebates" | "case-studies" | "surge";

export function SiteNav({ active }: { active: SiteActive }) {
  const links = [
    { key: "start", href: "/", label: "Home" },
    { key: "plan", href: "/plan", label: "My energy plan" },
    { key: "calculator", href: "/calculator", label: "Rebate calculator" },
    { key: "electricity", href: "/compare", label: "Electricity compare" },
    { key: "gas", href: "/gas-compare", label: "Gas compare" },
    { key: "certificates", href: "/guides/certificate-prices", label: "Certificates" },
    { key: "guides", href: "/guides", label: "Guides and rebates" },
    { key: "assessments", href: "/assessments", label: "Home assessments" },
  ] as const;
  return (
    <ResponsiveSiteNav>
      {links.map((link) => (
        <Link
          className={active === link.key ? "active" : "inactive"}
          href={link.href}
          key={link.key}
          aria-current={active === link.key ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </ResponsiveSiteNav>
  );
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
            Book now
          </Link>
          <a
            className="site-call-link"
            href={PUBLIC_SITE.phoneHref}
            aria-label={`Call Australian Energy Assessments on ${PUBLIC_SITE.phoneDisplay}`}
          >
            Call
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

export function SiteFooter({ children }: { children: ReactNode }) {
  return <footer className="site-footer"><p>{children}</p><p>Powered by <a href={`${PUBLIC_SITE.apexUrl}/`}>Australian Energy Assessments</a> | <Link href="/assessments" prefetch={false}>Home energy assessments</Link> | <Link href="/home-energy-rating-for-existing-homes" prefetch={false}>Home Energy Rating</Link> | <Link href="/faq" prefetch={false}>FAQ</Link> | <Link href="/privacy" prefetch={false}>Privacy and analytics</Link> | <Link href="/book-an-assessment" prefetch={false}>Book now</Link> | <a href={PUBLIC_SITE.phoneHref}>{PUBLIC_SITE.phoneDisplay}</a> | <a href={`mailto:${PUBLIC_SITE.email}`}>Email</a></p><p><Link href="/team" prefetch={false}>Our team</Link> | <Link href="/communities-schools" prefetch={false}>Community education</Link> | <Link href="/trusted-suppliers" prefetch={false}>Trusted resources</Link></p><p>{PUBLIC_SITE.legalName} | ABN {PUBLIC_SITE.abn} | {PUBLIC_SITE.address.streetAddress}, {PUBLIC_SITE.address.addressLocality} {PUBLIC_SITE.address.addressRegion} {PUBLIC_SITE.address.postalCode}</p><p className="site-footer-profiles"><a href={PUBLIC_SITE.googleBusinessProfile} target="_blank" rel="noopener noreferrer">Google Business Profile</a> | <a href={PUBLIC_SITE.facebook} target="_blank" rel="noopener noreferrer">Facebook</a> | <a href={PUBLIC_SITE.instagram} target="_blank" rel="noopener noreferrer">Instagram</a> | <a href={PUBLIC_SITE.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a></p></footer>;
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
