import {
  AssessmentServicePage,
  buildAssessmentMetadata,
  type AssessmentServiceCard,
  type AssessmentServiceFaq,
  type AssessmentServiceSource,
  type AssessmentServiceStep,
} from "@/components/AssessmentServicePage";

const path = "/basix-nsw";
const title = "BASIX Assessment Support NSW | Australian Energy Assessments";
const description = "NSW BASIX support for thermal performance, project commitments and evidence that keeps the certificate aligned with residential plans.";

export const metadata = buildAssessmentMetadata({ path, title, description });

const cards: readonly AssessmentServiceCard[] = [
  {
    label: "NSW planning pathway",
    title: "Confirm whether BASIX applies",
    description: "BASIX is part of the NSW planning system for applicable residential development. The project type, scope and approval pathway determine the current assessment requirements.",
    boundaryTitle: "Check the project, not a generic rule",
    boundary: "The NSW Planning Portal and the relevant consent authority remain the source of truth for whether a BASIX certificate is required and what it must cover.",
    evidenceTitle: "Start with",
    evidence: ["NSW project address", "Development type and proposed work", "Approval stage and consent authority", "Current Planning Portal project details"],
    outputTitle: "Pathway result",
    output: "A confirmed BASIX scope before detailed water, energy, thermal performance and materials or embodied emissions information is entered or relied on.",
    href: "https://www.planningportal.nsw.gov.au/development-and-assessment/basix",
    linkLabel: "Read the official BASIX overview",
  },
  {
    label: "Thermal performance",
    title: "Use an eligible assessment method",
    description: "The BASIX thermal performance section provides different assessment methods for eligible project types, including the NatHERS simulation pathway.",
    boundaryTitle: "Method depends on eligibility",
    boundary: "Do not assume every dwelling can use the same method. The project type, dwelling configuration and current NSW rules determine the available pathway.",
    evidenceTitle: "For NatHERS simulation",
    evidence: ["Coordinated floor plans, elevations and sections", "Construction and insulation details", "Window, glazing and shading schedules", "Orientation, site and climate information"],
    outputTitle: "Assessment use",
    output: "Thermal performance inputs and evidence that can be coordinated with the broader BASIX assessment and the plans submitted for approval.",
    href: "https://www.planningportal.nsw.gov.au/basix-thermal-performance-section",
    linkLabel: "Check the official thermal methods",
  },
  {
    label: "Certificate commitments",
    title: "Keep BASIX commitments aligned with plans",
    description: "The BASIX assessment records project commitments that need to remain consistent with the design information and approval documents used for the development.",
    boundaryTitle: "Changes can affect the certificate",
    boundary: "A later change to the design, materials, fixtures or fixed systems may require the BASIX assessment and related documents to be reviewed before approval or construction proceeds.",
    evidenceTitle: "Control together",
    evidence: ["Water fixtures and landscape information", "Thermal construction and glazing", "Fixed energy systems", "Materials and current plan revisions"],
    outputTitle: "Project use",
    output: "A BASIX certificate and commitments that describe the same project as the drawings and specifications submitted through the confirmed NSW approval pathway.",
    href: "https://www.planningportal.nsw.gov.au/development-and-assessment/basix",
    linkLabel: "Confirm current BASIX requirements",
  },
];

const steps: readonly AssessmentServiceStep[] = [
  { title: "Confirm project scope", description: "Identify the NSW development type, proposed work, consent authority, approval stage and current Planning Portal pathway." },
  { title: "Choose the method", description: "Confirm the eligible thermal performance method and the evidence needed for the particular dwelling or development." },
  { title: "Coordinate inputs", description: "Use the current plans and specifications for water, energy, thermal performance and materials or embodied emissions information." },
  { title: "Resolve inconsistencies", description: "Correct missing or conflicting design details before treating the BASIX commitments as settled project evidence." },
  { title: "Maintain alignment", description: "Review the assessment, certificate, plans and specifications when the approved or constructed design changes." },
];

const sources: readonly AssessmentServiceSource[] = [
  {
    title: "NSW BASIX overview",
    description: "The NSW Planning Portal explains the purpose of BASIX, the sustainability areas assessed and its role in the residential planning pathway.",
    href: "https://www.planningportal.nsw.gov.au/development-and-assessment/basix",
    linkLabel: "Read the official BASIX overview",
  },
  {
    title: "BASIX thermal performance methods",
    description: "The NSW Planning Portal explains the thermal performance section and the assessment methods available for eligible project types.",
    href: "https://www.planningportal.nsw.gov.au/basix-thermal-performance-section",
    linkLabel: "Read the official thermal performance guidance",
  },
];

const faqs: readonly AssessmentServiceFaq[] = [
  {
    question: "Is BASIX the same as a NatHERS assessment?",
    answer: "No. BASIX is a NSW planning assessment covering several sustainability areas. A NatHERS simulation can be the thermal performance method used within an eligible BASIX pathway, but it does not replace the broader BASIX assessment and commitments.",
  },
  {
    question: "Does every NSW renovation need a BASIX certificate?",
    answer: "Not every project follows the same rule. The development type, scope, current NSW requirements and consent pathway determine whether BASIX applies. Confirm the project in the NSW Planning Portal or with the relevant consent authority.",
  },
  {
    question: "Can the BASIX certificate use different details from the plans?",
    answer: "The certificate commitments and submitted plans need to describe the same project. Conflicting construction, glazing, fixture, appliance or system information should be resolved before the documents are relied on for approval or construction.",
  },
  {
    question: "What happens if the design changes after assessment?",
    answer: "Review the effect of the change on the BASIX inputs, commitments, certificate and approval documents. The consent authority or Planning Portal pathway determines whether updated evidence is required.",
  },
];

export default function BasixNswPage() {
  return (
    <AssessmentServicePage
      path={path}
      breadcrumbLabel="BASIX NSW"
      eyebrow="New South Wales residential planning"
      title="BASIX assessment support for NSW residential projects"
      introduction="Building or renovating in NSW? BASIX is part of the planning process. It checks water, energy, thermal performance and materials for the project. The BASIX certificate and commitments need to match the plans you submit for approval."
      reviewed="1 September 2026"
      reviewNote="BASIX rules, tools and eligible thermal methods can change. Confirm the current requirements in the NSW Planning Portal and with the relevant consent authority."
      cardsEyebrow="What BASIX covers"
      cardsTitle="The project, the assessment method and the commitments"
      cards={cards}
      processEyebrow="How it works"
      processTitle="Keep the BASIX certificate and plans matching"
      steps={steps}
      sources={sources}
      faqTitle="BASIX assessment questions"
      faqs={faqs}
      ctaEyebrow="Need help with BASIX?"
      ctaTitle="Tell us what you are building or renovating"
      ctaDescription="Start with the NSW address, project type, approval stage and current plans. We will explain the likely pathway and what information is needed next."
      ctaActions={[
        { label: "Book a 5-minute call", href: "/book-an-assessment" },
        { label: "Call 1300 241 149", href: "tel:+611300241149" },
      ]}
      serviceName="BASIX assessment support for NSW residential projects"
      serviceType="NSW BASIX assessment and NatHERS thermal performance support"
      alternateNames={["BASIX energy assessment", "NSW BASIX assessment"]}
      areaServed="New South Wales"
      reviewedIso="2026-09-01"
      coverageTitle="New South Wales service area"
      coverageDescription="BASIX is a New South Wales planning pathway. Project eligibility, service availability and timing are confirmed before assessment work begins."
      footer="BASIX support is project specific. The NSW Planning Portal and relevant consent authority determine the current scope, eligible methods and evidence required for approval."
    />
  );
}
