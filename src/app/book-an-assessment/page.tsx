import {
  AssessmentServicePage,
  buildAssessmentMetadata,
  type AssessmentServiceCard,
  type AssessmentServiceFaq,
  type AssessmentServiceSource,
  type AssessmentServiceStep,
} from "@/components/AssessmentServicePage";
import { PublicAssessmentBookingForm } from "@/components/PublicAssessmentBookingForm";

const path = "/book-an-assessment";
const title = "Book Home Energy Assessment | Australian Energy Assessments";
const description = "Discuss a NatHERS new-home certificate, an existing-home Home Energy Rating or a NSW BASIX pathway. Call 1300 241 149 or email our assessment team.";

export const metadata = buildAssessmentMetadata({ path, title, description });

const cards: readonly AssessmentServiceCard[] = [
  {
    label: "Plans and approvals",
    title: "New home or major renovation",
    description: "A plan-based NatHERS assessment models the proposed design and can produce the new-home certificate required for the confirmed approval pathway.",
    boundaryTitle: "Confirm before modelling",
    boundary: "The state or territory, National Construction Code pathway, project type and approval authority determine the evidence that must be accepted.",
    evidenceTitle: "Useful details for the first discussion",
    evidence: ["Project address and jurisdiction", "New build or renovation stage", "Available plans and specifications", "Certifier, council or approval pathway"],
    outputTitle: "Pathway to discuss",
    output: "A thermal performance and, where applicable, Whole of Home assessment using the coordinated design documents.",
    href: "/nathers-for-new-homes",
    linkLabel: "Review new-home NatHERS assessments",
  },
  {
    label: "Home already built",
    title: "Existing-home energy assessment",
    description: "The current Home Energy Rating pathway assesses the home on site and supports practical decisions about comfort, energy use and upgrades.",
    boundaryTitle: "Different certificate purpose",
    boundary: "An existing-home rating does not demonstrate compliance with National Construction Code requirements for a new home or major renovation.",
    evidenceTitle: "Useful details for the first discussion",
    evidence: ["Property suburb and state", "Reason for seeking the rating", "Known renovations or access limits", "The upgrade, sale or rental decision involved"],
    outputTitle: "Pathway to discuss",
    output: "A Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, estimated annual energy use and upgrade guidance.",
    href: "/home-energy-rating-for-existing-homes",
    linkLabel: "Review existing-home ratings",
  },
  {
    label: "NSW planning",
    title: "BASIX assessment support",
    description: "BASIX is a NSW planning pathway covering project commitments for residential water, energy, thermal performance and materials or embodied emissions where applicable.",
    boundaryTitle: "NSW projects only",
    boundary: "The NSW Planning Portal and the relevant consent authority determine whether BASIX applies and which assessment method the project must use.",
    evidenceTitle: "Useful details for the first discussion",
    evidence: ["NSW project address", "Development type and approval stage", "Current plans and specifications", "Planning Portal or consent authority requirements"],
    outputTitle: "Pathway to discuss",
    output: "Support to coordinate the relevant BASIX inputs, thermal method and commitments with the submitted plans.",
    href: "/basix-nsw",
    linkLabel: "Review BASIX assessment support",
  },
];

const steps: readonly AssessmentServiceStep[] = [
  { title: "Tell us the building stage", description: "Say whether the home is proposed, under design, being renovated or already built, and identify the state or territory." },
  { title: "Explain the decision", description: "Tell us whether the assessment is for approval, design testing, an existing-home rating, upgrade planning, sale, rental or another confirmed purpose." },
  { title: "Confirm the evidence", description: "We can identify whether the next step needs coordinated plans and specifications or access to the completed home." },
  { title: "Use the correct pathway", description: "Proceed only after the assessment type, approval boundary, expected evidence and output are clear." },
];

const sources: readonly AssessmentServiceSource[] = [
  {
    title: "Official guidance for new-home certificates",
    description: "Home Energy Rating explains the thermal Star Rating, Whole of Home rating and certificate information used for new homes.",
    href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate",
    linkLabel: "Read the new-home certificate guidance",
  },
  {
    title: "Official guidance for existing homes",
    description: "Home Energy Rating explains what an on-site existing-home assessment covers and the results provided to the household.",
    href: "https://www.homeenergyrating.gov.au/households/existing-homes/how-get-assessment",
    linkLabel: "Read the existing-home assessment guidance",
  },
  {
    title: "Official NSW BASIX overview",
    description: "The NSW Planning Portal explains the purpose, scope and approval role of BASIX for residential development in New South Wales.",
    href: "https://www.planningportal.nsw.gov.au/basix/about-basix",
    linkLabel: "Read the NSW BASIX overview",
  },
];

const faqs: readonly AssessmentServiceFaq[] = [
  {
    question: "Which home energy assessment should I book?",
    answer: "The building stage, location and intended use decide the pathway. Proposed designs generally need the new-home NatHERS pathway, completed homes use the existing-home Home Energy Rating pathway, and eligible NSW development may also need BASIX.",
  },
  {
    question: "Can an existing-home rating replace a new-home NatHERS certificate?",
    answer: "No. An existing-home Home Energy Rating describes a completed home and supports upgrade decisions. It cannot demonstrate National Construction Code compliance for a new home or a major renovation that needs the new-home certificate pathway.",
  },
  {
    question: "What should I provide when I first contact you?",
    answer: "Start with the suburb and state, whether the home is proposed or already built, the project stage and the decision the assessment must support. The assessment team can then confirm what plans, specifications or site access are relevant.",
  },
  {
    question: "I searched for a NatHERS assessor, energy assessor or BASIX assessor. Can I still call?",
    answer: "Yes. Those search terms can describe different services, so the first call should confirm whether you need a new-home certificate, an existing-home rating or a NSW BASIX pathway before work begins.",
  },
];

export default function BookAnAssessmentPage() {
  return (
    <AssessmentServicePage
      path={path}
      breadcrumbLabel="Book an assessment"
      eyebrow="Book an assessment"
      title="Start with the right home energy assessment pathway"
      introduction="Whether you searched for a NatHERS assessor, home energy assessor, existing-home energy assessment or BASIX assessor, begin by confirming the building stage, location and purpose. Call or email Australian Energy Assessments to discuss the correct pathway before supplying detailed project documents."
      reviewed="1 September 2026"
      reviewNote="Assessment names and approval requirements can change. The official scheme, planning portal and relevant approval authority remain the source of truth for the project."
      cardsEyebrow="Choose the starting point"
      cardsTitle="New design, existing home or NSW BASIX"
      cards={cards}
      processEyebrow="A clear first contact"
      processTitle="Confirm the service before assessment work begins"
      steps={steps}
      beforeSources={<PublicAssessmentBookingForm />}
      sources={sources}
      faqTitle="Booking and pathway questions"
      faqs={faqs}
      ctaEyebrow="Speak with the assessment team"
      ctaTitle="Discuss your home, project and approval pathway"
      ctaDescription="Call 1300 241 149 or email info@ausenergyassessments.com. Include the state or territory, building stage and purpose of the assessment. Do not email identity documents or unrelated private information."
      ctaActions={[
        { label: "Call 1300 241 149", href: "tel:+611300241149" },
        { label: "Email the assessment team", href: "mailto:info@ausenergyassessments.com" },
      ]}
      serviceName="Home energy assessment pathway consultation"
      serviceType="NatHERS, Home Energy Rating and BASIX assessment pathway consultation"
      footer="The correct assessment depends on the project location, building stage, evidence and approval purpose. Requirements must be confirmed for the specific property and approval pathway."
    />
  );
}
