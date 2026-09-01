import {
  AssessmentServicePage,
  buildAssessmentMetadata,
  type AssessmentServiceCard,
  type AssessmentServiceFaq,
  type AssessmentServiceSource,
  type AssessmentServiceStep,
} from "@/components/AssessmentServicePage";

const path = "/home-energy-rating-for-existing-homes";
const title = "Existing Home Energy Rating | Australian Energy Assessments";
const description = "Existing-home Home Energy Rating assessments, with primary on-site coverage in NSW and Victoria and other locations confirmed case by case.";

export const metadata = buildAssessmentMetadata({ path, title, description });

const cards: readonly AssessmentServiceCard[] = [
  {
    label: "On-site assessment",
    title: "Record the home as it is now",
    description: "The assessor visits the completed home and records the building fabric, layout, orientation, windows, shading and major fixed appliances used by the official existing-home method.",
    boundaryTitle: "Existing condition matters",
    boundary: "The assessment describes the home and installed systems at the time of the visit. Unknown or inaccessible details need to be handled under the current method rather than guessed as verified facts.",
    evidenceTitle: "Useful preparation",
    evidence: ["Safe access to the relevant rooms and areas", "Known renovation history", "Information about major fixed appliances", "The comfort or upgrade decision to be supported"],
    outputTitle: "Assessment context",
    output: "Official guidance says an assessment typically takes about two to three hours, depending on the home and the evidence that can be recorded safely.",
    href: "https://www.homeenergyrating.gov.au/households/existing-homes/how-get-assessment",
    linkLabel: "Check the official assessment process",
  },
  {
    label: "Two rating scales",
    title: "Home Energy Rating and Star Rating",
    description: "The existing-home certificate presents a Home Energy Rating from 0 to 100+ for overall energy performance and a Star Rating from 0 to 10 for the building's thermal performance.",
    boundaryTitle: "Use the current names",
    boundary: "This is the Home Energy Rating pathway for completed homes. It is not called a Whole of Home rating, even though one of the rating scales also runs from 0 to 100+.",
    evidenceTitle: "Results to read together",
    evidence: ["Home Energy Rating from 0 to 100+", "Star Rating from 0 to 10", "Model assumptions and recorded home features", "The certificate date and assessed condition"],
    outputTitle: "Assessment result",
    output: "The two ratings help separate the overall energy picture from the thermal performance of the building fabric.",
    href: "https://www.homeenergyrating.gov.au/households/existing-homes",
    linkLabel: "Read the official existing-homes overview",
  },
  {
    label: "Decision support",
    title: "Annual energy estimate and upgrade guidance",
    description: "The result includes estimated annual energy use and guidance on improvements that may lift performance, comfort or resilience for the assessed home.",
    boundaryTitle: "Modelled guidance, not a quote",
    boundary: "The estimate is not a guaranteed bill, saving, payback period or construction quote. Household behaviour, tariffs, weather, products and workmanship can change real outcomes.",
    evidenceTitle: "Use the guidance to ask",
    evidence: ["Which constraint matters first", "Which measures work together", "What needs site-specific design or a licensed trade", "What evidence should be checked before spending"],
    outputTitle: "Practical use",
    output: "A prioritised starting point for discussing upgrades, comparing scopes and tracking how the home's assessed performance changes over time.",
    href: "/guides/project-preparation",
    linkLabel: "Prepare an evidence-based project scope",
  },
];

const steps: readonly AssessmentServiceStep[] = [
  { title: "Confirm the purpose", description: "Identify whether the rating will support comfort, upgrades, a renovation decision, sale, rental or a clearer understanding of current performance." },
  { title: "Prepare access", description: "Make the relevant parts of the home safely accessible and share known renovation or equipment information without opening unsafe areas." },
  { title: "Assess the home", description: "The assessor records the existing building and fixed systems using the current Home Energy Rating method." },
  { title: "Use the results", description: "Read both rating scales, estimated annual energy use, assumptions and upgrade guidance before requesting site-specific quotes or approvals." },
];

