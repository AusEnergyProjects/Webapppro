import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PublicRentalAssessmentRequestForm } from "@/components/PublicRentalAssessmentRequestForm";
import { TLinkBrand } from "@/components/TLinkChrome";

export const metadata = {
  title: "Request a Victorian Rental Assessment | TLink",
  description: "Request a Victorian rental minimum standards assessment, with optional electrical, gas and smoke alarm checks.",
};

export default function RentalAssessmentRequestPage() {
  return <main className="wrap rental-assessment-request-page">
    <SiteHeader active="assessments" />
    <header className="guide-hero assessments-hero">
      <TLinkBrand context="Rental assessment request" />
      <span>Victorian rental properties</span>
      <h1>Request the assessment. We will confirm the booking.</h1>
      <p>Rental providers and authorised agents can send the property and scope without creating an account. Victorian rental minimum standards are selected by default, but can be unticked. Electrical, gas and smoke alarm checks can be requested separately or together.</p>
      <div className="assessment-asat"><strong>This form does not book a job</strong><span>We first confirm authority, scope, price, property access and appointment details. A TLink job is created and assigned only after that review.</span></div>
    </header>
    <PublicRentalAssessmentRequestForm />
    <section className="assessment-upload-boundary"><div><span>Already working with us?</span><h2>Your assessor can also complete the workflow from TLink</h2><p>Assigned assessors see their schedule, open the job, save each section and issue the final report from the app or web portal.</p></div><Link href="/direct-trade/access">Open TLink access</Link></section>
    <SiteFooter>Do not place tenant identity details, access codes, payment information or documents in this public request. We will collect only what is needed after authority and scope are confirmed.</SiteFooter>
  </main>;
}
