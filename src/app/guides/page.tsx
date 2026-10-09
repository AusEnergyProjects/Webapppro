import Link from "next/link";
import { GuideShell, GuideSection } from "@/components/GuideShell";
import { buildPlatformMetadata } from "@/lib/public-site";
import styles from "./page.module.css";

export const metadata = buildPlatformMetadata({
  path: "/guides",
  title: "Home Energy Guides: Bills, Solar and Upgrades | Australian Energy Assessments",
  description: "Understand energy bills, solar, batteries, home assessments and electric upgrades. Choose a guide, see a worked example and take your next step.",
});

export default function GuidesPage() {
  return <GuideShell label="Your home energy library" title="What would you like to understand?" introduction="Start with your question. Find a plain-language explanation, learn what the numbers mean and see what to check before choosing a plan or paying for an upgrade.">
    <nav className={styles.jumpNav} aria-label="Choose a guide topic">
      <a href="#bills-and-solar">Bills, solar and batteries</a>
      <a href="#comfort-and-electric">Comfort and going electric</a>
      <a href="#assessments-and-ratings">Assessments and ratings</a>
      <a href="#quotes-and-support">Quotes and support</a>
    </nav>

    <section className="guide-callout guide-callout-primary"><div><h2>Which systems are worth considering?</h2><p>See product photos and compare the pros and cons of panels, inverters, batteries, heat pumps and aircon.</p></div><Link href="/guides/products">Compare products</Link></section>

    <div className={styles.nextSteps}>
      <Link href="/compare"><span>Use your own bill</span><strong>Compare electricity plans</strong><small>Then explore solar and storage.</small></Link>
      <Link href="/assessments"><span>Understand your property</span><strong>Find an assessment</strong><small>Choose the service that answers your question.</small></Link>
      <Link href="/case-studies"><span>See the numbers explained</span><strong>Explore worked examples</strong><small>Follow the calculation and its assumptions.</small></Link>
    </div>

    <div id="bills-and-solar" className={styles.sectionAnchor}>
      <GuideSection eyebrow="Spend less on energy" title="Bills, solar and batteries"><p className={styles.sectionIntro}>Understand when you use electricity, what solar can replace and what a battery adds.</p><div className="guide-card-grid">
        <article className="guide-card"><span>Rooftop solar</span><h3>Will solar suit the way I use electricity?</h3><p>Learn kW, kWh, self-use and feed-in tariffs. Understand your postcode estimate and what a roof-specific quote needs.</p><Link href="/guides/solar">Understand rooftop solar</Link></article>
        <article className="guide-card"><span>Home batteries</span><h3>What does storage add beyond solar?</h3><p>Compare the extra saving with the extra price. Get clear on usable capacity, backup power and battery controls.</p><Link href="/guides/batteries">Understand home batteries</Link></article>
      </div><div className={styles.inlineLinks}><Link href="/case-studies#electricity-timing">Why usage timing changes plan costs</Link><Link href="/case-studies#solar-self-use">See solar self-use explained</Link><Link href="/gas-compare">Compare mains gas plans</Link></div></GuideSection>
    </div>

    <div id="comfort-and-electric" className={styles.sectionAnchor}>
      <GuideSection eyebrow="A home that works better" title="Comfort and going electric"><p className={styles.sectionIntro}>Start with the home and your daily needs, then choose the right equipment.</p><div className="guide-card-grid">
        <article className="guide-card guide-card-wide"><span>Home energy upgrades</span><h3>What should I improve first?</h3><p>Put safety, comfort and the building first. Plan appliance replacements, solar and storage in a useful order.</p><Link href="/guides/home-energy-upgrades">Plan home energy upgrades</Link></article>
        <article className="guide-card"><span>Heating and cooling</span><h3>How do I choose the right heating system?</h3><p>Check the rooms you use, local climate, noise and installation work before comparing system sizes.</p><Link href="/guides/heating">Compare heating and cooling</Link></article>
        <article className="guide-card"><span>Heat pumps</span><h3>What is a heat pump, and which kind do I need?</h3><p>Understand the difference between reverse-cycle air conditioning and heat pump hot water.</p><Link href="/guides/heat-pumps">Understand heat pumps</Link></article>
        <article className="guide-card"><span>Hot water</span><h3>Which hot-water system fits my household?</h3><p>Compare storage, hot-water demand, recovery time, running costs and the complete installed price.</p><Link href="/guides/hot-water">Compare hot-water options</Link></article>
        <article className="guide-card"><span>Insulation and draughts</span><h3>Why is my home hard to heat or cool?</h3><p>Understand unwanted heat flow, air leaks and ventilation. Check the building before replacing equipment.</p><Link href="/guides/insulation-draught-proofing">Explore insulation and draught proofing</Link></article>
        <article className="guide-card"><span>Electric cooking</span><h3>What does switching to induction involve?</h3><p>Check cookware, kitchen fit, electrical circuits, ventilation and safe removal of gas appliances.</p><Link href="/guides/cooking">Plan electric cooking</Link></article>
        <article className="guide-card"><span>EV charging</span><h3>How should I charge an electric car at home?</h3><p>Match your driving and parking to solar, tariffs, charging power and any approval or switchboard work.</p><Link href="/guides/ev-charging">Plan home EV charging</Link></article>
      </div><div className={styles.inlineLinks}><Link href="/case-studies#leaving-gas">See the cost of leaving gas explained</Link><Link href="/plan">Build my home energy roadmap</Link></div></GuideSection>
    </div>

    <div id="assessments-and-ratings" className={styles.sectionAnchor}>
      <GuideSection eyebrow="Get the right evidence" title="Assessments and ratings"><p className={styles.sectionIntro}>A practical home assessment, a formal rating and building approval work answer different questions.</p><div className="guide-card-grid">
        <article className="guide-card"><span>Assessment checklist</span><h3>What should I prepare for an assessment?</h3><p>Find the bills, property details or building plans relevant to the service you need.</p><Link href="/guides/prepare-for-home-energy-assessment">Prepare for an assessment</Link></article>
        <article className="guide-card"><span>Assessment costs</span><h3>Is a free home assessment available?</h3><p>Check paid services and how to verify a genuine council or government program in your area.</p><Link href="/guides/free-home-energy-assessments">Understand assessment costs</Link></article>
        <article className="guide-card"><span>Myths and facts</span><h3>What can an assessment tell me?</h3><p>Separate ratings and useful recommendations from savings that depend on your home and household.</p><Link href="/guides/home-energy-assessment-myths">Read assessment questions and answers</Link></article>
        <article className="guide-card"><span>Building approvals</span><h3>How do NCC, NatHERS and BASIX fit together?</h3><p>See which system sets requirements, which models the home and how NSW BASIX fits the approval process.</p><Link href="/guides/ncc-nathers-basix">Understand building assessment pathways</Link></article>
        <article className="guide-card"><span>Ratings and certifications</span><h3>What does a green building label mean?</h3><p>Compare NatHERS, Home Energy Rating, Green Star and NABERS without treating their star scales as the same.</p><Link href="/guides/green-building-certifications-australia">Understand ratings and certifications</Link></article>
        <article className="guide-card"><span>Building diagnostics</span><h3>Can testing help find air leaks and heat loss?</h3><p>Learn what blower door testing and thermal imaging can show and what a useful report should contain.</p><Link href="/blower-door-thermal-imaging">Explore air leakage and thermal imaging</Link></article>
      </div><div className={styles.inlineLinks}><Link href="/assessments">Choose an assessment service</Link></div></GuideSection>
    </div>

    <div id="quotes-and-support" className={styles.sectionAnchor}>
      <GuideSection eyebrow="Before you commit" title="Quotes, rebates and reliable support"><p className={styles.sectionIntro}>Get the scope and final price clear. Confirm support with the program owner before relying on it.</p><div className="guide-card-grid">
        <article className="guide-card"><span>Project preparation</span><h3>What belongs in the project and the quote?</h3><p>Prepare for urgent replacements, owner or strata permissions, renter-friendly options and your budget.</p><Link href="/guides/project-preparation">Prepare an upgrade project</Link></article>
        <article className="guide-card"><span>Energy certificates</span><h3>What are STCs and VEECs worth?</h3><p>See how certificates can affect an upgrade discount and review dated, indicative price information.</p><Link href="/guides/certificate-prices">Open the certificate price tracker</Link></article>
        <article className="guide-card"><span>Rebates and assistance</span><h3>What support applies where I live?</h3><p>Choose your state or territory, then check eligibility, current availability and the official source.</p><Link href="/rebates">Check rebates and assistance</Link></article>
        <article className="guide-card"><span>Trusted resources</span><h3>Where can I check a supplier or a claim?</h3><p>Find independent sources and check installer accreditation, approved products, warranties and quote scope.</p><Link href="/trusted-suppliers">Open trusted resources and supplier checks</Link></article>
      </div></GuideSection>
    </div>

    <section className="guide-callout guide-callout-primary"><div><h2>Turn what you have learned into your next step</h2><p>Your private roadmap brings the relevant comparisons, home improvements and assessment options together around your goal.</p></div><Link href="/plan">Build my roadmap</Link></section>
  </GuideShell>;
}
