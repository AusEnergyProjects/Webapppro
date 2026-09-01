import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { GuideSection, GuideShell } from "@/components/GuideShell";
import { JsonLd } from "@/components/JsonLd";
import { PublicFaqList, type PublicFaq } from "@/components/PublicFaqList";
import { PUBLIC_SITE, buildApexMetadata } from "@/lib/public-site";

const path = "/trusted-suppliers";
const canonical = `${PUBLIC_SITE.apexUrl}${path}`;
const title = "Trusted Home Energy Resources, NatHERS and Rebate Links | Australian Energy Assessments";
const description = "Official Australian home energy rating, NatHERS, rebate, energy comparison and accreditation resources, with plain-English guidance for checking suppliers and quotes.";

export const metadata = buildApexMetadata({ path, title, description });

type ResourceGroupId = "ratings" | "government" | "consumer" | "industry";
type TrustedResource = {
  name: string;
  type: string;
  description: string;
  href: string;
  group: ResourceGroupId;
  logo?: string;
  logoSource?: string;
  mark?: string;
};

const resourceGroups: readonly { id: ResourceGroupId; eyebrow: string; title: string; introduction: string }[] = [
  {
    id: "ratings",
    eyebrow: "Ratings and standards",
    title: "Understand the rules before paying for advice",
    introduction: "These are the national starting points for home energy ratings, NatHERS, appliance labels, sustainable design and the National Construction Code.",
  },
  {
    id: "government",
    eyebrow: "Government help and schemes",
    title: "Check rebates, certificates and energy plans at the source",
    introduction: "Program rules change. Use the responsible government or regulator page to confirm eligibility, approved products and the current process before signing a quote.",
  },
  {
    id: "consumer",
    eyebrow: "Independent consumer guidance",
    title: "Learn without being funnelled into a sales quote",
    introduction: "These non-commercial organisations publish practical education and consumer research. They do not replace an assessment of your own home.",
  },
  {
    id: "industry",
    eyebrow: "Accreditation and industry bodies",
    title: "Check the people, products and technical standards behind the work",
    introduction: "These bodies cover home energy assessors, solar accreditation, refrigeration licensing, efficiency, HVAC, glazing and clean-energy products. An industry listing is useful evidence, but it is not a guarantee of a good quote.",
  },
];

