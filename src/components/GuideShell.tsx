import { SiteHeader } from "./ComparatorChrome";
import type { ReactNode } from "react";

export function GuideShell({ label, title, introduction, children }: { label: string; title: string; introduction: string; children: ReactNode }) {
  return <main className="wrap guide-page">
    <SiteHeader active="guides" />
    <header className="guide-hero"><span>{label}</span><h1>{title}</h1><p>{introduction}</p></header>
    {children}
    <footer><p>Guidance is general and estimates are indicative. Obtain site-specific advice and confirm products, eligibility, incentives, warranties and network requirements before committing.</p><p>Provided by <a href="https://www.ausenergyassessments.com/" target="_blank" rel="noreferrer">Australian Energy Assessments</a> | Independent energy assessments | 1300 241 149</p></footer>
  </main>;
}

export function GuideSection({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <section className="guide-section"><div className="guide-section-heading"><span>{eyebrow}</span><h2>{title}</h2></div>{children}</section>;
}
