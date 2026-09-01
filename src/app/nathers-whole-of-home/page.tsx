import {
  AssessmentServicePage,
  buildAssessmentMetadata,
  type AssessmentServiceCard,
  type AssessmentServiceFaq,
  type AssessmentServiceSource,
  type AssessmentServiceStep,
} from "@/components/AssessmentServicePage";

const path = "/nathers-whole-of-home";
const title = "NatHERS Whole of Home Rating | Australian Energy Assessments";
const description = "Understand the NatHERS Whole of Home rating from 0 to 100+, how it complements the thermal Star Rating and why it applies to the new-home certificate pathway.";

export const metadata = buildAssessmentMetadata({ path, title, description });

const cards: readonly AssessmentServiceCard[] = [
  {
    label: "New-home energy systems",
    title: "Model major fixed energy use",
    description: "Whole of Home modelling brings major fixed appliances and on-site energy systems into the new-home assessment alongside the building's thermal performance.",
    boundaryTitle: "Modelled design inputs",
    boundary: "The result depends on the fixed systems and energy features recorded for the proposed design. It is not a guarantee of a future household's energy use or bill.",
    evidenceTitle: "Inputs commonly considered",
    evidence: ["Heating and cooling systems", "Hot water and fixed appliances", "On-site solar generation", "Battery storage where relevant"],
    outputTitle: "Rating scale",
    output: "A Whole of Home rating from 0 to 100+ on the applicable new-home certificate, with higher results representing stronger modelled whole-home performance.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
    linkLabel: "Read the official certificate guide",
  },
  {
    label: "Two complementary results",
    title: "Read Whole of Home with the Star Rating",
    description: "The thermal Star Rating describes the modelled heating and cooling demand of the building shell. Whole of Home adds the effect of major fixed systems and on-site energy.",
    boundaryTitle: "One does not replace the other",
    boundary: "A strong result on one scale does not remove the need to understand the other. The design, systems and approval evidence need to remain coordinated.",
    evidenceTitle: "Read together",
    evidence: ["Thermal Star Rating from 0 to 10", "Whole of Home rating from 0 to 100+", "Modelled systems and assumptions", "Certificate status and design revision"],
    outputTitle: "Design use",
    output: "A clearer view of how the proposed building fabric and specified energy systems work together under the standardised model.",
    href: "/nathers-for-new-homes",
    linkLabel: "Review the full new-home assessment pathway",
  },
  {
    label: "Terminology boundary",
    title: "Keep existing-home ratings separate",
    description: "A completed home can receive a Home Energy Rating from 0 to 100+ and a Star Rating from 0 to 10 after an on-site assessment, but that service is not called Whole of Home.",
    boundaryTitle: "Whole of Home means new home",
    boundary: "Use Whole of Home for the new-home certificate pathway. Use Home Energy Rating for the current assessment of an existing home.",
    evidenceTitle: "Choose by building stage",
    evidence: ["Proposed design uses new-home assessment", "Completed home uses on-site assessment", "NCC evidence uses the new-home pathway", "Existing-home results support upgrade decisions"],
    outputTitle: "Clear communication",
    output: "Correct naming helps households, designers, assessors and approval authorities understand which evidence is being discussed.",
    href: "/home-energy-rating-for-existing-homes",
    linkLabel: "Understand existing-home ratings",
  },
];

const steps: readonly AssessmentServiceStep[] = [
  { title: "Confirm it is a new-home pathway", description: "Identify the project, jurisdiction, approval route and whether the applicable new-home certificate must include Whole of Home modelling." },
  { title: "Coordinate building and systems", description: "Provide the same design revision used for thermal modelling, together with the proposed major fixed appliances, solar and battery details." },
  { title: "Model both rating components", description: "Assess the thermal performance and the fixed whole-home energy systems under the current NatHERS method and software." },
  { title: "Resolve design gaps", description: "Review practical changes to the shell or fixed systems while choices can still be coordinated across the project." },
  { title: "Maintain certificate alignment", description: "Keep the certificate, approved plans, schedules and installed design aligned when products or project details change." },
];

const sources: readonly AssessmentServiceSource[] = [
  {
    title: "Official explanation of the Whole of Home rating",
    description: "The Home Energy Rating new-home certificate guide explains the Whole of Home scale, the thermal Star Rating and the information recorded on the certificate.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
    linkLabel: "Read the new-home certificate guide",
  },
  {
    title: "Official new-home pathway overview",
    description: "Home Energy Rating explains how NatHERS evidence is used for proposed homes and why design information must match the relevant approval pathway.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes",
    linkLabel: "Read the new-homes overview",
  },
];

const faqs: readonly AssessmentServiceFaq[] = [
  {
    question: "Is Whole of Home only for new homes?",
    answer: "Yes. Whole of Home is the 0 to 100+ rating used in the new-home certificate pathway. The current service for a completed home is called Home Energy Rating, even though its overall scale also runs from 0 to 100+.",
  },
  {
    question: "Does Whole of Home replace the NatHERS Star Rating?",
    answer: "No. The thermal Star Rating from 0 to 10 and Whole of Home rating from 0 to 100+ describe different parts of the proposed design and can both appear on the new-home certificate.",
  },
  {
    question: "Is a 100 rating an energy-bill guarantee?",
    answer: "No. The Whole of Home score is a standardised model using the design and system assumptions recorded for the assessment. Actual bills depend on occupancy, behaviour, weather, tariffs, construction and equipment operation.",
  },
  {
    question: "Can Whole of Home support NCC evidence?",
    answer: "It can form part of the relevant new-home certificate evidence for National Construction Code energy performance. The jurisdiction and approval authority determine the exact pathway and evidence that must be accepted.",
  },
];

export default function NathersWholeOfHomePage() {
  return (
    <AssessmentServicePage
      path={path}
      breadcrumbLabel="NatHERS Whole of Home"
      eyebrow="New-home certificate rating"
      title="NatHERS Whole of Home rating for new-home certificates"
      introduction="NatHERS Whole of Home is the 0 to 100+ rating used for the applicable new-home certificate pathway. It models major fixed appliances and on-site energy systems alongside the thermal Star Rating. A completed home uses the separate Home Energy Rating service, not the Whole of Home name."
      reviewed="1 September 2026"
      reviewNote="Whole of Home requirements depend on the National Construction Code pathway adopted for the project location. Confirm the current requirements with the relevant approval authority."
      cardsEyebrow="Use the rating correctly"
      cardsTitle="Fixed systems, thermal performance and clear terminology"
      cards={cards}
      processEyebrow="One coordinated design"
      processTitle="Model the building shell and fixed systems together"
      steps={steps}
      sources={sources}
      faqTitle="Whole of Home questions"
      faqs={faqs}
      ctaEyebrow="Discuss Whole of Home"
      ctaTitle="Confirm the certificate and project pathway"
      ctaDescription="Start with the project location, design stage, certifier or approval pathway and the current drawings and fixed system selections."
      ctaActions={[
        { label: "Book an assessment discussion", href: "/book-an-assessment" },
        { label: "Call 1300 241 149", href: "tel:+611300241149" },
      ]}
      serviceName="NatHERS Whole of Home rating"
      serviceType="Whole of Home modelling for the new-home NatHERS certificate pathway"
      areaServed="Australia"
      footer="Whole of Home is new-home certificate terminology. Existing homes use the Home Energy Rating pathway and cannot use that rating to demonstrate new-home NCC compliance."
    />
  );
}