// Logo copies come from the linked organisation's own website. Where reuse terms
// are restrictive or a stable standalone asset is unavailable, a text mark is used.
const resources: readonly TrustedResource[] = [
  {
    name: "Home Energy Rating (NatHERS)",
    type: "Australian Government rating scheme",
    description: "The national source for new-home NatHERS ratings, existing-home ratings, accredited assessors and what a certificate means.",
    href: "https://www.homeenergyrating.gov.au/",
    group: "ratings",
    logo: "/trusted-resources/home-energy-rating.svg",
    logoSource: "https://www.homeenergyrating.gov.au/themes/custom/custom/logo.svg",
  },
  {
    name: "Your Home",
    type: "Australian Government guide",
    description: "A practical guide to designing, building or renovating a comfortable, efficient and climate-suitable Australian home.",
    href: "https://www.yourhome.gov.au/",
    group: "ratings",
    logo: "/trusted-resources/your-home.png",
    logoSource: "https://www.yourhome.gov.au/sites/default/files/YourHome-logo.png",
  },
  {
    name: "energy.gov.au",
    type: "Australian Government information",
    description: "Plain information about household energy use, electrification, solar, batteries, rebates and lowering running costs.",
    href: "https://www.energy.gov.au/households",
    group: "ratings",
    logo: "/trusted-resources/energy-gov-au.png",
    logoSource: "https://www.energy.gov.au/themes/custom/energy/logo.png",
  },
  {
    name: "Energy Rating",
    type: "Australian Government program",
    description: "Check appliance energy labels, running-cost information and minimum energy-performance requirements.",
    href: "https://www.energyrating.gov.au/",
    group: "ratings",
    logo: "/trusted-resources/energy-rating.png",
    logoSource: "https://www.energyrating.gov.au/themes/custom/erp/images/logo.png",
  },
  {
    name: "Australian Building Codes Board",
    type: "National construction-code body",
    description: "The official source for the National Construction Code and its residential energy-efficiency requirements.",
    href: "https://www.abcb.gov.au/",
    group: "ratings",
    logo: "/trusted-resources/abcb.svg",
    logoSource: "https://www.abcb.gov.au/themes/custom/abcb_theme/assets/images/logos/abcb/abcb-inline-color.svg",
  },
  {
    name: "Clean Energy Regulator",
    type: "Australian Government regulator",
    description: "Official rules for Small-scale Technology Certificates and eligible solar, battery and heat-pump hot-water systems.",
    href: "https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems",
    group: "government",
    logo: "/trusted-resources/clean-energy-regulator.svg",
    logoSource: "https://cer.gov.au/themes/custom/cer/logo.svg",
  },
  {
    name: "Energy Made Easy",
    type: "Australian Energy Regulator service",
    description: "A free independent electricity and gas plan comparison service for participating states and territories outside Victoria.",
    href: "https://www.energymadeeasy.gov.au/",
    group: "government",
    logo: "/trusted-resources/energy-made-easy.svg",
    logoSource: "https://www.energymadeeasy.gov.au/images/eme-logo.svg",
  },
  {
    name: "NSW Climate and Energy Action",
    type: "NSW Government information",
    description: "NSW household guidance for energy assessments, electrification, solar, batteries and current rebates.",
    href: "https://www.energy.nsw.gov.au/households",
    group: "government",
    mark: "NSW",
  },
  {
    name: "Solar Victoria",
    type: "Victorian Government program",
    description: "Current Victorian solar, battery and hot-water eligibility, consumer guidance and approved-provider information.",
    href: "https://www.solar.vic.gov.au/",
    group: "government",
    logo: "/trusted-resources/solar-victoria.png",
    logoSource: "https://www.solar.vic.gov.au/sites/default/files/2023-11/SolarVic-Ripple2_Logo-Print.png?width=296",
  },
  {
    name: "Victorian Energy Upgrades",
    type: "Victorian Government program",
    description: "Check eligible upgrades, discounts, approved products, accredited providers and your consumer rights in Victoria.",
    href: "https://www.energy.vic.gov.au/victorian-energy-upgrades/homes",
    group: "government",
    mark: "VEU",
  },
  {
    name: "SEC Victoria",
    type: "Victorian Government-owned service",
    description: "Household electrification guidance and tools from Victoria's publicly owned energy company.",
    href: "https://www.secvictoria.com.au/households",
    group: "government",
    mark: "SEC",
  },
  {
    name: "Victorian Energy Compare",
    type: "Victorian Government service",
    description: "Victoria's free independent electricity and gas plan comparison service.",
    href: "https://compare.energy.vic.gov.au/start",
    group: "government",
    mark: "VIC",
  },
  {
    name: "Rewiring Australia",
    type: "Independent not-for-profit",
    description: "Research and practical education about household electrification, efficient appliances and the energy transition.",
    href: "https://rewiringaustralia.org/",
    group: "consumer",
    logo: "/trusted-resources/rewiring-australia.png",
    logoSource: "https://cdn.prod.website-files.com/68f1420476692a2b7f18c5cf/68f1420476692a2b7f18c9ee_RA_logo_large_Black_transparent%20(1).png",
  },
  {
    name: "Renew",
    type: "Independent registered charity",
    description: "Long-running practical guidance about sustainable homes, electrification, renewable energy and household technology.",
    href: "https://renew.org.au/",
    group: "consumer",
    mark: "renew",
  },
  {
    name: "Energy Consumers Australia",
    type: "Independent consumer body",
    description: "National research and advocacy focused on household and small-business energy outcomes.",
    href: "https://energyconsumersaustralia.com.au/",
    group: "consumer",
    logo: "/trusted-resources/energy-consumers-australia.svg",
    logoSource: "https://energyconsumersaustralia.com.au/themes/custom/eca/logo.svg",
  },
  {
    name: "Australian Building Sustainability Accreditation",
    type: "New-home assessor accrediting body",
    description: "Use the current BDAA directory to check an ABSA-accredited NatHERS assessor for new-home work.",
    href: "https://bdaa.com.au/Web/Web/Accreditation/Search-Accredited-Professionals.aspx",
    group: "industry",
    mark: "ABSA",
  },
  {
    name: "Design Matters National",
    type: "Home energy assessor accrediting body",
    description: "A current accrediting body for new-home NatHERS assessors and the accreditation service for existing-home assessors.",
    href: "https://www.designmatters.org.au/",
    group: "industry",
    logo: "/trusted-resources/design-matters-national.png",
    logoSource: "https://www.designmatters.org.au/images/2023/Logos/DMN-%20BLACK.png?version=360B6B3C",
  },
  {
    name: "Home Energy Raters Association",
    type: "New-home assessor accrediting body",
    description: "A not-for-profit professional body and current accrediting organisation for new-home NatHERS assessors.",
    href: "https://hera.asn.au/",
    group: "industry",
    logo: "/trusted-resources/hera.png",
    logoSource: "https://hera.asn.au/wp-content/uploads/2019/02/HERA-LOGO-1.png",
  },
  {
    name: "Energy Efficiency Council",
    type: "Not-for-profit peak body",
    description: "Industry education and policy work covering energy efficiency, electrification and flexible energy use in homes.",
    href: "https://eec.org.au/for-homes/",
    group: "industry",
    logo: "/trusted-resources/energy-efficiency-council.png",
    logoSource: "https://eec.org.au/wp-content/uploads/2021/10/EEC-acronym_colour_horiz_CMYK-1.png",
  },
  {
    name: "Solar Accreditation Australia",
    type: "Installer accreditation body",
    description: "Check the accreditation status of solar and battery designers or installers under the national scheme.",
    href: "https://saaustralia.com.au/accreditation-status-check/",
    group: "industry",
    logo: "/trusted-resources/solar-accreditation-australia.png",
    logoSource: "https://saaustralia.com.au/wp-content/uploads/2023/11/SAA-Logo-Blue-Dark-1-300x81.png",
  },
  {
    name: "Australian Refrigeration Council",
    type: "Government-appointed licence body",
    description: "Use ARCtick to check the refrigerant-handling licence needed for air-conditioning and refrigeration work.",
    href: "https://www.arctick.org/",
    group: "industry",
    logo: "/trusted-resources/arctick.jpg",
    logoSource: "https://www.arctick.org/images/ARCtick_Logo.jpg",
  },
  {
    name: "Clean Energy Council",
    type: "Not-for-profit industry body",
    description: "Approved-product lists for solar panels, inverters and batteries, plus consumer-code information.",
    href: "https://cleanenergycouncil.org.au/industry-programs/products-program",
    group: "industry",
    logo: "/trusted-resources/clean-energy-council.svg",
    logoSource: "https://cleanenergycouncil.org.au/assets/images/site-logo.svg",
  },
  {
    name: "AIRAH",
    type: "Not-for-profit technical body",
    description: "Technical resources and professional standards for heating, ventilation, air conditioning and refrigeration.",
    href: "https://www.airah.org.au/",
    group: "industry",
    mark: "AIRAH",
  },
  {
    name: "Australian Glass and Window Association",
    type: "Not-for-profit industry body",
    description: "Technical and consumer information about windows, glazing and the Window Energy Rating Scheme.",
    href: "https://www.agwa.com.au/",
    group: "industry",
    logo: "/trusted-resources/agwa.svg",
    logoSource: "https://www.agwa.com.au/images/Website/Template/AGWA-Logo-Blue.svg",
  },
];

