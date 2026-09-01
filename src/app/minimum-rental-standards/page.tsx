import Link from "next/link";
import { GuideSection, GuideShell } from "@/components/GuideShell";
import { JsonLd } from "@/components/JsonLd";
import { PublicFaqList, type PublicFaq } from "@/components/PublicFaqList";
import { PUBLIC_SITE, buildApexMetadata } from "@/lib/public-site";

const path = "/minimum-rental-standards";
const canonical = `${PUBLIC_SITE.apexUrl}${path}`;
const officialStandardsUrl = "https://www.consumer.vic.gov.au/resources-and-tools/legislation/public-consultations-and-reviews/new-minimum-energy-efficiency-standards";
const existingStandardsUrl = "https://www.consumer.vic.gov.au/housing/renting/repairs-alterations-safety-and-pets/minimum-standards/minimum-standards-for-rental-properties";
const regulationsUrl = "https://www.legislation.vic.gov.au/in-force/statutory-rules/residential-tenancies-regulations-2021/006";
const title = "Victorian Rental Minimum Energy Standards 2027 to 2030 | Australian Energy Assessments";
const description = "A plain-language guide to Victoria's rental heating, cooling, hot water, showerhead, ceiling insulation and draughtproofing rules from 2027 to 2030.";

export const metadata = buildApexMetadata({ path, title, description });

const faqs: readonly PublicFaq[] = [
  {
    question: "Do all six new requirements start on 1 March 2027?",
    answer: "No. They have different triggers. Heating and hot water changes apply when an existing system fails and cannot be repaired. Cooling, showerhead and ceiling-insulation requirements can be triggered by a new rental agreement or conversion to month-to-month. Draughtproofing begins from 1 July 2027, and cooling reaches all rentals from 1 July 2030.",
  },
  {
    question: "Do I have to replace working heating or hot water equipment in 2027?",
    answer: "Not simply because the date arrives. The new heating and hot-water efficiency requirements are triggered when the existing system permanently fails and cannot be repaired. Current minimum standards still apply in the meantime.",
  },
  {
    question: "Does every ceiling need R5.0 insulation?",
    answer: "The new requirement applies to ceiling spaces, or parts of ceiling spaces, where no insulation is present. If insulation is already present, the Victorian guidance says no upgrade is required under this specific standard, regardless of its rating or material. Exemptions can also apply.",
  },
  {
    question: "Can draughtproofing begin as soon as gaps are found?",
    answer: "Not where the property has gas appliances. A licensed plumber must complete a gas safety check before the work starts, and the check must be less than six months old when the work is completed. If unsafe unflued or open-flued appliances are identified, the draughtproofing must not proceed.",
  },
  {
    question: "Does a Home Energy Rating prove that the rental complies?",
    answer: "No. A rating can help explain how the home performs and which improvements may help, but compliance is checked against each legal standard and its evidence. Electrical, gas, plumbing and installation work may also need the relevant licensed or qualified professional.",
  },
  {
    question: "Are exemptions available?",
    answer: "Yes, but they depend on the particular standard and property. Examples can include centralised systems, owners corporation or heritage restrictions, unsafe or inaccessible spaces and insufficient installation space. Keep evidence for any exemption you rely on and confirm it against the current regulations.",
  },
];

const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service",
      "@id": `${canonical}#service`,
      name: "Victorian rental minimum energy standards assessment planning",
      serviceType: "Rental property energy assessment and upgrade planning",
      description: "Property review and planning support for Victoria's rental minimum energy standards. A rating or assessment does not itself prove legal compliance.",
      url: canonical,
      provider: { "@id": PUBLIC_SITE.organizationId },
      areaServed: { "@type": "AdministrativeArea", name: "Victoria" },
      availableChannel: {
        "@type": "ServiceChannel",
        serviceUrl: `${PUBLIC_SITE.apexUrl}/rental-assessment/request`,
      },
    },
    {
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: "en-AU",
      dateModified: "2026-09-02",
      isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId },
      about: { "@id": `${canonical}#service` },
      citation: [officialStandardsUrl, existingStandardsUrl, regulationsUrl],
      breadcrumb: { "@id": `${canonical}#breadcrumb` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Assessments", item: `${PUBLIC_SITE.apexUrl}/assessments` },
        { "@type": "ListItem", position: 3, name: "Victorian rental minimum energy standards", item: canonical },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${canonical}#faq`,
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ],
};

