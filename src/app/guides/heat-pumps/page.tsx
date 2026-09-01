import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "Heat Pumps for Australian Homes: What to Compare";
const description = "A plain-English guide to reverse-cycle air conditioners and heat pump hot-water systems, including sizing, installation, running costs and quote checks.";

export const metadata = buildGuideMetadata({ path: "/guides/heat-pumps", title, description, publishedIso: "2026-09-01", reviewedIso: "2026-09-01" });

export default function HeatPumpsGuidePage() {
  return <AuthoritativeGuidePage
    path="/guides/heat-pumps"
    label="Heat pump guide"
    title={title}
    description={description}
    introduction="A heat pump moves heat instead of making it directly. In homes, the term usually means a reverse-cycle air conditioner or a heat pump hot-water system. They do different jobs, so start with the job you need done."
    publishedIso="2026-09-01"
    reviewedIso="2026-09-01"
    topics={["Heat pumps", "Reverse-cycle air conditioning", "Heat pump hot water", "Home electrification"]}
    sections={[
      {
        eyebrow: "Start here",
        title: "Choose the right type of heat pump",
        items: [
          "For heating and cooling rooms, compare reverse-cycle air conditioners.",
          "For household hot water, compare heat pump hot-water systems.",
          "If you need both, assess them separately because sizing, installation and usage are different.",
        ],
      },
      {
        eyebrow: "Heating and cooling",
        title: "Size the system for the rooms and climate",
        paragraphs: [
          "Floor area alone is not enough. A useful quote considers climate, insulation, draughts, glazing, orientation, room use and the temperatures you want to maintain.",
          "Australian Government guidance says an efficient reverse-cycle system can move roughly three to six units of heat for each unit of electricity it uses. That is a useful comparison point, not a promise about your bill.",
          "Ask for the exact indoor and outdoor model numbers, rated capacity, climate-zone performance, noise information and every electrical, drainage, mounting, ducting or zoning cost.",
        ],
        note: { title: "Improve the home first where practical", text: "Better insulation, shading and draught control can reduce the heating or cooling load and may change the system size you need." },
      },
      {
        eyebrow: "Hot water",
        title: "Match storage and recovery to the household",
        items: [
          "Compare tank size, recovery time and the number of people using hot water.",
          "Check noise, airflow, drainage, frost conditions and the proposed installation location.",
          "If winter temperatures regularly fall below 5°C, confirm the model's minimum operating temperature and cold-weather performance.",
          "Confirm the backup element, timer or control settings and any tariff assumptions.",
          "Ask what happens if the unit fails and how warranty service is provided locally.",
        ],
      },
      {
        eyebrow: "Costs and incentives",
        title: "Treat savings as an estimate, not a promise",
        paragraphs: [
          "Running cost depends on the old system, local climate, energy prices, household use and controls. A rebate or certificate can also change the upfront price without changing whether the equipment suits the home.",
          "Require the full price first, then show each current discount separately. Confirm eligibility with the program owner before relying on it.",
        ],
      },
    ]}
    sources={[
      { label: "Australian Government heating and cooling guidance", href: "https://www.energy.gov.au/households/heating-and-cooling" },
      { label: "Australian Government hot-water guidance", href: "https://www.energy.gov.au/households/hot-water-systems" },
      { label: "Energy Rating climate-zone guidance", href: "https://www.energyrating.gov.au/consumer-information/products/heating-and-cooling" },
    ]}
    cta={{ title: "Compare the home before comparing products", text: "Build a simple plan from your rooms, current equipment, comfort problems and budget.", href: "/plan", label: "Build my energy plan" }}
  />;
}
