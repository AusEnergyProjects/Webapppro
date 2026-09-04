import { AuthoritativeGuidePage } from "@/components/AuthoritativeGuidePage";
import { buildGuideMetadata } from "@/lib/public-site";

const title = "Home Electrification and Energy Upgrades: What to Do First";
const description = "A practical whole-home order for comfort, building-fabric improvements and switching from gas to efficient electric appliances without assuming every home needs the same products.";

export const metadata = buildGuideMetadata({ path: "/guides/home-energy-upgrades", title, description, publishedIso: "2026-09-01", reviewedIso: "2026-09-04" });

export default function HomeEnergyUpgradesGuidePage() {
  return <AuthoritativeGuidePage
    path="/guides/home-energy-upgrades"
    label="Home upgrade guide"
    title={title}
    description={description}
    introduction="There is no universal top-five list. The best order depends on the home's safety, moisture, climate, building fabric, current equipment, energy use and budget. Start with the problem you are trying to solve."
    publishedIso="2026-09-01"
    reviewedIso="2026-09-04"
    topics={["Home energy upgrades", "Home electrification", "One-stop home energy advice", "Energy efficiency", "Comfort", "Switching from gas", "Solar and batteries"]}
    sections={[
      {
        eyebrow: "A useful one-stop pathway",
        title: "One clear sequence, with the right specialists",
        items: [
          "Start with the household's comfort, safety, budget and timing rather than a product list.",
          "Use bills, an assessment or building diagnostics only where the evidence will change the decision.",
          "Turn the findings into a practical now, next and later whole-home plan.",
          "Compare written scope, products, enabling work, exclusions, evidence and support before accepting a quote.",
          "Share the property brief and contact details with suitable businesses only when the household chooses to proceed.",
          "Keep commissioning records, reports, warranties and follow-up checks together after the work.",
        ],
        note: { title: "Independent evidence first", text: "A one-stop service should reduce confusing handoffs, not pretend one person is qualified to do every task. The right assessors, licensed trades and specialists still need clear roles." },
      },
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
        title: "Plan appliance replacement before something fails",
        paragraphs: [
          "Heating, hot water and cooking are easier to replace well when there is time to check the home, electrical capacity, site constraints and available products. Record the age and condition of each gas or inefficient electric appliance, then decide what should replace it when it reaches the end of its life.",
          "If an appliance fails unexpectedly, focus first on a safe working replacement. Ask for the efficient electric option, any enabling electrical work and the full installed price before accepting a like-for-like gas replacement by default.",
        ],
        items: [
          "Check switchboard, wiring, circuits and available electrical capacity.",
          "Sequence heating, hot water and cooking around likely failure dates and the household budget.",
          "Confirm space, drainage, noise, outdoor-unit, plumbing and ventilation constraints.",
          "For renters or strata homes, identify the owner, body corporate or building approvals needed before seeking installation quotes.",
        ],
      },
      {
        eyebrow: "Step 5",
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
        eyebrow: "Step 6",
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
      {
        eyebrow: "The final gas appliance",
        title: "Count the connection cost as well as the appliance cost",
        paragraphs: [
          "A gas bill normally includes a daily supply charge even when very little gas is used. Once every gas appliance has been safely replaced, ask the retailer about the current disconnection or abolishment process, fees and timing for your address.",
          "Do not disconnect or alter gas equipment yourself. A qualified professional must complete regulated gas work, and apartments or shared services may have different constraints.",
        ],
        note: { title: "A phased plan is still a plan", text: "You do not need to replace every appliance at once. A clear now, next and later sequence can avoid rushed purchases while keeping the eventual gas-connection decision visible." },
      },
    ]}
    sources={[
      { label: "Australian Government household energy guidance", href: "https://www.energy.gov.au/households" },
      { label: "Australian Government electrification guidance", href: "https://www.energy.gov.au/households/electrification" },
      { label: "RACE for 2030 one-stop shop research", href: "https://www.racefor2030.com.au/project/enhancing-home-thermal-efficiency-2/" },
      { label: "Your Home renovation guidance", href: "https://www.yourhome.gov.au/buy-build-renovate/renovations-and-additions" },
      { label: "Understanding an existing-home certificate", href: "https://www.homeenergyrating.gov.au/households/existing-homes/understanding-your-certificate" },
      { label: "Household Energy Upgrades Fund", href: "https://www.cefc.com.au/where-we-invest/special-investment-programs/household-energy-upgrades-fund/" },
      { label: "Victorian Energy Upgrades products", href: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products" },
      { label: "NSW Home Energy Saver", href: "https://www.energy.nsw.gov.au/households/grants-rebates/home-energy-saver" },
    ]}
    cta={{ title: "Turn the choices into one practical sequence", text: "Build a private home energy roadmap that separates urgent work from the upgrades that can wait. You can then check rebates, assessments and trade help for each step.", href: "/plan", label: "Build my home energy plan" }}
  />;
}
