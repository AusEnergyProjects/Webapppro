/* The electricity tab uses this exact brandmark asset. Keep the gas tab on the same source. */
/* eslint-disable @next/next/no-img-element */
import { ReactNode } from "react";

const AEA_LOGO_DATA_URI = "data:image/png;base64,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";

export function BrandBar() {
  return (
    <a href="https://www.ausenergyassessments.com/" target="_blank" rel="noreferrer" className="brandbar">
      <span className="brandmark" aria-hidden="true"><img src={AEA_LOGO_DATA_URI} alt="" /></span>
      <span className="brandtext">
        <strong className="brandname">Australian Energy Assessments</strong>
        <span className="brandtag">Independent energy assessments</span>
      </span>
    </a>
  );
}

export function SiteNav({ active }: { active: "start" | "electricity" | "gas" | "guides" | "rebates" | "case-studies" }) {
  const links = [
    { key: "start", href: "/getting-started", label: "Start here" },
    { key: "electricity", href: "/compare", label: "Electricity compare" },
    { key: "gas", href: "/gas-compare", label: "Gas compare" },
    { key: "guides", href: "/guides", label: "Guides" },
    { key: "rebates", href: "/rebates", label: "Rebates and help" },
    { key: "case-studies", href: "/case-studies", label: "Worked examples" },
  ] as const;
  return <nav aria-label="Energy services" className="comparator-nav">{links.map((link) => <a className={active === link.key ? "active" : "inactive"} href={link.href} key={link.key} aria-current={active === link.key ? "page" : undefined}>{link.label}</a>)}</nav>;
}

export function ComparatorHero({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="hero">
      <h1>{title}</h1>
      {children}
    </header>
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
