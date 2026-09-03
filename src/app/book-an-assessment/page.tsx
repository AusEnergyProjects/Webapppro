import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { CALENDLY_BOOKING_URL, CALENDLY_EMBED_URL } from "@/lib/assessment-booking";
import { PUBLIC_SITE } from "@/lib/public-site";
import bookingStyles from "@/components/AssessmentBooking.module.css";
import styles from "./page.module.css";

const path = "/book-an-assessment";
const canonical = `${PUBLIC_SITE.apexUrl}${path}`;
const title = "Book a 5-Minute Call | Australian Energy Assessments";
const description = "Choose a time for a five-minute call to confirm your property, assessment needs and next step with Australian Energy Assessments.";
const image = `${PUBLIC_SITE.apexUrl}/aea-home-energy-plan-og-v2.png`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical },
  openGraph: {
    title,
    description,
    url: canonical,
    type: "website",
    siteName: PUBLIC_SITE.name,
    locale: "en_AU",
    images: [{
      url: image,
      width: 1731,
      height: 909,
      alt: "Book a short call with Australian Energy Assessments",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service",
      "@id": `${canonical}#service`,
      name: "Five-minute assessment enquiry call",
      serviceType: "Customer enquiry and booking support",
      description,
      url: canonical,
      provider: { "@id": PUBLIC_SITE.organizationId },
      areaServed: { "@type": "Country", name: "Australia" },
      availableChannel: [
        {
          "@type": "ServiceChannel",
          serviceUrl: CALENDLY_BOOKING_URL,
        },
        {
          "@type": "ServiceChannel",
          servicePhone: {
            "@type": "ContactPoint",
            telephone: PUBLIC_SITE.telephone,
            contactType: "assessment enquiries",
          },
        },
      ],
      potentialAction: {
        "@type": "ReserveAction",
        name: "Book a five-minute enquiry call",
        target: {
          "@type": "EntryPoint",
          urlTemplate: CALENDLY_BOOKING_URL,
          actionPlatform: [
            "https://schema.org/DesktopWebPlatform",
            "https://schema.org/MobileWebPlatform",
          ],
        },
        result: {
          "@type": "Reservation",
          name: "Five-minute assessment call",
        },
      },
    },
    {
      "@type": "ContactPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: "en-AU",
      about: { "@id": `${canonical}#service` },
      mainEntity: { "@id": `${canonical}#service` },
      publisher: { "@id": PUBLIC_SITE.organizationId },
    },
  ],
};

export default function BookAnAssessmentPage() {
  return (
    <main className="wrap">
      <JsonLd data={structuredData} />
      <SiteHeader active="assessments" />

      <header className={styles.hero}>
        <div className={styles.heroContent}>
          <span className={styles.eyebrow}>Australian Energy Assessments</span>
          <h1>Book a five-minute call</h1>
          <p>Choose a time that suits you. We will confirm the property, what you need and the next step. This short call is for planning only. It is not the assessment itself.</p>
        </div>
      </header>

      <section className={bookingStyles.bookingCard} aria-labelledby="choose-call-time">
        <div className={styles.bookingHeading}>
          <div>
            <span>Choose a time</span>
            <h2 id="choose-call-time">Available five-minute calls</h2>
          </div>
        </div>

        <div className={bookingStyles.embedShell}>
          <iframe
            className={bookingStyles.embed}
            src={CALENDLY_EMBED_URL}
            title="Choose a five-minute call time with Australian Energy Assessments"
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>

        <div className={styles.confirmation}>
          <span aria-hidden="true">&#10003;</span>
          <div>
            <strong>Your booking updates the Australian Energy Assessments calendar</strong>
            <p>After you choose a time and complete the basic booking questions, Calendly adds the call to the connected Australian Energy Assessments calendar and emails the booking details to the address you enter. Our team receives the appointment notification.</p>
          </div>
        </div>

        <p className={bookingStyles.privacyNote}>Calendly handles the booking details and calendar event. Read the <Link href="/privacy" style={{ color: "#087f73", fontWeight: 800 }}>Australian Energy Assessments privacy notice</Link> and <a href="https://calendly.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#087f73", fontWeight: 800 }}>Calendly privacy notice</a>.</p>
      </section>

      <aside className={styles.help} aria-label="Alternative contact options">
        <div>
          <strong>Would you rather speak now?</strong>
          <span>Call or email the assessment team during business hours.</span>
        </div>
        <a className="btn" href={PUBLIC_SITE.phoneHref}>Call {PUBLIC_SITE.phoneDisplay}</a>
        <a className="btn ghost" href={`mailto:${PUBLIC_SITE.email}`}>Email us</a>
      </aside>

      <SiteFooter>Book a five-minute planning call before an assessment. We will confirm the property, what you need and the next step. It is not the assessment itself.</SiteFooter>
    </main>
  );
}
