import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/JsonLd";
import { SiteFooter, SiteHeader } from "@/components/ComparatorChrome";
import { PUBLIC_SITE } from "@/lib/public-site";

export type AssessmentServiceCard = {
  label: string;
  title: string;
  description: string;
  boundaryTitle: string;
  boundary: string;
  evidenceTitle: string;
  evidence: readonly string[];
  outputTitle: string;
  output: string;
  href: string;
  linkLabel: string;
};

export type AssessmentServiceStep = {
  title: string;
  description: string;
};

export type AssessmentServiceSource = {
  title: string;
  description: string;
  href: string;
  linkLabel: string;
};

export type AssessmentServiceFaq = {
  question: string;
  answer: string;
};

export type AssessmentServiceAction = {
  label: string;
  href: string;
};

type AssessmentServicePageProps = {
  path: string;
  breadcrumbLabel: string;
  eyebrow: string;
  title: string;
  introduction: string;
  reviewed: string;
  reviewNote: string;
  cardsEyebrow: string;
  cardsTitle: string;
  cards: readonly AssessmentServiceCard[];
  processEyebrow: string;
  processTitle: string;
  steps: readonly AssessmentServiceStep[];
  beforeSources?: ReactNode;
  sources: readonly AssessmentServiceSource[];
  faqTitle: string;
  faqs: readonly AssessmentServiceFaq[];
  ctaEyebrow: string;
  ctaTitle: string;
  ctaDescription: string;
  ctaActions: readonly AssessmentServiceAction[];
  serviceName: string;
  serviceType: string;
  areaServed?: string;
  coverageTitle?: string;
  coverageDescription?: string;
  footer: string;
};

type AssessmentMetadataInput = {
  path: string;
  title: string;
  description: string;
};

function canonicalUrl(path: string) {
  return new URL(path, PUBLIC_SITE.apexUrl).toString();
}

