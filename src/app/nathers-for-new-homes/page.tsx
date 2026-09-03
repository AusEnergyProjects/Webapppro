import {
  AssessmentServicePage,
  buildAssessmentMetadata,
  type AssessmentServiceCard,
  type AssessmentServiceFaq,
  type AssessmentServiceSource,
  type AssessmentServiceStep,
} from "@/components/AssessmentServicePage";

const path = "/nathers-for-new-homes";
const title = "NatHERS Assessment Australia | Australian Energy Assessments";
const description = "Plan-based NatHERS assessments for new homes and major renovations Australia-wide, including thermal Star Rating and Whole of Home support.";

export const metadata = buildAssessmentMetadata({ path, title, description });

const cards: readonly AssessmentServiceCard[] = [
  {
    label: "Building shell",
    title: "Thermal performance Star Rating",
    description: "The thermal model uses the proposed plans, orientation, construction, insulation, glazing, shading and ventilation assumptions to estimate heating and cooling demand.",
    boundaryTitle: "A model of the proposed design",
    boundary: "The result depends on complete, coordinated design evidence. It is not an inspection of the finished building and it is not a prediction of a household's energy bill.",
    evidenceTitle: "Evidence commonly needed",
    evidence: ["Site plan, floor plans, elevations and sections", "Orientation and climate location", "Construction, insulation and sealing details", "Window, glazing and shading schedules"],
    outputTitle: "Certificate result",
    output: "A Star Rating from 0 to 10 for the modelled thermal performance, together with the certificate details and assumptions for the assessed design.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
    linkLabel: "Check the official certificate explanation",
  },
  {
    label: "Fixed household energy",
    title: "Whole of Home rating",
    description: "For the applicable new-home pathway, Whole of Home modelling considers major fixed appliances and on-site energy systems alongside the building's thermal performance.",
    boundaryTitle: "New-home certificate terminology",
    boundary: "Whole of Home is part of the new-home rating pathway. It is not the name of the current assessment delivered for a home that is already built.",
    evidenceTitle: "Evidence commonly needed",
    evidence: ["Heating and cooling systems", "Hot water and fixed appliance selections", "Proposed solar generation", "Proposed battery details where relevant"],
    outputTitle: "Certificate result",
    output: "A Whole of Home rating from 0 to 100+ that sits alongside the thermal Star Rating on the relevant new-home certificate.",
    href: "/nathers-whole-of-home",
    linkLabel: "Understand Whole of Home ratings",
  },
  {
    label: "Approval evidence",
    title: "Coordinated certificate and plans",
    description: "The model, certificate, specifications and approval drawings need to describe the same design so the assessment can support the confirmed building approval pathway.",
    boundaryTitle: "Authority remains decisive",
    boundary: "The certifier, council or other approval authority determines the National Construction Code pathway and whether the submitted evidence satisfies it.",
    evidenceTitle: "Controls to maintain",
    evidence: ["Current revision of every drawing", "Consistent material and glazing schedules", "Recorded modelling assumptions", "Review of later product or design changes"],
    outputTitle: "Project use",
    output: "A new-home certificate can demonstrate the relevant National Construction Code energy performance when the correct pathway and coordinated evidence are used.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes",
    linkLabel: "Read the official new-homes guidance",
  },
];

const steps: readonly AssessmentServiceStep[] = [
  { title: "Confirm the pathway", description: "Identify the project location, building class, design stage and the evidence requested by the certifier, council or approval authority." },
  { title: "Coordinate documents", description: "Provide the current architectural drawings, construction specifications, glazing schedule and relevant fixed system details." },
  { title: "Model the design", description: "The assessor records the design in approved software and identifies missing information or assumptions that need resolution." },
  { title: "Test design changes", description: "Compare practical design responses before treating any indicative option as an approved construction commitment." },
  { title: "Issue and maintain", description: "Use the relevant certificate with matching plans, then review changes that may affect the assessed performance or approval evidence." },
];

