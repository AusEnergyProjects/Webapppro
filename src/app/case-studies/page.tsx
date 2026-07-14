import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";

export const metadata = {
  title: "Energy Assessment Worked Examples | Australian Energy Assessments",
  description: "Transparent worked examples showing how household evidence, timing and assumptions affect energy assessment decisions.",
};

const examples = [
  {
    number: "01",
    label: "Electricity plans",
    title: "The same annual usage can produce a different plan ranking",
    question: "Why is annual kWh not always enough to choose a time-of-use plan?",
    evidence: ["A full year of half-hour electricity intervals", "Confirmed general-use and controlled-load registers", "Current retailer tariff periods and rates"],
    method: "Price each measured interval against the published tariff period, then add supply, controlled-load, demand and eligible discount components separately.",
    lesson: "Two homes can use the same annual kWh but have different costs when one uses more electricity in peak periods. The stronger comparison preserves timing instead of applying a generic usage split.",
    limitation: "A result can change when a tariff, eligibility rule, household routine or meter-data period changes.",
    href: "/compare",
    action: "Run an electricity comparison",
  },
  {
    number: "02",
    label: "Solar and battery",
    title: "Exports do not show how much solar the home used directly",
    question: "Why can similar solar systems deliver different household value?",
    evidence: ["Half-hour household load where available", "A stated solar generation shape and system size", "Battery capacity, power, efficiency and reserve assumptions", "Plan-specific import and feed-in rates"],
    method: "Match solar generation to household demand interval by interval. Send only the surplus to export or battery charging, then discharge the battery within its stated limits.",
    lesson: "Daytime household use can be more valuable than export. Battery value depends on when surplus is available and when the home would otherwise import from the grid.",
    limitation: "The scenario is indicative. Weather, shading, degradation, operating controls, outages and future behaviour can change actual performance.",
    href: "/guides/solar",
    action: "Read the solar guide",
  },
  {
    number: "03",
    label: "Mains gas",
    title: "A winter gas bill should not be multiplied as if usage were flat",
    question: "How can one recent bill support a more credible annual estimate?",
    evidence: ["Exact first and last bill dates", "Gas consumption in MJ", "Whether gas is used for space heating", "The confirmed gas distributor where a postcode overlaps"],
    method: "Allocate a dated bill to the selected heating or steady-use profile, annualise from that profile share, then price published seasonal periods and tariff blocks.",
    lesson: "A heating household usually consumes a larger share of annual gas in winter. A dated seasonal profile avoids treating a high winter bill as a typical period all year.",
    limitation: "Weather, occupancy, thermostat settings and appliance changes can make the next year different from the bill period.",
    href: "/gas-compare",
    action: "Run a gas comparison",
  },
] as const;

const publicationChecks = [
  "The household has explicitly consented to publication",
  "Names, addresses, NMI details, filenames and contact data are removed",
  "Plan names, tariff dates and source evidence are retained",
  "Before and after periods are long enough and genuinely comparable",
  "Weather, occupancy and appliance changes are disclosed",
  "Costs, savings and payback remain indicative with assumptions visible",
];

export default function CaseStudiesPage() {
  return <main className="wrap guide-page case-study-page">
    <SiteHeader active="case-studies" />
    <header className="guide-hero"><span>Worked examples</span><h1>See how the evidence changes the decision</h1><p>These examples explain the assessment method without presenting invented customers, testimonials or guaranteed savings. Each one shows what evidence is useful, how it is treated and where uncertainty remains.</p></header>

    <section className="case-study-disclosure"><strong>Illustrative scenarios, not customer case studies</strong><p>No household, retailer result or savings claim is represented here. Real outcomes require current plan data and household-specific evidence.</p></section>

    <section className="guide-section" aria-labelledby="examples-title"><div className="guide-section-heading"><span>Three common decisions</span><h2 id="examples-title">What a stronger assessment does differently</h2></div><div className="case-study-list">{examples.map((example) => <article className="case-study-card" key={example.number}><div className="case-study-title"><span>{example.number}</span><div><small>{example.label}</small><h3>{example.title}</h3><p>{example.question}</p></div></div><div className="case-study-evidence"><h4>Evidence used</h4><ul>{example.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="case-study-analysis"><div><h4>Method</h4><p>{example.method}</p></div><div><h4>Decision lesson</h4><p>{example.lesson}</p></div><div><h4>Important limitation</h4><p>{example.limitation}</p></div></div><a href={example.href}>{example.action}</a></article>)}</div></section>

    <section className="guide-section" aria-labelledby="publication-title"><div className="guide-section-heading"><span>Trust boundary</span><h2 id="publication-title">What a real published case study would need</h2></div><p className="case-study-intro">A future customer case study should be evidence-led, privacy-safe and clear about changes that are not caused by the energy decision itself.</p><ul className="guide-checklist">{publicationChecks.map((item) => <li key={item}>{item}</li>)}</ul></section>

    <section className="guide-callout"><div><h2>Use your own evidence</h2><p>The comparison tools keep electricity and gas separate, preserve material assumptions and show what should be confirmed before switching or buying equipment.</p></div><a href="/plan">Build your home energy roadmap</a></section>
    <SiteFooter>Worked examples are educational and indicative. They are not customer testimonials, current retailer quotes or guarantees of cost, savings or payback.</SiteFooter>
  </main>;
}
