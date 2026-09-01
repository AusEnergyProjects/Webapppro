import Link from "next/link";
import { GuideSection, GuideShell } from "@/components/GuideShell";
import { JsonLd } from "@/components/JsonLd";
import { PublicFaqList, type PublicFaq } from "@/components/PublicFaqList";
import { PUBLIC_SITE, buildApexMetadata } from "@/lib/public-site";

const path = "/communities-schools";
const canonical = `${PUBLIC_SITE.apexUrl}${path}`;
const title = "Home Energy Talks for Communities and Schools | Australian Energy Assessments";
const description = "Plain-language home energy talks and workshops for councils, schools and community groups, with the format, travel, cost and learning goals agreed first.";

export const metadata = buildApexMetadata({ path, title, description });

const faqs: readonly PublicFaq[] = [
  {
    question: "Are community sessions free?",
    answer: "Some speaking engagements may be offered on a volunteer basis and more involved sessions may be paid work. It depends on the audience, preparation, travel, presenter availability and materials. We confirm this before anything is booked.",
  },
  {
    question: "Can you visit a school or community venue?",
    answer: "Possibly. In-person availability depends on the location, date and presenter. An online talk may suit groups outside our current travel areas. For schools, we also confirm supervision, child-safety and venue requirements before agreeing to a visit.",
  },
  {
    question: "Can the content suit different age groups?",
    answer: "Yes, once we know the age range and learning goal. A primary-school activity, a senior-student discussion and a homeowner information night need different language, examples and session plans.",
  },
  {
    question: "Do participants receive products or take-home materials?",
    answer: "Any hands-on items, demonstrations or take-home material are confirmed as part of the session plan. We do not promise products before the format, safety requirements and budget are agreed.",
  },
];

const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service",
      "@id": `${canonical}#service`,
      name: "Home energy education for communities and schools",
      serviceType: "Community and school home energy talks and workshops",
      description,
      url: canonical,
      provider: { "@id": PUBLIC_SITE.organizationId },
      audience: [
        { "@type": "Audience", audienceType: "Community groups" },
        { "@type": "EducationalAudience", educationalRole: "student" },
        { "@type": "Audience", audienceType: "Local government programs" },
      ],
      availableChannel: {
        "@type": "ServiceChannel",
        serviceUrl: `${PUBLIC_SITE.apexUrl}/book-an-assessment`,
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
      breadcrumb: { "@id": `${canonical}#breadcrumb` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
        { "@type": "ListItem", position: 2, name: "Communities and schools", item: canonical },
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

export default function CommunitiesAndSchoolsPage() {
  return <GuideShell
    label="Community energy education"
    title="Home energy talks and workshops people can actually follow"
    introduction="Tell us who the session is for and what you want people to understand. We will shape the language, examples and format around the audience, then confirm the practical details before you commit."
  >
    <JsonLd data={schema} />
    <div className="assessment-asat"><strong>Session information reviewed 2 September 2026</strong><span>Format, presenter, travel, cost, accessibility, safety requirements and any materials are agreed before booking.</span></div>

    <GuideSection eyebrow="Who it is for" title="Start with the people in the room">
      <div className="guide-principle-grid">
        <article><strong>Community groups</strong><p>Practical sessions for homeowners, renters and neighbours who want clearer answers about comfort, bills and home upgrades.</p></article>
        <article><strong>Schools</strong><p>Age-appropriate explanations and activities built around a clear learning goal, with school supervision and child-safety requirements confirmed first.</p></article>
        <article><strong>Councils and local programs</strong><p>Information sessions that help residents understand assessments, common upgrades, official support and the questions to ask before buying.</p></article>
      </div>
    </GuideSection>

    <GuideSection eyebrow="Possible topics" title="Choose a few useful questions, not a wall of jargon">
      <ul className="guide-checklist">
        <li>Why some homes are hard to keep warm or cool</li>
        <li>How insulation, shading and draughts affect comfort</li>
        <li>What an energy bill can show, and what it cannot</li>
        <li>How efficient heating, cooling and hot water work</li>
        <li>Where solar and batteries may fit</li>
        <li>How home energy ratings differ for new and existing homes</li>
        <li>How to check a rebate or finance claim</li>
        <li>What to ask an assessor, installer or supplier</li>
      </ul>
    </GuideSection>

    <GuideSection eyebrow="Format" title="A session that fits the audience and the time available">
      <div className="guide-card-grid">
        <article className="guide-card"><span>Short talk</span><h3>One clear topic with time for questions</h3><p>Useful for an information night, staff session or community event where people need a practical overview without technical overload.</p></article>
        <article className="guide-card"><span>Interactive workshop</span><h3>Examples, discussion and simple checks</h3><p>Suitable when the group has more time and wants to work through home examples, compare claims or practise reading energy information.</p></article>
      </div>
      <div className="guide-note"><strong>Volunteer or paid?</strong><p>Some talks may be offered as volunteer engagements. Sessions that need tailored material, travel, activities or extended preparation may be paid. We confirm the arrangement clearly before booking.</p></div>
    </GuideSection>

    <GuideSection eyebrow="What to tell us" title="Six details make the first conversation useful">
      <ul className="guide-checklist">
        <li>Organisation and main contact</li>
        <li>Audience age range and expected group size</li>
        <li>Location or online preference</li>
        <li>Preferred dates and session length</li>
        <li>The one thing participants should understand afterwards</li>
        <li>Accessibility, supervision and venue requirements</li>
      </ul>
    </GuideSection>

    <GuideSection eyebrow="Questions" title="Community and school session FAQs">
      <PublicFaqList faqs={faqs} />
    </GuideSection>

    <section className="guide-callout guide-callout-primary"><div><h2>Talk through the session idea</h2><p>Use the five-minute call to tell us about the organisation, audience, location and preferred date. We will confirm whether there is a suitable format and presenter.</p></div><Link href="/book-an-assessment">Book now</Link></section>
  </GuideShell>;
}
