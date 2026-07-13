import { GuideShell, GuideSection } from "@/components/GuideShell";

export const metadata = {
  title: "Hot Water Guide | Australian Energy Assessments",
  description: "Independent guidance for comparing heat pump, solar, electric and gas hot water systems in Australia.",
};

export default function HotWaterGuidePage() {
  return <GuideShell label="Hot water guide" title="Match capacity and timing to household demand" introduction="A suitable hot water system must cover the household's peak demand, climate and available energy supply. Compare the full installed scope and likely operating schedule, not the tank price alone.">
    <GuideSection eyebrow="Prepare the evidence" title="Document demand and site constraints"><div className="guide-principle-grid">
      <article><strong>Household demand</strong><p>Record resident numbers, shower patterns, bath use, appliance connections and likely changes. Ask for the model&apos;s rated hot water delivery, not only its tank volume.</p></article>
      <article><strong>Energy and timing</strong><p>Identify rooftop solar, controlled-load wiring, tariff windows and when hot water is normally used. A timer may improve solar self-use only if recovery and storage remain adequate.</p></article>
      <article><strong>Climate and location</strong><p>Check cold-weather operation, frost suitability, airflow, drainage and compressor noise at the proposed location, especially near bedrooms and neighbours.</p></article>
    </div></GuideSection>

    <GuideSection eyebrow="Compare technologies" title="Understand where each option can differ"><div className="guide-two-column">
      <div><h3>Heat pump and solar hot water</h3><p>Heat pumps transfer heat from surrounding air into stored water. Australian Government guidance says they can use about 30% of the energy of a conventional electric hot water system, but climate, model performance, backup heating and schedules matter.</p><ul><li>Confirm integrated or split configuration</li><li>Check compressor sound and cold-climate limits</li><li>Ask when the resistive booster operates</li><li>Check the exact model against current incentive registers</li></ul></div>
      <div><h3>Electric storage and gas systems</h3><p>Storage systems keep a tank hot, while continuous-flow systems heat water on demand. Compare standing losses, tariff access, electrical capacity, gas fixed charges, venting and whether changing systems affects other appliances.</p><ul><li>Confirm tank delivery and recovery time</li><li>Check controlled-load or three-phase requirements</li><li>Include decommissioning and connection work</li><li>Plan a temporary service if replacement is urgent</li></ul></div>
    </div></GuideSection>

    <GuideSection eyebrow="Written quote checklist" title="Make installation and incentive claims auditable"><ul className="guide-checklist">
      <li>Exact marketed and registered model numbers</li><li>Tank volume and rated hot water delivery</li><li>Expected annual energy under the relevant climate zone</li><li>Normal, boost and low-temperature operating modes</li><li>Timer, controller and rooftop solar integration</li><li>Electrical, plumbing, drainage and structural work</li><li>Removal, disposal and temporary hot water arrangements</li><li>Product, tank, compressor and workmanship warranties</li>
    </ul><div className="guide-note"><strong>There is no mandatory Energy Rating Label for heat pump water heaters yet.</strong><p>Compare written performance data and warranty terms carefully. A 2026 government decision supports future minimum performance standards, with labelling expected through a later implementation stage.</p></div></GuideSection>

    <GuideSection eyebrow="Certificates and rebates" title="Verify the exact model before installation"><div className="guide-program"><p>Eligible solar water heaters and air source heat pumps may receive Small-scale Technology Certificates. The exact model must be on the Clean Energy Regulator register and installed as listed. Certificate values vary by model, postcode zone and the remaining deeming period.</p><p>State and territory rebates can change and may have separate product, property, installer and replacement rules. Check the current government directory and administering program before signing.</p><div className="guide-source-links"><a href="https://www.energy.gov.au/households/hot-water-systems" target="_blank" rel="noreferrer">Australian Government hot water guidance</a><a href="https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-water-heaters/register-solar-water-heaters" target="_blank" rel="noreferrer">Check the eligible model register</a><a href="https://www.energy.gov.au/rebate-topic/hot-water" target="_blank" rel="noreferrer">Find current hot water support</a></div></div></GuideSection>
  </GuideShell>;
}
