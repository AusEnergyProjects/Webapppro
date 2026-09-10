import Link from "next/link";
import { SiteFooter, SiteHeader } from "./ComparatorChrome";
import { QuickUpgradeEnquiry } from "./QuickUpgradeEnquiry";
import { HomeHeroScene } from "./HomeHeroScene";
import { SurgeOpenButton } from "./SurgeOpenButton";
import { PUBLIC_SITE } from "@/lib/public-site";
import styles from "./GettingStarted.module.css";

const steps = [
  ["01", "Tell us what you need", "Choose your service and tell us a little about your property."],
  ["02", "Reach suitable trades", "Your request goes to approved businesses that match the work and your area."],
  ["03", "Choose your next step", "Discuss your options. You decide who to work with and when to go ahead."],
] as const;

export function GettingStarted() {
  return <main className={`wrap ${styles.page}`}>
    <SiteHeader active="start" />
    <section className={styles.hero} aria-labelledby="home-title">
      <HomeHeroScene>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Australian Energy Assessments</span>
          <h1 id="home-title">A better home.<br /><span>A clearer next step.</span></h1>
          <p>From NatHERS assessments to everyday energy upgrades. Find the right help, connect with suitable trades and move forward with confidence.</p>
          <a className={styles.mobileStart} href="#home-enquiry">Start your request <span aria-hidden="true">↗</span></a>
        </div>
      </HomeHeroScene>
      <QuickUpgradeEnquiry />
    </section>
    <section className={styles.steps} aria-label="How your request works">
      {steps.map(([number, title, text]) => <article key={number}><span>{number}</span><div><h2>{title}</h2><p>{text}</p></div></article>)}
    </section>
    <section className={styles.assessments} id="home-assessments" aria-labelledby="home-assessments-title">
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Expertise starts at home</span><h2 id="home-assessments-title">Australian Energy Assessments.<br /><span>It is what we do.</span></h2></div><Link className={styles.textLink} href="/assessments">Compare assessment types <span aria-hidden="true">↗</span></Link></div>
      <div className={styles.assessmentGrid}>
        <article className={styles.nathersCard}>
          <div className={styles.cardTop}><span>Designing or building</span><span aria-hidden="true">01 /</span></div>
          <h3>NatHERS<br />assessments</h3>
          <p>Understand your new home&apos;s energy performance before it is built. Plan-based assessments available Australia-wide.</p>
          <Link className={styles.cardAction} href="/nathers-for-new-homes">Explore NatHERS assessments <span aria-hidden="true">↗</span></Link>
          <div className={styles.relatedLinks}><Link href="/nathers-whole-of-home">Whole of Home</Link><Link href="/basix-nsw">BASIX for NSW</Link></div>
        </article>
        <article className={styles.ratingCard}>
          <div className={styles.cardTop}><span>Already living in your home</span><span aria-hidden="true">02 /</span></div>
          <h3>Home Energy<br />Ratings</h3>
          <p>Find out how your home performs and where to improve comfort and energy use. On-site assessments mainly in NSW and Victoria.</p>
          <Link className={styles.cardAction} href="/home-energy-rating-for-existing-homes">Explore existing-home ratings <span aria-hidden="true">↗</span></Link>
          <div className={styles.relatedLinks}><Link href="/blower-door-thermal-imaging">Blower door testing & thermal imaging</Link></div>
        </article>
      </div>
    </section>
    <section className={styles.tools} id="compare-energy-plans" aria-labelledby="home-tools-title">
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>A little clarity goes a long way</span><h2 id="home-tools-title">Explore your options.</h2></div><p>Practical tools when you want to look into it first.</p></div>
      <div className={styles.toolGrid}>
        <article><span className={styles.toolNumber}>01 / Compare</span><h3>Could your energy plan fit better?</h3><p>Compare electricity and mains gas plans using your location and usage.</p><div className={styles.toolLinks}><Link href="/compare">Compare electricity <span aria-hidden="true">↗</span></Link><Link href="/gas-compare">Compare gas <span aria-hidden="true">↗</span></Link></div></article>
        <article><span className={styles.toolNumber}>02 / Plan</span><h3>Put your home upgrades in order.</h3><p>Build a practical plan, explore rebates and understand what to do first.</p><div className={styles.toolLinks}><Link href="/plan">Build my home energy plan</Link><Link href="/calculator">Estimate a rebate <span aria-hidden="true">↗</span></Link></div></article>
        <article><span className={styles.toolNumber}>03 / Ask</span><h3>Still working it out?</h3><p>Talk through your ideas with our AI energy guide, or speak with our team.</p><SurgeOpenButton label="Ask Wattzun AI first" description="Help with your next decision." draft="Help me decide which home energy assessment or upgrade to start with, and when to request help from a trade." /><Link className={styles.callLink} href="/book-an-assessment">Book a five-minute call <span aria-hidden="true">↗</span></Link></article>
      </div>
      <div className={styles.resourceLinks}><Link href="/guides">Browse all guides, rebates and examples</Link><Link href="/rebates">Rebates & assistance</Link><Link href="/direct-trade/standards">Read the marketplace standards</Link></div>
    </section>
    <section className={styles.finalCta} aria-labelledby="home-next-title"><div><span className={styles.eyebrow}>Your next step starts here</span><h2 id="home-next-title">Let&apos;s get your home moving forward.</h2><p>One request. Suitable trades. Your choice.</p></div><a className={styles.primaryLink} href="#home-enquiry">Tell us what you need <span aria-hidden="true">↗</span></a></section>
    <aside className={styles.partners}><p><strong>Good at what you do?</strong> Approved trades and reputable suppliers can connect through TLink.</p><Link href="/direct-trade/partners">Trade and supplier participation</Link></aside>
    <SiteFooter>Prices, rebates and rules can change. Confirm the full quote, credentials and conditions before you commit. Need help? <a href={PUBLIC_SITE.phoneHref}>{PUBLIC_SITE.phoneDisplay}</a>.</SiteFooter>
  </main>;
}
