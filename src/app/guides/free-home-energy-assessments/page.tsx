import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "Are Free Home Energy Assessments Available?";
const description = "Understand when a home energy assessment may be funded, what the free five-minute call includes and what to confirm before relying on a rebate or program.";

export const metadata = buildGuideMetadata({ path: "/guides/free-home-energy-assessments", title, description, publishedIso: "2026-09-01", reviewedIso: "2026-09-01" });

export default function FreeAssessmentGuidePage() {
  return <AuthoritativeGuidePage
    path="/guides/free-home-energy-assessments"
    label="Assessment cost guide"
    title={title}
    description={description}
    introduction="Sometimes a council, community program or government service funds an assessment for eligible households. That does not make every assessment free. Australian Energy Assessments offers a free five-minute booking call, then confirms the service and price before work starts."
    publishedIso="2026-09-01"
    reviewedIso="2026-09-01"
    topics={["Home energy assessment cost", "Energy rebates", "Home Energy Rating", "Residential Efficiency Scorecard"]}
    sections={[
      {
        eyebrow: "What is free",
        title: "The five-minute call checks the service, not the home",
        paragraphs: [
          "The call confirms the property location, whether the home is built or still on plans, why you need the assessment and what information is needed next.",
          "It is not the assessment, rating or certificate. Any paid work is scoped and quoted separately before you commit.",
        ],
      },
      {
        eyebrow: "Funded programs",
        title: "Check the exact program before assuming eligibility",
        items: [
          "Who runs or funds the program?",
          "Which postcodes, property types and households are eligible?",
          "Is the service an official Home Energy Rating, a general audit or basic advice?",
          "Does the program choose the assessor, or can the household choose?",
          "Are there travel, report, certificate or follow-up costs?",
        ],
        note: { title: "A directory listing is not approval", text: "Program rules and funding can change. Confirm eligibility with the administering government, council or provider before booking or signing a quote." },
      },
      {
        eyebrow: "Old Scorecard pages",
        title: "Residential Efficiency Scorecard has closed",
        paragraphs: [
          "The Victorian Residential Efficiency Scorecard program closed on 23 June 2026. Old pages that describe Scorecard as a current free service should not be relied on.",
          "The current consumer service for an existing home is Home Energy Rating. Ask what output you will receive and whether any current program pays for it.",
        ],
      },
      {
        eyebrow: "What affects price",
        title: "A useful quote explains the scope",
        items: [
          "The assessment type and certificate or report required",
          "Dwelling size, complexity and number of units",
          "Quality of plans, specifications and other evidence",
          "On-site location, travel and access",
          "Urgency and any design revisions or follow-up modelling",
        ],
      },
    ]}
    sources={[
      { label: "Find current Australian Government rebates and assistance", href: "https://www.energy.gov.au/rebates" },
      { label: "Find an accredited assessor and compare quotes", href: "https://www.homeenergyrating.gov.au/find-accredited-assessor" },
      { label: "How to get an existing-home assessment", href: "https://www.homeenergyrating.gov.au/households/existing-homes/how-get-assessment" },
      { label: "Official Scorecard closure notice", href: "https://www.homeenergyrating.gov.au/news/nathers-news-june-edition-nathers-expansion-stage-2-rolling-out-july" },
    ]}
    cta={{ title: "Find out which assessment applies", text: "Tell us the suburb, whether the home is built and what decision the assessment needs to support. We will explain the next step before quoting any paid work.", href: "/book-an-assessment", label: "Book the free five-minute call" }}
  />;
}
