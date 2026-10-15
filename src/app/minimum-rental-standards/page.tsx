import Link from "next/link";
import { AeaServicePricePanel } from "@/components/AeaServices";
import { GuideSection, GuideShell } from "@/components/GuideShell";
import { JsonLd } from "@/components/JsonLd";
import { PublicFaqList, type PublicFaq } from "@/components/PublicFaqList";
import { PUBLIC_SITE, buildApexMetadata } from "@/lib/public-site";
import { getAeaService, gstInclusiveCents } from "@/lib/aea-services.mjs";
import { AEA_RENTAL_UPDATES } from "@/lib/aea-rental-updates.mjs";
import { RentalComplianceNotice, RentalProgramExperience } from "@/components/RentalComplianceNotice";

const path = "/minimum-rental-standards";
const canonical = `${PUBLIC_SITE.apexUrl}${path}`;
const officialStandardsUrl = "https://www.consumer.vic.gov.au/resources-and-tools/legislation/public-consultations-and-reviews/new-minimum-energy-efficiency-standards";
const existingStandardsUrl = "https://www.consumer.vic.gov.au/housing/renting/repairs-alterations-safety-and-pets/minimum-standards/minimum-standards-for-rental-properties";
const regulationsUrl = "https://www.legislation.vic.gov.au/in-force/statutory-rules/residential-tenancies-regulations-2021";
const gasSafetyUrl = "https://www.consumer.vic.gov.au/housing/renting/repairs-alterations-safety-and-pets/gas-electrical-and-water-safety-standards/rental-providers-gas-and-electrical-safety";
const title = "Rental Minimum Standards Assessment Victoria | Australian Energy Assessments";
const description = "Onsite Victorian rental minimum standards assessments for $150 + GST ($165 including GST), with photo evidence and clear findings. Understand current standards and the 2027 to 2030 energy changes.";

export const metadata = buildApexMetadata({ path, title, description });

const service = getAeaService("minimum-rental-standards")!;
const faqs: readonly PublicFaq[] = [
  ...service.faqs.map(([question, answer]) => ({ question, answer })),
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
    answer: "If the property has gas appliances, fixtures or fittings, a licensed or registered gasfitter must complete a pre-draughtproofing gas safety check within six months before the work starts. The check must identify ventilation requirements and areas that must not be draughtproofed. This is separate from the two-yearly check, although one visit can meet both requirements if its timing and scope are suitable.",
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
      name: service.name,
      serviceType: "Victorian rental minimum standards assessment",
      description: service.summary,
      url: canonical,
      provider: { "@id": PUBLIC_SITE.organizationId },
      offers: { "@type": "Offer", price: (gstInclusiveCents(service.priceExGstCents) / 100).toFixed(2), priceCurrency: "AUD", url: canonical,
        priceSpecification: { "@type": "UnitPriceSpecification", price: (gstInclusiveCents(service.priceExGstCents) / 100).toFixed(2), priceCurrency: "AUD", valueAddedTaxIncluded: true } },
      areaServed: { "@type": "AdministrativeArea", name: "Victoria" },
      availableChannel: {
        "@type": "ServiceChannel",
        serviceUrl: canonical,
      },
    },
    {
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: "en-AU",
      dateModified: "2026-10-15",
      isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId },
      about: { "@id": `${canonical}#service` },
      citation: [AEA_RENTAL_UPDATES.url, officialStandardsUrl, existingStandardsUrl, gasSafetyUrl, regulationsUrl],
      breadcrumb: { "@id": `${canonical}#breadcrumb` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Services", item: `${PUBLIC_SITE.apexUrl}/services` },
        { "@type": "ListItem", position: 3, name: "Rental minimum standards assessment", item: canonical },
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
    title="Rental minimum standards assessments"
    introduction="Support your rental portfolio with clear assessments, useful records and a practical plan for the new requirements. We work alongside your existing providers and can look after wider compliance needs where your team needs support."
  >
    <JsonLd data={schema} />
    <RentalComplianceNotice showAssessmentLink={false} />
    <AeaServicePricePanel serviceId="minimum-rental-standards" />
    <RentalProgramExperience />
    <GuideSection eyebrow="Your onsite assessment" title="The current minimum standards we review">
      <p>We review the applicable requirements across locks, vermin-proof bins, toilets, bathrooms, kitchens, laundry facilities, structural soundness, mould and damp, electrical safety, window coverings, windows, lighting, ventilation, heating and window-covering cord anchors.</p>
      <p>Findings identify what meets the inspected requirement, what needs attention and what could not be verified. Photographs and limitations are kept with the report. Licensed testing and specialist investigations remain separate where needed.</p>
    </GuideSection>
    <div className="assessment-asat">
      <strong>Official Consumer Affairs Victoria guidance checked 15 October 2026</strong>
      <span>The rental-law changes page was updated 14 October 2026. Check the current guidance before ordering work because technical details and requirements can change.</span>
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
      <div className="guide-note"><strong>Check gas safety before sealing</strong><p>If the property has gas appliances, fixtures or fittings, a licensed or registered gasfitter must complete a pre-draughtproofing gas safety check within six months before work starts. The gasfitter identifies ventilation requirements and areas that must not be draughtproofed. A two-yearly gas check can cover both purposes only when it meets both sets of timing and information requirements.</p></div>
      <div className="guide-source-links"><a href={gasSafetyUrl} target="_blank" rel="noreferrer">CAV pre-draughtproofing gas safety requirements</a></div>
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
        <a href={AEA_RENTAL_UPDATES.url} target="_blank" rel="noreferrer">Official Victorian rental law changes</a>
        <a href={officialStandardsUrl} target="_blank" rel="noreferrer">Consumer Affairs Victoria new energy standards</a>
        <a href={existingStandardsUrl} target="_blank" rel="noreferrer">Current rental minimum standards</a>
        <a href={regulationsUrl} target="_blank" rel="noreferrer">Residential Tenancies Regulations 2021</a>
        <a href="https://www.energy.vic.gov.au/victorian-energy-upgrades" target="_blank" rel="noreferrer">Victorian Energy Upgrades discounts</a>
      </div>
    </GuideSection>

    <GuideSection eyebrow="Questions" title="Victorian rental energy standards FAQs">
      <PublicFaqList faqs={faqs} />
    </GuideSection>

    <section className="guide-callout guide-callout-primary"><div><h2>Plan the next steps for your rental portfolio</h2><p>Talk through the new requirements, your existing arrangements and where your team needs support. We will confirm the assessments, safety checks and ongoing schedule that fit your properties, with each service clearly scoped and priced.</p><p>For an individual property, you can also <Link href="/rental-assessment/request">request a rental assessment</Link>.</p></div><Link href="/book-an-assessment">Discuss your portfolio</Link></section>
  </GuideShell>;
}
