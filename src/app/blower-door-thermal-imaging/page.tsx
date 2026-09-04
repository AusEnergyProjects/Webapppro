import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "Blower Door Testing and Thermal Imaging for Homes";
const description = "Understand what blower door testing and thermal imaging measure, when to use them together and what evidence to expect from a home building-diagnostics service.";

export const metadata = buildGuideMetadata({
  path: "/blower-door-thermal-imaging",
  title,
  description,
  publishedIso: "2026-09-04",
  reviewedIso: "2026-09-04",
});

export default function BlowerDoorThermalImagingPage() {
  return <AuthoritativeGuidePage
    path="/blower-door-thermal-imaging"
    parent={{ name: "Assessments", href: "/assessments", active: "assessments" }}
    label="Home building diagnostics"
    title={title}
    description={description}
    introduction="These tools answer different questions. A blower door measures air leakage across the building envelope, which means the home's outer shell. A thermal camera maps surface-temperature patterns. Used carefully, they can help find why a room is draughty, why insulation is underperforming or where a retrofit needs more investigation."
    publishedIso="2026-09-04"
    reviewedIso="2026-09-04"
    topics={["Blower door testing", "Thermal imaging", "Airtightness", "Insulation", "Home energy assessment"]}
    sections={[
      {
        eyebrow: "The short answer",
        title: "Measure the whole home, then locate the likely problem",
        paragraphs: [
          "A blower door uses a calibrated fan and pressure measurements to quantify how much air leaks through the home. Results are commonly reported at a 50 pascal pressure difference, using units such as air changes per hour or air permeability, which is the leakage rate for each square metre of the tested shell.",
          "Thermal imaging shows surface-temperature differences. It can help identify patterns consistent with missing or displaced insulation, thermal bridging, damp areas or air leakage, but the image does not prove the cause on its own.",
        ],
      },
      {
        eyebrow: "Blower door testing",
        title: "Use it when the amount of air leakage matters",
        items: [
          "Measure the home before and after planned air-sealing work.",
          "Check a new building envelope before finishes make defects harder to reach.",
          "Investigate widespread draughts or comfort problems when visual checks are not enough.",
          "Record the test method, building configuration, equipment and result units so a later test can be compared fairly.",
        ],
        note: { title: "A leakage number is not a repair list", text: "The test measures the overall envelope. Smoke tracing, thermal imaging and a careful inspection may still be needed to locate individual leakage paths." },
      },
      {
        eyebrow: "Thermal imaging",
        title: "Use it when the pattern and location matter",
        items: [
          "Look for insulation gaps, compression or displacement in ceilings and walls.",
          "Check repeating patterns that may show a thermal bridge, where framing or another path carries heat around the insulation.",
          "Inspect around windows, doors, downlights, exhaust fans and service penetrations.",
          "Record paired visible and thermal images, the location, indoor and outdoor conditions, camera details and any limitations.",
        ],
        note: { title: "Conditions affect the image", text: "Weather, sun, wind, heating or cooling, surface finishes, moisture and the indoor-to-outdoor temperature difference can change what the camera shows. A thermogram, or thermal image, should be interpreted with the building context, not treated as a diagnosis by itself." },
      },
      {
        eyebrow: "Use them together",
        title: "The strongest result connects measurement, location and context",
        paragraphs: [
          "A blower door can create a controlled pressure difference while a practitioner uses a thermal camera or smoke tool to trace likely leakage paths. The combined evidence is useful when preparing a targeted sealing or insulation scope and when checking the result after work.",
          "For a straightforward visible defect, one tool may be enough. Ask what decision the test needs to support before paying for a larger scope.",
        ],
      },
      {
        eyebrow: "Safety boundary",
        title: "Tighter is not automatically healthier or safer",
        items: [
          "Do not block intentional ventilation, exhaust paths, flues or combustion-air openings.",
          "Record gas, wood and other combustion appliances before pressure testing or permanent sealing work.",
          "Investigate moisture, condensation and mould before closing a building assembly or reducing its drying path.",
          "Plan adequate kitchen, bathroom, laundry and whole-home ventilation as airtightness improves.",
          "Use the licences and specialists required for any electrical, gas, building, moisture or hazardous-material work found during the assessment.",
        ],
      },
      {
        eyebrow: "Before you book",
        title: "Ask for a result you can act on",
        items: [
          "The purpose of the test and whether it covers the whole home or a defined area.",
          "The test method, practitioner capability and current equipment or calibration details.",
          "The building setup, weather and operating conditions that will be recorded.",
          "A clear report with results, labelled evidence, limitations and recommended next checks.",
          "Whether a follow-up test after repairs is included or separately priced.",
        ],
        note: { title: "Separate diagnostics from formal ratings", text: "Blower door testing and thermal imaging can support an investigation or upgrade plan. They are not automatically a NatHERS certificate, Home Energy Rating, building-compliance approval, moisture report or structural inspection." },
      },
    ]}
    sources={[
      { label: "Your Home ventilation and airtightness", href: "https://www.yourhome.gov.au/passive-design/ventilation-airtightness" },
      { label: "Your Home renovations and additions", href: "https://www.yourhome.gov.au/buy-build-renovate/renovations-and-additions" },
      { label: "ABCB building sealing verification", href: "https://www.abcb.gov.au/resources/videos/building-sealing-verification" },
      { label: "Australian Government Home Energy Ratings Disclosure Framework", href: "https://www.energy.gov.au/sites/default/files/2024-12/home-energy-ratings-disclosure-framework-version-2.pdf" },
      { label: "CSIRO air infiltration research", href: "https://www.csiro.au/en/news/All/Articles/2024/August/testing-leakiness-australian-homes" },
    ]}
    cta={{ title: "Need a diagnostic test for your home?", text: "Choose blower door testing, thermal imaging or both. A matching business can then review the property, purpose and access before quoting.", href: "/direct-trade", label: "Prepare a service request" }}
  />;
}
