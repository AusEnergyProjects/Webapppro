import { GuideShell, GuideSection } from "@/components/GuideShell";

export const metadata = {
  title: "Home Energy Guides and Support | Australian Energy Assessments",
  description: "Independent guidance for home comfort, electrification, solar, batteries, EV charging, rebates and project-ready decisions.",
};

export default function GuidesPage() {
  return <GuideShell label="Learn and prepare" title="Find the right evidence without opening ten tabs" introduction="Start with the decision you are making. Each guide explains what to check, what belongs in a written quote and which official source should confirm incentives or requirements.">
    <section className="guide-callout guide-callout-primary"><div><h2>Not sure which guide comes first?</h2><p>Build a private home energy roadmap from your goal, property situation and existing equipment. It puts the relevant comparisons, guides, assessment and project brief in order.</p></div><a href="/plan">Build my roadmap</a></section>
    <section className="guide-callout"><div><h2>Need a NatHERS or BASIX assessment?</h2><p>Start with the dedicated assessment hub for new homes, existing homes and NSW BASIX projects, including the evidence to prepare and the official pathway to confirm.</p></div><a href="/assessments">Explore assessment services</a></section>
    <GuideSection eyebrow="Choose a guide" title="Start with the decision you are making"><div className="guide-card-grid">
      <article className="guide-card"><span>Rooftop solar</span><h3>Match generation to your home</h3><p>Understand sizing, self-consumption, exports, site design, quote assumptions and installer checks.</p><a href="/guides/solar">Open the solar guide</a></article>
      <article className="guide-card"><span>Home batteries</span><h3>Test whether storage fits your load</h3><p>Understand usable capacity, power, backup, cycling, warranties, VPP terms and the current federal discount structure.</p><a href="/guides/batteries">Open the battery guide</a></article>
      <article className="guide-card"><span>Heating and cooling</span><h3>Reduce the load before sizing equipment</h3><p>Compare reverse-cycle systems using climate-zone performance, room needs, noise, installation details and realistic operating patterns.</p><a href="/guides/heating">Open the heating guide</a></article>
      <article className="guide-card"><span>Hot water</span><h3>Match the system to household demand</h3><p>Compare heat pump, solar, storage and continuous-flow options using capacity, climate, tariffs, noise, backup and written quote evidence.</p><a href="/guides/hot-water">Open the hot water guide</a></article>
      <article className="guide-card guide-card-wide"><span>Building fabric</span><h3>Reduce unwanted heat flow and air leakage</h3><p>Assess insulation, draughts, ventilation, moisture, windows, safety and quote scope before replacing major heating or cooling equipment.</p><a href="/guides/insulation-draught-proofing">Open the insulation guide</a></article>
      <article className="guide-card"><span>Electric cooking</span><h3>Coordinate the appliance and enabling work</h3><p>Check induction cooking, cookware, circuits, ventilation, kitchen fit and safe gas decommissioning.</p><a href="/guides/cooking">Open the cooking guide</a></article>
      <article className="guide-card"><span>EV charging</span><h3>Match charging power to real driving</h3><p>Check daily range, parking, solar, tariffs, switchboard capacity, smart controls and strata approval.</p><a href="/guides/ev-charging">Open the EV charging guide</a></article>
    </div></GuideSection>
    <section className="guide-callout"><div><h2>Use your own load pattern where possible</h2><p>A household can use the same annual electricity as another home but at very different times. Half-hour meter data makes solar self-use and battery discharge estimates more representative.</p></div><a href="/compare">Model solar and battery scenarios</a></section>
    <section className="guide-callout"><div><h2>Check location-specific support</h2><p>Rebates, certificates, loans and provider discounts can have different rules. Choose your state or territory and confirm the official source before using an incentive in a quote.</p></div><a href="/rebates">Open rebates and assistance</a></section>
    <section className="guide-callout"><div><h2>See why the evidence matters</h2><p>Worked examples show how timing, self-use and seasonal consumption can change an assessment, with the method and limitations visible.</p></div><a href="/case-studies">View worked examples</a></section>
  </GuideShell>;
}
