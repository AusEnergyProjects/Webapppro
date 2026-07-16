import { SiteFooter, SiteHeader } from "./ComparatorChrome";
import type { SiteActive } from "./ComparatorChrome";
import type { ReactNode } from "react";

export function GuideShell({ label, title, introduction, active = "guides", children }: { label: string; title: string; introduction: string; active?: SiteActive; children: ReactNode }) {
  return <main className="wrap guide-page">
    <SiteHeader active={active} />
    <header className="guide-hero"><span>{label}</span><h1>{title}</h1><p>{introduction}</p></header>
    {children}
    <SiteFooter>Guidance is general and estimates are indicative. Obtain site-specific advice and confirm products, eligibility, incentives, warranties and network requirements before committing.</SiteFooter>
  </main>;
}

export function GuideSection({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <section className="guide-section"><div className="guide-section-heading"><span>{eyebrow}</span><h2>{title}</h2></div>{children}</section>;
}
