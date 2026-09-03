import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "How to Prepare for a Home Energy Assessment";
const description = "A practical checklist for a new-home NatHERS assessment, an on-site Home Energy Rating or a general home energy audit.";

export const metadata = buildGuideMetadata({ path: "/guides/prepare-for-home-energy-assessment", title, description, publishedIso: "2026-09-01", reviewedIso: "2026-09-01" });

export default function AssessmentPreparationGuidePage() {
  return <AuthoritativeGuidePage
    path="/guides/prepare-for-home-energy-assessment"
    label="Assessment preparation"
    title={title}
    description={description}
    introduction="First confirm which assessment you need. A proposed home is assessed from plans. A completed home normally needs an on-site visit. A general audit may answer a narrower question but does not automatically produce an official rating."
    publishedIso="2026-09-01"
    reviewedIso="2026-09-01"
    topics={["Home energy assessment", "NatHERS", "Home Energy Rating", "Energy audit"]}
    sections={[
      {
        eyebrow: "Before you book",
        title: "Explain the decision the assessment must support",
        items: [
          "Is the home proposed, under construction or already built?",
          "Do you need planning or building-approval evidence, an existing-home rating or upgrade advice?",
          "What is the property location and dwelling type?",
          "Is there a deadline, certifier request, rebate rule or finance requirement?",
        ],
      },
      {
        eyebrow: "Plan-based assessment",
        title: "Send coordinated drawings and specifications",
        items: [
          "Current floor plans, elevations, sections and site plan",
          "Window and door sizes, types and performance details",
          "Insulation, construction and sealing specifications",
          "Shading, orientation and neighbouring obstruction information",
          "Fixed heating, cooling, hot-water, lighting, solar and battery selections where required",
        ],
        note: { title: "Use one drawing revision", text: "Tell the assessor which revision is current. A certificate based on superseded plans can create rework and may not describe the approved design." },
      },
      {
        eyebrow: "On-site assessment",
        title: "Make the home safe and accessible",
        items: [
          "Confirm the owner or authorised occupant has approved access.",
          "Allow roughly two to three hours for a typical existing-home visit. Larger or more complex homes can take longer.",
          "Provide safe access to the rooms and building areas included in the scope.",
          "Have renovation plans, appliance details and recent energy information available if known.",
          "List the rooms that are uncomfortable and the seasons or times when the problem occurs.",
          "Tell the assessor about hazards, pets, restricted areas or access limits before the visit.",
          "Expect a consent form and ask how your property information, photos and assessment data will be used.",
        ],
      },
      {
        eyebrow: "After the assessment",
        title: "Check what you will receive",
        paragraphs: [
          "The quote should name the certificate, report, ratings or recommendations included and explain any follow-up needed. Ask how assumptions, inaccessible areas and missing evidence will be recorded.",
          "Keep the final output with the plans, photos and evidence that support it. Update the assessment when material parts of the design or home change.",
        ],
      },
    ]}
    sources={[
      { label: "How to get an existing-home assessment", href: "https://www.homeenergyrating.gov.au/households/existing-homes/how-get-assessment" },
      { label: "Existing-home client information and consent form", href: "https://www.homeenergyrating.gov.au/resources/client-information-and-consent-form" },
      { label: "How new homes are measured", href: "https://www.homeenergyrating.gov.au/households/new-homes/measuring-energy-efficiency-new-homes" },
      { label: "Understanding a new-home certificate", href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate" },
    ]}
    cta={{ title: "Confirm the assessment before collecting every document", text: "Start with the property stage, location and result you need. The assessment guide will show which service fits and what to prepare.", href: "/assessments", label: "Compare home energy assessments" }}
  />;
}
