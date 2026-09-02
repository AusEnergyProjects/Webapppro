import Link from "next/link";
import { GuideSection, GuideShell } from "@/components/GuideShell";
import { JsonLd } from "@/components/JsonLd";
import { PUBLIC_SITE } from "@/lib/public-site";

export type AuthoritativeGuideSection = {
  eyebrow: string;
  title: string;
  paragraphs?: readonly string[];
  items?: readonly string[];
  note?: { title: string; text: string };
};

export type AuthoritativeGuideSource = {
  label: string;
  href: string;
};

type AuthoritativeGuidePageProps = {
  path: `/${string}`;
  label: string;
  title: string;
  description: string;
  introduction: string;
  publishedIso: `${number}-${number}-${number}`;
  reviewedIso: `${number}-${number}-${number}`;
  topics: readonly string[];
  sections: readonly AuthoritativeGuideSection[];
  sources: readonly AuthoritativeGuideSource[];
  cta: { title: string; text: string; href: string; label: string };
};

export function AuthoritativeGuidePage({
  path,
  label,
  title,
  description,
  introduction,
  publishedIso,
  reviewedIso,
  topics,
  sections,
  sources,
  cta,
}: AuthoritativeGuidePageProps) {
  const canonical = new URL(path, `${PUBLIC_SITE.apexUrl}/`).toString();
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${canonical}#article`,
        headline: title,
        description,
        url: canonical,
        mainEntityOfPage: { "@id": `${canonical}#webpage` },
        author: { "@id": PUBLIC_SITE.organizationId },
        publisher: { "@id": PUBLIC_SITE.organizationId },
        image: `${PUBLIC_SITE.apexUrl}/aea-home-energy-plan-og-v2.png`,
        datePublished: publishedIso,
        dateModified: reviewedIso,
        inLanguage: "en-AU",
        isAccessibleForFree: true,
        citation: sources.map((source) => source.href),
        about: topics.map((name) => ({ "@type": "Thing", name })),
      },
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: title,
        description,
        dateModified: reviewedIso,
        inLanguage: "en-AU",
        isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId },
        breadcrumb: { "@id": `${canonical}#breadcrumb` },
        mainEntity: { "@id": `${canonical}#article` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
          { "@type": "ListItem", position: 2, name: "Guides", item: `${PUBLIC_SITE.apexUrl}/guides` },
          { "@type": "ListItem", position: 3, name: title, item: canonical },
        ],
      },
    ],
  };

  return <GuideShell label={label} title={title} introduction={introduction}>
    <JsonLd data={schema} />
    <div className="assessment-asat">
      <strong>Reviewed {reviewedIso}</strong>
      <span>Written for household decisions. Official sources are linked below for rules and program details.</span>
    </div>
    {sections.map((section) => <GuideSection eyebrow={section.eyebrow} title={section.title} key={section.title}>
      {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {section.items && <ul className="guide-checklist">{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
      {section.note && <div className="guide-note"><strong>{section.note.title}</strong><p>{section.note.text}</p></div>}
    </GuideSection>)}
    <GuideSection eyebrow="Check the source" title="Current official guidance">
      <div className="guide-source-links">{sources.map((source) => <a href={source.href} target="_blank" rel="noreferrer" key={source.href}>{source.label}</a>)}</div>
    </GuideSection>
    <section className="guide-callout"><div><h2>{cta.title}</h2><p>{cta.text}</p></div><Link href={cta.href}>{cta.label}</Link></section>
  </GuideShell>;
}
