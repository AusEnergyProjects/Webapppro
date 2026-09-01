import Link from "next/link";
import { GuideSection, GuideShell } from "@/components/GuideShell";
import { JsonLd } from "@/components/JsonLd";
import { PublicFaqList, type PublicFaq } from "@/components/PublicFaqList";
import { PUBLIC_SITE, buildApexMetadata } from "@/lib/public-site";

const path = "/trusted-suppliers";
const canonical = `${PUBLIC_SITE.apexUrl}${path}`;
const title = "Trusted Home Energy Resources and Supplier Checks | Australian Energy Assessments";
const description = "Independent government and community energy resources, plus a practical checklist for checking installers, suppliers, products, quotes and rebates.";

export const metadata = buildApexMetadata({ path, title, description });

const resources = [
  {
    name: "Solar Victoria",
    type: "Victorian Government program",
    description: "Current Victorian solar and hot-water program information, eligibility and consumer guidance.",
    href: "https://www.solar.vic.gov.au/",
  },
  {
    name: "Victorian Energy Upgrades",
    type: "Victorian Government program",
    description: "Current information about eligible upgrades, discounts, approved products and accredited providers in Victoria.",
    href: "https://www.energy.vic.gov.au/victorian-energy-upgrades",
  },
  {
    name: "Renew",
    type: "Independent not-for-profit",
    description: "Consumer education and practical information about sustainable homes, electrification and household technology.",
    href: "https://renew.org.au/",
  },
  {
    name: "Electrify Yarra",
    type: "Community group",
    description: "Local community information and events focused on household electrification in the City of Yarra.",
    href: "https://www.electrifyyarra.org/",
  },
] as const;

const faqs: readonly PublicFaq[] = [
  {
    question: "Does a link on this page mean Australian Energy Assessments endorses a supplier?",
    answer: "No. The links are starting points, not rankings or guarantees. Government and community resources can explain rules and options, but you still need to check the person, product, quote and evidence for your own job.",
  },
  {
    question: "Does Australian Energy Assessments take product commissions?",
    answer: "Australian Energy Assessments does not sell the equipment being assessed or take product commissions for assessment recommendations. If a commercial or referral relationship is introduced in future, Australian Energy Assessments will disclose it clearly where it affects the choice.",
  },
  {
    question: "What should I check before accepting an installer quote?",
    answer: "Confirm the business identity, licence or accreditation relevant to the work, insurance, written scope, product model, program eligibility, exclusions, warranty, timing and payment terms. Check who is responsible for permits, certificates, electrical work, disposal and making good.",
  },
  {
    question: "Is the cheapest quote the best choice?",
    answer: "Not necessarily. Compare the same scope, product performance, installation details, evidence, warranty and exclusions. A low price can reflect a smaller scope or missing work rather than better value.",
  },
];

const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: title,
      description,
      inLanguage: "en-AU",
      dateModified: "2026-09-02",
      isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId },
      mainEntity: { "@id": `${canonical}#resources` },
      breadcrumb: { "@id": `${canonical}#breadcrumb` },
    },
    {
      "@type": "ItemList",
      "@id": `${canonical}#resources`,
      name: "Independent home energy resources",
      itemListElement: resources.map((resource, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "Organization",
          name: resource.name,
          description: resource.description,
          url: resource.href,
        },
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Trusted resources and supplier checks", item: canonical },
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

export default function TrustedSuppliersPage() {
  return <GuideShell
    label="Resources and supplier checks"
    title="Useful starting points, without pretending a logo is proof"
    introduction="This page separates independent government and community information from the commercial decisions you make about suppliers. Start with the official sources, then use the checklist to examine anyone you may hire."
  >
    <JsonLd data={schema} />
    <div className="assessment-asat"><strong>Links and descriptions checked 2 September 2026</strong><span>Inclusion is not a ranking, endorsement or guarantee. Program rules, business details and availability can change.</span></div>

    <GuideSection eyebrow="Independent sources" title="Start with the rule or program owner">
      <div className="guide-card-grid">
        {resources.map((resource) => <article className="guide-card" key={resource.href}><span>{resource.type}</span><h3>{resource.name}</h3><p>{resource.description}</p><a href={resource.href} target="_blank" rel="noreferrer">Open {resource.name}</a></article>)}
      </div>
    </GuideSection>

    <GuideSection eyebrow="Before you hire" title="Check the evidence for the exact work">
      <ul className="guide-checklist">
        <li>Correct legal business name and current contact details</li>
        <li>Licence or accreditation that applies to the work</li>
        <li>Insurance and who will actually attend the property</li>
        <li>Exact product brand, model and approved-product status</li>
        <li>Itemised scope, exclusions and making-good work</li>
        <li>Rebate eligibility checked with the official program</li>
        <li>Product and workmanship warranties in writing</li>
        <li>Permits, certificates, disposal and payment milestones</li>
      </ul>
      <div className="guide-note"><strong>Be careful with the word trusted</strong><p>A familiar logo, a rebate claim or a place in a directory does not prove that a quote is right for your home. Trust should come from current credentials, clear evidence, a written scope and a fair way to resolve problems.</p></div>
    </GuideSection>

    <GuideSection eyebrow="Independent position" title="Assessment advice stays separate from product sales">
      <p>Australian Energy Assessments does not sell the equipment being assessed or take product commissions for assessment recommendations. We can help define the problem and the performance needed, then you can compare suppliers on the same written brief.</p>
    </GuideSection>

    <GuideSection eyebrow="Questions" title="Supplier and installer FAQs">
      <PublicFaqList faqs={faqs} />
    </GuideSection>

    <section className="guide-callout guide-callout-primary"><div><h2>Give trades the same project brief</h2><p>TLink is designed to help you prepare an upgrade request and connect with suitable active trades when they are available. You still check the final licence, insurance, scope, product and warranty before accepting a quote.</p></div><Link href="/direct-trade">Create a TLink project brief</Link></section>
  </GuideShell>;
}
