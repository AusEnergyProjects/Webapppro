import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "Home Energy Upgrades: What to Improve First";
const description = "A practical order for improving comfort and energy performance without assuming every Australian home needs the same products.";

export const metadata = buildGuideMetadata({ path: "/guides/home-energy-upgrades", title, description, publishedIso: "2026-09-01", reviewedIso: "2026-09-01" });

export default function HomeEnergyUpgradesGuidePage() {
  return <AuthoritativeGuidePage
    path="/guides/home-energy-upgrades"
    label="Home upgrade guide"
    title={title}
    description={description}
    introduction="There is no universal top-five list. The best order depends on the home's safety, moisture, climate, building fabric, current equipment, energy use and budget. Start with the problem you are trying to solve."
    publishedIso="2026-09-01"
    reviewedIso="2026-09-01"
    topics={["Home energy upgrades", "Energy efficiency", "Comfort", "Electrification", "Solar and batteries"]}
    sections={[
      {
        eyebrow: "Step 1",
        title: "Deal with safety, leaks and moisture first",
        paragraphs: [
          "Repair active water leaks and investigate damp, condensation, mould, unsafe wiring or combustion-appliance concerns before covering areas or tightening the building.",
          "An energy rating is not a structural, electrical, gas, moisture or medical assessment. Bring in the right qualified professional where those risks exist.",
        ],
      },
      {
        eyebrow: "Step 2",
        title: "Understand where comfort and energy are being lost",
        items: [
          "Record which rooms are too hot, cold or draughty and when it happens.",
          "Check insulation coverage, gaps, shading, glazing and ventilation.",
          "Review bills or interval data without assuming every change in cost comes from the building.",
          "Use an assessment when the cause or upgrade order is unclear.",
        ],
      },
      {
        eyebrow: "Step 3",
        title: "Reduce the load before replacing major equipment",
        paragraphs: [
          "Useful fabric work can include draught control, insulation, shading and window improvements. The right mix depends on climate, construction and the specific comfort problem.",
          "Once the load is clearer, heating, cooling and hot-water equipment can be sized for the home rather than selected from a generic rule.",
        ],
      },
      {
        eyebrow: "Step 4",
        title: "Coordinate electrification, solar and batteries",
        items: [
          "Check switchboard, wiring and available electrical capacity.",
          "Plan when old gas or resistive appliances are likely to be replaced.",
          "Size solar against the home's daytime use and likely future loads.",
          "Test battery value against actual usage timing, tariffs and backup needs.",
        ],
        note: { title: "Savings are indicative", text: "Bills, prices, weather and household behaviour change. A rating or model supports a decision but cannot guarantee a bill reduction, payback period or property-value increase." },
      },
    ]}
    sources={[
      { label: "Australian Government household energy guidance", href: "https://www.energy.gov.au/households" },
      { label: "Your Home renovation guidance", href: "https://www.yourhome.gov.au/buy-build-renovate/renovations-and-additions" },
      { label: "Understanding an existing-home certificate", href: "https://www.homeenergyrating.gov.au/households/existing-homes/understanding-your-certificate" },
    ]}
    cta={{ title: "Turn the list into a home-specific order", text: "Build a private roadmap from the home's current problems, equipment and goals.", href: "/plan", label: "Build my energy plan" }}
  />;
}
