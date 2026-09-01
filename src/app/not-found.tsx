import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";

export const metadata: Metadata = {
  title: "Page Not Found | Australian Energy Assessments",
  description: "This Australian Energy Assessments page is no longer available. Browse current home energy guidance and assessment services.",
  robots: { index: false, follow: true },
};

export default function NotFoundPage() {
  return <main className="wrap guide-page">
    <SiteHeader active="guides" />
    <header className="guide-hero">
      <span>Page not found</span>
      <h1>That page is no longer available</h1>
      <p>Some older articles have been retired because they were outdated, repetitive or did not meet our current evidence standards. The useful topics now live in clearer, source-backed guides.</p>
    </header>
    <section className="guide-callout guide-callout-primary">
      <div><h2>Looking for practical home energy guidance?</h2><p>Browse the current guide library or choose the assessment that matches your home and project stage.</p></div>
      <Link href="/guides">Browse current guides</Link>
    </section>
    <section className="guide-section">
      <div className="guide-card-grid">
        <article className="guide-card"><span>Assessments</span><h3>NatHERS, Home Energy Rating and BASIX</h3><p>Work out which assessment applies before collecting the wrong documents.</p><Link href="/assessments">Choose an assessment</Link></article>
        <article className="guide-card"><span>Home upgrades</span><h3>What should you improve first?</h3><p>Start with the problem, the home&apos;s condition and the evidence needed for a useful decision.</p><Link href="/guides/home-energy-upgrades">Open the upgrade guide</Link></article>
        <article className="guide-card"><span>Personal guidance</span><h3>Build a private home energy roadmap</h3><p>Put the relevant comparisons, guides and next steps in a practical order.</p><Link href="/plan">Build my roadmap</Link></article>
      </div>
    </section>
    <SiteFooter>Information is general. Confirm current requirements and site-specific advice before making a decision.</SiteFooter>
  </main>;
}
