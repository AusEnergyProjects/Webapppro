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
    <aside className={styles.independence} aria-label="Independent guidance">
      <div><span className={styles.eyebrow}>On your side</span><strong>Unbiased guidance. No sales pitch.</strong></div>
      <p>We don&apos;t sell products or leads. No paid placement, and no vested interest in which product or trade you choose.</p>
    </aside>
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
      <div className={styles.wattzunFeature}>
        <picture className={styles.wattzunArtwork}><img src="/surge-ai-command-centre-4k.webp" alt="" width={3840} height={2160} loading="lazy" decoding="async" /></picture>
        <div className={styles.wattzunCopy}>
          <span className={styles.eyebrow}>Free guidance, at your pace</span>
          <h2 id="home-tools-title">Meet Wattzun AI.</h2>
          <p className={styles.wattzunIntro}>A little guidance.<br />A clearer way forward.</p>
          <p>Ask about energy bills, rebates, assessments or upgrades. Wattzun helps you understand the options and build a practical plan for your home, without a sales pitch.</p>
          <ul className={styles.wattzunTopics} aria-label="Ways Wattzun can help"><li>Understand your bills</li><li>Plan home upgrades</li><li>Explore rebates</li></ul>
          <SurgeOpenButton label="Talk to Wattzun AI" description="Your free home energy guide." draft="Help me understand my home energy options and decide where to start." />
          <Link className={styles.callLink} href="/book-an-assessment">Prefer a person? Book a five-minute call <span aria-hidden="true">↗</span></Link>
        </div>
      </div>
      <div className={styles.toolGrid}>
        <article><span className={styles.toolNumber}>Compare energy plans</span><h3>Find a plan that fits.</h3><p>Compare electricity and mains gas plans using your location and usage.</p><div className={styles.toolLinks}><Link href="/compare">Compare electricity <span aria-hidden="true">↗</span></Link><Link href="/gas-compare">Compare gas <span aria-hidden="true">↗</span></Link></div></article>
        <article><span className={styles.toolNumber}>Plan your upgrades</span><h3>Make your next move count.</h3><p>Put your home upgrades in order and explore rebates that may apply.</p><div className={styles.toolLinks}><Link href="/plan">Build my home energy plan <span aria-hidden="true">↗</span></Link><Link href="/calculator">Estimate a rebate <span aria-hidden="true">↗</span></Link></div></article>
      </div>
      <div className={styles.resourceLinks}><Link href="/guides">Browse all guides, rebates and examples</Link><Link href="/rebates">Rebates & assistance</Link><Link href="/direct-trade/standards">Read the marketplace standards</Link></div>
    </section>
    <section className={styles.finalCta} aria-labelledby="home-next-title"><div><span className={styles.eyebrow}>Your next step starts here</span><h2 id="home-next-title">Let&apos;s get your home moving forward.</h2><p>One request. Suitable trades. Your choice.</p></div><a className={styles.primaryLink} href="#home-enquiry">Tell us what you need <span aria-hidden="true">↗</span></a></section>
    <aside className={styles.partners}><p><strong>Good at what you do?</strong> Approved trades and reputable suppliers can connect through TLink.</p><Link href="/direct-trade/partners">Trade and supplier participation</Link></aside>
    <SiteFooter>Prices, rebates and rules can change. Confirm the full quote, credentials and conditions before you commit. Need help? <a href={PUBLIC_SITE.phoneHref}>{PUBLIC_SITE.phoneDisplay}</a>.</SiteFooter>
  </main>;
}
