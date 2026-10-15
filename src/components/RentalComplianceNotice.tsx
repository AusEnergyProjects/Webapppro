import Link from "next/link";
import { AEA_RENTAL_UPDATES } from "@/lib/aea-rental-updates.mjs";
import styles from "./RentalComplianceNotice.module.css";

export function RentalComplianceNotice({ showAssessmentLink = true }: { showAssessmentLink?: boolean }) {
  return <aside className={styles.notice} aria-label="Victorian rental law changes">
    <div className={styles.heading}><span>For Victorian property managers</span><h2>Rental laws have changed. Get your portfolio ready.</h2></div>
    <a className={styles.officialLink} href={AEA_RENTAL_UPDATES.url} target="_blank" rel="noopener noreferrer">Official Victorian rental law changes: Consumer Affairs Victoria <span aria-hidden="true">↗</span></a>
    <p>{AEA_RENTAL_UPDATES.summary}</p>
    <p>Advertising a rental that does not meet the minimum standards can be an offence. Consumer Affairs Victoria can require agents and rental providers to produce their compliance records.</p>
    <p>Annual smoke-alarm checks and blind-cord safety requirements also apply. Further energy-efficiency standards begin phasing in from 1 March 2027.</p>
    {showAssessmentLink ? <Link className={styles.action} href="/minimum-rental-standards">See the changes and our rental compliance services <span aria-hidden="true">→</span></Link> : null}
  </aside>;
}

export function RentalProgramExperience() {
  return <section className={styles.experience} aria-label="Rental portfolio services and program experience">
    <div className={styles.heading}><span>Assessments. Records. Ongoing support.</span><h2>Practical support for the changes ahead.</h2></div>
    <p>Bring the new minimum-standards record requirements and 2027 upgrade planning into your portfolio&apos;s compliance schedule. We can work alongside your existing providers, with Australian Energy Assessments responsible for the assessments, reports and follow-up work you engage us to deliver.</p>
    <p>{AEA_RENTAL_UPDATES.programWork}</p>
    <p>Where you need broader support, our services cover minimum standards assessments, smoke-alarm servicing, licensed electrical checks and qualified gas safety checks. We can manage the appointments, records and due dates with your team, with scope and pricing confirmed upfront.</p>
    <p>Talk through the changes, the suburbs you manage and where your team needs support. A de-identified rental compliance assessment report is available on request.</p>
    <Link className={styles.action} href="/book-an-assessment">Discuss the changes for your portfolio <span aria-hidden="true">→</span></Link>
  </section>;
}
