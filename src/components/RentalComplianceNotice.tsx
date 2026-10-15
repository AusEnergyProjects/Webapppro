import Link from "next/link";
import { AEA_RENTAL_UPDATES } from "@/lib/aea-rental-updates.mjs";
import { CALENDLY_BOOKING_URL } from "@/lib/assessment-booking";
import styles from "./RentalComplianceNotice.module.css";

export function RentalComplianceNotice({ showAssessmentLink = true }: { showAssessmentLink?: boolean }) {
  return <aside className={styles.notice} aria-label="Victorian rental law changes">
    <div className={styles.heading}><span>For Victorian property managers</span><h2>Rental laws have changed. Get your portfolio ready.</h2></div>
    <a className={styles.officialLink} href={AEA_RENTAL_UPDATES.url} target="_blank" rel="noopener noreferrer">Official Victorian rental law changes: Consumer Affairs Victoria <span aria-hidden="true">↗</span></a>
    <p>{AEA_RENTAL_UPDATES.summary}</p>
    <p>{AEA_RENTAL_UPDATES.advertisingPenalty}</p>
    <p>{AEA_RENTAL_UPDATES.recordsPenalty}</p>
    <p>{AEA_RENTAL_UPDATES.penaltyBasis} <a className={styles.officialLink} href={AEA_RENTAL_UPDATES.penaltiesUrl} target="_blank" rel="noopener noreferrer">Check the official penalties</a></p>
    <p>Annual smoke-alarm checks and blind-cord safety requirements also apply. Further energy-efficiency standards begin phasing in from 1 March 2027.</p>
    {showAssessmentLink ? <Link className={styles.action} href="/minimum-rental-standards">See the changes and our rental compliance services <span aria-hidden="true">→</span></Link> : null}
  </aside>;
}

export function RentalProgramExperience() {
  return <section className={styles.experience} aria-label="Rental portfolio services and program experience">
    <div className={styles.heading}><span>Assessments. Records. Ongoing support.</span><h2>Practical support for the changes ahead.</h2></div>
    <p>Bring the new minimum-standards record requirements and 2027 upgrade planning into your portfolio&apos;s compliance schedule.</p>
    <p>{AEA_RENTAL_UPDATES.teamExperience}</p>
    <p>{AEA_RENTAL_UPDATES.programWork}</p>
    <p>{AEA_RENTAL_UPDATES.reportSupport}</p>
    <p>We can work alongside your existing providers, with Australian Energy Assessments responsible for the assessments, reports and follow-up work you engage us to deliver.</p>
    <p>Where you need broader support, our services cover minimum standards assessments and smoke-alarm servicing. Our electrical and gas safety checks are carried out by our appropriately licensed or registered tradespeople. We can manage the appointments, records and due dates with your team, with scope and pricing confirmed upfront.</p>
    <p>Call James directly on <a className={styles.officialLink} href="tel:+61473378088">0473 378 088</a> to discuss the changes and how we can support your team. A de-identified rental compliance assessment report is available on request.</p>
    <a className={styles.action} href={CALENDLY_BOOKING_URL} target="_blank" rel="noopener noreferrer">Prefer a time that suits you? Book a call with Calendly <span aria-hidden="true">↗</span></a>
  </section>;
}
