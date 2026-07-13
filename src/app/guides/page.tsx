import { GuideShell, GuideSection } from "@/components/GuideShell";

export const metadata = {
  title: "Home Energy Guides | Australian Energy Assessments",
  description: "Independent guidance for assessing rooftop solar and home batteries.",
};

export default function GuidesPage() {
  return <GuideShell label="Home energy guides" title="Plan an upgrade with the assumptions visible" introduction="Use these guides to understand the evidence, quote details and practical questions that matter before choosing rooftop solar or a home battery.">
    <GuideSection eyebrow="Choose a guide" title="Start with the decision you are making"><div className="guide-card-grid">
      <article className="guide-card"><span>Rooftop solar</span><h3>Match generation to your home</h3><p>Understand sizing, self-consumption, exports, site design, quote assumptions and installer checks.</p><a href="/guides/solar">Open the solar guide</a></article>
      <article className="guide-card"><span>Home batteries</span><h3>Test whether storage fits your load</h3><p>Understand usable capacity, power, backup, cycling, warranties, VPP terms and the current federal discount structure.</p><a href="/guides/batteries">Open the battery guide</a></article>
    </div></GuideSection>
    <section className="guide-callout"><div><h2>Use your own load pattern where possible</h2><p>A household can use the same annual electricity as another home but at very different times. Half-hour meter data makes solar self-use and battery discharge estimates more representative.</p></div><a href="/compare">Model solar and battery scenarios</a></section>
  </GuideShell>;
}
