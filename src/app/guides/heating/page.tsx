import { GuideShell, GuideSection } from "@/components/GuideShell";

export const metadata = {
  title: "Heating and Cooling Guide | Australian Energy Assessments",
  description: "Independent guidance for assessing efficient home heating and cooling in Australia.",
};

export default function HeatingGuidePage() {
  return <GuideShell label="Heating and cooling guide" title="Reduce the load before sizing the system" introduction="Comfort depends on the home, climate, rooms and operating pattern as well as the appliance. Start with draughts, insulation and shading, then compare equipment sized for the spaces you will actually use.">
    <GuideSection eyebrow="Start with the home" title="Lower demand before buying capacity"><div className="guide-principle-grid">
      <article><strong>Seal and insulate</strong><p>Address uncontrolled draughts, curtains, shading and insulation where practical. A lower heating or cooling load can change the size and running pattern you need.</p></article>
      <article><strong>Choose the rooms</strong><p>Record which rooms need conditioning, their floor area, ceiling height, orientation, glazing and how often they are occupied.</p></article>
      <article><strong>Use the local climate zone</strong><p>For non-ducted air conditioners, compare the Zoned Energy Rating Label for the hot, average or cold zone that applies to your location.</p></article>
    </div></GuideSection>

    <GuideSection eyebrow="Compare systems" title="Separate efficiency from suitability"><div className="guide-two-column">
      <div><h3>Reverse-cycle air conditioning</h3><p>Reverse-cycle systems move heat instead of creating it directly. Government guidance says market models can provide about 3 to 6 units of heating or cooling for each unit of electricity used.</p><ul><li>Compare similar capacities in the correct climate zone</li><li>Check heating performance at low outdoor temperatures</li><li>Record indoor and outdoor noise ratings</li><li>Ask how zoning and part-load operation are controlled</li></ul></div>
      <div><h3>Existing gas or resistive heating</h3><p>Do not compare appliance fuel prices alone. Include efficiency losses, electrical fan use, fixed gas charges that may remain, room coverage and whether another gas appliance keeps the connection necessary.</p><ul><li>Confirm flue and ventilation safety requirements</li><li>Price any switchboard or electrical work</li><li>Identify rooms that can be conditioned separately</li><li>Model the expected hours and thermostat settings</li></ul></div>
    </div></GuideSection>

    <GuideSection eyebrow="Written quote checklist" title="Require enough detail to compare like with like"><ul className="guide-checklist">
      <li>Exact indoor and outdoor model numbers</li><li>Rated heating and cooling capacity for each zone</li><li>Zoned Energy Rating Label values for your climate</li><li>Indoor and outdoor sound power information</li><li>Room-by-room sizing assumptions and design temperatures</li><li>Electrical, switchboard, drainage and mounting work</li><li>Ducting, zoning controls and sealing work where applicable</li><li>Equipment, installation and workmanship warranties</li>
    </ul><div className="guide-note"><strong>Do not size from floor area alone.</strong><p>A site assessment should consider climate, construction, glazing, orientation, insulation, air leakage, occupancy and room use. Oversizing can add cost and reduce effective part-load operation.</p></div></GuideSection>

    <GuideSection eyebrow="Current support" title="Check incentives by postcode before signing"><div className="guide-program"><p>Heating and cooling assistance is location and eligibility dependent. Use the Australian Government rebate directory, then confirm the program directly with the administering government or provider before accepting a quote.</p><div className="guide-source-links"><a href="https://www.energy.gov.au/households/heating-and-cooling" target="_blank" rel="noreferrer">Australian Government heating guidance</a><a href="https://www.energyrating.gov.au/consumer-information/products/heating-and-cooling" target="_blank" rel="noreferrer">Zoned Energy Rating guidance</a><a href="https://www.energy.gov.au/rebate-topic/hvac" target="_blank" rel="noreferrer">Find heating and cooling support</a></div></div></GuideSection>
  </GuideShell>;
}