const resourceStyles: Record<"card" | "logo" | "logoImage" | "mark" | "type" | "title" | "copy" | "link", CSSProperties> = {
  card: { display: "flex", flexDirection: "column", padding: 14 },
  logo: { alignItems: "center", background: "#fff", border: "1px solid #dbe7e2", borderRadius: 10, display: "flex", height: 76, justifyContent: "center", marginBottom: 13, overflow: "hidden", padding: "9px 14px" },
  logoImage: { height: 54, maxWidth: 180, objectFit: "contain", width: "100%" },
  mark: { color: "var(--color-aea-navy)", fontFamily: "var(--font-aea-heading)", fontSize: "1.35rem", fontWeight: 950, letterSpacing: ".04em" },
  type: { color: "var(--color-aea-green-dark)", fontSize: ".65rem", fontWeight: 900, letterSpacing: ".035em", lineHeight: 1.35, textTransform: "uppercase" },
  title: { color: "var(--color-aea-ink)", fontSize: ".94rem", lineHeight: 1.3, marginTop: 6 },
  copy: { color: "var(--color-aea-muted)", fontSize: ".76rem", lineHeight: 1.52, margin: "6px 0 13px" },
  link: { alignItems: "center", alignSelf: "flex-start", color: "var(--color-aea-green-dark)", display: "inline-flex", fontSize: ".76rem", fontWeight: 900, gap: 5, marginTop: "auto", textDecorationThickness: 1, textUnderlineOffset: 3 },
};

