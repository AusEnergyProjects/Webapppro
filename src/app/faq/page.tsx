import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PUBLIC_SITE } from "@/lib/public-site";
import styles from "@/components/FaqAccordion.module.css";

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
  id: string;
  eyebrow: string;
  title: string;
  questions: readonly FaqEntry[];
};

const faqGroups: readonly FaqGroup[] = [
  {
    id: "rating-basics",
    eyebrow: "Start with the terms",
    title: "Home energy rating and NatHERS basics",
    questions: [
      {
        question: "What is NatHERS?",
        answer: "NatHERS is the Nationwide House Energy Rating Scheme. It provides nationally consistent methods and approved software for rating the energy performance of Australian homes. The assessment process and output differ for a proposed new home and a completed existing home, so the property stage must be confirmed first.",
      },
      {
        question: "What does a NatHERS thermal Star Rating measure?",
        answer: "The 0 to 10 Star Rating models how much heating and cooling a home's design needs to remain comfortable in its climate. It considers features such as orientation, layout, insulation, glazing, shading, sealing assumptions and construction. It is a model of the building shell, not a prediction of one household's bills.",
      },
      {
        question: "What is a Whole of Home rating?",
        answer: "Whole of Home is a 0 to 100+ rating that models energy used by major fixed systems and the contribution of on-site generation. Depending on the applicable method, this can include heating and cooling, hot water, lighting, pool or spa pumps, solar and batteries. It complements the thermal Star Rating rather than replacing it.",
      },
      {
        question: "Can a Home Energy Rating or Whole of Home score exceed 100?",
        answer: "Yes. A score above 100 can occur when modelled annual on-site generation is greater than the modelled energy use included in the rating method. It does not guarantee a zero electricity bill because tariffs, export limits, household plug loads, behaviour, weather and system performance still affect the real result.",
      },
    ],
  },
  {
    id: "choose-an-assessment",
    eyebrow: "Choose the right pathway",
    title: "Existing homes, new homes and BASIX",
    questions: [
      {
        question: "Which energy assessment applies to a home that is already built?",
        answer: "Ask about the current Home Energy Rating pathway. It requires an on-site assessment of the completed home and can provide a Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, estimated annual energy use and upgrade guidance. Confirm the exact output before booking because a general energy audit is not automatically an official rating.",
      },
      {
        question: "Which assessment applies to a proposed new home?",
        answer: "A proposed new home normally uses the relevant plan-based NatHERS pathway. Depending on the project and jurisdiction, the certificate can include a thermal Star Rating and a Whole of Home rating. The certifier, council or other approval authority determines the evidence the project must provide.",
      },
      {
        question: "Is Home Energy Rating the same as NatHERS Whole of Home?",
        answer: "No. Home Energy Rating is the current consumer service for a completed home. Whole of Home is the 0 to 100+ rating used with the thermal Star Rating in applicable NatHERS certificate pathways. The names are related, but they are not interchangeable services.",
      },
      {
        question: "How do BASIX and NatHERS relate for a NSW project?",
        answer: "BASIX is the NSW planning pathway for sustainability requirements. NatHERS modelling and certificates may form part of the thermal and energy evidence for a project, but BASIX and NatHERS are not the same approval. The NSW Planning Portal, the project's certifier and the current project settings determine what must be lodged.",
      },
      {
        question: "Is a general home energy audit automatically an official rating?",
        answer: "No. Home energy audit and energy assessment are broad terms. Before relying on a service, confirm the assessment method, assessor pathway, certificate or report produced, property stage and the decision or approval the output is meant to support.",
      },
    ],
  },
  {
    id: "new-homes",
    eyebrow: "Plan-based assessments",
    title: "New homes, apartments and renovations",
    questions: [
      {
        question: "Can Australian Energy Assessments complete new-home NatHERS work anywhere in Australia?",
        answer: "Plan-based NatHERS and Whole of Home work can be delivered remotely for projects across Australia, subject to complete plans and specifications and the current requirements for the project location and approval pathway.",
      },
      {
        question: "When should a new-home NatHERS assessment begin?",
        answer: "Begin while the design can still change, ideally before construction documentation and product selections are locked in. Early modelling makes it easier to test orientation, glazing, shading, insulation and layout changes before they become expensive variations.",
      },
      {
        question: "What documents are needed for a new-home NatHERS assessment?",
        answer: "Prepare current floor plans, elevations, sections, orientation and site details, construction and insulation specifications, glazing and shading information, and the proposed fixed appliances needed for Whole of Home. The assessor should identify material gaps instead of treating assumptions as confirmed selections.",
      },
      {
        question: "Does every new home in Australia simply need a 7 Star rating?",
        answer: "No single sentence covers every approval. The National Construction Code provides a national framework, but adoption dates, building classifications, apartment averaging, state pathways such as BASIX and project-specific approvals matter. Confirm the current target and Whole of Home requirement with the relevant authority before design decisions are finalised.",
      },
      {
        question: "What happens if a design misses its required rating target?",
        answer: "The model can be used to test changes such as glazing, insulation, shading, sealing assumptions, ceiling fans or layout refinements. The appropriate response depends on the cause of the shortfall, buildability and cost. Changes should be agreed with the designer and reflected consistently in the final plans, specifications and certificate.",
      },
      {
        question: "Do apartments, extensions and major renovations use the same process?",
        answer: "Not always. Apartments can have unit and building-level requirements, while an extension or renovation may follow a different state or approval pathway depending on its scope. Confirm the building classification, jurisdiction and approval authority before commissioning a certificate.",
      },
    ],
  },
  {
    id: "existing-homes",
    eyebrow: "On-site assessments",
    title: "Existing-home visits and outputs",
    questions: [
      {
        question: "Where are on-site existing-home assessments available?",
        answer: "Existing-home ratings require a property visit. Current field delivery is primarily in New South Wales and Victoria. Availability, travel and timing for other Australian locations are confirmed before a booking is accepted.",
      },
      {
        question: "What happens during an existing-home assessment?",
        answer: "The assessor records the home's construction, insulation, glazing, shading, orientation and relevant fixed systems using the current assessment method. Safe access, observable evidence and any reliable supporting records matter. The visit is evidence gathering, not invasive building work.",
      },
      {
        question: "Do I need building plans for an existing-home rating?",
        answer: "Plans are not normally essential because the home is inspected on site. Available plans, renovation records, product documents or photographs can still help confirm details that are difficult to observe. Unknown information must be handled under the method rather than guessed as verified.",
      },
      {
        question: "How should I prepare, and does someone need to attend?",
        answer: "Arrange lawful access to the home and relevant services, make accessible areas safe to inspect, and gather any useful renovation or product records. An owner, occupier or authorised person should be available when access, consent or property-specific questions need to be resolved.",
      },
      {
        question: "How long does an existing-home assessment take?",
        answer: "Official guidance says an on-site existing-home assessment typically takes about two to three hours. The actual duration depends on the home, access and the evidence that can be recorded safely. The five-minute call on this website is only a logistics call and is not the assessment itself.",
      },
      {
        question: "What do I receive, and how long does the final result take?",
        answer: "The agreed scope should state the certificate or report, ratings, modelled energy information and upgrade guidance to be delivered. Turnaround depends on the property, evidence quality and any follow-up needed, so Australian Energy Assessments confirms timing after reviewing the scope rather than promising one universal deadline.",
      },
    ],
  },
  {
    id: "evidence-and-certificates",
    eyebrow: "Evidence and boundaries",
    title: "Accuracy, certificates and compliance",
    questions: [
      {
        question: "Who can issue an official NatHERS assessment or certificate?",
        answer: "Use an assessor who is authorised for the relevant scheme, software and assessment pathway. Ask for the assessor's current accreditation or authorisation details and confirm that the output is accepted for the decision or approval you need. A business description alone is not proof of a current credential.",
      },
      {
        question: "How accurate is a home energy rating?",
        answer: "A rating is a standardised model built from the recorded property, climate data and the assumptions required by the method. Its usefulness depends on accurate inputs and evidence. It is not a live measurement of future household behaviour, workmanship, tariffs or weather.",
      },
      {
        question: "Does an existing-home Home Energy Rating prove National Construction Code compliance?",
        answer: "No. An existing-home certificate cannot demonstrate National Construction Code compliance. A new home or applicable major renovation that needs regulatory evidence must use the relevant new-home certificate and approval pathway.",
      },
      {
        question: "Can I reuse a rating after the design, products or home have changed?",
        answer: "Do not assume so. A certificate or report describes the assessed design or property at a particular time. Material changes to construction, glazing, insulation, appliances, solar or the building itself may require the model, recommendations or certificate to be reviewed.",
      },
      {
        question: "Does a rating guarantee my bills, comfort or upgrade savings?",
        answer: "No. Ratings and annual energy estimates are modelled decision support. Actual bills, comfort and savings depend on household behaviour, tariffs, weather, product selection, design, installation quality, maintenance and changes made after the assessment.",
      },
    ],
  },
  {
    id: "upgrades-and-decisions",
    eyebrow: "Using the result",
    title: "Upgrades, rebates, rentals and finance",
    questions: [
      {
        question: "How should I compare upgrade recommendations?",
        answer: "Start with the verified constraint, then compare scopes, assumptions, product evidence, installation requirements and interactions between measures. A rating can guide priorities, but site-specific design, regulated work and final quotes remain separate decisions.",
      },
      {
        question: "How do solar and batteries affect a Whole of Home rating?",
        answer: "Eligible on-site generation and storage can improve the modelled Whole of Home result, but the effect depends on the current method, system size, orientation and the rest of the home. A higher modelled score does not by itself prove bill savings or financial payback.",
      },
      {
        question: "Does electrification always come before insulation or draught sealing?",
        answer: "No. The best sequence depends on the home's verified weaknesses, safety, equipment condition, climate, budget and planned works. Improving the building shell can reduce heating and cooling demand, while efficient electric systems and solar may address different parts of energy use. The measures should be assessed as a system.",
      },
      {
        question: "Can an assessment confirm a rebate or green-loan approval?",
        answer: "Not by itself. Programs and lenders set their own current eligibility, evidence, product and timing rules. A rating or report may support an application, but eligibility should be checked directly before committing to an upgrade or finance contract.",
      },
      {
        question: "Does a Home Energy Rating prove rental minimum-standard compliance?",
        answer: "Not automatically. Rental standards are set by each state or territory and can require specific evidence, products, installation work or exemptions. A rating may help plan improvements, but the relevant tenancy rules and regulator determine legal compliance.",
      },
      {
        question: "Can energy upgrades fix condensation, mould or health problems?",
        answer: "They may reduce contributing factors such as cold surfaces, uncontrolled air leakage or temperature extremes, but they are not a universal diagnosis or treatment. Moisture sources, ventilation, drainage, leaks and health concerns may require qualified building, ventilation or health advice.",
      },
    ],
  },
  {
    id: "booking-and-legacy-terms",
    eyebrow: "Before you book",
    title: "Costs, independence and legacy Scorecard searches",
    questions: [
      {
        question: "Can I still book a Residential Efficiency Scorecard assessment?",
        answer: "No. Residential Efficiency Scorecard closed on 23 June 2026. An older Scorecard certificate can still describe the home at the time it was assessed, but it is not interchangeable with a current Home Energy Rating. Ask about the current pathway if a new rating is required.",
      },
      {
        question: "How much does a home energy assessment cost?",
        answer: "Cost depends on the property stage, assessment pathway, dwelling size and complexity, number and quality of documents, location, travel and required output. Australian Energy Assessments confirms the scope before quoting so a five-minute logistics call is not mistaken for the paid assessment.",
      },
      {
        question: "What happens during the five-minute booking call?",
        answer: "The call confirms the property location, building stage, reason for the assessment, likely pathway and the evidence needed next. It helps prevent the wrong service being booked and does not replace the assessment.",
      },
      {
        question: "Is Australian Energy Assessments independent of product sales?",
        answer: "Australian Energy Assessments provides assessment and guidance services rather than using the rating to sell a nominated insulation, glazing, heating, cooling or solar product. Any supplier, installer, referral or commercial relationship relevant to a recommendation should still be disclosed before a customer relies on it.",
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

      <nav className={`guide-source-links ${styles.breadcrumb}`} aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/assessments">Assessments</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">FAQ</span>
      </nav>

      <header className="guide-hero assessments-hero">
        <span>Home energy assessment answers</span>
        <h1>Home Energy Rating, NatHERS, BASIX and energy assessor FAQ</h1>
        <p>Start with one simple question: is the home already built or still on plans? The answers below explain Home Energy Rating, NatHERS, BASIX, old Scorecard terms, costs and what happens during an assessment without assuming you already know the industry language.</p>
      </header>

      <div className="assessment-asat">
        <strong>Official guidance reviewed 1 September 2026</strong>
        <span>Rules can change by location and project. These answers help you understand the options, while the relevant authority confirms what a building or planning application must include.</span>
      </div>

      {faqGroups.map((group) => (
        <section className="assessment-section" aria-labelledby={`${group.id}-heading`} id={group.id} key={group.id}>
          <div className="guide-section-heading">
            <span>{group.eyebrow}</span>
            <h2 id={`${group.id}-heading`}>{group.title}</h2>
          </div>
          <div className={styles.list}>
            {group.questions.map((faq) => (
              <details className={styles.item} key={faq.question}>
                <summary className={styles.question}>
                  <span>{faq.question}</span>
                </summary>
                <div className={styles.answer}>
                  <p>{faq.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      <section className="assessment-section" aria-labelledby="faq-official-sources">
        <div className="guide-section-heading">
          <span>Check the source</span>
          <h2 id="faq-official-sources">Official assessment and planning guidance</h2>
        </div>
        <div className={`assessment-two-column ${styles.support}`}>
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

      <section className={`assessment-two-column ${styles.support}`} aria-label="Related assessment guides">
        <article>
          <span>Existing homes</span>
          <h2>Home Energy Rating</h2>
          <p>See the current on-site pathway, evidence and output for a completed home.</p>
          <Link href="/home-energy-rating-for-existing-homes">Explore existing-home ratings</Link>
        </article>
        <article>
          <span>New homes</span>
          <h2>NatHERS assessments</h2>
          <p>Understand plan-based modelling, documentation and approval boundaries.</p>
          <Link href="/nathers-for-new-homes">Explore new-home NatHERS</Link>
        </article>
        <article>
          <span>Energy use</span>
          <h2>Whole of Home</h2>
          <p>Learn how fixed systems and on-site generation complement the thermal Star Rating.</p>
          <Link href="/nathers-whole-of-home">Explore Whole of Home</Link>
        </article>
        <article>
          <span>NSW projects</span>
          <h2>BASIX assessments</h2>
          <p>See how NSW sustainability requirements and project evidence fit together.</p>
          <Link href="/basix-nsw">Explore BASIX</Link>
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
