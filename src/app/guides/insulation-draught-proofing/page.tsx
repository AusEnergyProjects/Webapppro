import { GuideShell, GuideSection } from "@/components/GuideShell";

const assessmentChecks = [
  "Rooms that are hardest to keep comfortable and the seasons when problems occur",
  "Existing ceiling, wall and floor insulation type, depth, condition and coverage",
  "Visible gaps, compressed batts, displaced insulation and uninsulated access hatches",
  "Draughts around doors, windows, skirtings, exhaust fans, vents and service penetrations",
  "Roof leaks, rising damp, condensation, mould or other moisture sources",
  "Shading, glazing and window coverings that affect summer heat gain and winter heat loss",
];

const quoteChecks = [
  "The exact areas to be insulated or sealed and any inaccessible areas",
  "Product name, insulation type, product R value and proposed total R value",
  "How gaps, edges, thermal bridges and roof-space access hatches will be treated",
  "Electrical inspection, downlight and heat-source clearances, and other safety work",
  "Moisture, condensation and ventilation risks plus the proposed controls",
  "Removal, repair or retention of existing insulation and site clean-up",
  "Installer qualifications, product warranty and workmanship warranty",
  "The complete price with any rebate, certificate or provider discount shown separately",
];

export const metadata = {
  title: "Insulation and Draught Proofing Guide | Australian Energy Assessments",
  description: "Assess insulation, airtightness, ventilation, moisture, safety and written quotes before improving an Australian home.",
};

export default function InsulationGuidePage() {
  return <GuideShell label="Insulation and draught proofing guide" title="Reduce the building load before replacing equipment" introduction="Insulation slows unwanted heat flow and draught proofing limits uncontrolled air leakage. A good upgrade also protects ventilation, moisture management, electrical safety and the performance of the whole building fabric.">
    <GuideSection eyebrow="Start with evidence" title="Find the comfort problem before choosing a product"><ul className="guide-checklist">{assessmentChecks.map((item) => <li key={item}>{item}</li>)}</ul><div className="guide-note"><strong>Do not assume every cold or hot room has the same cause</strong><p>Missing insulation, air leakage, unshaded glazing, moisture, thermal bridges and an undersized or poorly distributed heating system can feel similar. A site inspection helps separate them.</p></div></GuideSection>

    <GuideSection eyebrow="A practical sequence" title="Improve the envelope in a controlled order"><div className="guide-principle-grid">
      <article><strong>1. Control water and moisture</strong><p>Repair leaks and investigate damp or mould before covering areas. Insulation and tighter construction can change drying conditions and condensation risk.</p></article>
      <article><strong>2. Keep intentional ventilation</strong><p>Ventilation brings in outdoor air on purpose and removes moisture and pollutants. Draught proofing should target uncontrolled leakage without blocking required ventilation.</p></article>
      <article><strong>3. Seal unwanted gaps</strong><p>Check doors, windows, exhaust fans, vents, service penetrations, fireplaces, skirtings and ceiling access points. Use products suited to the opening and its movement.</p></article>
      <article><strong>4. Install continuous insulation</strong><p>Choose insulation for the climate and construction. Gaps, compression and thermal bridges can reduce performance even when the product rating looks strong.</p></article>
      <article><strong>5. Address windows and shading</strong><p>Seal frames first, then assess close-fitting coverings, external shading and glazing. The useful response depends on orientation, climate and the season of concern.</p></article>
      <article><strong>6. Reassess equipment needs</strong><p>A lower heating or cooling load can change the appropriate system size. Update the assessment before replacing major equipment.</p></article>
    </div></GuideSection>

    <GuideSection eyebrow="Understand the specification" title="Product R value is not the whole result"><div className="guide-two-column"><div><h3>Product and total R value</h3><p>R value describes resistance to heat flow. Product R value applies to the insulation itself, while total R value includes the other materials and air spaces in the roof, wall or floor system.</p><p>The appropriate level depends on climate, construction and the direction of heat flow. Ask for the proposed total system performance, not only the number printed on a batt.</p></div><div><h3>Continuity and thermal bridges</h3><p>Heat can bypass insulation through framing, slab edges, metal elements, gaps and penetrations. Insulation should fit the space without unsafe compression, voids or displaced sections.</p><p>Reflective insulation also depends on the specified adjacent air space and installation direction. Follow the product instructions and building requirements.</p></div></div></GuideSection>

    <GuideSection eyebrow="Safety boundary" title="Some checks belong with qualified professionals"><div className="guide-two-column"><div><h3>Before insulation work</h3><ul><li>Have a licensed electrician assess wiring before it is covered</li><li>Confirm clearances around downlights, transformers, exhaust fans and other heat sources</li><li>Identify roof access, fragile surfaces, confined spaces and possible hazardous materials</li><li>Confirm the work meets the National Construction Code, relevant standards and product instructions</li></ul></div><div><h3>Before extensive air sealing</h3><ul><li>Do not block ventilation required for an unflued gas heater or other combustion appliance</li><li>Ensure bathroom and kitchen exhaust is managed appropriately</li><li>Plan how indoor moisture and pollutants will be removed</li><li>Seek building advice where condensation, mould or unusually tight construction is a concern</li></ul></div></div><div className="guide-note"><strong>Airtightness and ventilation are different</strong><p>Airtightness limits accidental leakage through gaps. Ventilation is deliberate. A comfortable, efficient home needs unwanted leakage controlled and suitable ventilation maintained.</p></div></GuideSection>

    <GuideSection eyebrow="Compare written quotes" title="Require the scope and assumptions to be visible"><ul className="guide-checklist">{quoteChecks.map((item) => <li key={item}>{item}</li>)}</ul></GuideSection>

    <GuideSection eyebrow="Official guidance" title="Confirm the design and installation requirements"><div className="guide-source-links"><a href="https://www.energy.gov.au/households/insulation-and-draught-proofing" target="_blank" rel="noreferrer">Australian Government household guide</a><a href="https://www.yourhome.gov.au/passive-design/insulation" target="_blank" rel="noreferrer">Your Home insulation guidance</a><a href="https://www.yourhome.gov.au/passive-design/ventilation-airtightness" target="_blank" rel="noreferrer">Your Home ventilation and airtightness</a><a href="https://www.energy.gov.au/households/windows" target="_blank" rel="noreferrer">Australian Government windows guide</a></div></GuideSection>

    <section className="guide-callout"><div><h2>Check location-specific support</h2><p>Insulation and draught-proofing assistance depends on location, household eligibility, property requirements and the current program rules.</p></div><a href="/rebates">Open rebates and assistance</a></section>
    <section className="guide-callout"><div><h2>Size heating and cooling after reducing the load</h2><p>Once the building fabric is better understood, compare equipment using room needs, climate performance, installation design and realistic operating patterns.</p></div><a href="/guides/heating">Open the heating guide</a></section>
  </GuideShell>;
}