const faqs: readonly PublicFaq[] = [
  {
    question: "Where should I start if I just want to understand my home's energy use?",
    answer: "Start with Your Home for plain-English education. If you want a measured rating, use Home Energy Rating to understand the difference between a new-home NatHERS assessment and an existing-home assessment, then check the right assessor pathway.",
  },
  {
    question: "Does a logo or link here mean Australian Energy Assessments endorses that organisation?",
    answer: "No. The links identify the government program, regulator, not-for-profit or recognised industry body responsible for that information. Inclusion is not a partnership, ranking or guarantee.",
  },
  {
    question: "Does Australian Energy Assessments take product commissions?",
    answer: "Australian Energy Assessments does not sell the equipment being assessed or take product commissions for assessment recommendations. If a commercial or referral relationship is introduced in future, Australian Energy Assessments will disclose it clearly where it affects the choice.",
  },
  {
    question: "What should I check before accepting an installer quote?",
    answer: "Confirm the legal business name, the licence or accreditation required for the exact work, insurance, written scope, product model, program eligibility, exclusions, warranty, timing and payment terms. Also check who handles permits, certificates, disposal and making good.",
  },
  {
    question: "Is the cheapest quote the best choice?",
    answer: "Not necessarily. Compare the same scope, product performance, installation details, evidence, warranty and exclusions. A low price can reflect missing work rather than better value.",
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
      name: "Official and independent Australian home energy resources",
      numberOfItems: resources.length,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: resources.map((resource, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "WebPage",
          name: resource.name,
          description: resource.description,
          url: resource.href,
          ...(resource.logo ? { image: `${PUBLIC_SITE.apexUrl}${resource.logo}` } : {}),
        },
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Trusted home energy resources", item: canonical },
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
    label="Official links and independent guidance"
    title="Trusted home energy resources"
    introduction="A plain-English library of the government programs, regulators, consumer organisations and recognised industry bodies worth knowing. Use it to understand the rules, check claims and find the right evidence before you spend money."
  >
    <JsonLd data={schema} />
    <div className="assessment-asat"><strong>Links and descriptions checked 2 September 2026</strong><span>Logos identify the source only. They do not imply endorsement, partnership or approval of Australian Energy Assessments.</span></div>

    {resourceGroups.map((group) => <GuideSection key={group.id} eyebrow={group.eyebrow} title={group.title}>
      <p>{group.introduction}</p>
      <div className="guide-principle-grid">
        {resources.filter((resource) => resource.group === group.id).map((resource) => <article style={resourceStyles.card} key={resource.href}>
          <div style={resourceStyles.logo} aria-hidden="true">
            {resource.logo
              ? <Image src={resource.logo} alt="" width={180} height={64} sizes="180px" style={resourceStyles.logoImage} />
              : <span style={resourceStyles.mark}>{resource.mark}</span>}
          </div>
          <span style={resourceStyles.type}>{resource.type}</span>
          <h3 style={resourceStyles.title}>{resource.name}</h3>
          <p style={resourceStyles.copy}>{resource.description}</p>
          <a style={resourceStyles.link} href={resource.href} target="_blank" rel="noreferrer" aria-label={`Visit the official ${resource.name} website`}>Visit official website <span aria-hidden="true">↗</span></a>
        </article>)}
      </div>
    </GuideSection>)}

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

    <GuideSection eyebrow="Questions" title="Resource, supplier and installer FAQs">
      <PublicFaqList faqs={faqs} />
    </GuideSection>

    <section className="guide-callout guide-callout-primary"><div><h2>Give trades the same project brief</h2><p>TLink is designed to help you prepare an upgrade request and connect with suitable active trades when they are available. You still check the final licence, insurance, scope, product and warranty before accepting a quote.</p></div><Link href="/direct-trade">Create a TLink project brief</Link></section>
  </GuideShell>;
}