export function buildAssessmentMetadata({ path, title, description }: AssessmentMetadataInput): Metadata {
  const canonical = canonicalUrl(path);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      siteName: "Australian Energy Assessments",
      locale: "en_AU",
      images: [{
        url: `${PUBLIC_SITE.platformUrl}/aea-home-energy-plan-og-v2.png`,
        width: 1731,
        height: 909,
        alt: "Australian Energy Assessments home energy assessment services",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${PUBLIC_SITE.platformUrl}/aea-home-energy-plan-og-v2.png`],
    },
  };
}

function AssessmentLink({ href, children }: { href: string; children: string }) {
  if (href.startsWith("/")) {
    return <Link href={href}>{children}</Link>;
  }

  const opensNewTab = href.startsWith("http://") || href.startsWith("https://");
  return (
    <a href={href} target={opensNewTab ? "_blank" : undefined} rel={opensNewTab ? "noreferrer" : undefined}>
      {children}
    </a>
  );
}

export function AssessmentServicePage({
  path,
  breadcrumbLabel,
  eyebrow,
  title,
  introduction,
  reviewed,
  reviewNote,
  cardsEyebrow,
  cardsTitle,
  cards,
  processEyebrow,
  processTitle,
  steps,
  beforeSources,
  sources,
  faqTitle,
  faqs,
  ctaEyebrow,
  ctaTitle,
  ctaDescription,
  ctaActions,
  serviceName,
  serviceType,
  areaServed,
  coverageTitle,
  coverageDescription,
  footer,
}: AssessmentServicePageProps) {
  const canonical = canonicalUrl(path);
  const telephoneIsVisible = ctaActions.some((action) => action.href === PUBLIC_SITE.phoneHref);
  const emailIsVisible = ctaActions.some((action) => action.href === `mailto:${PUBLIC_SITE.email}`);
  const availableChannel = [
    ...(telephoneIsVisible ? [{
      "@type": "ServiceChannel",
      servicePhone: {
        "@type": "ContactPoint",
        telephone: PUBLIC_SITE.phoneHref.replace("tel:", ""),
        contactType: "assessment enquiries",
      },
    }] : []),
    ...(emailIsVisible ? [{
      "@type": "ServiceChannel",
      serviceUrl: `mailto:${PUBLIC_SITE.email}`,
    }] : []),
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        "@id": `${canonical}#service`,
        name: serviceName,
        serviceType,
        description: introduction,
        url: canonical,
        mainEntityOfPage: { "@id": `${canonical}#webpage` },
        provider: { "@id": PUBLIC_SITE.organizationId },
        ...(areaServed ? {
          areaServed: areaServed === "Australia"
            ? { "@type": "Country", name: areaServed }
            : { "@type": "AdministrativeArea", name: areaServed },
        } : {}),
        ...(availableChannel.length > 0 ? { availableChannel } : {}),
      },
      {
        "@type": "WebPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: title,
        description: introduction,
        inLanguage: "en-AU",
        about: { "@id": `${canonical}#service` },
        breadcrumb: { "@id": `${canonical}#breadcrumb` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${PUBLIC_SITE.apexUrl}/` },
          { "@type": "ListItem", position: 2, name: "Assessments", item: `${PUBLIC_SITE.apexUrl}/assessments` },
          { "@type": "ListItem", position: 3, name: breadcrumbLabel, item: canonical },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${canonical}#faq`,
        isPartOf: { "@id": `${canonical}#webpage` },
        mainEntity: faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };

  return (
    <main className="wrap assessments-page">
      <JsonLd data={structuredData} />
      <SiteHeader active="assessments" />

      <nav className="guide-source-links" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link href="/assessments">Assessments</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{breadcrumbLabel}</span>
      </nav>

      <header className="guide-hero assessments-hero">
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{introduction}</p>
      </header>

      <div className="assessment-asat">
        <strong>Official guidance reviewed {reviewed}</strong>
        <span>{reviewNote}</span>
      </div>

      {coverageTitle && coverageDescription && <div className="assessment-coverage">
        <strong>{coverageTitle}</strong>
        <span>{coverageDescription}</span>
      </div>}

      <section className="assessment-section" aria-labelledby="assessment-service-scope">
        <div className="guide-section-heading">
          <span>{cardsEyebrow}</span>
          <h2 id="assessment-service-scope">{cardsTitle}</h2>
        </div>
        <div className="assessment-card-grid">
          {cards.map((card) => (
            <article className="assessment-card" key={card.title}>
              <div>
                <span>{card.label}</span>
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </div>
              <div className="assessment-boundary">
                <strong>{card.boundaryTitle}</strong>
                <p>{card.boundary}</p>
              </div>
              <div className="assessment-evidence">
                <strong>{card.evidenceTitle}</strong>
                <ul>{card.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
              <div className="assessment-output">
                <strong>{card.outputTitle}</strong>
                <p>{card.output}</p>
              </div>
              <AssessmentLink href={card.href}>{card.linkLabel}</AssessmentLink>
            </article>
          ))}
        </div>
      </section>

      <section className="assessment-section" aria-labelledby="assessment-service-process">
        <div className="guide-section-heading">
          <span>{processEyebrow}</span>
          <h2 id="assessment-service-process">{processTitle}</h2>
        </div>
        <ol className="assessment-process">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {beforeSources}

      <section className="assessment-two-column" aria-label="Official sources">
        {sources.map((source) => (
          <article key={source.href}>
            <span>Official source</span>
            <h2>{source.title}</h2>
            <p>{source.description}</p>
            <a href={source.href} target="_blank" rel="noreferrer">{source.linkLabel}</a>
          </article>
        ))}
      </section>

      <section className="assessment-section" aria-labelledby="assessment-service-faq">
        <div className="guide-section-heading">
          <span>Clear answers</span>
          <h2 id="assessment-service-faq">{faqTitle}</h2>
        </div>
        <div className="assessment-two-column">
          {faqs.map((faq) => (
            <article key={faq.question}>
              <span>Question</span>
              <h2>{faq.question}</h2>
              <p>{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="assessment-upload-boundary">
        <div>
          <span>{ctaEyebrow}</span>
          <h2>{ctaTitle}</h2>
          <p>{ctaDescription}</p>
        </div>
        {ctaActions.map((action) => (
          <AssessmentLink href={action.href} key={action.href}>{action.label}</AssessmentLink>
        ))}
      </section>

      <SiteFooter>{footer}</SiteFooter>
    </main>
  );
}
