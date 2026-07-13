import { GuideShell, GuideSection } from "@/components/GuideShell";

const quoteChecks = [
  "System size in kW and the exact panel and inverter models",
  "A site-specific layout showing panel placement, orientation and likely shading",
  "Expected annual generation and bill savings with every assumption stated",
  "Network connection, export limits and any smart-meter work",
  "Switchboard, wiring, access or other work included in the total price",
  "Product, performance and workmanship warranties plus local support details",
];

export const metadata = {
  title: "Rooftop Solar Guide | Australian Energy Assessments",
  description: "Assess rooftop solar sizing, self-consumption, quotes, installers and network limits.",
};

export default function SolarGuidePage() {
  return <GuideShell label="Rooftop solar guide" title="Size solar around when your home uses electricity" introduction="Annual consumption is only the starting point. A useful design also considers daytime demand, roof conditions, export limits, future appliances and the tariff that values imports and exports.">
    <GuideSection eyebrow="The core calculation" title="Solar value has two different parts"><div className="guide-principle-grid">
      <article><strong>Solar used in the home</strong><p>Each kWh used as it is generated can avoid buying a kWh from the grid. This is usually more valuable than exporting the same energy.</p></article>
      <article><strong>Solar exported to the grid</strong><p>Surplus generation earns the applicable feed-in tariff, subject to plan eligibility and any network export limit.</p></article>
      <article><strong>Future electricity use</strong><p>An EV, heat-pump hot water or electric heating may change the useful system size and the times when energy is consumed.</p></article>
    </div></GuideSection>

    <GuideSection eyebrow="Before requesting quotes" title="Prepare evidence for a site-specific design"><div className="guide-two-column"><div><h3>Household evidence</h3><ul><li>Recent bills covering about 12 months</li><li>NEM12 half-hour data where available</li><li>Current solar, controlled load or demand tariff details</li><li>Planned EV, heating, cooling or hot-water changes</li></ul></div><div><h3>Property evidence</h3><ul><li>Roof orientation, usable space and shading</li><li>Switchboard location and condition</li><li>Meter type and electricity distributor</li><li>Preferred inverter and battery locations</li></ul></div></div></GuideSection>

    <GuideSection eyebrow="Compare like with like" title="What every written solar quote should show"><ul className="guide-checklist">{quoteChecks.map((item) => <li key={item}>{item}</li>)}</ul><div className="guide-note"><strong>Small-scale technology certificates</strong><p>Eligible rooftop solar installations may receive an upfront STC discount. The final value depends on the system, location, installation date and certificate value. Ensure the written quote shows the deduction separately instead of presenting it as an unexplained saving.</p></div></GuideSection>

    <GuideSection eyebrow="Installer and product checks" title="Do not assess the price alone"><div className="guide-two-column"><div><h3>Confirm accreditation</h3><p>Ask for the installer&apos;s Solar Accreditation Australia number and verify it. Government rebates under the Small-scale Renewable Energy Scheme require an accredited installer.</p></div><div><h3>Confirm approved equipment</h3><p>Check that panels and inverters are approved products, read the warranty conditions and confirm who provides technical and after-sales support in Australia.</p></div></div><div className="guide-source-links"><a href="https://www.energy.gov.au/households/solar-pv-and-batteries" target="_blank" rel="noreferrer">Australian Government Solar Consumer Guide</a><a href="https://www.energy.gov.au/solar/solar-retailers-and-installation/choose-your-solar-retailer-and-installer" target="_blank" rel="noreferrer">Choosing a retailer and installer</a></div></GuideSection>

    <section className="guide-callout"><div><h2>Model the household before choosing a size</h2><p>The electricity comparison can apply a solar shape to your measured or assumed load and show estimated self-use, grid imports, exports and plan-specific feed-in value.</p></div><a href="/compare">Open the solar scenario</a></section>
  </GuideShell>;
}
