import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "Green Building Ratings and Certifications in Australia";
const description = "A plain-English comparison of NCC, NatHERS, BASIX, Home Energy Rating, Green Star and NABERS for Australian homes and apartments.";

export const metadata = buildGuideMetadata({
  path: "/guides/green-building-certifications-australia",
  title,
  description,
  publishedIso: "2026-09-02",
  reviewedIso: "2026-09-02",
});

export default function GreenBuildingCertificationsGuidePage() {
  return <AuthoritativeGuidePage
    path="/guides/green-building-certifications-australia"
    label="Ratings and certifications"
    title={title}
    description={description}
    introduction="A star rating, planning certificate and green certification are not the same thing. The right evidence depends on whether you are approving a design, rating an existing home, certifying construction or measuring how a building operates."
    publishedIso="2026-09-02"
    reviewedIso="2026-09-02"
    topics={["Green building certification", "NatHERS", "Home Energy Rating", "BASIX", "Green Star", "NABERS"]}
    sections={[
      {
        eyebrow: "Start here",
        title: "Ask what the claim actually measures",
        items: [
          "Is it a mandatory approval requirement or a voluntary certification?",
          "Does it assess a proposed design, the completed work or measured operation?",
          "Does the certificate identify this exact home, apartment building or standard design?",
          "Who issued it, what method was used and is the result still current?",
          "Do not compare star numbers across schemes. The scales measure different things.",
        ],
      },
      {
        eyebrow: "Building approval",
        title: "NCC, NatHERS and BASIX have different jobs",
        paragraphs: [
          "The National Construction Code sets minimum requirements. It is not a green certification, and the Australian Building Codes Board does not approve individual projects.",
          "NatHERS models a new home's design and can provide rating evidence for the applicable approval pathway. A NatHERS certificate is not whole-building sustainability certification or proof that the finished home was built exactly as modelled.",
          "BASIX is part of the NSW planning process. Its certificate records project commitments across water, energy, thermal performance and materials. It is not a voluntary national eco-label.",
        ],
      },
      {
        eyebrow: "Existing homes",
        title: "Home Energy Rating assesses a home that is already built",
        paragraphs: [
          "The current Home Energy Rating pathway involves an on-site assessment of the existing home and its fixed appliances. The certificate includes a Home Energy Rating and a separate thermal Star Rating.",
          "It supports household upgrade decisions. It does not replace new-home compliance evidence, a building approval or a Green Star certification.",
        ],
      },
      {
        eyebrow: "Voluntary certification",
        title: "Green Star Homes is a separate GBCA process",
        paragraphs: [
          "Green Star is owned and managed by the Green Building Council of Australia. Green Star Homes covers a broader set of sustainability outcomes than an energy rating alone.",
          "As checked on 2 September 2026, Green Star Homes eligibility is limited to volume builders. A Green Star Designed assessment is not final certification of a completed home. Certification follows construction evidence and independent assessment by the Green Building Council of Australia.",
        ],
        note: {
          title: "Check the exact status",
          text: "Only a project certified by the Green Building Council of Australia can claim Green Star certification. Ask for the project entry or certificate instead of relying on a marketing logo alone.",
        },
      },
      {
        eyebrow: "Apartments and larger buildings",
        title: "NABERS measures operational performance for eligible building types",
        paragraphs: [
          "For apartment buildings, NABERS ratings cover the energy and water used by common property and shared services. They exclude energy used inside individual residences.",
          "A NABERS Accredited Assessor completes an accredited rating under the scheme rules. An estimate from a public calculator is indicative and cannot be promoted as an accredited rating.",
        ],
      },
      {
        eyebrow: "Before relying on a claim",
        title: "Verify the document, scope and issuer",
        items: [
          "Read the certificate rather than relying on a brochure or listing description.",
          "Match the address, lot, plan revision or building named on the document.",
          "Check whether the result is design-stage, as-built or operational.",
          "Confirm the assessor, certifier or scheme owner through the official directory where one exists.",
          "Check the issue date, expiry and whether later changes could affect the result.",
        ],
      },
    ]}
    sources={[
      { label: "How the NCC applies to homes", href: "https://ncc.abcb.gov.au/homeowners/how-ncc-applies-your-home" },
      { label: "Official NatHERS measurement guidance for new homes", href: "https://www.homeenergyrating.gov.au/households/new-homes/measuring-energy-efficiency-new-homes" },
      { label: "Official Home Energy Rating guidance for existing homes", href: "https://www.homeenergyrating.gov.au/households/existing-homes/measuring-energy-efficiency-existing-homes" },
      { label: "NSW Planning Portal BASIX overview", href: "https://www.planningportal.nsw.gov.au/development-and-assessment/basix" },
      { label: "Green Star rating system", href: "https://new.gbca.org.au/green-star/rating-system/" },
      { label: "Green Star Homes eligibility and certification stages", href: "https://new.gbca.org.au/green-star/rating-system/homes/" },
      { label: "NABERS apartment building scope", href: "https://www.nabers.gov.au/ratings/spaces-we-rate/apartment-buildings" },
    ]}
    cta={{
      title: "Need the right energy assessment, not another label?",
      text: "Australian Energy Assessments can explain the likely NatHERS, Home Energy Rating or BASIX pathway. Green Star and NABERS certifications must be arranged through their own scheme requirements and accredited providers.",
      href: "/assessments",
      label: "Choose an assessment",
    }}
  />;
}
