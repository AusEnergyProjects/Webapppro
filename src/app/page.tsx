import type { Metadata } from "next";
import { GettingStarted } from "@/components/GettingStarted";
import { JsonLd } from "@/components/JsonLd";
import { buildApexMetadata, PUBLIC_SITE } from "@/lib/public-site";

export const metadata: Metadata = buildApexMetadata({
  path: "/",
  title: "Home Energy Assessments Australia | Australian Energy Assessments",
  description: "Independent home energy assessments for new and existing homes, with Australia-wide NatHERS plan assessments and on-site Home Energy Ratings mainly in NSW and Victoria.",
});

const homepageSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${PUBLIC_SITE.apexUrl}/#webpage`,
      url: `${PUBLIC_SITE.apexUrl}/`,
      name: "Australian Energy Assessments | Home Energy Assessments and NatHERS",
      description: metadata.description,
      inLanguage: "en-AU",
      dateModified: "2026-09-03",
      isPartOf: { "@id": PUBLIC_SITE.apexWebsiteId },
      about: { "@id": PUBLIC_SITE.organizationId },
      mainEntity: { "@id": `${PUBLIC_SITE.apexUrl}/#home-energy-assessment-service` },
      hasPart: { "@id": `${PUBLIC_SITE.apexUrl}/#assessment-pathways` },
    },
    {
      "@type": "Service",
      "@id": `${PUBLIC_SITE.apexUrl}/#home-energy-assessment-service`,
      name: "Home energy assessments for Australian homes",
      serviceType: "Home energy assessment",
      description: "Independent help choosing and arranging the right assessment for a new design or an existing home.",
      url: `${PUBLIC_SITE.apexUrl}/`,
      provider: { "@id": PUBLIC_SITE.organizationId },
      areaServed: { "@type": "Country", name: "Australia" },
      availableChannel: [
        {
          "@type": "ServiceChannel",
          serviceUrl: `${PUBLIC_SITE.apexUrl}/book-an-assessment`,
        },
        {
          "@type": "ServiceChannel",
          servicePhone: {
            "@type": "ContactPoint",
            telephone: PUBLIC_SITE.telephone,
            contactType: "assessment enquiries",
          },
        },
      ],
    },
    {
      "@type": "ItemList",
      "@id": `${PUBLIC_SITE.apexUrl}/#assessment-pathways`,
      name: "Australian home energy assessment pathways",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "NatHERS for new homes", url: `${PUBLIC_SITE.apexUrl}/nathers-for-new-homes` },
        { "@type": "ListItem", position: 2, name: "Home Energy Rating for existing homes", url: `${PUBLIC_SITE.apexUrl}/home-energy-rating-for-existing-homes` },
        { "@type": "ListItem", position: 3, name: "NatHERS Whole of Home", url: `${PUBLIC_SITE.apexUrl}/nathers-whole-of-home` },
        { "@type": "ListItem", position: 4, name: "BASIX assessment support", url: `${PUBLIC_SITE.apexUrl}/basix-nsw` },
      ],
    },
  ],
};

export default function Home() {
  return <><JsonLd data={homepageSchema} /><GettingStarted /></>;
}