const sources: readonly AssessmentServiceSource[] = [
  {
    title: "How to get an existing-home assessment",
    description: "Home Energy Rating explains the on-site process, typical duration and the rating, annual energy estimate and upgrade information provided after assessment.",
    href: "https://www.homeenergyrating.gov.au/households/existing-homes/how-get-assessment",
    linkLabel: "Read the official assessment guide",
  },
  {
    title: "Home Energy Rating launched in 2026",
    description: "The Australian Government launch notice explains the new consumer service and its role in rating existing homes under the national framework.",
    href: "https://www.energy.gov.au/news/home-energy-rating-launched-today",
    linkLabel: "Read the official launch notice",
  },
];

const faqs: readonly AssessmentServiceFaq[] = [
  {
    question: "Is an existing-home assessment still called NatHERS?",
    answer: "The official consumer service is Home Energy Rating. People still search for a NatHERS existing home assessment or NatHERS rating for an existing home, but the result for a completed home should use the current Home Energy Rating and Star Rating names.",
  },
  {
    question: "What happened to the Residential Efficiency Scorecard?",
    answer: "Residential Efficiency Scorecard is a legacy search term for the former service. Home Energy Rating launched nationally on 1 July 2026 and is the current official consumer pathway for rating an existing home.",
  },
  {
    question: "What results does the existing-home certificate provide?",
    answer: "It provides a Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, estimated annual energy use and upgrade guidance for the assessed home.",
  },
  {
    question: "Can this rating demonstrate NCC compliance for a major renovation?",
    answer: "No. An existing-home rating cannot demonstrate National Construction Code compliance. If a major renovation must demonstrate compliance, official guidance says it needs the relevant new-home certificate pathway. The approval authority determines the evidence required for the project.",
  },
];

export default function HomeEnergyRatingForExistingHomesPage() {
  return (
    <AssessmentServicePage
      path={path}
      breadcrumbLabel="Existing-home rating"
      eyebrow="Homes that are already built"
      title="Home Energy Rating for an existing home"
      introduction="The current on-site assessment for a completed home provides a Home Energy Rating from 0 to 100+, a Star Rating from 0 to 10, estimated annual energy use and upgrade guidance. Australian Energy Assessments primarily delivers these visits in New South Wales and Victoria, with other locations confirmed case by case. Older searches may call this a NatHERS existing-home assessment, home energy audit or Residential Efficiency Scorecard assessment."
      reviewed="1 September 2026"
      reviewNote="Home Energy Rating launched nationally on 1 July 2026. Older articles and search results may still use Residential Efficiency Scorecard or apply new-home NatHERS terms to existing homes."
      cardsEyebrow="What the current rating provides"
      cardsTitle="On-site evidence, two rating scales and upgrade guidance"
      cards={cards}
      processEyebrow="Assess the completed home"
      processTitle="Turn current-home evidence into practical next steps"
      steps={steps}
      sources={sources}
      faqTitle="Existing-home rating questions"
      faqs={faqs}
      ctaEyebrow="Discuss an existing-home rating"
      ctaTitle="Explain the home and the decision you need to make"
      ctaDescription="Start with the suburb and state, why you want the rating and any known access limits or renovations. The assessment team can confirm whether the current Home Energy Rating pathway fits."
      ctaActions={[
        { label: "Book a 5-minute call", href: "/book-an-assessment" },
        { label: "Call 1300 241 149", href: "tel:+611300241149" },
      ]}
      serviceName="Home Energy Rating for existing homes"
      serviceType="On-site existing-home energy assessment"
      alternateNames={["NatHERS existing home assessment", "home energy audit", "Residential Efficiency Scorecard assessment"]}
      areaServed="Australia"
      reviewedIso="2026-09-01"
      coverageTitle="On-site availability by location"
      coverageDescription="Existing-home assessments require a property visit. Current field delivery is primarily in New South Wales and Victoria; availability, travel and timing for other Australian locations are confirmed before booking."
      footer="An existing-home rating supports household decisions and upgrade planning. It does not replace a new-home certificate, building approval or site-specific trade design."
    />
  );
}
