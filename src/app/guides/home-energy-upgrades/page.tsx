import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "Home Energy Upgrades: What to Improve First";
const description = "A practical order for improving comfort and energy performance without assuming every Australian home needs the same products.";

export const metadata = buildGuideMetadata({ path: "/guides/home-energy-upgrades", title, description, publishedIso: "2026-09-01", reviewedIso: "2026-09-02" });

export default function HomeEnergyUpgradesGuidePage() {
  return <AuthoritativeGuidePage
    path="/guides/home-energy-upgrades"
    label="Home upgrade guide"
    title={title}
    description={description}
    introduction="There is no universal top-five list. The best order depends on the home's safety, moisture, climate, building fabric, current equipment, energy use and budget. Start with the problem you are trying to solve."
    publishedIso="2026-09-01"
    reviewedIso="2026-09-02"
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
      {
        eyebrow: "Step 5",
        title: "Check rebates and finance after the scope is clear",
        paragraphs: [
          "A discount or lower-rate loan can help with a suitable project, but it does not make the wrong product, size or installation good value. Start with the work the home needs, then check the current support for that exact scope.",
          "Program amounts, approved products, provider rules and lender criteria change. Confirm them with the program owner or lender before signing a quote or finance contract.",
        ],
        items: [
          "Check eligibility on the current official program page.",
          "Confirm the exact product and provider meet the program rules.",
          "Ask for the discount, fees and customer contribution in writing.",
          "Do not assume two incentives can be combined unless both programs allow it.",
          "Compare the full repayment and ownership terms of any finance, not just the advertised rate.",
        ],
        note: { title: "A rating is not universal finance approval", text: "Some lenders use home energy ratings or other sustainability evidence, but their thresholds and accepted documents differ. Check the current product criteria with the lender." },
      },
    ]}
    sources={[
      { label: "Australian Government household energy guidance", href: "https://www.energy.gov.au/households" },
      { label: "Your Home renovation guidance", href: "https://www.yourhome.gov.au/buy-build-renovate/renovations-and-additions" },
      { label: "Understanding an existing-home certificate", href: "https://www.homeenergyrating.gov.au/households/existing-homes/understanding-your-certificate" },
      { label: "Household Energy Upgrades Fund", href: "https://www.cefc.com.au/where-we-invest/special-investment-programs/household-energy-upgrades-fund/" },
      { label: "Victorian Energy Upgrades products", href: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products" },
      { label: "NSW Home Energy Saver", href: "https://www.energy.nsw.gov.au/households/grants-rebates/home-energy-saver" },
    ]}
    cta={{ title: "Check current support for the right project", text: "Choose your state or territory and verify current rebates, certificates, loans and provider discounts before using them in a budget.", href: "/rebates", label: "Check rebates and assistance" }}
  />;
}
