import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PUBLIC_SITE } from "@/lib/public-site";

const canonical = `${PUBLIC_SITE.apexUrl}/faq`;
const title = "Home Energy Assessment FAQ | NatHERS and Ratings";
const description = "Clear answers about Home Energy Rating, NatHERS, Whole of Home, BASIX, legacy Scorecard searches, coverage, evidence and booking an energy assessor.";
const image = `${PUBLIC_SITE.platformUrl}/aea-home-energy-plan-og-v2.png`;

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
      alt: "Australian Energy Assessments home energy assessment guidance",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [image],
  },
};

type FaqEntry = {
  question: string;
  answer: string;
};

type FaqGroup = {
  eyebrow: string;
  title: string;
  questions: readonly FaqEntry[];
};

const faqGroups: readonly FaqGroup[] = [
  {
    eyebrow: "Choose the right pathway",
    title: "Assessment names and building stages",
    questions: [
      {
        question: "Which energy assessment applies to a home that is already built?",
        answer: "Ask about the current Home Energy Rating pathway. It is an on-site assessment of the completed home and provides a Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, estimated annual energy use and upgrade guidance.",
      },
      {
        question: "Which assessment applies to a proposed new home?",
        answer: "A proposed new home normally uses the relevant plan-based NatHERS pathway. Depending on the project and jurisdiction, the certificate can include a thermal Star Rating and a Whole of Home rating. The certifier, council or other approval authority determines the evidence the project must provide.",
      },
      {
        question: "Is Home Energy Rating the same as NatHERS Whole of Home?",
        answer: "No. Home Energy Rating is the current consumer service for a completed home. Whole of Home is the 0 to 100+ rating used with the thermal Star Rating in the applicable new-home NatHERS certificate pathway.",
      },
      {
        question: "Can I still book a Residential Efficiency Scorecard assessment?",
        answer: "No. Residential Efficiency Scorecard closed on 23 June 2026. The term remains useful when reading older pages or certificates, but a household seeking a current existing-home assessment should ask about Home Energy Rating.",
      },
      {
        question: "Does an existing-home Home Energy Rating prove National Construction Code compliance?",
        answer: "No. An existing-home certificate cannot demonstrate National Construction Code compliance. A new home or applicable major renovation that needs regulatory evidence must use the relevant new-home certificate and approval pathway.",
      },
    ],
  },
  {
    eyebrow: "Coverage and delivery",
    title: "Where and how assessments are completed",
    questions: [
      {
        question: "Can Australian Energy Assessments complete new-home NatHERS work anywhere in Australia?",
        answer: "Plan-based NatHERS and Whole of Home work can be delivered remotely for projects across Australia, subject to complete plans and specifications and the current requirements for the project location and approval pathway.",
      },
      {
        question: "Where are on-site existing-home assessments available?",
        answer: "Existing-home ratings require a property visit. Current field delivery is primarily in New South Wales and Victoria. Availability, travel and timing for other Australian locations are confirmed before a booking is accepted.",
      },
      {
        question: "How long does an existing-home assessment take?",
        answer: "Official guidance says an on-site existing-home assessment typically takes about two to three hours, depending on the home and the evidence that can be recorded safely. The five-minute call on this website is only a logistics call and is not the assessment itself.",
      },
      {
        question: "What happens during the five-minute booking call?",
        answer: "The call confirms the property location, building stage, reason for the assessment, likely pathway and the evidence needed next. It helps prevent the wrong service being booked and does not replace the assessment.",
      },
    ],
  },
  {
    eyebrow: "Evidence and results",
    title: "What to prepare and how to use the output",
    questions: [
      {
        question: "What documents are needed for a new-home NatHERS assessment?",
        answer: "Prepare current floor plans, elevations, sections, orientation and site details, construction and insulation specifications, glazing and shading information, and the proposed fixed appliances needed for Whole of Home. The assessor will identify gaps before treating the model as final.",
      },
      {
        question: "What should I prepare for an existing-home rating?",
        answer: "Provide safe access to the relevant parts of the home, known renovation history, information about major fixed appliances and the decision the rating should support. Unknown or inaccessible details must be handled under the current assessment method rather than guessed as verified facts.",
      },
      {
        question: "Does a rating guarantee my bills or upgrade savings?",
        answer: "No. Ratings and annual energy estimates are modelled decision support. Actual bills and savings depend on household behaviour, tariffs, weather, product selection, design, installation quality and changes made after the assessment.",
      },
      {
        question: "Is a general home energy audit automatically an official rating?",
        answer: "No. Home energy audit and energy assessment are broad search terms. Before relying on a service, confirm the assessment method, assessor pathway, certificate or report produced, property stage and the decision or approval the output is meant to support.",
      },
      {
        question: "How should I compare upgrade recommendations?",
        answer: "Start with the verified constraint, then compare scopes, assumptions, product evidence, installation requirements and interactions between measures. A rating can guide priorities, but site-specific design, regulated work and final quotes remain separate decisions.",
      },
    ],
  },
];

const faqs = faqGroups.flatMap((group) => group.questions);

