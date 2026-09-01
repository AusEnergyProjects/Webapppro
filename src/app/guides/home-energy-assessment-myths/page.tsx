import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "Home Energy Assessment Myths: Clear Answers";
const description = "Plain-English answers to common myths about NatHERS, Home Energy Ratings, bills, savings, compliance, free assessments and property value.";

export const metadata = buildGuideMetadata({ path: "/guides/home-energy-assessment-myths", title, description, publishedIso: "2026-09-01", reviewedIso: "2026-09-01" });

export default function AssessmentMythsGuidePage() {
  return <AuthoritativeGuidePage
    path="/guides/home-energy-assessment-myths"
    label="Myth and fact guide"
    title={title}
    description={description}
    introduction="Home energy terms are easy to mix up. These answers separate what an assessment can show from what still depends on the home, the project and the relevant authority."
    publishedIso="2026-09-01"
    reviewedIso="2026-09-01"
    topics={["Home energy assessment myths", "NatHERS", "Home Energy Rating", "Energy savings"]}
    sections={[
      {
        eyebrow: "Myth 1",
        title: "NatHERS is one assessment for every home",
        paragraphs: ["NatHERS new-home work is usually based on proposed plans and specifications. A completed home uses the current on-site Home Energy Rating service. A general energy audit may have a different scope and does not automatically provide either official certificate."],
      },
      {
        eyebrow: "Myth 2",
        title: "A high rating guarantees a low bill",
        paragraphs: ["A rating models the home using a defined method. Actual bills also depend on occupancy, thermostat settings, appliance use, energy prices, weather and the period being compared. A rating supports better decisions but does not guarantee a bill."],
      },
      {
        eyebrow: "Myth 3",
        title: "An existing-home rating proves building or rental compliance",
        paragraphs: ["Not automatically. New-home building evidence and rental minimum standards have their own rules. The certifier, council, tenancy regulator or other authority determines what evidence is accepted."],
      },
      {
        eyebrow: "Myth 4",
        title: "Every home energy assessment is free",
        paragraphs: ["Some current programs may fund eligible households. Otherwise the assessment is scoped and quoted. Australian Energy Assessments offers a free five-minute booking call, not a free assessment unless a named current program covers the work."],
      },
      {
        eyebrow: "Myth 5",
        title: "An assessment guarantees payback or higher property value",
        paragraphs: ["It cannot. An assessment can compare options and record assumptions. Product prices, energy tariffs, finance, maintenance, buyer demand and the way the household uses the home can all change the result."],
        note: { title: "Ask for the boundary", text: "A trustworthy scope says what is being assessed, what evidence is used, what output is provided and what the result cannot prove." },
      },
      {
        eyebrow: "Myth 6",
        title: "Solar fixes a low thermal Star Rating",
        paragraphs: ["Solar can improve the whole-home energy result, but it does not change how well the roof, walls, floor, insulation and windows hold a comfortable temperature. The building shell and the energy systems are measured separately for a reason."],
      },
      {
        eyebrow: "Myth 7",
        title: "Every Australian new home has the same 7 Star rule",
        paragraphs: ["Most jurisdictions now use a 7 Star setting, but states and territories decide how and when National Construction Code requirements apply. Always confirm the current rule for the project location and approval pathway."],
      },
      {
        eyebrow: "Myth 8",
        title: "Anyone using the title energy assessor can issue the official certificate",
        paragraphs: ["No. An official certificate must come from an assessor accredited or authorised for that assessment pathway. Check the person's current credentials and confirm that the output is accepted for the decision you need to make."],
      },
      {
        eyebrow: "Myth 9",
        title: "A low rating means the home is hopeless",
        paragraphs: ["A low rating can help show where to begin. The useful next step is to separate low-cost actions from larger work, check safety and moisture first, and compare improvements that fit the home and budget."],
      },
    ]}
    sources={[
      { label: "Official new-home assessment guidance", href: "https://www.homeenergyrating.gov.au/households/new-homes/measuring-energy-efficiency-new-homes" },
      { label: "Official existing-home assessment guidance", href: "https://www.homeenergyrating.gov.au/households/existing-homes/how-get-assessment" },
      { label: "Understanding an existing-home certificate", href: "https://www.homeenergyrating.gov.au/households/existing-homes/understanding-your-certificate" },
      { label: "Australian Government rebates directory", href: "https://www.energy.gov.au/rebates" },
    ]}
    cta={{ title: "Still unsure which service fits?", text: "Start with whether the home is built, where it is and what the assessment must support.", href: "/assessments", label: "Choose an assessment" }}
  />;
}