export default function MinimumRentalStandardsPage() {
  return <GuideShell
    active="assessments"
    label="Victorian rental homes"
    title="The new energy standards do not all start at once"
    introduction="Victoria's rental energy rules begin in stages from 1 March 2027. The trigger changes depending on the item, so a working heater, an empty ceiling space and a new rental agreement are treated differently. This guide turns the timeline into a practical checklist."
  >
    <JsonLd data={schema} />
    <div className="assessment-asat">
      <strong>Official Consumer Affairs Victoria guidance checked 2 September 2026</strong>
      <span>The government page was last updated 17 August 2026. Check it again before ordering work because technical details and compliance guidance can change.</span>
    </div>

    <GuideSection eyebrow="First boundary" title="Current standards still apply now">
      <p>Victorian rentals already have minimum standards. The six changes below add new energy requirements from 2027. Do not wait for the new dates if the property already fails a current requirement.</p>
      <div className="guide-source-links"><a href={existingStandardsUrl} target="_blank" rel="noreferrer">Check the current rental minimum standards</a></div>
    </GuideSection>

    <GuideSection eyebrow="Timeline" title="What changes, and when">
      <div className="guide-card-grid">
        <article className="guide-card"><span>From 1 March 2027</span><h3>When heating or hot water fails beyond repair</h3><p>A failed fixed heater must be replaced with an eligible efficient electric heater. A failed hot-water system must be replaced with an efficient heat pump water heater or electric-boosted solar water heater, unless an exemption applies.</p></article>
        <article className="guide-card"><span>From 1 March 2027</span><h3>At a new agreement or conversion to month-to-month</h3><p>The trigger can bring in efficient fixed cooling in the main living area, 4-star WELS showerheads and R5.0 ceiling insulation where no insulation is present. The technical requirements and exemptions differ for each item.</p></article>
        <article className="guide-card"><span>From 1 July 2027</span><h3>Draughtproofing at a new or month-to-month agreement</h3><p>External doors, windows and unsealed wall vents must be draughtproofed, subject to the gas-safety rule and any applicable exemption.</p></article>
        <article className="guide-card"><span>From 1 July 2030</span><h3>Cooling reaches every Victorian rental</h3><p>All rental properties must meet the fixed cooling standard regardless of when the rental agreement began.</p></article>
      </div>
    </GuideSection>

    <GuideSection eyebrow="Six areas" title="What to check before arranging work">
      <div className="guide-card-grid">
        <article className="guide-card"><span>Heating</span><h3>Working equipment is not replaced just because 2027 arrives</h3><p>From 1 March 2027, the new efficient-electric replacement rule applies when the existing fixed heating system fails and cannot be repaired. Current heating standards still apply.</p></article>
        <article className="guide-card"><span>Cooling</span><h3>The trigger starts with agreements, then reaches all rentals</h3><p>From 1 March 2027, eligible fixed cooling is required at a new agreement, conversion to month-to-month, or when existing fixed cooling fails beyond repair. From 1 July 2030 it applies to every rental.</p></article>
        <article className="guide-card"><span>Hot water</span><h3>The change happens at permanent failure</h3><p>A system that is working does not need early replacement under this new rule. When it fails beyond repair from 1 March 2027, the replacement must be an eligible heat pump or electric-boosted solar system unless exempt.</p></article>
        <article className="guide-card"><span>Showerheads</span><h3>4-star WELS, with a narrow 3-star fallback</h3><p>The 4-star requirement is triggered at a new agreement or conversion to month-to-month from 1 March 2027. If a 4-star showerhead cannot be installed or will not work effectively because of the plumbing, a 3-star model is required instead.</p></article>
        <article className="guide-card"><span>Ceiling insulation</span><h3>R5.0 where no insulation is present</h3><p>A qualified installer must treat all ceiling spaces or parts with no insulation. Existing insulation does not have to be upgraded under this specific standard. An electrical safety checklist and any required electrical work must be completed by the specified times.</p></article>
        <article className="guide-card"><span>Draughtproofing</span><h3>Gas safety comes before sealing</h3><p>From 1 July 2027, the rule covers gaps around external doors and windows and unsealed wall vents at the agreement trigger. Gas appliances change what must happen first.</p></article>
      </div>
    </GuideSection>

    <GuideSection eyebrow="Safety" title="Gas appliances change the draughtproofing process">
      <div className="guide-note"><strong>Do not seal first and check later</strong><p>If the property has gas appliances, a licensed plumber must complete a gas safety check before any draughtproofing work begins. The check must be less than six months old when the work is completed. If the check identifies unsafe unflued or open-flued appliances, draughtproofing must not proceed.</p></div>
    </GuideSection>

    <GuideSection eyebrow="Assessment boundary" title="A rating helps with planning, but it is not a compliance certificate">
      <div className="guide-two-column">
        <div><h3>What a home assessment can help with</h3><ul><li>Record the home&apos;s current fabric and fixed systems</li><li>Explain comfort and energy-performance priorities</li><li>Identify questions or evidence that need follow-up</li><li>Plan sensible sequencing around equipment failure and agreement triggers</li></ul></div>
        <div><h3>What still needs its own check</h3><ul><li>Each legal standard, trigger and exemption</li><li>Electrical, gas, plumbing and installer requirements</li><li>Owners corporation, heritage or access restrictions</li><li>Proof of installation and appliance information</li></ul></div>
      </div>
      <p><strong>A rating does not prove compliance.</strong> A Home Energy Rating, sometimes searched for as an existing-home NatHERS assessment, measures home performance. Rental compliance depends on the legal standard and evidence for each item.</p>
    </GuideSection>

    <GuideSection eyebrow="Official sources" title="Check the rule that applies to the property">
      <div className="guide-source-links">
        <a href={officialStandardsUrl} target="_blank" rel="noreferrer">Consumer Affairs Victoria new energy standards</a>
        <a href={existingStandardsUrl} target="_blank" rel="noreferrer">Current rental minimum standards</a>
        <a href={regulationsUrl} target="_blank" rel="noreferrer">Residential Tenancies Regulations 2021</a>
        <a href="https://www.energy.vic.gov.au/victorian-energy-upgrades" target="_blank" rel="noreferrer">Victorian Energy Upgrades discounts</a>
      </div>
    </GuideSection>

    <GuideSection eyebrow="Questions" title="Victorian rental energy standards FAQs">
      <PublicFaqList faqs={faqs} />
    </GuideSection>

    <section className="guide-callout guide-callout-primary"><div><h2>Start with a property review</h2><p>The request form starts a scope review. It does not book work or promise a compliance certificate. Rental minimum standards are included, while electrical, gas and smoke-alarm checks remain separate unless requested.</p></div><Link href="/rental-assessment/request">Request a rental assessment</Link></section>
  </GuideShell>;
}