const officialSources = [
  {
    title: "Existing-home Home Energy Rating",
    description: "Official guidance on the assessment process, typical visit duration, certificate ratings and upgrade information.",
    href: "https://www.homeenergyrating.gov.au/households/existing-homes/how-get-assessment",
  },
  {
    title: "New-home NatHERS certificate",
    description: "Official guidance on thermal Star Ratings, Whole of Home and the information shown on a new-home certificate.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
  },
  {
    title: "Scorecard closure transition",
    description: "Official confirmation that Residential Efficiency Scorecard closed during the 2026 national existing-home rollout.",
    href: "https://www.homeenergyrating.gov.au/news/nathers-news-june-edition-nathers-expansion-stage-2-rolling-out-july",
  },
  {
    title: "NSW BASIX requirements",
    description: "NSW Planning Portal guidance on the BASIX planning pathway and current project requirements.",
    href: "https://www.planningportal.nsw.gov.au/basix/about-basix",
  },
] as const;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: "en-AU",
      dateModified: "2026-09-01",
      publisher: { "@id": PUBLIC_SITE.organizationId },
      isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId },
      breadcrumb: { "@id": `${canonical}#breadcrumb` },
      mainEntity: { "@id": `${canonical}#faq` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Assessments", item: `${PUBLIC_SITE.apexUrl}/assessments` },
        { "@type": "ListItem", position: 3, name: "Frequently asked questions", item: canonical },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${canonical}#faq`,
      isPartOf: { "@id": `${canonical}#webpage` },
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ],
};

export default function FrequentlyAskedQuestionsPage() {
  return (
    <main className="wrap assessments-page">
      <JsonLd data={structuredData} />
      <SiteHeader active="assessments" />

      <nav className="guide-source-links" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/assessments">Assessments</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Frequently asked questions</span>
      </nav>

      <header className="guide-hero assessments-hero">
        <span>Home energy assessment answers</span>
        <h1>Home Energy Rating, NatHERS, BASIX and energy assessor FAQ</h1>
        <p>Use the building stage and required output to choose the right pathway. These answers separate current existing-home terminology, plan-based new-home certificates, NSW BASIX requirements and legacy Scorecard searches.</p>
      </header>

      <div className="assessment-asat">
        <strong>Official guidance reviewed 1 September 2026</strong>
        <span>Building, planning and assessment requirements can change. Confirm the current project location, approval pathway, assessment method and required evidence before relying on a rating or certificate.</span>
      </div>

      {faqGroups.map((group) => (
        <section className="assessment-section" aria-labelledby={`faq-${group.eyebrow.replaceAll(" ", "-").toLowerCase()}`} key={group.title}>
          <div className="guide-section-heading">
            <span>{group.eyebrow}</span>
            <h2 id={`faq-${group.eyebrow.replaceAll(" ", "-").toLowerCase()}`}>{group.title}</h2>
          </div>
          <div className="assessment-two-column">
            {group.questions.map((faq) => (
              <article key={faq.question}>
                <span>Question</span>
                <h2>{faq.question}</h2>
                <p>{faq.answer}</p>
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="assessment-section" aria-labelledby="faq-official-sources">
        <div className="guide-section-heading">
          <span>Check the source</span>
          <h2 id="faq-official-sources">Official assessment and planning guidance</h2>
        </div>
        <div className="assessment-two-column">
          {officialSources.map((source) => (
            <article key={source.href}>
              <span>Official source</span>
              <h2>{source.title}</h2>
              <p>{source.description}</p>
              <a href={source.href} target="_blank" rel="noreferrer">Read the official guidance</a>
            </article>
          ))}
        </div>
      </section>

      <section className="assessment-two-column">
        <article>
          <span>Current and legacy terms</span>
          <h2>Compare Home Energy Rating, NatHERS and Scorecard</h2>
          <p>See the three terms side by side before choosing an assessment or relying on an older search result.</p>
          <Link href="/home-energy-rating-vs-nathers-vs-scorecard">Open the terminology guide</Link>
        </article>
        <article>
          <span>Assessment pathways</span>
          <h2>Start with the property stage and location</h2>
          <p>Compare existing-home, new-home and NSW BASIX services, the evidence each pathway needs and the output it provides.</p>
          <Link href="/assessments">Compare assessment pathways</Link>
        </article>
      </section>

      <section className="assessment-upload-boundary">
        <div>
          <span>Need a project-specific answer?</span>
          <h2>Book a five-minute logistics call</h2>
          <p>Tell us where the property is, whether it is proposed or already built and what the assessment needs to support. We will confirm the likely pathway and next evidence without treating the call as the assessment itself.</p>
        </div>
        <Link href="/book-an-assessment">Book now</Link>
        <a href={PUBLIC_SITE.phoneHref}>Call {PUBLIC_SITE.phoneDisplay}</a>
      </section>

      <SiteFooter>These answers are general until the property, project stage, location, evidence and approval pathway are confirmed. Current official guidance and the relevant authority remain the source of truth.</SiteFooter>
    </main>
  );
}