const sources: readonly AssessmentServiceSource[] = [
  {
    title: "Understanding a new-home certificate",
    description: "The official Home Energy Rating guidance explains the thermal Star Rating, Whole of Home rating, certificate status and information shown on a new-home certificate.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
    linkLabel: "Read the certificate guide",
  },
  {
    title: "Home Energy Rating guidance for new homes",
    description: "The Australian Government service explains the role of NatHERS assessments and new-home energy rating evidence for households and residential projects.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes",
    linkLabel: "Read the new-homes overview",
  },
];

const faqs: readonly AssessmentServiceFaq[] = [
  {
    question: "Can a NatHERS new-home certificate demonstrate NCC compliance?",
    answer: "Yes, when the certificate is produced for the correct project and pathway, uses coordinated evidence and meets the requirements adopted for that jurisdiction. The certifier, council or relevant approval authority decides what must be submitted and accepted.",
  },
  {
    question: "Does Whole of Home replace the thermal Star Rating?",
    answer: "No. The new-home certificate can include both a thermal Star Rating from 0 to 10 and a Whole of Home rating from 0 to 100+. They describe related but different parts of the assessed design.",
  },
  {
    question: "Does every major renovation need the same NatHERS certificate?",
    answer: "No single answer applies to every project. The location, building work, approval pathway and requirements adopted by the jurisdiction determine whether a new-home NatHERS certificate or another method is required.",
  },
  {
    question: "Is the rating a forecast of the future energy bill?",
    answer: "No. It is a standardised model of the proposed design under defined assumptions. Actual energy use and bills also depend on weather, occupancy, behaviour, tariffs, equipment settings and construction quality.",
  },
  {
    question: "How is a NatHERS assessment quoted?",
    answer: "The quote depends on the project type, design stage, number of dwellings, quality of the plans and specifications, certificate requirements and any option testing or later revisions. Australian Energy Assessments confirms the scope and price before modelling starts.",
  },
];

export default function NathersForNewHomesPage() {
  return (
    <AssessmentServicePage
      path={path}
      breadcrumbLabel="NatHERS for new homes"
      eyebrow="New homes and major renovations"
      title="NatHERS assessments for new homes and major renovations"
      introduction="Building a new home or planning a major renovation? We assess the plans before construction and show how the design performs. Because the work is plan-based, Australian Energy Assessments can help with projects anywhere in Australia."
      reviewed="1 September 2026"
      reviewNote="National Construction Code requirements and jurisdictional adoption can change. Confirm the current project pathway with the relevant certifier, council or approval authority."
      cardsEyebrow="What you are getting"
      cardsTitle="The rating, the energy systems and the certificate"
      cards={cards}
      processEyebrow="How it works"
      processTitle="From current plans to the right certificate"
      steps={steps}
      sources={sources}
      faqTitle="New-home NatHERS questions"
      faqs={faqs}
      ctaEyebrow="Ready to check the plans?"
      ctaTitle="Tell us where the project is up to"
      ctaDescription="Start with the project location, design stage and any plans you already have. We will explain what is needed next and what the assessment will provide."
      ctaActions={[
        { label: "Book a 5-minute call", href: "/book-an-assessment" },
        { label: "Call 1300 241 149", href: "tel:+611300241149" },
      ]}
      serviceName="NatHERS assessment for new homes"
      serviceType="Plan-based NatHERS thermal performance and Whole of Home assessment"
      alternateNames={["7 star NatHERS assessment", "NCC home energy assessment", "new home energy rating"]}
      areaServed="Australia"
      reviewedIso="2026-09-03"
      coverageTitle="Desktop assessment across Australia"
      coverageDescription="New-home NatHERS assessments are completed from coordinated plans and specifications, so projects can be assessed remotely across Australia. The state or territory and approval authority still determine the applicable pathway and evidence."
      footer="New-home rating evidence is project specific. The assessment model, certificate, plans and approval requirements must remain coordinated as the design changes."
    />
  );
}
