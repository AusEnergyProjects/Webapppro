import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "NCC, NatHERS and BASIX: Which One Applies?";
const description = "Understand how the National Construction Code, NatHERS ratings and NSW BASIX fit together for a new home or major renovation.";

export const metadata = buildGuideMetadata({ path: "/guides/ncc-nathers-basix", title, description, publishedIso: "2026-09-01", reviewedIso: "2026-09-01" });

export default function StandardsGuidePage() {
  return <AuthoritativeGuidePage
    path="/guides/ncc-nathers-basix"
    label="Building energy standards"
    title={title}
    description={description}
    introduction="The NCC sets building requirements. NatHERS is one way to model a home's energy performance and produce rating evidence. BASIX is part of the NSW planning process. Your project can involve more than one of them."
    publishedIso="2026-09-01"
    reviewedIso="2026-09-01"
    topics={["National Construction Code", "NatHERS", "BASIX", "New homes", "Major renovations"]}
    sections={[
      {
        eyebrow: "The short answer",
        title: "Start with the project location and approval route",
        items: [
          "The NCC is the national code, but states and territories decide how and when provisions apply.",
          "NatHERS software models the proposed design and can produce the rating evidence used for the confirmed approval pathway.",
          "BASIX applies to relevant residential development in NSW and covers more than the NatHERS thermal rating alone.",
          "Do not assume one 7 Star rule applies to every Australian project. Jurisdictions can vary the NCC settings they adopt.",
          "The certifier, council or other approval authority confirms what your project must submit.",
        ],
      },
      {
        eyebrow: "NatHERS",
        title: "The assessment is based on coordinated plans",
        paragraphs: [
          "A new-home NatHERS assessment models the proposed home before construction. The certificate can include a thermal Star Rating and, where required, a Whole of Home rating for fixed energy systems.",
          "The drawings, specifications and model must describe the same design. If windows, insulation, shading or fixed systems change, the assessment may also need to change.",
        ],
      },
      {
        eyebrow: "NSW projects",
        title: "BASIX and NatHERS are connected but not interchangeable",
        paragraphs: [
          "BASIX is completed through the NSW Planning Portal. NatHERS results can be used within the BASIX pathway, but a NatHERS certificate by itself is not the whole BASIX submission.",
          "Confirm the current BASIX settings, plans and certificate requirements for the specific project before construction documents are finalised.",
        ],
      },
      {
        eyebrow: "Avoid rework",
        title: "Ask these questions before modelling starts",
        items: [
          "What is the project address, building class and approval pathway?",
          "Which drawing revision and specification are current?",
          "Has the certifier identified the required energy evidence?",
          "Who will update the model when the design changes?",
          "Which certificate and supporting files must be submitted?",
        ],
      },
    ]}
    sources={[
      { label: "Australian Building Codes Board NCC overview", href: "https://ncc.abcb.gov.au/faq/general-ncc" },
      { label: "Official new-home energy-rating guidance", href: "https://www.homeenergyrating.gov.au/households/new-homes/measuring-energy-efficiency-new-homes" },
      { label: "Understanding a new-home certificate", href: "https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate" },
      { label: "NSW Planning Portal BASIX overview", href: "https://www.planningportal.nsw.gov.au/development-and-assessment/basix" },
    ]}
    cta={{ title: "Need a plan-based NatHERS assessment?", text: "See what the assessor needs, what the certificate includes and how Australia-wide desktop assessment works before you book.", href: "/nathers-for-new-homes", label: "Explore new-home NatHERS assessments" }}
  />;
}
